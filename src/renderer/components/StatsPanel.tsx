/**
 * 键盘数据实时统计面板。
 * 通过 preload keyboardApi 订阅主进程事件 + 拉取历史统计。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DailyStats } from '../../shared/types.ts'

interface LiveCounters {
  keyPresses: Record<string, number>
  combinationPresses: Record<string, number>
  mouse: { left: number; right: number; middle: number }
  total: number
  startTime: number
}

const EMPTY_STATS: DailyStats = {
  keyPresses: {},
  combinationPresses: {},
  mousePresses: {},
  totalPresses: 0
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}小时 ${m}分钟 ${s % 60}秒`
}

/** 取 top N 键位（含历史+实时合并） */
function topKeys(stats: DailyStats, live: LiveCounters, n: number): Array<{ key: string; count: number }> {
  const merged = new Map<string, number>()
  for (const [k, v] of Object.entries(stats.keyPresses)) merged.set(k, v)
  for (const [k, v] of Object.entries(live.keyPresses)) merged.set(k, (merged.get(k) ?? 0) + v)
  return [...merged.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

export default function StatsPanel(): React.JSX.Element {
  const [stats, setStats] = useState<DailyStats>(EMPTY_STATS)
  const [live, setLive] = useState<LiveCounters>({
    keyPresses: {},
    combinationPresses: {},
    mouse: { left: 0, right: 0, middle: 0 },
    total: 0,
    startTime: Date.now()
  })
  const [now, setNow] = useState(Date.now())
  // 用 ref 避免事件闭包读到旧 live
  const liveRef = useRef(live)
  liveRef.current = live

  useEffect(() => {
    void window.keyboardApi?.getDailyStats().then(setStats)
    return window.keyboardApi?.onKeyEvent(data => {
      const cur = liveRef.current
      const target =
        data.key.includes('+') ||
        ['Ctrl', 'Shift', 'Alt', 'Command'].some(s => data.key.includes(s))
          ? 'combinationPresses'
          : 'keyPresses'
      setLive({
        ...cur,
        [target]: { ...cur[target], [data.key]: (cur[target][data.key] ?? 0) + 1 },
        total: cur.total + 1
      })
    })
  }, [])

  useEffect(() => {
    return window.keyboardApi?.onMouseEvent(data => {
      const cur = liveRef.current
      const mouse = { ...cur.mouse }
      if (data.name === 'Left') mouse.left++
      else if (data.name === 'Right') mouse.right++
      else mouse.middle++
      setLive({ ...cur, mouse })
    })
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // 每 30s 刷新一次历史统计（与主进程同步节奏一致），合并实时增量
  useEffect(() => {
    const t = setInterval(() => {
      void window.keyboardApi?.getDailyStats().then(s => {
        setStats(s)
        // 历史已包含实时已同步部分，重置全部实时增量（含鼠标）
        setLive(cur => ({
          ...cur,
          keyPresses: {},
          combinationPresses: {},
          mouse: { left: 0, right: 0, middle: 0 },
          total: 0
        }))
      })
    }, 30_000)
    return () => clearInterval(t)
  }, [])

  const mergedTop = useMemo(() => topKeys(stats, live, 10), [stats, live])
  const runningTime = now - live.startTime

  return (
    <div className="stats-grid">
      <section className="summary-box">
        <h2>实时统计</h2>
        <p className="running-time">已运行时间：{formatDuration(runningTime)}</p>
        <div className="stat-section">
          <h3>键盘统计</h3>
          <p>键盘按键次数：{stats.totalPresses + live.total}</p>
          <p>最近按键（实时增量）：{live.total}</p>
        </div>
        <div className="stat-section">
          <h3>鼠标统计</h3>
          <p>左键点击：{(stats.mousePresses['Left'] ?? 0) + live.mouse.left}</p>
          <p>右键点击：{(stats.mousePresses['Right'] ?? 0) + live.mouse.right}</p>
          <p>中键点击：{(stats.mousePresses['Middle'] ?? 0) + live.mouse.middle}</p>
        </div>
      </section>

      <section className="chart-container">
        <h2>最常用按键</h2>
        {mergedTop.length === 0 ? (
          <p className="empty-hint">暂无数据——敲击键盘后这里会出现统计。</p>
        ) : (
          <ol className="key-list">
            {mergedTop.map(({ key, count }, i) => (
              <li key={key}>
                <span className="key-rank">{i + 1}</span>
                <span className="key-name">{key}</span>
                <span className="key-bar">
                  <span
                    className="key-bar-fill"
                    style={{ width: `${Math.round((count / mergedTop[0].count) * 100)}%` }}
                  />
                </span>
                <span className="key-count">{count}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}