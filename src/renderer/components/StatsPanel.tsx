/**
 * 键盘数据实时统计面板。
 * 通过 preload keyboardApi 订阅主进程事件 + 拉取历史统计。
 * 支持 今日/昨日 切换；实时按键 ticker 反馈最近的敲击。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DailyStats, TrendData } from '../../shared/types.ts'

type Range = 'today' | 'yesterday'

interface LiveCounters {
  keyPresses: Record<string, number>
  combinationPresses: Record<string, number>
  mouse: { left: number; right: number; middle: number }
  /** 本段普通键实时增量（与历史 totalPresses 同口径，仅普通键） */
  normalKeys: number
  /** 最近敲击的按键（用于实时动效展示） */
  recent: string[]
  startTime: number
}

const EMPTY_STATS: DailyStats = {
  keyPresses: {},
  combinationPresses: {},
  mousePresses: {},
  totalPresses: 0
}

const EMPTY_LIVE: LiveCounters = {
  keyPresses: {},
  combinationPresses: {},
  mouse: { left: 0, right: 0, middle: 0 },
  normalKeys: 0,
  recent: [],
  startTime: Date.now()
}

const RECENT_LIMIT = 8

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}小时 ${m}分钟 ${s % 60}秒`
}

/** yyyy-mm-dd -> MM-DD */
function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${m}-${d}`
}

/** 取 top N 键位（今日合并实时增量；昨日仅用历史） */
function topKeys(stats: DailyStats, live: LiveCounters, n: number, range: Range): Array<{ key: string; count: number }> {
  const merged = new Map<string, number>()
  for (const [k, v] of Object.entries(stats.keyPresses)) merged.set(k, v)
  if (range === 'today') {
    for (const [k, v] of Object.entries(live.keyPresses)) merged.set(k, (merged.get(k) ?? 0) + v)
  }
  return [...merged.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

export default function StatsPanel(): React.JSX.Element {
  const [range, setRange] = useState<Range>('today')
  const [stats, setStats] = useState<DailyStats>(EMPTY_STATS)
  const [live, setLive] = useState<LiveCounters>(EMPTY_LIVE)
  const [now, setNow] = useState(Date.now())
  const [trendDays, setTrendDays] = useState<7 | 30>(7)
  const [trend, setTrend] = useState<TrendData>({ dates: [], totals: [] })
  // 用 ref 避免事件闭包读到旧 live
  const liveRef = useRef(live)
  liveRef.current = live

  const fetchRange = useCallback((r: Range): void => {
    const p = r === 'today' ? window.keyboardApi?.getDailyStats() : window.keyboardApi?.getYesterdayStats()
    if (!p) return
    void p.then(s => {
      setStats(s)
      // 历史已包含实时已同步部分，重置实时增量（昨日视图无需实时）
      setLive(cur => (r === 'today' ? { ...cur, keyPresses: {}, combinationPresses: {}, mouse: { left: 0, right: 0, middle: 0 }, normalKeys: 0, recent: [] } : cur))
    })
  }, [])

  useEffect(() => {
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
        normalKeys: cur.normalKeys + (target === 'keyPresses' ? 1 : 0),
        recent: [data.key, ...cur.recent].slice(0, RECENT_LIMIT)
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

  // 主进程每完成一次写库同步，就推送事件触发刷新（替代周期性轮询，无重复/漏计窗口）
  useEffect(() => {
    fetchRange(range)
    return window.keyboardApi?.onStatsSynced(() => fetchRange(range))
  }, [range, fetchRange])

  // 拉取趋势数据（切换跨度或数据同步时刷新）
  useEffect(() => {
    const load = (): void => {
      void window.keyboardApi?.getTrend(trendDays).then(setTrend)
    }
    load()
    return window.keyboardApi?.onStatsSynced(load)
  }, [trendDays])

  const mergedTop = useMemo(() => topKeys(stats, live, 10, range), [stats, live, range])
  const runningTime = now - live.startTime
  const trendMax = useMemo(() => Math.max(1, ...trend.totals), [trend.totals])
  const trendEmpty = useMemo(() => trend.totals.length === 0 || trend.totals.every(t => t === 0), [trend.totals])

  const setRangeAndClear = (r: Range): void => {
    setRange(r)
    setLive(cur => ({ ...cur, startTime: Date.now() }))
  }

  return (
    <div className="stats-grid">
      <section className="summary-box">
        <div className="panel-head">
          <h2>实时统计</h2>
          <div className="range-toggle" role="tablist" aria-label="统计范围">
            <button
              type="button"
              className={`range-btn ${range === 'today' ? 'range-btn-active' : ''}`}
              onClick={() => setRangeAndClear('today')}
            >
              今日
            </button>
            <button
              type="button"
              className={`range-btn ${range === 'yesterday' ? 'range-btn-active' : ''}`}
              onClick={() => setRangeAndClear('yesterday')}
            >
              昨日
            </button>
          </div>
        </div>
        <p className="running-time">已运行时间：{formatDuration(runningTime)}</p>

        <div className="stat-section">
          <h3>键盘统计</h3>
          <p className="stat-big">
            按键次数<span className="stat-big-num">{range === 'today' ? stats.totalPresses + live.normalKeys : stats.totalPresses}</span>
          </p>
          {range === 'today' && <p className="stat-sub">本次运行实时增量：{live.normalKeys} 次</p>}
          {range === 'today' && live.recent.length > 0 && (
            <div className="recent-keys" aria-label="最近按键">
              {live.recent.map((k, i) => (
                <span key={`${k}-${i}`} className="recent-key">
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="stat-section">
          <h3>鼠标统计</h3>
          <p>左键：{(stats.mousePresses['Left'] ?? 0) + (range === 'today' ? live.mouse.left : 0)}</p>
          <p>右键：{(stats.mousePresses['Right'] ?? 0) + (range === 'today' ? live.mouse.right : 0)}</p>
          <p>中键：{(stats.mousePresses['Middle'] ?? 0) + (range === 'today' ? live.mouse.middle : 0)}</p>
        </div>
      </section>

      <section className="chart-container">
        <h2>最常用按键 · {range === 'today' ? '今日' : '昨日'}</h2>
        {mergedTop.length === 0 ? (
          <p className="empty-hint">该时段暂无数据——敲击键盘后这里会出现统计。</p>
        ) : (
          <ol className="key-list">
            {mergedTop.map(({ key, count }, i) => (
              <li key={key} className="key-row">
                <span className="key-rank">{i + 1}</span>
                <span className="key-name">{key}</span>
                <span className="key-bar">
                  <span
                    className="key-bar-fill"
                    style={{ width: `${Math.max(4, Math.round((count / mergedTop[0].count) * 100))}%` }}
                  />
                </span>
                <span className="key-count">{count}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="chart-container trend-container">
        <div className="panel-head">
          <h2>按键趋势</h2>
          <div className="range-toggle" role="tablist" aria-label="趋势跨度">
            <button
              type="button"
              className={`range-btn ${trendDays === 7 ? 'range-btn-active' : ''}`}
              onClick={() => setTrendDays(7)}
            >
              近7天
            </button>
            <button
              type="button"
              className={`range-btn ${trendDays === 30 ? 'range-btn-active' : ''}`}
              onClick={() => setTrendDays(30)}
            >
              近30天
            </button>
          </div>
        </div>
        {trendEmpty ? (
          <p className="empty-hint">暂无趋势数据——多使用几天后这里会出现。</p>
        ) : (
          <div className="trend-chart" role="img" aria-label={`最近${trendDays}天按键趋势`}>
            {trend.totals.map((total, i) => (
              <div className="trend-col" key={trend.dates[i]} title={`${trend.dates[i]}：${total} 次`}>
                <span className="trend-val">{total || ''}</span>
                <div className="trend-bar">
                  <div
                    className="trend-bar-fill"
                    style={{ height: `${Math.max(total > 0 ? 2 : 0, (total / trendMax) * 100)}%` }}
                  />
                </div>
                <span className="trend-label">{shortDate(trend.dates[i])}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
