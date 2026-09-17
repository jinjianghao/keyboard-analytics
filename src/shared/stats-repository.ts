/**
 * SQLite 数据访问层。
 *
 * 高频采集写入（缓存批写/事务/定时同步）与查询共用同一连接。
 * 查询结果全部为纯数据对象，可安全地序列化给渲染进程或 Mastra agent 工具使用。
 */
import sqlite3 from 'sqlite3'
import path from 'node:path'
import type { DailyStats } from '../shared/types.ts'

/** 项目根目录（dev = 启动 cwd；产物由主进程 spawn 继承同一 cwd） */
function projectRoot(): string {
  return path.resolve(process.cwd())
}

/** 解析数据库文件路径（支持外部通过环境变量覆盖） */
export function getDbPath(): string {
  return process.env.KEYBOARD_DB_PATH
    ? path.resolve(process.env.KEYBOARD_DB_PATH)
    : path.resolve(projectRoot(), 'keyboard_stats.db')
}

export interface NormalKeyRow {
  key: string
  count: number
  date: string
}

export interface ShortcutKeyRow {
  combination: string
  count: number
  date: string
}

export interface MouseEventRow {
  button: string
  count: number
  date: string
}

export interface TableSchemaColumn {
  name: string
  type: string
}

export interface TableSchema {
  table: string
  columns: TableSchemaColumn[]
}

/** 开启 WAL，提升高频写入性能 */
function configure(db: sqlite3.Database): void {
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
}

export function createDb(): sqlite3.Database {
  const db = new sqlite3.Database(getDbPath())
  configure(db)
  return db
}

export function closeDb(db: sqlite3.Database): void {
  db.close()
}

/** 整表结构描述（供 agent 生成 SQL 使用） */
export function getSchema(db: sqlite3.Database): Promise<TableSchema[]> {
  const { promise, resolve, reject } = Promise.withResolvers<TableSchema[]>()
  db.all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    (err, tables: Array<{ name: string }>) => {
      if (err) return reject(err)
      const result: TableSchema[] = []
      let pending = tables.length
      if (pending === 0) return resolve(result)
      tables.forEach(t => {
        db.all(`PRAGMA table_info(${t.name})`, (err2, cols: Array<{ name: string; type: string }>) => {
          if (err2) return reject(err2)
          result.push({ table: t.name, columns: cols.map(c => ({ name: c.name, type: c.type })) })
          if (--pending === 0) resolve(result)
        })
      })
    }
  )
  return promise
}

/** 执行只读查询，返回行数组与列名 */
export function query(
  db: sqlite3.Database,
  sql: string,
  params: unknown[] = []
): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    rows: Record<string, unknown>[]
    columns: string[]
  }>()
  db.all(sql, params as never, (err, rows) => {
    if (err) return reject(err)
    const columns = rows.length > 0 ? Object.keys(rows[0] as object) : []
    resolve({ rows: rows as Record<string, unknown>[], columns })
  })
  return promise
}

/** 当日统计（与历史键盘数据面板共用） */
export function getDailyStats(db: sqlite3.Database, dateStr: string): Promise<DailyStats> {
  const { promise, resolve, reject } = Promise.withResolvers<DailyStats>()
  const sql = `
    SELECT n.key as key, n.count as count, 'normal' as type FROM normal_keys n WHERE n.date = ?
    UNION ALL
    SELECT s.combination as key, s.count as count, 'shortcut' as type FROM shortcut_keys s WHERE s.date = ?
    UNION ALL
    SELECT m.button as key, m.count as count, 'mouse' as type FROM mouse_events m WHERE m.date = ?
  `
  db.all(sql, [dateStr, dateStr, dateStr], (err, rows: Array<{ key: string; count: number; type: string }>) => {
    if (err) return reject(err)
    const stats: DailyStats = {
      keyPresses: {},
      combinationPresses: {},
      mousePresses: {},
      totalPresses: 0
    }
    rows.forEach(row => {
      if (row.type === 'normal') {
        stats.keyPresses[row.key] = row.count
        stats.totalPresses += row.count
      } else if (row.type === 'shortcut') {
        stats.combinationPresses[row.key] = row.count
      } else if (row.type === 'mouse') {
        stats.mousePresses[row.key] = row.count
      }
    })
    resolve(stats)
  })
  return promise
}

/** 本地时区的当天日期 yyyy-mm-dd（与旧实现保持一致） */
export function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function yesterdayLocal(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}