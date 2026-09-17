/**
 * Electron 主进程。
 *
 * 职责：
 * - 创建窗口（加载渲染层）
 * - 注册全局键盘/鼠标监听，转发事件给渲染进程并写入采集管理器
 * - 处理 IPC：daily/yesterday 统计、Mastra server 地址
 * - 启动/停止 Mastra 独立 server 子进程（生命周期与应用绑定）
 */
import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { GlobalKeyboardListener } from 'node-global-key-listener'
import { uIOhook } from 'uiohook-napi'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, getDailyStats, todayLocal, yesterdayLocal } from '../shared/stats-repository.ts'
import { IPC_CHANNELS, type DailyStats } from '../shared/types.ts'
import { EventCollector } from './event-collector.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 生产环境数据库写入 userData；dev 保持项目根，兼容旧数据
if (app.isPackaged) {
  process.env.KEYBOARD_DB_PATH ??= path.join(app.getPath('userData'), 'keyboard_stats.db')
}

if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'IMEBasedTextInput')
}

/** 取 mastra server 独立进程的入口（构建后 / 开发时不同路径） */
function mastraServerEntry(): string {
  if (process.env.MASTRA_SERVER_ENTRY) return process.env.MASTRA_SERVER_ENTRY
  // 开发：直接跑 TS 源码（Node 22.18+ 支持 .ts）；生产：server.ts 被 esbuild 打进 out/main/mastra-server.mjs
  if (!app.isPackaged) return path.resolve(app.getAppPath(), 'src/mastra/server.ts')
  return path.resolve(__dirname, 'mastra-server.mjs')
}

/** 生产环境把数据库放到 userData，避免写入只读的 asar */
function dbPathForChild(): string {
  if (process.env.KEYBOARD_DB_PATH) return process.env.KEYBOARD_DB_PATH
  if (app.isPackaged) return path.join(app.getPath('userData'), 'keyboard_stats.db')
  // dev：out/main/../.. = 项目根
  return path.resolve(__dirname, '../../keyboard_stats.db')
}

// 按键码 -> 中文显示名（普通键）
const KEY_NAME_NORMAL: Record<number, string> = {
  29: '0', 18: '1', 19: '2', 20: '3', 21: '4', 23: '5', 22: '6', 26: '7', 28: '8', 25: '9',
  0: 'A', 11: 'B', 8: 'C', 2: 'D', 14: 'E', 3: 'F', 5: 'G', 4: 'H', 34: 'I', 38: 'J',
  40: 'K', 37: 'L', 46: 'M', 45: 'N', 31: 'O', 35: 'P', 12: 'Q', 15: 'R', 1: 'S', 17: 'T',
  32: 'U', 9: 'V', 13: 'W', 7: 'X', 16: 'Y', 6: 'Z', 10: '§', 50: '`', 27: '-', 24: '=',
  33: '[', 30: ']', 41: ';', 39: "'", 43: ',', 47: '.', 44: '/', 42: '\\',
  82: '小键盘0', 83: '小键盘1', 84: '小键盘2', 85: '小键盘3', 86: '小键盘4',
  87: '小键盘5', 88: '小键盘6', 89: '小键盘7', 91: '小键盘8', 92: '小键盘9',
  65: '小键盘.', 67: '小键盘*', 69: '小键盘+', 75: '小键盘/', 78: '小键盘-',
  81: '小键盘=', 71: '小键盘清除', 76: '小键盘回车',
  49: '空格', 36: '回车', 48: 'Tab', 51: '删除', 117: '向前删除', 52: '换行',
  53: 'Esc',
  122: 'F1', 120: 'F2', 99: 'F3', 118: 'F4', 96: 'F5', 97: 'F6', 98: 'F7', 100: 'F8',
  101: 'F9', 109: 'F10', 103: 'F11', 111: 'F12', 105: 'F13', 107: 'F14', 113: 'F15',
  106: 'F16', 64: 'F17', 79: 'F18', 80: 'F19', 90: 'F20',
  72: '音量+', 73: '音量-', 74: '静音', 114: '帮助/插入', 115: 'Home', 119: 'End',
  116: 'PageUp', 121: 'PageDown', 123: '←', 124: '→', 125: '↓', 126: '↑',
  145: '亮度-', 144: '亮度+', 130: '仪表盘', 131: '启动台'
}

// 修饰键码 -> 中文名
const KEY_NAME_MODIFIER: Record<number, string> = {
  54: '右Command', 55: 'Command', 56: 'Shift', 57: 'CapsLock', 58: 'Option',
  59: 'Control', 60: '右Shift', 61: '右Option', 62: '右Control', 63: 'Fn'
}

const collector = new EventCollector()
let mastraServer: ChildProcess | null = null
const mastraUrl = `http://127.0.0.1:${process.env.MASTRA_PORT ?? 4111}`

function startMastraServer(): void {
  if (process.env.DISABLE_MASTRA_SERVER === '1') return
  try {
    const entry = mastraServerEntry()
    // @mastra 依赖 lru-cache 的 tracingChannel（Node 18.17+）及 ESM，Electron 28 内置 node 18 不满足，
    // 因此 dev/prod 统一用系统 node 运行：dev 跑 TS 源码（Node 22.18+ 支持 .ts），prod 跑打包产物。
    const child = spawn('node', [entry], {
      env: {
        ...process.env,
        PORT: String(process.env.MASTRA_PORT ?? 4111),
        KEYBOARD_DB_PATH: dbPathForChild()
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    mastraServer = child
    child.stdout?.on('data', d => console.log(`[mastra] ${String(d).trimEnd()}`))
    child.stderr?.on('data', d => console.error(`[mastra] ${String(d).trimEnd()}`))
    child.on('exit', code => console.log(`[mastra] server exited code=${code}`))
    child.on('error', err => console.error('[mastra] 启动失败（请确认已安装 Node ≥22.18）:', err))
  } catch (e) {
    console.error('[mastra] 启动失败:', e)
    mastraServer = null
  }
}

function stopMastraServer(): void {
  if (mastraServer) {
    mastraServer.kill('SIGTERM')
    mastraServer = null
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getDailyStats, async (): Promise<DailyStats> => {
    const db = createDb()
    try {
      return await getDailyStats(db, todayLocal())
    } finally {
      db.close()
    }
  })
  ipcMain.handle(IPC_CHANNELS.getYesterdayStats, async (): Promise<DailyStats> => {
    const db = createDb()
    try {
      return await getDailyStats(db, yesterdayLocal())
    } finally {
      db.close()
    }
  })
  ipcMain.handle(IPC_CHANNELS.getMastraUrl, () => mastraUrl)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '键盘统计分析',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 键盘监听
  try {
    const keyboard = new GlobalKeyboardListener()
    keyboard.addListener((e, down) => {
      if (e.name && e.name.toLowerCase().includes('mouse')) return
      if (e.state === 'DOWN') return
      if (!down) return
      const keyName = KEY_NAME_NORMAL[e.vKey] ?? KEY_NAME_MODIFIER[e.vKey] ?? e.name
      if (!keyName) return
      mainWindow.webContents.send(IPC_CHANNELS.keyEvent, { type: 'keyboard', key: keyName })
      collector.handleKeyPress(keyName)
    })
  } catch (e) {
    console.error('键盘监听初始化失败:', e)
  }

  // 鼠标监听
  try {
    uIOhook.on('mousedown', e => {
      const buttonName = e.button === 1 ? 'Left' : e.button === 2 ? 'Right' : e.button === 3 ? 'Middle' : null
      if (!buttonName) return
      collector.handleMouseEvent(buttonName)
      mainWindow.webContents.send(IPC_CHANNELS.mouseEvent, {
        type: 'mouse',
        name: buttonName,
        timestamp: Date.now()
      })
    })
    uIOhook.start()
  } catch (e) {
    console.error('鼠标监听初始化失败:', e)
  }
}

app.whenReady().then(() => {
  registerIpc()
  startMastraServer()
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let flushed = false
app.on('before-quit', e => {
  if (flushed) return
  e.preventDefault()
  flushed = true
  void (async () => {
    stopMastraServer()
    try {
      uIOhook.stop()
    } catch {
      /* ignore */
    }
    await collector.flushAndClose()
    app.quit()
  })()
})