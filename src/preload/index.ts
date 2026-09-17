/**
 * preload：通过 contextBridge 向渲染进程暴露受控 API。
 * 渲染进程无法直接触碰 Node，只能调用这里定义的方法。
 */
import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type KeyboardAnalyticsApi,
  type KeyboardEventPayload,
  type MouseEventPayload
} from '../shared/types.ts'

const api: KeyboardAnalyticsApi = {
  getDailyStats: () => ipcRenderer.invoke(IPC_CHANNELS.getDailyStats),
  getYesterdayStats: () => ipcRenderer.invoke(IPC_CHANNELS.getYesterdayStats),
  onKeyEvent: cb => {
    const listener = (_: unknown, data: KeyboardEventPayload): void => cb(data)
    ipcRenderer.on(IPC_CHANNELS.keyEvent, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.keyEvent, listener)
  },
  onMouseEvent: cb => {
    const listener = (_: unknown, data: MouseEventPayload): void => cb(data)
    ipcRenderer.on(IPC_CHANNELS.mouseEvent, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.mouseEvent, listener)
  },
  getMastraUrl: () => ipcRenderer.invoke(IPC_CHANNELS.getMastraUrl)
}

contextBridge.exposeInMainWorld('keyboardApi', api)