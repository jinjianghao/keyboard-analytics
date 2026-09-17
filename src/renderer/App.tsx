/**
 * 根组件：统计面板 + AI 聊天。
 */
import StatsPanel from './components/StatsPanel.tsx'
import ChatPanel from './components/ChatPanel.tsx'

export default function App(): React.JSX.Element {
  return (
    <div className="container">
      <h1>键盘使用统计</h1>
      <StatsPanel />
      <ChatPanel />
    </div>
  )
}