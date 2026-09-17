/**
 * 键盘数据分析 agent。
 *
 * 模型路由优先级：
 * 1. MASTRA_MODEL 显式指定
 * 2. LLM_PROVIDER=qianfan（默认）→ 千帆（百度智能云）DeepSeek，OpenAI 兼容端点
 * 3. LLM_PROVIDER=ollama → 本地 Ollama
 * 4. 其他 → 云模型（CLOUD_MODEL）
 *
 * 配置值来自 .env（server.ts 启动时通过 loadEnvFile 加载）。
 */
import { Agent } from '@mastra/core/agent'
import { executeQueryTool, getSchemaTool, getDailyStatsTool } from '../tools/sqlite-tools.ts'

type ModelConfig = string | { id: `${string}/${string}`; url?: string; apiKey?: string }

export function resolveModel(): ModelConfig {
  // 运行时读取：Mastra 支持 model 为函数，在每次请求时调用，
  // 此时 server.ts 已 loadEnvFile（ESM import 提升导致模块求值早于 loadEnvFile）
  const provider = process.env.LLM_PROVIDER ?? 'qianfan'
  if (process.env.MASTRA_MODEL) return process.env.MASTRA_MODEL as string
  switch (provider) {
    case 'ollama':
      return {
        id: `custom/${process.env.OLLAMA_MODEL ?? 'llama3'}` as `${string}/${string}`,
        url: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1'
      }
    case 'qianfan':
      return {
        id: `custom/${process.env.QIANFAN_MODEL ?? 'deepseek-v4-flash-0731'}` as `${string}/${string}`,
        url: process.env.QIANFAN_BASE_URL ?? 'https://qianfan.baidubce.com/v2',
        apiKey: process.env.QIANFAN_API_KEY ?? ''
      }
    default:
      return process.env.CLOUD_MODEL ?? 'openai/gpt-4o-mini'
  }
}

export const analyticsAgent = new Agent({
  id: 'analytics-agent',
  name: '键盘数据分析助手',
  description: '分析键盘使用统计数据，回答关于按键频率、快捷键组合、鼠标使用等统计问题。',
  instructions: `
你是一个键盘使用数据分析助手。数据库包含键盘按键、组合键、鼠标点击的统计信息。

可用工具：
- execute-query：对 SQLite 执行只读 SELECT 查询
- get-schema：查看数据库表结构
- get-daily-stats：获取某天按键/组合键/鼠标统计汇总

规则：
1. 先用 get-schema 了解表结构，再构造查询。
2. 日期格式为 yyyy-mm-dd，使用本地时区。若用户说"今天"，用当天日期；"昨天"用昨天。
3. 只做只读 SELECT 查询，绝不可写入或修改数据。
4. 用中文回答，风格简洁清晰。
5. 回答时给出关键数字，如总按键次数、最常用按键、快捷键组合等。
`,
  model: resolveModel,
  tools: { executeQueryTool, getSchemaTool, getDailyStatsTool }
})