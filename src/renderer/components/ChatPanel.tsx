/**
 * AI 聊天组件。
 * 通过 AI SDK UI 的 useChat 连接 Mastra server 的 /chat/analytics-agent 流式接口。
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

export default function ChatPanel(): React.JSX.Element {
  const [mastraBase, setMastraBase] = useState<string>('http://127.0.0.1:4111')
  const [input, setInput] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.keyboardApi?.getMastraUrl().then(url => {
      // 去掉尾部斜杠
      setMastraBase(url.replace(/\/$/, ''))
    })
  }, [])

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${mastraBase}/chat/analytics-agent`
      }),
    [mastraBase]
  )

  const { messages, sendMessage, status } = useChat({
    transport
  })

  // 从消息 parts 提取纯文本（AI SDK v7 结构）
  const textOf = (m: (typeof messages)[number]): string =>
    m.parts
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join('')

  // 新消息到达时自动滚动到底部
  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight })
  }, [messages])

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (!input.trim() || status !== 'ready') return
    void sendMessage({ text: input.trim() })
    setInput('')
  }

  if (collapsed) {
    return (
      <button
        className="chat-fab"
        onClick={() => setCollapsed(false)}
        title="打开发AI助手"
        aria-label="打开AI助手"
      >
        💬
      </button>
    )
  }

  return (
    <div className="chat-box">
      <div className="chat-header">
        <span className="chat-title">AI 助手</span>
        <button className="chat-icon-btn" onClick={() => setCollapsed(true)} title="收起" aria-label="收起">
          ▾
        </button>
      </div>
      <div className="chat-history" ref={historyRef}>
        {messages.length === 0 && <p className="chat-empty">问问 AI 关于你的键盘使用数据吧～</p>}
        {messages.map(m =>
          m.role === 'user' ? (
            <div key={m.id} className="msg msg-user">
              <span className="bubble bubble-user">{textOf(m)}</span>
            </div>
          ) : (
            <div key={m.id} className="msg msg-ai">
              <span className="bubble bubble-ai">{textOf(m)}</span>
            </div>
          )
        )}
        {status === 'submitted' && (
          <div className="msg msg-ai">
            <span className="bubble bubble-ai">
              <span className="loading" /> AI 正在思考...
            </span>
          </div>
        )}
      </div>
      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="问点什么，如：今天最常用的按键是什么？"
          disabled={status !== 'ready'}
        />
        <button className="chat-send" type="submit" disabled={status !== 'ready' || !input.trim()}>
          发送
        </button>
      </form>
    </div>
  )
}