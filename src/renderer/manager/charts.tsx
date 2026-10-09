import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { NoteColor } from '@shared/types'
import {
  formatDuration,
  formatMoment,
  periodTick,
  periodTitle,
  totalCount,
  weekdayLabel,
  type EventCounts,
  type Lifeline,
  type PeriodSummary,
  type StatsGranularity,
} from '@shared/stats'

/*
 * Hand-drawn SVG charts for the statistics page. Marks follow one spec: bars at
 * most 24px with a 4px rounded data end, 2px surface gaps, hairline grid,
 * markers r >= 4 with a 2px surface ring. Colours come from CSS variables in
 * stats.css (validated: blue / aqua / orange on the paper surface).
 */

export const SERIES = {
  created: 'var(--series-created)',
  completed: 'var(--series-done)',
  abandoned: 'var(--series-dropped)',
} as const

const PAPER_FILL: Record<NoteColor, string> = {
  butter: '#f2d869',
  rose: '#f0a39c',
  mint: '#a3d088',
  sky: '#97cfd8',
  lilac: '#c9aed6',
}

// ---- layout helpers ----

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0].contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

interface Tip {
  x: number
  y: number
  content: ReactNode
}

/** One tooltip per chart, positioned inside the chart's relative container. */
export function useTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const show = (event: React.MouseEvent | React.FocusEvent, content: ReactNode) => {
    const host = (event.currentTarget as Element).closest('.chart') as HTMLElement | null
    if (!host) return
    const box = host.getBoundingClientRect()
    if ('clientX' in event) setTip({ x: event.clientX - box.left, y: event.clientY - box.top, content })
    else {
      const target = (event.currentTarget as Element).getBoundingClientRect()
      setTip({ x: target.left + target.width / 2 - box.left, y: target.top - box.top, content })
    }
  }
  const hide = () => setTip(null)
  const node = tip ? (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">{tip.content}</div>
  ) : null
  return { show, hide, node }
}

/** Bar path with a rounded data end and a square baseline end. */
function bar(x: number, y: number, width: number, height: number, roundTop: boolean): string {
  if (height <= 0) return ''
  const r = Math.min(4, height, width / 2)
  if (roundTop) {
    return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`
  }
  return `M${x},${y}V${y + height - r}Q${x},${y + height} ${x + r},${y + height}H${x + width - r}Q${x + width},${y + height} ${x + width},${y + height - r}V${y}Z`
}

function niceStep(max: number, parts: number): number {
  if (max <= parts) return 1
  const raw = max / parts
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power
}

export function Legend({ items }: { items: Array<{ color: string; label: string; shape?: 'bar' | 'dot' | 'ring' }> }) {
  return (
    <div className="legend">
      {items.map((item) => (
        <span key={item.label}>
          <i data-shape={item.shape ?? 'bar'} style={{ '--swatch': item.color } as React.CSSProperties} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

// ---- flow: written (up) vs torn off + abandoned (down), one column per period ----

export function FlowChart({ periods, granularity, selected, onSelect }: {
  periods: PeriodSummary[]
  granularity: StatsGranularity
  selected: number
  onSelect(start: number): void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const tip = useTip()
  const height = 250
  // The bottom margin holds the value under the selected column and the period labels.
  const margin = { top: 24, right: 8, bottom: 42, left: 30 }
  const maxUp = Math.max(1, ...periods.map((period) => period.created))
  const maxDown = Math.max(1, ...periods.map((period) => period.completed + period.abandoned))
  const plotHeight = height - margin.top - margin.bottom
  const scale = plotHeight / (maxUp + maxDown)
  const baseline = margin.top + maxUp * scale
  const plotWidth = Math.max(0, width - margin.left - margin.right)
  const band = periods.length > 0 ? plotWidth / periods.length : 0
  const barWidth = Math.min(24, band * 0.5)
  const step = niceStep(Math.max(maxUp, maxDown), 2)
  const ticks: number[] = []
  for (let value = step; value <= maxUp; value += step) ticks.push(-value)
  for (let value = step; value <= maxDown; value += step) ticks.push(value)
  const showEvery = band >= 40 ? 1 : 2

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="每个周期新写与撕下、废弃的便签数">
          {ticks.map((tick) => {
            const y = baseline + tick * scale
            return (
              <g key={tick}>
                <line className="grid" x1={margin.left} x2={width - margin.right} y1={y} y2={y} />
                <text className="tick" x={margin.left - 6} y={y + 3.5} textAnchor="end">{Math.abs(tick)}</text>
              </g>
            )
          })}
          <text className="tick" x={margin.left - 6} y={baseline + 3.5} textAnchor="end">0</text>
          <text className="axis-note" x={margin.left} y={11}>{'↑ 新写  ↓ 撕下 / 废弃'}</text>
          {periods.map((period, index) => {
            const x = margin.left + index * band
            const center = x + band / 2
            const isSelected = period.start === selected
            const up = period.created * scale
            const done = period.completed * scale
            const dropped = period.abandoned * scale
            const left = center - barWidth / 2
            const content = (
              <>
                <strong>{periodTitle(period.start, granularity)}</strong>
                <span><i style={{ background: SERIES.created }} />新写 {period.created}</span>
                <span><i style={{ background: SERIES.completed }} />撕下 {period.completed}</span>
                <span><i style={{ background: SERIES.abandoned }} />废弃 {period.abandoned}</span>
                <span className="muted">期末未完成 {period.open} 张</span>
              </>
            )
            return (
              <g key={period.start} className="flow-col" data-selected={isSelected} style={{ '--i': index } as React.CSSProperties}>
                {isSelected && <rect className="col-wash" x={x + 2} y={margin.top - 6} width={band - 4} height={plotHeight + 12} rx={6} />}
                <path className="grow-up" d={bar(left, baseline - up - 1, barWidth, up, true)} fill={SERIES.created} />
                <path className="grow-down" d={bar(left, baseline + 1, barWidth, done, dropped <= 0)} fill={SERIES.completed} />
                {dropped > 0 && (
                  <path className="grow-down" d={bar(left, baseline + 1 + done + (done > 0 ? 2 : 0), barWidth, dropped, false)} fill={SERIES.abandoned} />
                )}
                {isSelected && period.created > 0 && <text className="value" x={center} y={baseline - up - 6} textAnchor="middle">{period.created}</text>}
                {isSelected && period.completed + period.abandoned > 0 && (
                  <text className="value" x={center} y={baseline + done + dropped + (dropped > 0 && done > 0 ? 2 : 0) + 14} textAnchor="middle">{period.completed + period.abandoned}</text>
                )}
                {index % showEvery === 0 || isSelected ? (
                  <text className="tick" data-strong={isSelected} x={center} y={height - 6} textAnchor="middle">{periodTick(period.start, granularity)}</text>
                ) : null}
                <rect
                  className="hit"
                  x={x}
                  y={margin.top - 6}
                  width={band}
                  height={plotHeight + 12}
                  tabIndex={0}
                  role="button"
                  aria-label={`${periodTitle(period.start, granularity)}：新写 ${period.created}，撕下 ${period.completed}，废弃 ${period.abandoned}`}
                  onMouseMove={(event) => tip.show(event, content)}
                  onMouseLeave={tip.hide}
                  onFocus={(event) => tip.show(event, content)}
                  onBlur={tip.hide}
                  onClick={() => onSelect(period.start)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelect(period.start)
                  }}
                />
              </g>
            )
          })}
          <line className="baseline" x1={margin.left} x2={width - margin.right} y1={baseline} y2={baseline} />
        </svg>
      )}
      {tip.node}
    </div>
  )
}

export function FlowTable({ periods, granularity }: { periods: PeriodSummary[]; granularity: StatsGranularity }) {
  return (
    <table className="data-table">
      <thead>
        <tr><th>{granularity === 'week' ? '周' : '月'}</th><th>新写</th><th>撕下</th><th>废弃</th><th>勾选新增</th><th>勾选完成</th><th>期末未完成</th><th>撕下中位用时</th></tr>
      </thead>
      <tbody>
        {[...periods].reverse().map((period) => (
          <tr key={period.start}>
            <td>{periodTitle(period.start, granularity)}</td>
            <td>{period.created}</td>
            <td>{period.completed}</td>
            <td>{period.abandoned}</td>
            <td>{period.tasksCreated}</td>
            <td>{period.tasksDone}</td>
            <td>{period.open}</td>
            <td>{formatDuration(period.medianDoneMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---- lifelines: every note alive in the period as a paper strip ----

/** A lifeline row, or a group header when the rows are grouped by topic. */
export type LifelineItem =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'row'; key: string; row: Lifeline; topic?: string }

export function Lifelines({ items, start, end, days, granularity, now, onOpen }: {
  items: LifelineItem[]
  start: number
  end: number
  days: number[]
  granularity: StatsGranularity
  now: number
  onOpen(noteId: string): void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const tip = useTip()
  const rowHeight = 30
  const headerHeight = 24
  const labelWidth = Math.min(190, Math.max(120, width * 0.24))
  const margin = { top: 44, right: 22, bottom: 10 }
  const plotLeft = labelWidth + 10
  const tail = 30
  const plotWidth = Math.max(0, width - plotLeft - margin.right)
  const offsets: number[] = []
  let cursor = margin.top
  for (const item of items) {
    offsets.push(cursor)
    cursor += item.kind === 'header' ? headerHeight : rowHeight
  }
  const height = cursor + margin.bottom
  const x = (time: number) => plotLeft + ((Math.min(Math.max(time, start), end) - start) / (end - start)) * plotWidth
  const dayWidth = plotWidth / days.length
  const labelEvery = granularity === 'week' ? 1 : dayWidth >= 22 ? 1 : dayWidth >= 12 ? 3 : 5
  const nowInside = now >= start && now < end

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="这段时间每张便签从写下到撕下或废弃的时间线">
          <defs>
            {/* An open note fades out over its last few pixels: it is still on the desk. */}
            {Object.entries(PAPER_FILL).map(([color, fill]) => (
              <linearGradient key={color} id={`tail-${color}`} x1="0" x2="1">
                <stop offset="0" stopColor={fill} stopOpacity="1" />
                <stop offset="1" stopColor={fill} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {nowInside && <rect className="future" x={x(now)} y={margin.top - 6} width={plotLeft + plotWidth - x(now)} height={height - margin.top - margin.bottom + 6} />}
          {days.map((day, index) => {
            const weekday = (new Date(day).getDay() + 6) % 7
            const left = plotLeft + index * dayWidth
            return (
              <g key={day}>
                {weekday >= 5 && <rect className="weekend" x={left} y={margin.top - 6} width={dayWidth} height={height - margin.top - margin.bottom + 6} />}
                {(granularity === 'week' || weekday === 0) && <line className="grid" x1={left} x2={left} y1={margin.top - 6} y2={height - margin.bottom} />}
                {index % labelEvery === 0 && (
                  <text className="tick" x={left + (granularity === 'week' ? dayWidth / 2 : 2)} y={16} textAnchor={granularity === 'week' ? 'middle' : 'start'}>
                    {granularity === 'week' ? `${weekdayLabel(day)} ${new Date(day).getMonth() + 1}/${new Date(day).getDate()}` : new Date(day).getDate()}
                  </text>
                )}
              </g>
            )
          })}
          {nowInside && (
            <g className="now">
              <line x1={x(now)} x2={x(now)} y1={margin.top - 8} y2={height - margin.bottom} />
              <text x={x(now)} y={margin.top - 13} textAnchor="middle">现在</text>
            </g>
          )}
          {items.map((item, index) => {
            const y = offsets[index]
            if (item.kind === 'header') {
              return (
                <g key={item.key} className="life-header">
                  <line x1={0} x2={width - margin.right} y1={y + headerHeight - 4} y2={y + headerHeight - 4} />
                  <text x={4} y={y + headerHeight - 9}>{item.label}<tspan className="muted"> · {item.count} 张</tspan></text>
                </g>
              )
            }
            const { row, topic } = item
            const middle = y + rowHeight / 2
            const left = x(row.from)
            const right = Math.max(left + 6, x(row.to))
            const doneTasks = row.note.tasks.filter((task) => task.checkedAt !== null).length
            const title = row.note.title || '（无标题便签）'
            const content = (
              <>
                <strong>{title}</strong>
                <span className="muted">写于 {formatMoment(row.note.createdAt, true)}</span>
                {row.note.endedAt !== null
                  ? <span>{row.note.state === 'abandoned' ? '废弃' : '撕下'}于 {formatMoment(row.note.endedAt)} · 用时 {formatDuration(row.note.endedAt - row.note.createdAt)}</span>
                  : <span>还在桌面 · 已 {formatDuration(now - row.note.createdAt)}</span>}
                {row.note.tasks.length > 0 && <span>勾选清单 {doneTasks}/{row.note.tasks.length}</span>}
                {topic && <span>主题：{topic}</span>}
                {row.note.state === 'active' && <span className="muted">点击打开这张便签</span>}
              </>
            )
            return (
              <g
                key={item.key}
                className="life-row"
                style={{ '--i': index } as React.CSSProperties}
                tabIndex={0}
                role="button"
                aria-label={`${title}，${row.note.endedAt !== null ? (row.note.state === 'abandoned' ? '已废弃' : '已撕下') : '还在桌面'}`}
                onMouseMove={(event) => tip.show(event, content)}
                onMouseLeave={tip.hide}
                onFocus={(event) => tip.show(event, content)}
                onBlur={tip.hide}
                onClick={() => row.note.state === 'active' && onOpen(row.note.id)}
                onKeyDown={(event) => {
                  if ((event.key === 'Enter' || event.key === ' ') && row.note.state === 'active') onOpen(row.note.id)
                }}
                data-clickable={row.note.state === 'active'}
              >
                <rect className="row-hit" x={0} y={y} width={width} height={rowHeight} />
                <text className="life-label" x={labelWidth} y={middle + 4} textAnchor="end">
                  {title.length > 16 ? `${title.slice(0, 15)}…` : title}
                </text>
                <g className="strip" style={{ transformOrigin: `${left}px ${middle}px` }}>
                  {row.carriedOut ? (
                    <>
                      <rect x={left} y={middle - 6} width={Math.max(3, right - left - tail + 3)} height={12} rx={3} fill={PAPER_FILL[row.note.color]} />
                      <rect x={Math.max(left, right - tail)} y={middle - 6} width={Math.min(tail, right - left)} height={12} fill={`url(#tail-${row.note.color})`} />
                    </>
                  ) : (
                    <rect x={left} y={middle - 6} width={right - left} height={12} rx={3} fill={PAPER_FILL[row.note.color]} />
                  )}
                  {row.carriedIn && <path className="torn-edge" d={`M${left},${middle - 6} l3,3 l-3,3 l3,3 l-3,3`} />}
                </g>
                {row.note.tasks.map((task) => {
                  const added = task.createdAt >= start && task.createdAt < end
                  const checked = task.checkedAt !== null && task.checkedAt >= start && task.checkedAt < end
                  if (!added && !checked) return null
                  return (
                    <g key={task.id} className="task-mark">
                      {added && checked && <line x1={x(task.createdAt)} x2={x(task.checkedAt!)} y1={middle + 9} y2={middle + 9} />}
                      {added && <circle cx={x(task.createdAt)} cy={middle + 9} r={3.5} className="task-added" />}
                      {checked && <circle cx={x(task.checkedAt!)} cy={middle + 9} r={4} className="task-done" />}
                    </g>
                  )
                })}
                {row.outcome && (
                  <g className="end-cap" transform={`translate(${right},${middle})`}>
                    <circle r={7} fill={row.outcome === 'completed' ? SERIES.completed : SERIES.abandoned} />
                    {row.outcome === 'completed'
                      ? <path d="M-3.2,0.2 L-0.9,2.5 L3.3,-2.4" />
                      : <path d="M-2.6,-2.6 L2.6,2.6 M2.6,-2.6 L-2.6,2.6" />}
                  </g>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {tip.node}
    </div>
  )
}

// ---- rhythm: a week as weekday × hour, a month as a calendar ----

const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21]
const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function countLines(counts: EventCounts) {
  return (
    <>
      {counts.created > 0 && <span><i style={{ background: SERIES.created }} />新写 {counts.created}</span>}
      {counts.completed > 0 && <span><i style={{ background: SERIES.completed }} />撕下 {counts.completed}</span>}
      {counts.abandoned > 0 && <span><i style={{ background: SERIES.abandoned }} />废弃 {counts.abandoned}</span>}
      {counts['task-created'] > 0 && <span>勾选项新增 {counts['task-created']}</span>}
      {counts['task-done'] > 0 && <span>勾选完成 {counts['task-done']}</span>}
      {totalCount(counts) === 0 && <span className="muted">没有动静</span>}
    </>
  )
}

export function WeekRhythm({ grid }: { grid: EventCounts[][] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const tip = useTip()
  const left = 38
  const top = 18
  const cell = Math.max(10, Math.min(26, (width - left - 4) / 24))
  const height = top + cell * 7 + 4
  const max = Math.max(1, ...grid.flat().map(totalCount))
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="这一周每天每个小时的便签动静">
          {HOUR_LABELS.map((hour) => (
            <text key={hour} className="tick" x={left + hour * cell + cell / 2} y={11} textAnchor="middle">{hour}时</text>
          ))}
          {grid.map((hours, day) => (
            <g key={day}>
              <text className="tick" x={left - 8} y={top + day * cell + cell / 2 + 4} textAnchor="end">{WEEKDAY_NAMES[day]}</text>
              {hours.map((counts, hour) => {
                const total = totalCount(counts)
                const cx = left + hour * cell + cell / 2
                const cy = top + day * cell + cell / 2
                const radius = total > 0 ? Math.max(3, Math.sqrt(total / max) * (cell / 2 - 1.5)) : 1.2
                const content = (
                  <>
                    <strong>{WEEKDAY_NAMES[day]} {hour}:00–{hour + 1}:00</strong>
                    {countLines(counts)}
                  </>
                )
                return (
                  <g key={hour}>
                    <circle className={total > 0 ? 'punch' : 'punch-empty'} cx={cx} cy={cy} r={radius} style={{ '--i': hour } as React.CSSProperties} />
                    {total > 0 && (
                      <rect
                        className="hit"
                        x={cx - cell / 2}
                        y={cy - cell / 2}
                        width={cell}
                        height={cell}
                        tabIndex={0}
                        aria-label={`${WEEKDAY_NAMES[day]} ${hour} 点：${total} 次`}
                        onMouseMove={(event) => tip.show(event, content)}
                        onMouseLeave={tip.hide}
                        onFocus={(event) => tip.show(event, content)}
                        onBlur={tip.hide}
                      />
                    )}
                  </g>
                )
              })}
            </g>
          ))}
        </svg>
      )}
      {tip.node}
    </div>
  )
}

/** Sequential blue ramp for counts: empty, then four steps light → dark. */
const HEAT = ['var(--heat-0)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)']

function heatLevel(total: number, max: number): number {
  if (total <= 0) return 0
  return Math.min(4, 1 + Math.floor((total / max) * 3.999))
}

export function MonthCalendar({ days, counts, now }: { days: number[]; counts: EventCounts[]; now: number }) {
  const tip = useTip()
  const max = Math.max(1, ...counts.map(totalCount))
  const offset = days.length > 0 ? (new Date(days[0]).getDay() + 6) % 7 : 0
  return (
    <div className="chart">
      <div className="calendar" role="grid" aria-label="这个月每天的便签动静">
        {WEEKDAY_NAMES.map((name) => <span key={name} className="calendar__head">{name.slice(1)}</span>)}
        {Array.from({ length: offset }, (_, index) => <span key={`pad-${index}`} />)}
        {days.map((day, index) => {
          const total = totalCount(counts[index])
          const level = heatLevel(total, max)
          const content = (
            <>
              <strong>{new Date(day).getMonth() + 1}月{new Date(day).getDate()}日 {weekdayLabel(day)}</strong>
              {countLines(counts[index])}
            </>
          )
          return (
            <button
              key={day}
              type="button"
              className="calendar__day"
              data-level={level}
              data-future={day > now}
              style={{ background: HEAT[level], '--i': index } as React.CSSProperties}
              aria-label={`${new Date(day).getDate()}日：${total} 次`}
              onMouseMove={(event) => tip.show(event, content)}
              onMouseLeave={tip.hide}
              onFocus={(event) => tip.show(event, content)}
              onBlur={tip.hide}
            >
              {new Date(day).getDate()}
            </button>
          )
        })}
      </div>
      <div className="heat-legend" aria-hidden>
        <span>少</span>
        {HEAT.map((color) => <i key={color} style={{ background: color }} />)}
        <span>多</span>
      </div>
      {tip.node}
    </div>
  )
}

// ---- checklist items per day ----

export function TaskBars({ days, counts, granularity }: { days: number[]; counts: EventCounts[]; granularity: StatsGranularity }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const tip = useTip()
  const height = 130
  const margin = { top: 14, right: 4, bottom: 20, left: 22 }
  const max = Math.max(1, ...counts.map((entry) => Math.max(entry['task-created'], entry['task-done'])))
  const plotWidth = Math.max(0, width - margin.left - margin.right)
  const plotHeight = height - margin.top - margin.bottom
  const band = days.length > 0 ? plotWidth / days.length : 0
  const barWidth = Math.max(2, Math.min(12, (band - 4) / 2))
  const baseline = margin.top + plotHeight
  const step = niceStep(max, 2)
  const ticks: number[] = []
  for (let value = step; value <= max; value += step) ticks.push(value)
  const labelEvery = granularity === 'week' ? 1 : band >= 18 ? 2 : 5
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="每天新增和勾选完成的清单项">
          {ticks.map((tick) => {
            const y = baseline - (tick / max) * plotHeight
            return (
              <g key={tick}>
                <line className="grid" x1={margin.left} x2={width - margin.right} y1={y} y2={y} />
                <text className="tick" x={margin.left - 5} y={y + 3.5} textAnchor="end">{tick}</text>
              </g>
            )
          })}
          {days.map((day, index) => {
            const entry = counts[index]
            const center = margin.left + index * band + band / 2
            const added = (entry['task-created'] / max) * plotHeight
            const done = (entry['task-done'] / max) * plotHeight
            const content = (
              <>
                <strong>{new Date(day).getMonth() + 1}月{new Date(day).getDate()}日 {weekdayLabel(day)}</strong>
                <span><i style={{ background: SERIES.created }} />新增 {entry['task-created']}</span>
                <span><i style={{ background: SERIES.completed }} />勾选 {entry['task-done']}</span>
              </>
            )
            return (
              <g key={day} style={{ '--i': index } as React.CSSProperties}>
                <path className="grow-up" d={bar(center - barWidth - 1, baseline - added, barWidth, added, true)} fill={SERIES.created} />
                <path className="grow-up" d={bar(center + 1, baseline - done, barWidth, done, true)} fill={SERIES.completed} />
                {index % labelEvery === 0 && (
                  <text className="tick" x={center} y={height - 5} textAnchor="middle">
                    {granularity === 'week' ? weekdayLabel(day).slice(1) : new Date(day).getDate()}
                  </text>
                )}
                <rect
                  className="hit"
                  x={center - band / 2}
                  y={margin.top}
                  width={band}
                  height={plotHeight}
                  onMouseMove={(event) => tip.show(event, content)}
                  onMouseLeave={tip.hide}
                />
              </g>
            )
          })}
          <line className="baseline" x1={margin.left} x2={width - margin.right} y1={baseline} y2={baseline} />
        </svg>
      )}
      {tip.node}
    </div>
  )
}
