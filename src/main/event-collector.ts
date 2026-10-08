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
   */
  handleKeyTransition(stdName: string, isDown: boolean): void {
    if (isDown) {
      this.tracker.down(stdName)
      return
    }
    const result = this.tracker.up(stdName)
    if (result === 'normal') this.countNormalKey(stdName)
    else if (result === 'combo') this.countCombinationKey(stdName)
  }

  handleMouseEvent(buttonName: string): void {
    this.mouseCache.set(buttonName, (this.mouseCache.get(buttonName) ?? 0) + 1)
    if (this.mouseCache.size >= CONSTANTS.NORMAL_CACHE_THRESHOLD) void this.syncMouse()
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
    await this.upsert({
      table,
      keyColumn,
      entries: [...cache.entries()]
    })
    cache.clear()
    this.onSynced?.()
  }

  private async syncMouse(): Promise<void> {
    if (this.syncLock) return
    if (this.mouseCache.size === 0) return
    await this.upsert({
      table: 'mouse_events',
      keyColumn: 'button',
      entries: [...this.mouseCache.entries()]
    })
    this.mouseCache.clear()
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
    if (this.normalCache.size > 0) await this.sync(false)
    if (this.shortcutCache.size > 0) await this.sync(true)
    if (this.mouseCache.size > 0) await this.syncMouse()
  }

  /** 退出前冲刷缓存，避免丢数据 */
  async flushAndClose(): Promise<void> {
    clearInterval(this.timer)
    await this.syncAll()
    await new Promise<void>(resolve => this.db.close(() => resolve()))
  }
}
