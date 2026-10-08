/**
 * SQLite 查询工具——供 Mastra agent 使用。
 *
 * 注意：Mastra server 运行在独立的 Node 进程，与 Electron 主进程共享同一个
 * SQLite 文件（WAL 模式支持多进程并发读写）。进程内复用共享连接，避免每个
 * 工具调用都开关连接（连接抖动）；进程退出时由 server 统一 close。
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getSharedQueryDb, getSchema, query, getDailyStats, type TableSchema } from '../../shared/stats-repository.ts'

/**
 * 只读 SQL 执行工具。
 * 通过黑名单拦截写操作，防止 agent 生成破坏性 SQL。
 */
export const executeQueryTool = createTool({
  id: 'execute-query',
  description:
    '对键盘统计数据 SQLite 数据库执行只读 SELECT 查询，返回行数组与列名。禁止执行任何写操作（INSERT/UPDATE/DELETE/DROP/ALTER 等）。',
  inputSchema: z.object({
    sql: z.string().describe('只读 SELECT SQL 语句，SQLite 方言，日期用 yyyy-mm-dd 字符串')
  }),
  outputSchema: z.object({
    rows: z.array(z.record(z.string(), z.unknown())),
    columns: z.array(z.string()),
    rowCount: z.number()
  }),
  execute: async ({ sql }) => {
    const blocked =
      /^\s*(insert|update|delete|drop|alter|create|replace|truncate|vacuum|attach|detach|pragma|reindex)\b/i.test(
        sql
      )
    if (blocked) {
      throw new Error('仅允许只读 SELECT 查询')
    }
    const { rows, columns } = await query(getSharedQueryDb(), sql)
    return { rows, columns, rowCount: rows.length }
  }
})

/** 数据库结构读取工具；schema 进程内缓存，避免每次回答都重查（结构极少变化） */
let cachedSchema: TableSchema[] | null = null
export const getSchemaTool = createTool({
  id: 'get-schema',
  description: '获取键盘统计数据库的表结构与列定义，用于理解可查询的数据模型。',
  inputSchema: z.object({}),
  outputSchema: z.object({
    schema: z.array(
      z.object({
        table: z.string(),
        columns: z.array(z.object({ name: z.string(), type: z.string() }))
      })
    )
  }),
  execute: async () => {
    if (!cachedSchema) {
      cachedSchema = await getSchema(getSharedQueryDb())
    }
    return { schema: cachedSchema }
  }
})

/** 当日统计读取工具（供面板/agent 快速取汇总） */
export const getDailyStatsTool = createTool({
  id: 'get-daily-stats',
  description: '获取指定日期的按键/组合键/鼠标点击统计汇总。date 格式 yyyy-mm-dd。',
  inputSchema: z.object({
    date: z.string().describe('日期，格式 yyyy-mm-dd')
  }),
  outputSchema: z.object({
    keyPresses: z.record(z.string(), z.number()),
    combinationPresses: z.record(z.string(), z.number()),
    mousePresses: z.record(z.string(), z.number()),
    totalPresses: z.number()
  }),
  execute: async ({ date }) => {
    return await getDailyStats(getSharedQueryDb(), date)
  }
})