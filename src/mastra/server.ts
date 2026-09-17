/**
 * Mastra 独立 server 启动入口。
 *
 * 由 Electron 主进程 spawn 运行。内部：Hono app + @mastra/hono 适配器，
 * init() 注册 chatRoute 等 API 路由，随后 @hono/node-server 监听端口。
 * 被 Electron 主进程以子进程方式启动，便于随应用生命周期启停。
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve, type ServerType } from '@hono/node-server'
import { mastra } from './index.ts'
import { MastraServer } from '@mastra/hono'

// 加载项目根 .env（Node 20.12+ 支持；master server 由主进程 spawn，需自加载）
try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile()
} catch {
  // .env 不存在时忽略（此时从进程环境变量读取）
}

const PORT = Number(process.env.PORT ?? 4111)

async function start(): Promise<void> {
  const app = new Hono()
  // 渲染层（Electron dev http://localhost:5173 或打包后的 file://）跨端口访问，必须放行 CORS。
  // mastra 的 server.cors 配置在此版本 @mastra/hono 不生效，需要在 Hono 层显式挂载。
  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS'], allowHeaders: ['*'] }))
  // Hono 只在路径存在 handler 时才执行 use 中间件；chatRoute 仅注册 POST，
  // 不会触发 cors 的 OPTIONS 预检逻辑，需显式注册 OPTIONS 路由以让预检返回 204。
  app.options('*', c => c.body(null, 204))
  const adapter = new MastraServer({ app, mastra })

  await adapter.init()

  // graceful shutdown
  let server: ServerType | undefined
  const shutdown = (signal: string): void => {
    console.log(`[mastra] received ${signal}, shutting down`)
    server?.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  server = serve({ fetch: app.fetch, port: PORT })
  console.log(`[mastra] server listening on http://127.0.0.1:${PORT}`)
  console.log(`[mastra] agent ready: analytics-agent (model: ${JSON.stringify(mastra.getAgentById('analytics-agent').getModel())})`)
}

void start().catch(err => {
  console.error('[mastra] server 启动失败:', err)
  process.exit(1)
})