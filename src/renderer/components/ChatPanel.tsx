/**
 * AI 聊天组件。
 * 通过 AI SDK UI 的 useChat 连接 Mastra server 的 /chat/analytics-agent 流式接口。
 * 未接入 AI 服务时展示横幅引导 + 设置面板（服务商预设/测连/保存即生效）。
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { AiConfigStatus } from '../../shared/ai-config.ts'
import { PROVIDER_PRESETS } from '../../shared/ai-config.ts'
import type { AiConfig } from '../../shared/ai-config.ts'

const EMPTY_STATUS: AiConfigStatus = {
  configured: false,
  provider: 'none',
  baseUrl: '',
  model: '',
  hasApiKey: false,
  reason: '尚未配置 AI 服务，请接入 API',
  configPath: ''
}

export default function ChatPanel(): React.JSX.Element {
  const [mastraBase, setMastraBase] = useState<string>('http://127.0.0.1:4111')
  const [input, setInput] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [status, setStatus] = useState<AiConfigStatus>(EMPTY_STATUS)
  const historyRef = useRef<HTMLDivElement>(null)

  // 设置面板表单：provider 对应预设 id
  const [cfgForm, setCfgForm] = useState<AiConfig>({
    provider: 'qianfan',
    baseUrl: PROVIDER_PRESETS[0].baseUrl,
    apiKey: '',
    model: PROVIDER_PRESETS[0].model
  })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [bannerVisible, setBannerVisible] = useState(true)
  // 对话错误提示（限速/网络抖动时展示，支持重发）
  const [chatError, setChatError] = useState('')

  const refreshStatus = (): void => {
    void window.keyboardApi?.getAiConfig().then(s => setStatus(s))
  }

  useEffect(() => {
    void window.keyboardApi?.getMastraUrl().then(url => {
      // 去掉尾部斜杠
      setMastraBase(url.replace(/\/$/, ''))
    })
    refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${mastraBase}/chat/analytics-agent`
      }),
    [mastraBase]
  )

  const { messages, sendMessage, status: chatStatus } = useChat({
    transport,
    onError: err => setChatError(err?.message || '对话失败，请重试')
  })

  const textOf = (m: (typeof messages)[number]): string =>
    m.parts
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join('')

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight })
  }, [messages])

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (!input.trim() || chatStatus !== 'ready' || !status.configured) return
    setChatError('')
    void sendMessage({ text: input.trim() })
    setInput('')
  }

  /** 选择预设时自动填充 baseUrl / model */
  const selectProvider = (id: string): void => {
    const preset = PROVIDER_PRESETS.find(p => p.id === id)
    if (!preset) return
    setCfgForm(c => ({
      ...c,
      provider: preset.id,
      baseUrl: preset.baseUrl,
      model: preset.model
    }))
  }

  const handleSave = (e: FormEvent): void => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setSaveMsg('')
    void window.keyboardApi?.setAiConfig(cfgForm).then(res => {
      setSaving(false)
      setStatus(res.status)
      if (res.ok) {
        setSaveMsg('保存成功，AI 助手已可用')
        setShowSettings(false)
      } else {
        setSaveMsg(res.error ?? '保存失败')
      }
    })
  }

  const openSettings = (): void => {
    // 以当前状态回填表单
    if (status.provider !== 'none') {
      setCfgForm(c => ({
        ...c,
        apiKey: '' // 出于安全，编辑时不回填已保存的 key
      }))
    }
    setShowSettings(true)
  }

  if (collapsed) {
    return (
      <button
        className="chat-fab"
        onClick={() => setCollapsed(false)}
        title="打开AI助手"
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
        <div className="chat-header-actions">
          <button
            className="chat-icon-btn"
            onClick={() => {
              refreshStatus()
              setShowSettings(s => !s)
              setSaveMsg('')
            }}
            title="设置"
            aria-label="设置"
          >
            ⚙
          </button>
          <button className="chat-icon-btn" onClick={() => setCollapsed(true)} title="收起" aria-label="收起">
            ▾
          </button>
        </div>
      </div>

      {showSettings ? (
        <form className="settings-form" onSubmit={handleSave}>
          <h3 className="settings-title">AI 服务设置</h3>

          <label className="settings-label">
            服务商
            <select
              className="settings-input"
              value={cfgForm.provider}
              onChange={e => selectProvider(e.target.value)}
            >
              {PROVIDER_PRESETS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-label">
            Base URL
            <input
              className="settings-input"
              value={cfgForm.baseUrl}
              onChange={e => setCfgForm(c => ({ ...c, baseUrl: e.target.value.trim() }))}
              placeholder="https://api.openai.com/v1"
              required
            />
          </label>

          <label className="settings-label">
            API Key
            <input
              className="settings-input"
              type="password"
              value={cfgForm.apiKey}
              onChange={e => setCfgForm(c => ({ ...c, apiKey: e.target.value.trim() }))}
              placeholder={
                PROVIDER_PRESETS.find(p => p.id === cfgForm.provider)?.keyPlaceholder ?? 'sk-...'
              }
              required
            />
          </label>

          <label className="settings-label">
            模型名称
            <input
              className="settings-input"
              value={cfgForm.model}
              onChange={e => setCfgForm(c => ({ ...c, model: e.target.value.trim() }))}
              placeholder={
                PROVIDER_PRESETS.find(p => p.id === cfgForm.provider)?.modelPlaceholder ??
                'gpt-4o-mini'
              }
              required
            />
          </label>

          <p className="settings-hint">保存时将自动测试连接，通过后立即生效。</p>

          <button className="settings-save" type="submit" disabled={saving}>
            {saving ? '正在测试并保存…' : '保存'}
          </button>
          {saveMsg && (
            <p className={`settings-msg ${saveMsg.includes('成功') ? 'settings-msg-ok' : 'settings-msg-err'}`}>
              {saveMsg}
            </p>
          )}
          <p className="settings-path">配置文件：{status.configPath}</p>
        </form>
      ) : (
        <>
          {!status.configured && bannerVisible && (
            <div className="chat-banner">
              <span className="chat-banner-icon">🔑</span>
              <span className="chat-banner-text">需要接入 AI 服务后才能使用</span>
              <div className="chat-banner-actions">
                <button className="chat-banner-btn" onClick={openSettings}>
                  去配置
                </button>
                <button
                  className="chat-banner-close"
                  onClick={() => setBannerVisible(false)}
                  aria-label="关闭提示"
                >
                  ×
                </button>
              </div>
            </div>
          )}
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
            {chatStatus === 'submitted' && (
              <div className="msg msg-ai">
                <span className="bubble bubble-ai">
                  <span className="loading" /> AI 正在思考...
                </span>
              </div>
            )}
            {chatError && (
              <div className="msg msg-ai">
                <span className="bubble bubble-ai chat-error-bubble">
                  <span>⚠️ {chatError}</span>
                  <button
                    className="chat-retry-btn"
                    onClick={() => {
                      const lastUser = [...messages].reverse().find(m => m.role === 'user')
                      if (lastUser) {
                        setChatError('')
                        void sendMessage({ text: textOf(lastUser) })
                      }
                    }}
                  >
                    重试
                  </button>
                </span>
              </div>
            )}
          </div>
          <form className="chat-input-row" onSubmit={handleSubmit}>
            <input
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={status.configured ? '问点什么，如：今天最常用的按键是什么？' : '请先完成 AI 服务配置'}
              disabled={chatStatus !== 'ready' || !status.configured}
            />
            <button
              className="chat-send"
              type="submit"
              disabled={chatStatus !== 'ready' || !input.trim() || !status.configured}
            >
              发送
            </button>
          </form>
        </>
      )}
    </div>
  )
}