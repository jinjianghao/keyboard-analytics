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
import { getDailyStats, getDailyTotals, getSharedQueryDb, closeSharedQueryDb, todayLocal, yesterdayLocal } from '../shared/stats-repository.ts'
import { EventCollector } from './event-collector.ts'
import { aiConfigStatus, loadAiConfig, saveAiConfig, validateAiConfig, type AiConfig, type SetAiConfigResult } from '../shared/ai-config.ts'
import { IPC_CHANNELS, type DailyStats, type TrendData } from '../shared/types.ts'
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

const collector = new EventCollector(() => broadcast(IPC_CHANNELS.statsSynced, {}))
let mastraServer: ChildProcess | null = null
const mastraUrl = `http://127.0.0.1:${process.env.MASTRA_PORT ?? 4111}`
let mastraStarted = false

/** 懒加载：仅当已配置 AI 时才真正启动 Mastra 子进程（幂等）。 */
async function ensureMastraStarted(): Promise<void> {
  if (mastraStarted || mastraServer) return
  if (process.env.DISABLE_MASTRA_SERVER === '1') return
  // 未配置 AI 就不 spawn 常驻子进程，保持"轻量安静"的卖点
  if (!validateAiConfig(loadAiConfig()).ok) return
  startMastraServer()
}

function startMastraServer(): void {
  mastraStarted = true
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
  mastraStarted = false
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getDailyStats, async (): Promise<DailyStats> => {
    return getDailyStats(getSharedQueryDb(), todayLocal())
  })
  ipcMain.handle(IPC_CHANNELS.getYesterdayStats, async (): Promise<DailyStats> => {
    return getDailyStats(getSharedQueryDb(), yesterdayLocal())
  })
  ipcMain.handle(IPC_CHANNELS.getTrend, async (_e, days: number): Promise<TrendData> => {
    const rows = await getDailyTotals(getSharedQueryDb(), Math.max(2, Math.min(90, Number(days) || 7)))
    return { dates: rows.map(r => r.date), totals: rows.map(r => r.total) }
  })
  ipcMain.handle(IPC_CHANNELS.mastraEnsureStarted, () => ensureMastraStarted())
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
    try {
      saveAiConfig(cfg)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, status: aiConfigStatus(cfg), error: `配置保存失败：${msg}` }
    }
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

/**
 * 全局输入监听。
 *
 * 授权感知（修复"先开应用后授权 → 永远统计不到"）：
 * - 启动时已授权 → 立即开始监听；
 * - 未授权 → 主动弹系统授权框引导授权，同时轮询权限状态，
 *   一旦"未授权 → 已授权"，无需重启应用即自动开始监听。
 * - 键盘与鼠标都只在权限确认后启动：未授权时 uiohook 的 hook_run 返回
 *   AXAPI_DISABLED 会触发原生 abort() 崩溃；node-global-key-listener 的
 *   MacKeyServer 子进程也会因 event tap 创建失败静默退出。
 * 幂等守卫：listenersReady 防止 uiohook/键盘监听被重复 start。
 */
const PERMISSION_POLL_INTERVAL_MS = 2000
let listenersReady = false
let promptedForPermission = false
let permissionWatchTimer: NodeJS.Timeout | undefined

function isInputPermissionGranted(): boolean {
  return process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false)
}

function stopPermissionWatch(): void {
  if (permissionWatchTimer) {
    clearInterval(permissionWatchTimer)
    permissionWatchTimer = undefined
  }
}

/** 真正启动键盘+鼠标监听（仅在权限确认后调用，幂等） */
function startInputListeners(): void {
  if (listenersReady) return
  listenersReady = true
  stopPermissionWatch()

  // 键鼠监听：node-global-key-listener。
  // macOS 上 MacKeyServer 的 event tap 同时上报 MOUSE LEFT/RIGHT/MIDDLE，
  // 因此 darwin 完全不再使用 uiohook——uiohook 的 worker 子进程在打包未签名
  // 场景下 event tap 创建失败会触发原生 abort()，把整个应用静默带走
  // （try/catch 拦不住原生 abort），是"授权后应用消失"的元凶。
  try {
    const keyboard = new GlobalKeyboardListener()
    void keyboard
      .addListener((e, down) => {
        const std = e.name ?? ''
        if (!std) return
        if (std.toLowerCase().includes('mouse')) {
          // darwin：鼠标事件直接来自 MacKeyServer；其他平台该库不上报鼠标，忽略
          if (process.platform === 'darwin' && down) {
            const buttonName = std === 'MOUSE LEFT' ? 'Left' : std === 'MOUSE RIGHT' ? 'Right' : std === 'MOUSE MIDDLE' ? 'Middle' : null
            if (!buttonName) return
            collector.handleMouseEvent(buttonName)
            broadcast(IPC_CHANNELS.mouseEvent, { type: 'mouse', name: buttonName, timestamp: Date.now() })
          }
          return
        }
        // 转发按下/抬起给采集器，用于组合键配对判定（纯修饰键不计入组合）
        collector.handleKeyTransition(std, e.state === 'DOWN')
        if (e.state === 'DOWN') return
        if (!down) return
        // 用跨平台标准名识别（A/SPACE/LEFT SHIFT/NUMPAD 1...），collector 内部判定普通/快捷键，展示层转中文
        const keyName = keyDisplayName(std)
        broadcast(IPC_CHANNELS.keyEvent, { type: 'keyboard', key: keyName })
      })
      .catch(e => console.error('键盘监听启动失败:', e))
  } catch (e) {
    console.error('键盘监听初始化失败:', e)
  }

  // 鼠标监听：仅非 macOS 使用 uiohook（Windows/Linux 无原生 abort 风险）
  if (process.platform !== 'darwin') {
    try {
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
    } catch (e) {
      console.error('鼠标监听初始化失败:', e)
    }
  }
}

function initInputListeners(): void {
  if (listenersReady) return
  if (isInputPermissionGranted()) {
    startInputListeners()
    return
  }
  broadcast(IPC_CHANNELS.accessibilityDenied, { platform: process.platform })
  console.warn('[input] 辅助功能未授权，已提示用户授权，检测到授权后将自动开启监听（无需重启应用）')
  // 主动弹一次系统授权框（true = 触发系统提示；用户点"打开系统设置"完成勾选）
  if (process.platform === 'darwin' && !promptedForPermission) {
    promptedForPermission = true
    try {
      systemPreferences.isTrustedAccessibilityClient(true)
    } catch {
      /* 弹框失败不影响轮询 */
    }
  }
  // 轮询权限：从"未授权"变为"已授权"的那一刻自动开始监听
  permissionWatchTimer ??= setInterval(() => {
    if (listenersReady) {
      stopPermissionWatch()
      return
    }
    if (isInputPermissionGranted()) {
      console.log('[input] 检测到辅助功能已授权，自动开启键盘/鼠标监听')
      startInputListeners()
    }
  }, PERMISSION_POLL_INTERVAL_MS)
}

app.whenReady().then(() => {
  registerIpc()
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
      closeSharedQueryDb()
      app.quit()
    })()
})