/**
 * 键盘/鼠标事件采集管理器（主进程）。
 *
 * 从旧实现 index.js 移植，行为保持一致：
 * - 缓存写入：普通键/组合键/鼠标事件先入 Map，达阈值或 30s 定时批量写库
 * - 事务包裹批量写入，失败回滚
 * 单独持有数据库连接（createDb 返回独立连接），避免与查询连接串扰。
 *
 * 组合键判定（修复"单独按修饰键也被计入组合统计"）：
 * - 通过 handleKeyTransition 跟踪按键"按下/抬起"；
 * - 修饰键（Shift/Ctrl/Alt/Cmd/Fn）只有与某个非修饰键同时按住（配对）时，
 *   才计为组合键；单独按下并抬起（无配对按键）的修饰键不计入。
 * - 非修饰键始终作为普通键计入。
 */
import type sqlite3 from 'sqlite3'
import { createDb, todayLocal } from '../shared/stats-repository.ts'
import { keyDisplayName } from './key-name-map.ts'
import { ShortcutTracker } from './shortcut-tracker.ts'

const CONSTANTS = {
  NORMAL_CACHE_THRESHOLD: 5,
  SHORTCUT_CACHE_THRESHOLD: 5,
  SYNC_INTERVAL_MS: 30_000
} as const

interface UpsertArgs {
  table: 'normal_keys' | 'shortcut_keys' | 'mouse_events'
  keyColumn: string
  entries: Array<[string, number]>
}

export class EventCollector {
  private db: sqlite3.Database
  private normalCache = new Map<string, number>()
  private shortcutCache = new Map<string, number>()
  private mouseCache = new Map<string, number>()
  private syncLock = false
  private timer: NodeJS.Timeout | undefined
  /** 采集开关：暂停时忽略新事件（已缓存数据保留，避免丢失） */
  private enabled = true
  /** 组合键配对判定（纯逻辑） */
  private tracker = new ShortcutTracker()

  /** 每次成功写库后的回调（供主进程通知渲染层刷新，替代轮询） */
  private onSynced?: () => void

  constructor(onSynced?: () => void) {
    this.db = createDb()
    this.onSynced = onSynced
    this.timer = setInterval(() => void this.syncAll(), CONSTANTS.SYNC_INTERVAL_MS)
    this.timer.unref()
  }

  /**
   * 处理按键"按下/抬起"转换。普通键在"抬起"时计数（与既有行为一致，天然去重
   * 键盘自动重复）；修饰键是否计入组合由 ShortcutTracker 判定。
   *
   * 暂停（enabled=false）时：仍维护 tracker 状态（保证按下/抬起配对、不残留），
   * 只是不计数——避免暂停期间的按下污染配对状态导致恢复后误判。
   * 返回值供主进程决定实时 ticker 分流（down 表示本次为按下事件）。
   */
  handleKeyTransition(stdName: string, isDown: boolean): 'down' | 'normal' | 'combo' | 'ignore' {
    if (isDown) {
      this.tracker.down(stdName)
      return 'down'
    }
    const result = this.tracker.up(stdName)
    if (!this.enabled) return result
    if (result === 'normal') this.countNormalKey(stdName)
    else if (result === 'combo') this.countCombinationKey(stdName)
    return result
  }

  handleMouseEvent(buttonName: string): void {
    if (!this.enabled) return
    this.mouseCache.set(buttonName, (this.mouseCache.get(buttonName) ?? 0) + 1)
    if (this.mouseCache.size >= CONSTANTS.NORMAL_CACHE_THRESHOLD) void this.syncMouse()
  }

  /**
   * 开/关采集。关闭时先把已缓存数据冲刷落盘（不丢数据），之后忽略新事件。
   * 开启后从干净状态恢复计数。
   */
  async setEnabled(on: boolean): Promise<void> {
    if (on === this.enabled) return
    if (!on) {
      this.enabled = false
      await this.syncAll()
    } else {
      this.enabled = true
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /** 清空所有统计数据（表 + 缓存），用于"清除数据"。 */
  async clearAll(): Promise<void> {
    this.normalCache.clear()
    this.shortcutCache.clear()
    this.mouseCache.clear()
    await new Promise<void>((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('DELETE FROM normal_keys', e => e && reject(e))
        this.db.run('DELETE FROM shortcut_keys', e => e && reject(e))
        this.db.run('DELETE FROM mouse_events', e => (e ? reject(e) : resolve()))
      })
    })
    this.onSynced?.()
  }

  private countNormalKey(stdName: string): void {
    const stored = keyDisplayName(stdName)
    this.normalCache.set(stored, (this.normalCache.get(stored) ?? 0) + 1)
    if (this.normalCache.size >= CONSTANTS.NORMAL_CACHE_THRESHOLD) void this.sync(false)
  }

  private countCombinationKey(stdName: string): void {
    const stored = keyDisplayName(stdName)
    this.shortcutCache.set(stored, (this.shortcutCache.get(stored) ?? 0) + 1)
    if (this.shortcutCache.size >= CONSTANTS.SHORTCUT_CACHE_THRESHOLD) void this.sync(true)
  }

  private async sync(isShortcut: boolean): Promise<void> {
    if (this.syncLock) return
    const cache = isShortcut ? this.shortcutCache : this.normalCache
    if (cache.size === 0) return
    const table = isShortcut ? 'shortcut_keys' : 'normal_keys'
    const keyColumn = isShortcut ? 'combination' : 'key'
    // 原子换出：先取走快照并换成新 Map，await 期间新事件写入新 Map，
    // 不会被本轮的 clear 误删（消除"快照后 clear 丢数据"竞态）。
    const entries = [...cache.entries()]
    if (isShortcut) this.shortcutCache = new Map()
    else this.normalCache = new Map()
    try {
      await this.upsert({ table, keyColumn, entries })
    } catch (err) {
      // 写库失败：把本轮条目并回当前缓存，等待下次触发/定时重试，不丢数据。
      const target = isShortcut ? this.shortcutCache : this.normalCache
      for (const [k, c] of entries) target.set(k, (target.get(k) ?? 0) + c)
      throw err
    }
    this.onSynced?.()
  }

  private async syncMouse(): Promise<void> {
    if (this.syncLock) return
    if (this.mouseCache.size === 0) return
    const entries = [...this.mouseCache.entries()]
    this.mouseCache = new Map()
    try {
      await this.upsert({ table: 'mouse_events', keyColumn: 'button', entries })
    } catch (err) {
      for (const [k, c] of entries) this.mouseCache.set(k, (this.mouseCache.get(k) ?? 0) + c)
      throw err
    }
    this.onSynced?.()
  }

  private async upsert({ table, keyColumn, entries }: UpsertArgs): Promise<void> {
    this.syncLock = true
    const date = todayLocal()
    const sql = `INSERT INTO ${table} (${keyColumn}, count, date, timestamp)
                 VALUES (?, ?, ?, datetime('now'))
                 ON CONFLICT(${keyColumn}, date)
                 DO UPDATE SET count = count + ?, timestamp = datetime('now')
                 WHERE ${keyColumn} = ? AND date = ?`
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    this.db.serialize(() => {
      this.db.run('BEGIN TRANSACTION', beginErr => {
        if (beginErr) {
          this.syncLock = false
          return reject(beginErr)
        }
        let i = 0
        const runNext = (): void => {
          if (i >= entries.length) {
            this.db.run('COMMIT', commitErr => {
              this.syncLock = false
              commitErr ? reject(commitErr) : resolve()
            })
            return
          }
          const [key, count] = entries[i]
          this.db.run(sql, [key, count, date, count, key, date], err => {
            if (err) {
              this.db.run('ROLLBACK', () => {
                this.syncLock = false
                reject(err)
              })
              return
            }
            i++
            runNext()
          })
        }
        runNext()
      })
    })
    return promise
  }

  private async syncAll(): Promise<void> {
    // 逐个冲刷并吞掉单表失败（记录日志），避免一个表失败阻断其余表写入 / 退出流程，
    // 也避免定时器触发的 syncAll 产生未处理的 Promise rejection。
    if (this.normalCache.size > 0) await this.sync(false).catch(e => console.error('[collector] 普通键冲刷失败:', e))
    if (this.shortcutCache.size > 0) await this.sync(true).catch(e => console.error('[collector] 组合键冲刷失败:', e))
    if (this.mouseCache.size > 0) await this.syncMouse().catch(e => console.error('[collector] 鼠标冲刷失败:', e))
  }

  /** 退出前冲刷缓存，避免丢数据 */
  async flushAndClose(): Promise<void> {
    clearInterval(this.timer)
    await this.syncAll()
    await new Promise<void>(resolve => this.db.close(() => resolve()))
  }
}
