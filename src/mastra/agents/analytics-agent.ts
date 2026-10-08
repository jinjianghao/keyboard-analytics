/**
 * 键盘数据分析 agent。
 *
 * 模型路由优先级：
 * 1. ai-config.json（主进程/渲染层设置面板写入）> 环境变量
 * 2. LLM_PROVIDER/qianfan（默认）→ 千帆（百度智能云）DeepSeek，OpenAI 兼容端点
 * 3. LLM_PROVIDER=ollama → 本地 Ollama
 * 4. 其他 → 云模型（CLOUD_MODEL）
 *
 * 配置值来自 ai-config.json（优先）或 .env（server.ts 启动时通过 loadEnvFile 加载）。
 */
import { Agent } from '@mastra/core/agent'
import { executeQueryTool, getSchemaTool, getDailyStatsTool } from '../tools/sqlite-tools.ts'
import { loadAiConfig } from '../../shared/ai-config.ts'

type ModelConfig = string | { id: `${string}/${string}`; url?: string; apiKey?: string }

/** 是否已接入可用配置（供外部判断是否启用 AI） */
export function isAiConfigured(): boolean {
  const cfg = loadAiConfig()
  if (!cfg) return false
  return Boolean(cfg.baseUrl && cfg.apiKey && cfg.model)
}

export function resolveModel(): ModelConfig {
  // 1. 配置文件优先（UI 设置面板写入，均为 OpenAI 兼容 custom 端点）
  const cfg = loadAiConfig()
  if (cfg) {
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
      throw new Error(
        'AI 服务未配置完整：请在设置面板选择服务商并填写 API Key（保存时自动校验）'
      )
    }
    return {
      id: `custom/${cfg.model}` as `${string}/${string}`,
      url: cfg.baseUrl,
      apiKey: cfg.apiKey
    }
  }

  // 2. 兼容旧 .env 配置
  return resolveModelFromEnv()
}

/** 从环境变量读取模型（旧配置方式） */
export function resolveModelFromEnv(): ModelConfig {
  const provider = process.env.LLM_PROVIDER ?? 'qianfan'
  if (process.env.MASTRA_MODEL) return process.env.MASTRA_MODEL as string
  switch (provider) {
    case 'ollama':
      return {
        id: `custom/${process.env.OLLAMA_MODEL ?? 'llama3'}` as `${string}/${string}`,
        url: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1'
      }
    case 'qianfan':
      if (!process.env.QIANFAN_API_KEY) {
        throw new Error('未配置 AI 服务：请先在设置面板接入 API 或启用本地 Ollama')
      }
      return {
        id: `custom/${process.env.QIANFAN_MODEL ?? 'deepseek-v4-flash-0731'}` as `${string}/${string}`,
        url: process.env.QIANFAN_BASE_URL ?? 'https://qianfan.baidubce.com/v2',
        apiKey: process.env.QIANFAN_API_KEY ?? ''
      }
    default:
      return process.env.CLOUD_MODEL ?? 'openai/gpt-4o-mini'
  }
}

/** 模型调用重试次数（应对 429/5xx 限速抖动），可通过环境变量 MASTRA_MAX_RETRIES 调整 */
function modelRetries(): number {
  const raw = Number(process.env.MASTRA_MAX_RETRIES)
  return Number.isFinite(raw) && raw >= 0 ? raw : 5
}

export const analyticsAgent = new Agent({
  id: 'analytics-agent',
  name: '键盘数据分析助手',
  description: '分析键盘使用统计数据，回答关于按键频率、快捷键组合、鼠标使用等统计问题。',
  maxRetries: modelRetries(),
  instructions: `
你是一个键盘使用数据分析助手。数据库包含键盘按键、组合键、鼠标点击的统计信息。

可用工具：
- execute-query：对 SQLite 执行只读 SELECT 查询
- get-schema：查看数据库表结构（进程内已缓存，多次调用无额外开销）
- get-daily-stats：获取某天按键/组合键/鼠标统计汇总

表结构：normal_keys(key,count,date)、shortcut_keys(combination,count,date)、mouse_events(button,count,date)。
key/combination/button 为中文显示名（如 空格、Control、左键），date 为 yyyy-mm-dd。

常用查询模板（优先套用，避免临时构造）：
- 今日总按键：SELECT SUM(count) FROM normal_keys WHERE date='<今日>'
- 某日最常用按键：SELECT key,count FROM normal_keys WHERE date='<日期>' ORDER BY count DESC LIMIT 10
- 最近7天每日按键量：SELECT date,SUM(count) total FROM normal_keys WHERE date>=date('<今日>','-6 days') GROUP BY date ORDER BY date
- 快捷键/组合键排行：SELECT combination,count FROM shortcut_keys WHERE date='<日期>' ORDER BY count DESC LIMIT 10
- 鼠标点击分布：SELECT button,count FROM mouse_events WHERE date='<日期>'

规则：
1. 日期格式为 yyyy-mm-dd，使用本地时区。若用户说"今天"，用当天日期；"昨天"用昨天。
2. 只做只读 SELECT 查询，绝不可写入或修改数据。
3. 用中文回答，风格简洁清晰。
4. 回答时给出关键数字，如总按键次数、最常用按键、快捷键组合等。
5. 优先使用上面的模板构造查询；只有模板无法覆盖时再用 get-schema 探索表结构。
`,
  model: resolveModel,
  tools: { executeQueryTool, getSchemaTool, getDailyStatsTool }
})