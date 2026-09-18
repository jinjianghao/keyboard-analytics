/**
 * Electron 主进程。
 *
 * 职责：
 * - 创建窗口（加载渲染层）
 * - 注册全局键盘/鼠标监听，转发事件给渲染进程并写入采集管理器
 * - 处理 IPC：daily/yesterday 统计、Mastra server 地址
 * - 启动/停止 Mastra 独立 server 子进程（生命周期与应用绑定）
 */
import { app, BrowserWindow, Menu, ipcMain, systemPreferences } from 'electron'
import { GlobalKeyboardListener } from 'node-global-key-listener'
import { uIOhook } from 'uiohook-napi'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, getDailyStats, todayLocal, yesterdayLocal } from '../shared/stats-repository.ts'
import { IPC_CHANNELS, type DailyStats } from '../shared/types.ts'
import { EventCollector } from './event-collector.ts'
import { aiConfigStatus, loadAiConfig, saveAiConfig, validateAiConfig, type AiConfig, type SetAiConfigResult } from '../shared/ai-config.ts'
// 按键识别：跨平台标准名 -> 中文显示（macOS Intel/AppleSilicon / Windows / Linux 通用）
// 不再依赖按平台硬编码的 vKey 映射表（macOS kVK 与 Windows VK 数值不一致）。
import { keyDisplayName, isShortcutLike } from './key-name-map.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 生产环境数据库写入 userData；dev 保持项目根，兼容旧数据
if (app.isPackaged) {
  process.env.KEYBOARD_DB_PATH ??= path.join(app.getPath('userData'), 'keyboard_stats.db')
  process.env.KEYBOARD_CONFIG_PATH ??= path.join(app.getPath('userData'), 'ai-config.json')
} else {
  process.env.KEYBOARD_CONFIG_PATH ??= path.join(app.getAppPath(), 'ai-config.json')
}

if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'IMEBasedTextInput')
}

/** 取 mastra server 独立进程的入口（构建后 / 开发时不同路径） */
function mastraServerEntry(): string {
  if (process.env.MASTRA_SERVER_ENTRY) return process.env.MASTRA_SERVER_ENTRY
  // dev：直接跑 TS 源码（内置 Node ≥22.18 原生支持 .ts）；prod：esbuild 产物 out/main/mastra-server.mjs
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

const collector = new EventCollector()
let mastraServer: ChildProcess | null = null
const mastraUrl = `http://127.0.0.1:${process.env.MASTRA_PORT ?? 4111}`

function startMastraServer(): void {
  if (process.env.DISABLE_MASTRA_SERVER === '1') return
  try {
    const entry = mastraServerEntry()
    // Electron ≥37 内置 Node 22（含 tracingChannel / ESM），满足 @mastra 全套依赖。
    // 用 Electron 自身以 Node 模式运行子进程，发布后用户无需安装 Node。
    // dev：仍跑 TS 源码（内置 node 22.18+ 支持 .ts）；prod：跑 esbuild 打包产物。
    const child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(process.env.MASTRA_PORT ?? 4111),
        KEYBOARD_DB_PATH: dbPathForChild()
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    mastraServer = child
    child.stdout?.on('data', d => console.log(`[mastra] ${String(d).trimEnd()}`))
    child.stderr?.on('data', d => console.error(`[mastra] ${String(d).trimEnd()}`))
    child.on('exit', code => console.log(`[mastra] server exited code=${code}`))
    child.on('error', err => console.error('[mastra] 启动失败:', err))
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
  ipcMain.handle(IPC_CHANNELS.getAiConfig, () => aiConfigStatus(loadAiConfig()))
  ipcMain.handle(IPC_CHANNELS.setAiConfig, async (_e, cfg: AiConfig): Promise<SetAiConfigResult> => {
    const check = validateAiConfig(cfg)
    if (!check.ok) {
      return { ok: false, status: aiConfigStatus(cfg), error: check.reason }
    }
    try {
      await testAiConnection(cfg)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, status: aiConfigStatus(cfg), error: `连接失败：${msg}` }
    }
    saveAiConfig(cfg)
    return { ok: true, status: aiConfigStatus(loadAiConfig()) }
  })
}

/** 向 OpenAI 兼容端点发一个最小 chat 请求，验证 key/地址可用（带指数退避重试） */
async function testAiConnection(cfg: AiConfig, timeoutMs = 15000, maxAttempts = 3): Promise<void> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await testAiConnectionOnce(cfg, timeoutMs)
      return
    } catch (err) {
      lastErr = err
      // 只有可重试错误才指数退避：网络/超时/5xx；4xx（如 key 错）直接失败
      const retryable = isRetryableTestError(err)
      if (!retryable || attempt === maxAttempts) break
      const delay = Math.min(1000 * 2 ** (attempt - 1), 8000)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}

function isRetryableTestError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  if (err.name === 'AbortError') return true
  // HTTP 5xx（服务端过载）可重试；4xx 是配置错误不重试
  if (/HTTP (5\d{2}|429)/.test(msg)) return true
  return /fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up/.test(msg)
}

async function testAiConnectionOnce(cfg: AiConfig, timeoutMs: number): Promise<void> {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1
      }),
      signal: controller.signal
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const detail = text ? `（HTTP ${res.status} ${text.slice(0, 160)}）` : `（HTTP ${res.status}）`
      throw new Error(`服务返回错误${detail}`)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('连接超时')
    throw err
  } finally {
    clearTimeout(timer)
  }
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
}

/** 向所有存活窗口广播事件（监听不受单个窗口生命周期影响） */
function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/** 全局输入监听（只初始化一次，避免 uiohook/键盘监听被重复 start 引起原生崩溃） */
let listenersReady = false
function initInputListeners(): void {
  if (listenersReady) return
  listenersReady = true

  // 键盘监听
  try {
    const keyboard = new GlobalKeyboardListener()
    keyboard.addListener((e, down) => {
      if (e.name && e.name.toLowerCase().includes('mouse')) return
      if (e.state === 'DOWN') return
      if (!down) return
      // 用跨平台标准名识别（A/SPACE/LEFT SHIFT/NUMPAD 1...），collector 内部判定普通/快捷键，展示层转中文
      const std = e.name ?? ''
      if (!std) return
      const keyName = keyDisplayName(std)
      broadcast(IPC_CHANNELS.keyEvent, { type: 'keyboard', key: keyName })
      collector.handleKeyPress(std)
    })
  } catch (e) {
    console.error('键盘监听初始化失败:', e)
  }

  // 鼠标监听
  try {
    // 关键：未授权辅助功能时，uiohook 的 hook_run 会返回 AXAPI_DISABLED，
    // 进而触发原生 abort() 崩溃（见 uiohook_worker_start 的错误处理）。
    // 必须先检测权限，未授权则跳过鼠标监听并提示用户，而不是硬启动。
    const trusted =
      process.platform === 'darwin'
        ? systemPreferences.isTrustedAccessibilityClient(false)
        : true
    if (!trusted) {
      broadcast(IPC_CHANNELS.accessibilityDenied, { platform: process.platform })
      console.warn('[input] 辅助功能未授权，跳过鼠标监听（避免 uiohook 原生崩溃）')
    } else {
      uIOhook.on('mousedown', e => {
        const buttonName = e.button === 1 ? 'Left' : e.button === 2 ? 'Right' : e.button === 3 ? 'Middle' : null
        if (!buttonName) return
        collector.handleMouseEvent(buttonName)
        broadcast(IPC_CHANNELS.mouseEvent, {
          type: 'mouse',
          name: buttonName,
          timestamp: Date.now()
        })
      })
      uIOhook.start()
    }
  } catch (e) {
    console.error('鼠标监听初始化失败:', e)
  }
}

app.whenReady().then(() => {
  registerIpc()
  startMastraServer()
  Menu.setApplicationMenu(null)
  initInputListeners()
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