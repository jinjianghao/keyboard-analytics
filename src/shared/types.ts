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

/** preload 暴露给渲染进程的 API */
export interface KeyboardAnalyticsApi {
  getDailyStats: () => Promise<DailyStats>
  getYesterdayStats: () => Promise<DailyStats>
  /** 注册键盘/鼠标事件监听，返回取消函数 */
  onKeyEvent: (cb: (data: KeyboardEventPayload) => void) => () => void
  onMouseEvent: (cb: (data: MouseEventPayload) => void) => () => void
  /** Mastra server 地址 */
  getMastraUrl: () => Promise<string>
  /** 读取当前 AI 接入状态 */
  getAiConfig: () => Promise<AiConfigStatus>
  /** 保存 AI 接入配置（先测连再写盘），返回保存结果 */
  setAiConfig: (cfg: AiConfig) => Promise<SetAiConfigResult>
}

export const IPC_CHANNELS = {
  getDailyStats: 'stats:get-daily',
  getYesterdayStats: 'stats:get-yesterday',
  keyEvent: 'event:key',
  mouseEvent: 'event:mouse',
  getMastraUrl: 'mastra:get-url',
  getAiConfig: 'ai:get-config',
  setAiConfig: 'ai:set-config'
} as const