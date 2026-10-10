import { useEffect, useMemo, useState } from 'react'
import {
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
  Table2,
  X,
} from 'lucide-react'
import type { AiStatus } from '@shared/ai'
import type { InsightRecord } from '@shared/insights'
import {
  dayCounts,
  formatDuration,
  formatMoment,
  hourGrid,
  lifelines,
  openTasks,
  periodDays,
  periodEnd,
  periodEvents,
  periodRelative,
  periodStart,
  periodTitle,
  shiftPeriod,
  summarizePeriod,
  trend,
  trendWindow,
  type StatsDataset,
  type StatsGranularity,
} from '@shared/stats'
import {
  FlowChart,
  FlowTable,
  Legend,
  Lifelines,
  MonthCalendar,
  SERIES,
  TaskBars,
  WeekRhythm,
  type LifelineItem,
} from './charts'

const api = window.lavaManager
const LIFELINE_PREVIEW = 18

function useDataset(): StatsDataset | null {
  const [dataset, setDataset] = useState<StatsDataset | null>(null)
  useEffect(() => {
    let alive = true
    let timer: number | null = null
    const load = () => void api.stats().then((next) => {
      if (alive) setDataset(next)
    })
    load()
    const off = api.onChanged(() => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(load, 600)
    })
    return () => {
      alive = false
      off()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])
  return dataset
}

function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => void api.aiStatus().then((next) => {
      if (alive) setStatus(next)
    })
    load()
    const off = api.onAiChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [])
  return status
}

function Delta({ now, before, unit }: { now: number; before: number; unit: string }) {
  const diff = now - before
  return <span className="tile__delta">{diff === 0 ? `与${unit}持平` : `较${unit} ${diff > 0 ? '+' : '−'}${Math.abs(diff)}`}</span>
}

function Tile({ label, value, children, swatch }: { label: string; value: string | number; children?: React.ReactNode; swatch?: string }) {
  return (
    <div className="tile">
      <span className="tile__label">{swatch && <i style={{ background: swatch }} />}{label}</span>
      <strong className="tile__value">{value}</strong>
      {children}
    </div>
  )
}

type InsightState =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: number }
  | { kind: 'error'; message: string; needsSetup?: boolean }

function InsightCard({ granularity, start, record, status, state, elapsed, titles, changedSince, onRun, onCancel, onOpenAi, onOpenNote }: {
  granularity: StatsGranularity
  start: number
  record: InsightRecord | null
  status: AiStatus | null
  state: InsightState
  elapsed: number
  titles: Map<string, string>
  changedSince: boolean
  onRun(): void
  onCancel(): void
  onOpenAi(): void
  onOpenNote(id: string): void
}) {
  const insight = record?.insight
  const unit = granularity === 'week' ? '这一周' : '这个月'
  const maxTopic = Math.max(1, ...(insight?.topics ?? []).map((topic) => topic.noteIds.length))
  return (
    <section className="stats-card insight" aria-labelledby="insight-title">
      <header className="stats-card__head">
        <h3 id="insight-title"><Sparkles size={15} />AI 解读 · {periodTitle(start, granularity)}</h3>
        {state.kind === 'running' ? (
          <button type="button" onClick={onCancel}><X size={13} />取消</button>
        ) : status?.ok ? (
          <button type="button" className={record ? '' : 'primary'} onClick={onRun}>
            {record ? <RefreshCw size={13} /> : <Sparkles size={13} />}{record ? '重新解读' : '生成解读'}
          </button>
        ) : null}
      </header>

      {state.kind === 'running' && (
        <p className="insight__running"><Loader2 size={15} className="spin" />模型正在读{unit}的便签… {elapsed}s</p>
      )}
      {state.kind === 'error' && (
        <p className="insight__error">
          {state.message}
          {state.needsSetup && <button type="button" onClick={onOpenAi}>去 AI 配置</button>}
        </p>
      )}

      {!record && state.kind !== 'running' && (
        status?.ok ? (
          <p className="hint">让模型读一读{unit}的便签：归纳主题、看看写和完成的节奏、找出拖着或被遗忘的事。会把这段时间便签的文字（每张约前 260 字）发送给 {status.detail}。</p>
        ) : (
          <div className="insight__setup">
            <p className="hint">配置语言模型后，可以让模型解读{unit}的便签：归纳主题、写和完成的节奏、拖着或被遗忘的事。翻译用的也是同一个模型。</p>
            <button type="button" className="primary" onClick={onOpenAi}>去 AI 配置</button>
          </div>
        )
      )}

      {insight && state.kind !== 'running' && (
        <div className="insight__body">
          {insight.headline && <p className="insight__headline">{insight.headline}</p>}
          {insight.summary && <p className="insight__summary">{insight.summary}</p>}
          <div className="insight__grid">
            {insight.topics.length > 0 && (
              <div className="insight__topics">
                <h4>主题</h4>
                {insight.topics.map((topic) => (
                  <div key={topic.name} className="topic" title={topic.noteIds.map((id) => titles.get(id) || '（无标题）').join('\n')}>
                    <div className="topic__line">
                      <span className="topic__name">{topic.name}</span>
                      <span className="topic__bar"><i style={{ width: `${(topic.noteIds.length / maxTopic) * 100}%` }} /></span>
                      <span className="topic__count">{topic.noteIds.length}</span>
                    </div>
                    {topic.desc && <p>{topic.desc}</p>}
                  </div>
                ))}
              </div>
            )}
            <div className="insight__notes">
              {insight.rhythm && (<><h4>节奏</h4><p>{insight.rhythm}</p></>)}
              {insight.insights.length > 0 && (<><h4>发现</h4><ul>{insight.insights.map((line) => <li key={line}>{line}</li>)}</ul></>)}
              {insight.suggestions.length > 0 && (<><h4>建议</h4><ul>{insight.suggestions.map((line) => <li key={line}>{line}</li>)}</ul></>)}
            </div>
          </div>
          {insight.stale.length > 0 && (
            <div className="insight__stale">
              <h4>可能被搁置的便签</h4>
              {insight.stale.map((item) => (
                <div key={item.noteId} className="stale-row">
                  <strong>{titles.get(item.noteId) || '（无标题便签）'}</strong>
                  <span>{item.reason}</span>
                  <button type="button" onClick={() => onOpenNote(item.noteId)}>打开</button>
                </div>
              ))}
            </div>
          )}
          <p className="insight__meta">
            {record.model} · 生成于 {formatMoment(record.createdAt)} · 读了 {record.noteCount} 张便签
            {changedSince && <span className="insight__stale-hint"> · 之后便签有变化，可以重新解读</span>}
          </p>
        </div>
      )}
    </section>
  )
}

export function StatsPage({ onOpenAi }: { onOpenAi(): void }) {
  const dataset = useDataset()
  const status = useAiStatus()
  const [granularity, setGranularity] = useState<StatsGranularity>('week')
  const [anchor, setAnchor] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const [groupByTopic, setGroupByTopic] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [cached, setCached] = useState<{ key: string; record: InsightRecord | null } | null>(null)
  const [insightState, setInsightState] = useState<InsightState>({ kind: 'idle' })
  const [elapsed, setElapsed] = useState(0)

  // Everything is measured against the moment the data was read, so the page renders the same on every pass.
  const now = dataset?.generatedAt ?? 0
  const selected = anchor ?? periodStart(now, granularity)
  const current = periodStart(now, granularity)
  const key = `${granularity}:${selected}`
  const unit = granularity === 'week' ? '上周' : '上月'

  useEffect(() => {
    if (now === 0) return
    let alive = true
    void api.insight(granularity, selected).then((record) => {
      if (alive) setCached({ key: `${granularity}:${selected}`, record })
    })
    return () => {
      alive = false
    }
  }, [granularity, selected, now])

  useEffect(() => {
    if (insightState.kind !== 'running') return
    const started = insightState.startedAt
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500)
    return () => window.clearInterval(timer)
  }, [insightState])

  const notes = useMemo(() => dataset?.notes ?? [], [dataset])
  const view = useMemo(() => {
    const end = periodEnd(selected, granularity)
    const days = periodDays(selected, granularity)
    const events = periodEvents(notes, selected, end)
    return {
      end,
      days,
      periods: trend(notes, trendWindow(selected, granularity, now), granularity, now),
      summary: summarizePeriod(notes, selected, granularity, now),
      previous: summarizePeriod(notes, shiftPeriod(selected, granularity, -1), granularity, now),
      rows: lifelines(notes, selected, end, now),
      hours: granularity === 'week' ? hourGrid(events) : null,
      dayTotals: dayCounts(events, days),
      waiting: openTasks(notes, now, 6),
    }
  }, [notes, selected, granularity, now])

  const record = cached?.key === key ? cached.record : null
  const titles = useMemo(() => new Map(notes.map((note) => [note.id, note.title])), [notes])
  const changedSince = Boolean(record && notes.some((note) => note.updatedAt > record.createdAt && view.rows.some((row) => row.note.id === note.id)))

  const items = useMemo((): LifelineItem[] => {
    const topicOf = new Map<string, string>()
    for (const topic of record?.insight.topics ?? []) for (const id of topic.noteIds) topicOf.set(id, topic.name)
    const rows = view.rows
    if (!groupByTopic || topicOf.size === 0) {
      const shown = expanded ? rows : rows.slice(0, LIFELINE_PREVIEW)
      return shown.map((row) => ({ kind: 'row', key: row.note.id, row, topic: topicOf.get(row.note.id) }))
    }
    const order = [...(record?.insight.topics ?? []).map((topic) => topic.name), '未归类']
    const result: LifelineItem[] = []
    let budget = expanded ? Infinity : LIFELINE_PREVIEW
    for (const name of order) {
      const group = rows.filter((row) => (topicOf.get(row.note.id) ?? '未归类') === name)
      if (group.length === 0 || budget <= 0) continue
      result.push({ kind: 'header', key: `h:${name}`, label: name, count: group.length })
      for (const row of group.slice(0, budget)) result.push({ kind: 'row', key: row.note.id, row, topic: name === '未归类' ? undefined : name })
      budget -= group.length
    }
    return result
  }, [view.rows, record, groupByTopic, expanded])

  const changeGranularity = (next: StatsGranularity) => {
    if (next === granularity) return
    setGranularity(next)
    setAnchor(anchor === null ? null : periodStart(anchor, next))
    setExpanded(false)
    setInsightState({ kind: 'idle' })
  }

  const select = (start: number) => {
    setAnchor(start === current ? null : start)
    setExpanded(false)
    setInsightState({ kind: 'idle' })
  }

  const runInsight = async () => {
    setElapsed(0)
    setInsightState({ kind: 'running', startedAt: Date.now() })
    const runFor = key
    const result = await api.runInsight(granularity, selected)
    if (result.ok) {
      setCached({ key: runFor, record: result.record })
      setInsightState({ kind: 'idle' })
    } else {
      setInsightState(result.message === '已取消' ? { kind: 'idle' } : { kind: 'error', message: result.message, needsSetup: result.needsSetup })
    }
  }

  if (!dataset) return <section className="panel"><p className="empty">正在统计…</p></section>
  if (notes.length === 0) return <section className="panel"><p className="empty">还没有便签。写几张、撕下几张之后，这里会画出你的节奏。</p></section>

  const relative = periodRelative(selected, granularity, now)
  const { summary, previous } = view
  const lifelineTotal = view.rows.length

  return (
    <section className="panel stats">
      <div className="stats-filters">
        <div className="segmented" role="tablist" aria-label="统计粒度">
          <button type="button" role="tab" aria-selected={granularity === 'week'} data-selected={granularity === 'week'} onClick={() => changeGranularity('week')}>按周</button>
          <button type="button" role="tab" aria-selected={granularity === 'month'} data-selected={granularity === 'month'} onClick={() => changeGranularity('month')}>按月</button>
        </div>
        <div className="period-nav">
          <button type="button" aria-label="上一段" onClick={() => select(shiftPeriod(selected, granularity, -1))}><ChevronLeft size={15} /></button>
          <strong>{periodTitle(selected, granularity)}</strong>
          {relative && <span className="period-nav__tag">{relative}</span>}
          <button type="button" aria-label="下一段" disabled={selected >= current} onClick={() => select(shiftPeriod(selected, granularity, 1))}><ChevronRight size={15} /></button>
        </div>
        {selected !== current && <button type="button" className="link" onClick={() => select(current)}>回到{granularity === 'week' ? '本周' : '本月'}</button>}
      </div>

      <div className="tiles">
        <Tile label="新写" value={summary.created} swatch={SERIES.created}><Delta now={summary.created} before={previous.created} unit={unit} /></Tile>
        <Tile label="撕下（完成）" value={summary.completed} swatch={SERIES.completed}>
          <span className="tile__delta">中位用时 {formatDuration(summary.medianDoneMs)}</span>
        </Tile>
        <Tile label="废弃" value={summary.abandoned} swatch={SERIES.abandoned}><Delta now={summary.abandoned} before={previous.abandoned} unit={unit} /></Tile>
        <Tile label="勾选项 完成 / 新增" value={`${summary.tasksDone} / ${summary.tasksCreated}`}>
          <span className="tile__delta">中位勾选用时 {formatDuration(summary.medianTaskMs)}</span>
        </Tile>
        <Tile label={selected === current ? '未完成' : '期末未完成'} value={summary.open}><Delta now={summary.open} before={previous.open} unit={unit} /></Tile>
      </div>

      <InsightCard
        granularity={granularity}
        start={selected}
        record={record}
        status={status}
        state={insightState}
        elapsed={elapsed}
        titles={titles}
        changedSince={changedSince}
        onRun={() => void runInsight()}
        onCancel={() => void api.cancelInsight()}
        onOpenAi={onOpenAi}
        onOpenNote={(id) => void api.focus(id)}
      />

      <section className="stats-card">
        <header className="stats-card__head">
          <h3>进与出 · 最近 12 {granularity === 'week' ? '周' : '个月'}</h3>
          <Legend items={[
            { color: SERIES.created, label: '新写' },
            { color: SERIES.completed, label: '撕下' },
            { color: SERIES.abandoned, label: '废弃' },
          ]} />
          <button type="button" className="icon-toggle" aria-pressed={showTable} title={showTable ? '看图表' : '看数据表'} onClick={() => setShowTable((value) => !value)}>
            {showTable ? <ChartColumn size={14} /> : <Table2 size={14} />}
          </button>
        </header>
        <p className="hint">柱子向上是这段时间写下的便签，向下是撕下（完成）和废弃的。点一根柱子查看那{granularity === 'week' ? '一周' : '个月'}。</p>
        {showTable
          ? <FlowTable periods={view.periods} granularity={granularity} />
          : <FlowChart key={`${granularity}`} periods={view.periods} granularity={granularity} selected={selected} onSelect={select} />}
      </section>

      <section className="stats-card">
        <header className="stats-card__head">
          <h3>便签生命线 · {lifelineTotal} 张</h3>
          <Legend items={[
            { color: SERIES.completed, label: '撕下', shape: 'dot' },
            { color: SERIES.abandoned, label: '废弃', shape: 'dot' },
            { color: SERIES.created, label: '勾选项新增', shape: 'ring' },
            { color: SERIES.completed, label: '勾选完成', shape: 'dot' },
          ]} />
          {record && record.insight.topics.length > 0 && (
            <label className="check-toggle"><input type="checkbox" checked={groupByTopic} onChange={(event) => setGroupByTopic(event.target.checked)} />按主题分组</label>
          )}
        </header>
        <p className="hint">每条纸带是一张便签，从写下延伸到撕下 ✓ 或废弃 ✕；淡出的一端表示还在桌面，锯齿起头表示更早写下。下方的小圆点是勾选清单的每一项。</p>
        {lifelineTotal === 0
          ? <p className="empty">这段时间桌面上没有便签。</p>
          : <Lifelines key={key} items={items} start={selected} end={view.end} days={view.days} granularity={granularity} now={now} onOpen={(id) => void api.focus(id)} />}
        {lifelineTotal > LIFELINE_PREVIEW && (
          <button type="button" className="link" onClick={() => setExpanded((value) => !value)}>
            {expanded ? '收起' : `展开全部 ${lifelineTotal} 张`}
          </button>
        )}
      </section>

      <div className="stats-pair">
        <section className="stats-card">
          <header className="stats-card__head">
            <h3>{granularity === 'week' ? '一周节奏' : '每日动静'}</h3>
          </header>
          <p className="hint">{granularity === 'week' ? '圆点越大，那个钟点写下、撕下、勾选的次数越多。' : '颜色越深，那天写下、撕下、勾选的次数越多。'}</p>
          {view.hours ? <WeekRhythm key={key} grid={view.hours} /> : <MonthCalendar key={key} days={view.days} counts={view.dayTotals} now={now} />}
        </section>

        <section className="stats-card">
          <header className="stats-card__head">
            <h3>勾选清单</h3>
            <Legend items={[{ color: SERIES.created, label: '新增' }, { color: SERIES.completed, label: '勾选' }]} />
          </header>
          <TaskBars key={key} days={view.days} counts={view.dayTotals} granularity={granularity} />
          {view.waiting.length > 0 && (
            <div className="waiting">
              <h4>最久没勾的</h4>
              {view.waiting.map((item) => (
                <button key={`${item.note.id}:${item.task.id}`} type="button" className="waiting__row" onClick={() => void api.focus(item.note.id)}>
                  <span className="waiting__box" data-doing={item.task.startedAt !== null} data-color={item.task.startedAt !== null ? item.note.color : undefined} title={item.task.startedAt !== null ? '进行中' : undefined} aria-hidden />
                  <span className="waiting__text">{item.task.text}<span className="waiting__note"> · {item.note.title.slice(0, 14) || '（无标题便签）'}</span></span>
                  <span className="waiting__age">{formatDuration(item.ageMs)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
