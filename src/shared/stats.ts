import type { NoteColor, NoteDoc, NoteDocNode, NoteRecord } from './types.ts'
import { noteState } from './note-model.ts'

/**
 * Note statistics: everything here is exact counting over timestamps the app
 * records itself. The language model only adds the semantic part (topics,
 * summary) on top; see insights.ts.
 */

export type StatsGranularity = 'week' | 'month'
export type NoteOutcome = 'active' | 'completed' | 'abandoned'

export interface StatsTask {
  id: string
  text: string
  createdAt: number
  /** When it was marked in progress; still set after it is checked. */
  startedAt: number | null
  checkedAt: number | null
}

export interface StatsNote {
  id: string
  title: string
  color: NoteColor
  createdAt: number
  updatedAt: number
  state: NoteOutcome
  /** When the note was torn off or abandoned. */
  endedAt: number | null
  /** When the note was marked in progress, if it is or was. */
  startedAt: number | null
  visible: boolean
  tasks: StatsTask[]
  /** Characters of text, for a rough sense of size. */
  chars: number
}

export interface StatsDataset {
  notes: StatsNote[]
  generatedAt: number
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

function readTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function plainText(node: NoteDocNode, skipLists: boolean): string {
  if (node.type === 'text') return node.text ?? ''
  if (skipLists && (node.type === 'taskList' || node.type === 'bulletList' || node.type === 'orderedList')) return ''
  return (node.content ?? []).map((child) => plainText(child, skipLists)).join(node.type === 'paragraph' ? '' : ' ')
}

/**
 * Checklist items with their timeline. The editor stamps each item with an id,
 * a creation time and a check time; items saved before that fall back to the
 * note's own times.
 */
export function extractTasks(doc: NoteDoc, fallback: { createdAt: number; updatedAt: number }): StatsTask[] {
  const tasks: StatsTask[] = []
  const walk = (node: NoteDocNode) => {
    if (tasks.length >= 2000) return
    if (node.type === 'taskItem') {
      const attrs = node.attrs ?? {}
      const createdAt = readTime(attrs.createdAt) ?? fallback.createdAt
      const checked = attrs.checked === true
      const checkedAt = checked ? Math.max(createdAt, readTime(attrs.checkedAt) ?? fallback.updatedAt) : null
      const text = plainText(node, true).replace(/\s+/g, ' ').trim()
      tasks.push({
        id: typeof attrs.tid === 'string' && attrs.tid ? attrs.tid : `t${tasks.length + 1}`,
        text: text.slice(0, 200),
        createdAt,
        startedAt: readTime(attrs.startedAt),
        checkedAt,
      })
    }
    node.content?.forEach(walk)
  }
  walk(doc)
  return tasks
}

export function buildStatsNote(note: NoteRecord, doc: NoteDoc): StatsNote {
  const state = noteState(note)
  return {
    id: note.id,
    title: note.title,
    color: note.color,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    state,
    endedAt: state === 'completed' ? note.archivedAt ?? null : state === 'abandoned' ? note.abandonedAt ?? null : null,
    startedAt: note.startedAt ?? null,
    visible: note.visible,
    tasks: extractTasks(doc, note),
    chars: plainText(doc, false).replace(/\s+/g, '').length,
  }
}

// ---- periods (local time; weeks start on Monday) ----

export function periodStart(time: number, granularity: StatsGranularity): number {
  const date = new Date(time)
  if (granularity === 'month') return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  const weekday = (date.getDay() + 6) % 7
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - weekday).getTime()
}

export function shiftPeriod(start: number, granularity: StatsGranularity, count: number): number {
  const date = new Date(start)
  if (granularity === 'month') return new Date(date.getFullYear(), date.getMonth() + count, 1).getTime()
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count * 7).getTime()
}

export function periodEnd(start: number, granularity: StatsGranularity): number {
  return shiftPeriod(start, granularity, 1)
}

/** Days in the period, each as its local midnight. */
export function periodDays(start: number, granularity: StatsGranularity): number[] {
  const end = periodEnd(start, granularity)
  const first = new Date(start)
  const days: number[] = []
  for (let offset = 0; offset < 32; offset += 1) {
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + offset).getTime()
    if (day >= end) break
    days.push(day)
  }
  return days
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export function weekdayLabel(time: number): string {
  return `周${WEEKDAYS[(new Date(time).getDay() + 6) % 7]}`
}

/** "2026年10月" or "10月6日 – 12日" / "9月29日 – 10月5日". */
export function periodTitle(start: number, granularity: StatsGranularity): string {
  const first = new Date(start)
  if (granularity === 'month') return `${first.getFullYear()}年${first.getMonth() + 1}月`
  const last = new Date(periodEnd(start, granularity) - DAY / 2)
  const tail = last.getMonth() === first.getMonth() ? `${last.getDate()}日` : `${last.getMonth() + 1}月${last.getDate()}日`
  return `${first.getMonth() + 1}月${first.getDate()}日 – ${tail}`
}

/** "本周" / "上周" / "本月" / "上月", or null for older periods. */
export function periodRelative(start: number, granularity: StatsGranularity, now: number): string | null {
  const current = periodStart(now, granularity)
  if (start === current) return granularity === 'week' ? '本周' : '本月'
  if (start === shiftPeriod(current, granularity, -1)) return granularity === 'week' ? '上周' : '上月'
  return null
}

/** Short axis label: "10/6" for a week, "10月" (or "2027年1月") for a month. */
export function periodTick(start: number, granularity: StatsGranularity): string {
  const date = new Date(start)
  if (granularity === 'week') return `${date.getMonth() + 1}/${date.getDate()}`
  return date.getMonth() === 0 ? `${date.getFullYear()}年1月` : `${date.getMonth() + 1}月`
}

// ---- counting ----

export interface PeriodSummary {
  start: number
  end: number
  created: number
  completed: number
  abandoned: number
  tasksCreated: number
  tasksDone: number
  /** Notes still on the desk at the end of the period (or now, for the current one). */
  open: number
  /** Median time from writing to tearing off, for notes torn off in the period. */
  medianDoneMs: number | null
  /** Median time from adding to checking, for checklist items checked in the period. */
  medianTaskMs: number | null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const within = (time: number | null, start: number, end: number): time is number => time !== null && time >= start && time < end

export function summarizeRange(notes: StatsNote[], start: number, end: number, now: number): PeriodSummary {
  const summary: PeriodSummary = {
    start,
    end,
    created: 0,
    completed: 0,
    abandoned: 0,
    tasksCreated: 0,
    tasksDone: 0,
    open: 0,
    medianDoneMs: null,
    medianTaskMs: null,
  }
  const doneDurations: number[] = []
  const taskDurations: number[] = []
  const cutoff = Math.min(end, now)
  for (const note of notes) {
    if (within(note.createdAt, start, end)) summary.created += 1
    if (within(note.endedAt, start, end)) {
      if (note.state === 'completed') {
        summary.completed += 1
        doneDurations.push(note.endedAt - note.createdAt)
      } else if (note.state === 'abandoned') {
        summary.abandoned += 1
      }
    }
    if (note.createdAt < cutoff && (note.endedAt === null || note.endedAt >= cutoff)) summary.open += 1
    for (const task of note.tasks) {
      if (within(task.createdAt, start, end)) summary.tasksCreated += 1
      if (within(task.checkedAt, start, end)) {
        summary.tasksDone += 1
        taskDurations.push(task.checkedAt - task.createdAt)
      }
    }
  }
  summary.medianDoneMs = median(doneDurations)
  summary.medianTaskMs = median(taskDurations)
  return summary
}

export function summarizePeriod(notes: StatsNote[], start: number, granularity: StatsGranularity, now: number): PeriodSummary {
  return summarizeRange(notes, start, periodEnd(start, granularity), now)
}

/**
 * The periods shown in the overview: `count` of them, ending with the current
 * one while the selected period is among them, otherwise centred on it.
 */
export function trendWindow(selected: number, granularity: StatsGranularity, now: number, count = 12): number[] {
  const current = periodStart(now, granularity)
  const earliestShown = shiftPeriod(current, granularity, -(count - 1))
  const last = selected >= earliestShown ? current : shiftPeriod(selected, granularity, Math.floor(count / 2))
  return Array.from({ length: count }, (_, index) => shiftPeriod(last, granularity, index - count + 1))
}

export function trend(notes: StatsNote[], starts: number[], granularity: StatsGranularity, now: number): PeriodSummary[] {
  return starts.map((start) => summarizePeriod(notes, start, granularity, now))
}

// ---- lifelines: each note as a strip across the period ----

export interface Lifeline {
  note: StatsNote
  /** Visible part of the note's life inside the period. */
  from: number
  to: number
  /** Written before the period started. */
  carriedIn: boolean
  /** Still on the desk after the period (or now). */
  carriedOut: boolean
  /** How the note ended, when that happened inside the period. */
  outcome: 'completed' | 'abandoned' | null
}

export function lifelines(notes: StatsNote[], start: number, end: number, now: number): Lifeline[] {
  const cutoff = Math.min(end, now)
  const rows: Lifeline[] = []
  for (const note of notes) {
    if (note.createdAt >= cutoff) continue
    if (note.endedAt !== null && note.endedAt < start) continue
    const endedInside = within(note.endedAt, start, end)
    rows.push({
      note,
      from: Math.max(note.createdAt, start),
      to: endedInside ? note.endedAt! : cutoff,
      carriedIn: note.createdAt < start,
      carriedOut: !endedInside,
      outcome: endedInside ? (note.state === 'abandoned' ? 'abandoned' : 'completed') : null,
    })
  }
  return rows.sort((a, b) => a.note.createdAt - b.note.createdAt)
}

// ---- activity rhythm ----

export type StatsEventKind = 'created' | 'completed' | 'abandoned' | 'task-created' | 'task-done'

export interface StatsEvent {
  at: number
  kind: StatsEventKind
  noteId: string
}

export function periodEvents(notes: StatsNote[], start: number, end: number): StatsEvent[] {
  const events: StatsEvent[] = []
  for (const note of notes) {
    if (within(note.createdAt, start, end)) events.push({ at: note.createdAt, kind: 'created', noteId: note.id })
    if (within(note.endedAt, start, end)) {
      events.push({ at: note.endedAt, kind: note.state === 'abandoned' ? 'abandoned' : 'completed', noteId: note.id })
    }
    for (const task of note.tasks) {
      if (within(task.createdAt, start, end)) events.push({ at: task.createdAt, kind: 'task-created', noteId: note.id })
      if (within(task.checkedAt, start, end)) events.push({ at: task.checkedAt, kind: 'task-done', noteId: note.id })
    }
  }
  return events.sort((a, b) => a.at - b.at)
}

export type EventCounts = Record<StatsEventKind, number>

export function emptyCounts(): EventCounts {
  return { created: 0, completed: 0, abandoned: 0, 'task-created': 0, 'task-done': 0 }
}

export function totalCount(counts: EventCounts): number {
  return counts.created + counts.completed + counts.abandoned + counts['task-created'] + counts['task-done']
}

/** Week rhythm: weekday (0 = Monday) by hour of day. */
export function hourGrid(events: StatsEvent[]): EventCounts[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, emptyCounts))
  for (const event of events) {
    const date = new Date(event.at)
    grid[(date.getDay() + 6) % 7][date.getHours()][event.kind] += 1
  }
  return grid
}

/** Month rhythm: one entry per day of the period. */
export function dayCounts(events: StatsEvent[], days: number[]): EventCounts[] {
  const counts = days.map(emptyCounts)
  for (const event of events) {
    let index = days.length - 1
    while (index > 0 && days[index] > event.at) index -= 1
    if (index >= 0 && event.at >= days[0]) counts[index][event.kind] += 1
  }
  return counts
}

// ---- checklist items ----

export interface OpenTask {
  task: StatsTask
  note: StatsNote
  ageMs: number
}

/** Unchecked items on notes that are still on the desk, oldest first. */
export function openTasks(notes: StatsNote[], now: number, limit = 8): OpenTask[] {
  const items: OpenTask[] = []
  for (const note of notes) {
    if (note.state !== 'active') continue
    for (const task of note.tasks) if (task.checkedAt === null && task.text) items.push({ task, note, ageMs: now - task.createdAt })
  }
  return items.sort((a, b) => b.ageMs - a.ageMs).slice(0, limit)
}

// ---- formatting ----

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} 分钟`
  if (ms < DAY) return `${Math.round((ms / HOUR) * 10) / 10} 小时`
  if (ms < 14 * DAY) return `${Math.round((ms / DAY) * 10) / 10} 天`
  return `${Math.round((ms / (7 * DAY)) * 10) / 10} 周`
}

export function formatMoment(time: number, withYear = false): string {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  const day = `${date.getMonth() + 1}月${date.getDate()}日`
  return `${withYear ? `${date.getFullYear()}年` : ''}${day} ${weekdayLabel(time)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function percent(part: number, whole: number): string {
  if (whole <= 0) return '—'
  return `${Math.round((part / whole) * 100)}%`
}
