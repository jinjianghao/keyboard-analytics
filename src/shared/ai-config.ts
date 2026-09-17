/**
 * AI 助手配置（用户自定义接入）。
 *
 * 存放位置：优先环境变量 KEYBOARD_CONFIG_PATH，否则 userData 下的 ai-config.json。
 * 兼容旧 .env 配置：配置文件存在时优先于环境变量。
 * 该模块被主进程、mastra 子进程、共享代码引用，须保持无 electron 依赖。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 支持的接入提供方 */
export type AiProvider = 'custom'

/** 内置服务商预设 */
export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  model: string
  /** API key 占位提示 */
  keyPlaceholder: string
  modelPlaceholder?: string
}

/** 常见 OpenAI 兼容服务商预设 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'qianfan',
    name: '百度千帆',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    model: 'deepseek-v4-flash-0731',
    keyPlaceholder: 'bce-v3/你的千帆访问令牌'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyPlaceholder: 'sk-...'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyPlaceholder: 'sk-...'
  },
  {
    id: 'qwen',
    name: '阿里通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    keyPlaceholder: 'sk-...'
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    keyPlaceholder: 'sk-...',
    modelPlaceholder: '如 gpt-4o-mini'
  }
]

/** 持久化的 AI 接入配置 */
export interface AiConfig {
  /** 提供方 preset id（对应 PROVIDER_PRESETS）；custom=任意 OpenAI 兼容端点 */
  provider: string
  /** OpenAI 兼容 base_url */
  baseUrl: string
  /** API key */
  apiKey: string
  /** 模型名 */
  model: string
}

/** 空配置状态 */
export interface AiConfigStatus {
  configured: boolean
  provider: string | 'none'
  baseUrl: string
  model: string
  hasApiKey: boolean
  /** 未配置时的原因说明 */
  reason: string
  /** 配置文件绝对路径（渲染层可展示） */
  configPath: string
}

/** 保存配置的返回结果（含测连结果） */
export interface SetAiConfigResult {
  ok: boolean
  status: AiConfigStatus
  /** 测连失败的错误信息 */
  error?: string
}

/**
 * 解析配置路径。
 * 在 Electron 主进程/子进程中都通过环境变量注入（由主进程在启动时设置）。
 */
export function configPath(): string {
  if (process.env.KEYBOARD_CONFIG_PATH) return process.env.KEYBOARD_CONFIG_PATH
  // fallback（例如直接 node 跑 mastra 时）：项目根
  return path.resolve(process.cwd(), 'ai-config.json')
}

/** 读取已保存的配置；文件不存在/损坏返回 null */
export function loadAiConfig(): AiConfig | null {
  const p = configPath()
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const data = JSON.parse(raw) as Partial<AiConfig>
    if (!data.provider || typeof data.provider !== 'string') return null
    return {
      provider: data.provider,
      baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : '',
      apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
      model: typeof data.model === 'string' ? data.model : ''
    }
  } catch {
    return null
  }
}

/** 保存配置到磁盘 */
export function saveAiConfig(cfg: AiConfig): void {
  const p = configPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8')
}

/** 判断当前配置字段是否齐全（不含网络探测） */
export function validateAiConfig(cfg: AiConfig | null): { ok: boolean; reason: string } {
  if (!cfg) return { ok: false, reason: '尚未配置 AI 服务' }
  const missing: string[] = []
  if (!cfg.baseUrl.trim()) missing.push('Base URL')
  if (!cfg.model.trim()) missing.push('模型名称')
  if (!cfg.apiKey.trim()) missing.push('API Key')
  if (missing.length > 0) return { ok: false, reason: `配置不完整：缺少 ${missing.join('、')}` }
  return { ok: true, reason: '' }
}

/** 生成展示用状态 */
export function aiConfigStatus(cfg: AiConfig | null): AiConfigStatus {
  if (!cfg) {
    return {
      configured: false,
      provider: 'none',
      baseUrl: '',
      model: '',
      hasApiKey: false,
      reason: '尚未配置 AI 服务，请接入 API',
      configPath: configPath()
    }
  }
  const v = validateAiConfig(cfg)
  return {
    configured: v.ok,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasApiKey: !!cfg.apiKey,
    reason: v.reason,
    configPath: configPath()
  }
}

/**
 * 探测 provider 在预设中的展示名；未知 id 返回原 id
 */
export function providerName(provider: string): string {
  return PROVIDER_PRESETS.find(p => p.id === provider)?.name ?? provider
}