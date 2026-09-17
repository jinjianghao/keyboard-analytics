/// <reference types="vite/client" />

/**
 * 渲染层类型扩展：preload 暴露的 keyboardApi
 */
import type { KeyboardAnalyticsApi } from '../shared/types.ts'

declare global {
  interface Window {
    keyboardApi?: KeyboardAnalyticsApi
  }
}

export {}