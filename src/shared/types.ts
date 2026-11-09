/**
 * 主进程 <-> 渲染进程 共享类型契约
 */
import type { AiConfig, AiConfigStatus, SetAiConfigResult } from './ai-config.ts'

/** 键盘事件负载 */
export interface KeyboardEventPayload {
  type: 'keyboard'
  key: string
  /** 由主进程统一判定：普通键 / 组合键，前端据此分流，不再用子串猜测 */
  kind: 'normal' | 'combo'
}

/** 鼠标事件负载 */
export interface MouseEventPayload {
  type: 'mouse'
  name: 'Left' | 'Right' | 'Middle'
  timestamp: number
}

/** 今日统计汇总（渲染进程实时面板数据） */
export interface DailyStats {
  keyPresses: Record<string, number>
  combinationPresses: Record<string, number>
  mousePresses: Record<string, number>
  totalPresses: number
}

/** 最近 N 天日按键总量趋势 */
export interface TrendData {
  dates: string[]
  totals: number[]
}

/**
 * Mastra server 接入信息。
 * token 仅在 Electron 主进程内存中生成、经 IPC 交给渲染层，绝不落盘，
 * 用于阻止本机其它进程/网页越权访问本地统计接口。
 */
export interface MastraEndpoint {
  url: string
  token: string
}

/** preload 暴露给渲染进程的 API */
export interface KeyboardAnalyticsApi {
  getDailyStats: () => Promise<DailyStats>
  getYesterdayStats: () => Promise<DailyStats>
  /** 最近 N 天日按键总量趋势 */
  getTrend: (days: number) => Promise<TrendData>
  /** 注册键盘/鼠标事件监听，返回取消函数 */
  onKeyEvent: (cb: (data: KeyboardEventPayload) => void) => () => void
  onMouseEvent: (cb: (data: MouseEventPayload) => void) => () => void
  /** 订阅主进程数据同步完成事件（写库后触发，替代周期性轮询） */
  onStatsSynced: (cb: () => void) => () => void
  /** 订阅"辅助功能未授权"事件（引导用户授权），返回取消函数 */
  onAccessibilityDenied: (cb: (data: { platform: string }) => void) => () => void
  /** 采集是否开启 */
  getCollectionEnabled: () => Promise<boolean>
  /** 开/关采集，返回最新状态 */
  setCollectionEnabled: (on: boolean) => Promise<boolean>
  /** 订阅采集开关状态变化，返回取消函数 */
  onCollectionState: (cb: (enabled: boolean) => void) => () => void
  /** 清空所有本地统计数据 */
  clearData: () => Promise<void>
  /** Mastra server 接入信息（地址 + 鉴权 token） */
  getMastraUrl: () => Promise<MastraEndpoint>
  /** 懒启动 Mastra server 并等待就绪（仅当已配置 AI 时有效） */
  ensureMastraStarted: () => Promise<void>
  /** 读取当前 AI 接入状态 */
  getAiConfig: () => Promise<AiConfigStatus>
  /** 保存 AI 接入配置（先测连再写盘），返回保存结果 */
  setAiConfig: (cfg: AiConfig) => Promise<SetAiConfigResult>
}

export const IPC_CHANNELS = {
  getDailyStats: 'stats:get-daily',
  getYesterdayStats: 'stats:get-yesterday',
  getTrend: 'stats:get-trend',
  keyEvent: 'event:key',
  mouseEvent: 'event:mouse',
  statsSynced: 'stats:synced',
  getMastraUrl: 'mastra:get-url',
  mastraEnsureStarted: 'mastra:ensure-started',
  getAiConfig: 'ai:get-config',
  setAiConfig: 'ai:set-config',
  getCollectionEnabled: 'collection:get-enabled',
  setCollectionEnabled: 'collection:set-enabled',
  collectionState: 'event:collection-state',
  clearData: 'stats:clear-data',
  accessibilityDenied: 'event:accessibility-denied'
} as const