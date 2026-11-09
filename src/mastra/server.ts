/**
 * Mastra 独立 server 启动入口。
 *
 * 由 Electron 主进程 spawn 运行。内部：Hono app + @mastra/hono 适配器，
 * init() 注册 chatRoute 等 API 路由，随后 @hono/node-server 监听端口。
 * 被 Electron 主进程以子进程方式启动，便于随应用生命周期启停。
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { timingSafeEqual } from 'node:crypto'
import { serve, type ServerType } from '@hono/node-server'
import { mastra } from './index.ts'
import { MastraServer } from '@mastra/hono'
import { closeSharedQueryDb } from '../shared/stats-repository.ts'

// 加载项目根 .env（Node 20.12+ 支持；master server 由主进程 spawn，需自加载）
try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile()
} catch {
  // .env 不存在时忽略（此时从进程环境变量读取）
}

const PORT = Number(process.env.PORT ?? 4111)
// 鉴权 token：由主进程 spawn 时注入。缺失（如手动裸跑）则不启用鉴权，仅本地调试用。
const TOKEN = process.env.MASTRA_TOKEN ?? ''

/** 定长比较，避免 token 校验的时序侧信道。 */
function tokenMatches(provided: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * CORS 白名单：仅放行 Electron 渲染层来源。
 * - dev：http://localhost:<vite端口>（ELECTRON_RENDERER_URL 注入到进程 env）
 * - prod：file:// 场景浏览器发 Origin: null，按 null 放行
 * - 无 Origin 头（非浏览器）放行；真正的越权读由 token 拦截。
 */
const ALLOWED_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/
function resolveOrigin(origin: string | undefined): string | null {
  if (!origin) return null
  if (origin === 'null') return origin
  if (ALLOWED_ORIGIN_RE.test(origin)) return origin
  return null
}

async function start(): Promise<void> {
  const app = new Hono()
  app.use(
    '*',
    cors({
      origin: (origin) => resolveOrigin(origin),
      allowMethods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'x-mastra-token'],
      maxAge: 600
    })
  )
  // Hono 只在路径存在 handler 时才执行 use 中间件；chatRoute 仅注册 POST，
  // 不会触发 cors 的 OPTIONS 预检逻辑，需显式注册 OPTIONS 路由以让预检返回 204。
  app.options('*', c => c.body(null, 204))
  // 健康检查：供主进程探测就绪，不含敏感数据，无需 token。
  app.get('/health', c => c.json({ ok: true }))
  // 鉴权：除 OPTIONS/health 外，所有接口必须携带正确 token。
  app.use('*', async (c, next) => {
    if (!TOKEN) return next()
    const header = c.req.header('x-mastra-token') ?? ''
    const auth = c.req.header('authorization') ?? ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!tokenMatches(header || bearer)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    return next()
  })
  const adapter = new MastraServer({ app, mastra })

  await adapter.init()

  // graceful shutdown
  let server: ServerType | undefined
  const shutdown = (signal: string): void => {
    console.log(`[mastra] received ${signal}, shutting down`)
    closeSharedQueryDb()
    server?.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  server = serve({ fetch: app.fetch, port: PORT })
  console.log(`[mastra] server listening on http://127.0.0.1:${PORT}`)
  // AI 未配置时 getModel() 会抛错——这只是诊断日志，绝不能让整个 server 进程退出：
  // server 存活 = 其余功能正常，聊天在用户于设置面板配置 AI 后自然可用。
  try {
    console.log(`[mastra] agent ready: analytics-agent (model: ${JSON.stringify(mastra.getAgentById('analytics-agent').getModel())})`)
  } catch (e) {
    console.warn(`[mastra] AI 尚未配置，聊天功能将在设置面板完成配置后可用：${e instanceof Error ? e.message : String(e)}`)
  }
}

void start().catch(err => {
  console.error('[mastra] server 启动失败:', err)
  process.exit(1)
})