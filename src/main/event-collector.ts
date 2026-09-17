/**
 * 键盘/鼠标事件采集管理器（主进程）。
 *
 * 从旧实现 index.js 移植，行为保持一致：
 * - 缓存写入：普通键/组合键/鼠标事件先入 Map，达阈值或 30s 定时批量写库
 * - 事务包裹批量写入，失败回滚
 * 单独持有数据库连接（createDb 返回独立连接），避免与查询连接串扰。
 */
import type sqlite3 from 'sqlite3'
import { createDb, todayLocal } from '../shared/stats-repository.ts'

const SPECIAL_KEYS: Record<string, true> = {
  Ctrl: true,
  Shift: true,
  Alt: true,
  Command: true
}

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

  constructor() {
    this.db = createDb()
    this.timer = setInterval(() => void this.syncAll(), CONSTANTS.SYNC_INTERVAL_MS)
    this.timer.unref()
  }

  isShortcutKey(keyName: string): boolean {
    return keyName.includes('+') || SPECIAL_KEYS[keyName] === true
  }

  handleKeyPress(keyName: string): void {
    const isShortcut = this.isShortcutKey(keyName)
    const cache = isShortcut ? this.shortcutCache : this.normalCache
    const threshold = isShortcut ? CONSTANTS.SHORTCUT_CACHE_THRESHOLD : CONSTANTS.NORMAL_CACHE_THRESHOLD
    cache.set(keyName, (cache.get(keyName) ?? 0) + 1)
    if (cache.size >= threshold) void this.sync(isShortcut)
  }

  handleMouseEvent(buttonName: string): void {
    this.mouseCache.set(buttonName, (this.mouseCache.get(buttonName) ?? 0) + 1)
    if (this.mouseCache.size >= CONSTANTS.NORMAL_CACHE_THRESHOLD) void this.syncMouse()
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