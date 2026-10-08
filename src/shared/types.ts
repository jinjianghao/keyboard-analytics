/**
 * 主进程 <-> 渲染进程 共享类型契约
 */
import type { AiConfig, AiConfigStatus, SetAiConfigResult } from './ai-config.ts'

/** 键盘事件负载 */
export interface KeyboardEventPayload {
  type: 'keyboard'
  key: string
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
  /** Mastra server 地址 */
  getMastraUrl: () => Promise<string>
  /** 懒启动 Mastra server（仅当已配置 AI 时有效） */
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
  accessibilityDenied: 'event:accessibility-denied'
} as const