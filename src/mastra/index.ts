/**
 * Mastra 应用入口。
 *
 * 配置为独立 server（Hono），供 Electron 渲染层通过 AI SDK UI 调用。
 * server 端口 4111，可由 PORT 环境变量覆盖。
 */
import { Mastra } from '@mastra/core/mastra'
import { chatRoute } from '@mastra/ai-sdk'
import { analyticsAgent } from './agents/analytics-agent.ts'

export const mastra = new Mastra({
  agents: { analyticsAgent },
  server: {
    port: Number(process.env.PORT ?? 4111),
    // CORS 由 server.ts 的 Hono 层统一处理（白名单 + token），此处不配置。
    apiRoutes: [
      chatRoute({
        path: '/chat/:agentId'
      })
    ]
  }
})