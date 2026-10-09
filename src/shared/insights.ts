import type { PeriodSummary, StatsGranularity, StatsNote } from './stats.ts'
import { formatDuration, formatMoment, periodEnd, periodTitle } from './stats.ts'

/**
 * The language-model half of the statistics: the app counts, the model reads
 * the notes of one period and explains them (topics, rhythm, what is stuck).
 */

export interface InsightTopic {
  name: string
  noteIds: string[]
  desc: string
}

export interface AiInsight {
  headline: string
  summary: string
  topics: InsightTopic[]
  rhythm: string
  insights: string[]
  suggestions: string[]
  stale: Array<{ noteId: string; reason: string }>
}

export interface InsightRecord {
  key: string
  granularity: StatsGranularity
  start: number
  createdAt: number
  model: string
  noteCount: number
  insight: AiInsight
}

export type InsightRunResult = { ok: true; record: InsightRecord } | { ok: false; message: string; needsSetup?: boolean }

export const INSIGHT_NOTE_LIMIT = 60
const PREVIEW_CHARS = 260

export function insightKey(granularity: StatsGranularity, start: number): string {
  return `${granularity}:${start}`
}

export interface InsightNoteInput {
  note: StatsNote
  /** The note's text (the index preview is enough: first ~400 characters). */
  preview: string
}

const STATE_LABEL = { active: '还在桌面', completed: '已撕下（完成）', abandoned: '已废弃' } as const

function compactTime(time: number): string {
  return formatMoment(time).replace(/^(\d+)月(\d+)日/, '$1-$2')
}

/** Notes with something happening in the period first, then the rest by recent edits. */
export function pickInsightNotes(inputs: InsightNoteInput[], start: number, end: number): InsightNoteInput[] {
  const active = (input: InsightNoteInput) => {
    const { note } = input
    if (note.createdAt >= start && note.createdAt < end) return true
    if (note.endedAt !== null && note.endedAt >= start && note.endedAt < end) return true
    return note.tasks.some((task) => (task.createdAt >= start && task.createdAt < end)
      || (task.checkedAt !== null && task.checkedAt >= start && task.checkedAt < end))
  }
  return [...inputs]
    .sort((a, b) => Number(active(b)) - Number(active(a)) || b.note.updatedAt - a.note.updatedAt)
    .slice(0, INSIGHT_NOTE_LIMIT)
}

export const INSIGHT_INSTRUCTIONS = `You are the analyst inside a sticky-note app. You receive one period (a week or a month) of the user's notes: when each note was written, whether it was finished (torn off), abandoned (discarded but kept) or is still open, its text, and its checklist items with the times they were added and checked. The counts are already computed exactly — do not recount them; use them, and read the texts, to explain what happened.

Write in Simplified Chinese, warm and concise, like a thoughtful friend looking back over the period with the user. In prose, refer to notes by their content, never by their codes.

Return one JSON object only, no markdown, no code fences:
{"headline":"<at most 18 characters: the period in one phrase>",
 "summary":"<2–3 sentences: what the period was about and how it went>",
 "topics":[{"name":"<2–6 characters>","notes":["N1","N4"],"desc":"<one short sentence>"}],
 "rhythm":"<1–2 sentences on timing: when notes get written and finished, what lingers or gets abandoned>",
 "insights":["<observation grounded in the notes and times>"],
 "suggestions":["<a concrete next step>"],
 "stale":[{"note":"N7","reason":"<why it looks stuck or forgotten>"}]}
Rules: 2–6 topics; each note in at most one topic; add a topic named "其他" only for leftovers. Up to 4 insights, up to 3 suggestions, up to 5 stale notes chosen only among notes still on the desk. Empty arrays are fine.`

export function buildInsightUserText(params: {
  granularity: StatsGranularity
  start: number
  summary: PeriodSummary
  notes: InsightNoteInput[]
  now: number
}): { text: string; aliases: Map<string, string> } {
  const { granularity, start, summary, notes, now } = params
  const end = periodEnd(start, granularity)
  const aliases = new Map<string, string>()
  const lines: string[] = [
    `Period: ${granularity === 'week' ? 'week' : 'month'} ${periodTitle(start, granularity)}${end > now ? ' (in progress, today is ' + compactTime(now) + ')' : ''}`,
    `Counts — written: ${summary.created}, torn off: ${summary.completed}, abandoned: ${summary.abandoned}, still on the desk at the end: ${summary.open}, checklist items added: ${summary.tasksCreated}, checked: ${summary.tasksDone}, median time to tear off: ${formatDuration(summary.medianDoneMs)}, median time to check an item: ${formatDuration(summary.medianTaskMs)}.`,
    `Notes (${notes.length}):`,
  ]
  notes.forEach(({ note, preview }, position) => {
    const alias = `N${position + 1}`
    aliases.set(alias, note.id)
    const parts = [alias, STATE_LABEL[note.state], `written ${compactTime(note.createdAt)}`]
    if (note.endedAt !== null) parts.push(`${note.state === 'abandoned' ? 'abandoned' : 'torn off'} ${compactTime(note.endedAt)} (after ${formatDuration(note.endedAt - note.createdAt)})`)
    else parts.push(`open for ${formatDuration(now - note.createdAt)}`)
    if (note.tasks.length > 0) parts.push(`checklist ${note.tasks.filter((task) => task.checkedAt !== null).length}/${note.tasks.length}`)
    lines.push(parts.join(' | '))
    const text = preview.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS)
    lines.push(`  text: ${text || '(no text, image only)'}`)
    const tasks = note.tasks.slice(0, 8).map((task) => task.checkedAt !== null
      ? `[x] ${task.text.slice(0, 50)} (${compactTime(task.createdAt)} → ${compactTime(task.checkedAt)})`
      : `[ ] ${task.text.slice(0, 50)} (added ${compactTime(task.createdAt)})`)
    if (tasks.length > 0) lines.push(`  items: ${tasks.join('; ')}`)
  })
  return { text: lines.join('\n'), aliases }
}

function str(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function strings(value: unknown, count: number, limit: number): string[] {
  return Array.isArray(value) ? value.map((item) => str(item, limit)).filter(Boolean).slice(0, count) : []
}

/** Read the model's JSON (tolerating code fences or text around it) and map note codes back to ids. */
export function parseInsight(text: string, aliases: ReadonlyMap<string, string>): AiInsight | null {
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  const idOf = (value: unknown) => aliases.get(str(value, 10).toUpperCase())
  const used = new Set<string>()
  const topics: InsightTopic[] = []
  for (const item of Array.isArray(raw.topics) ? raw.topics : []) {
    if (topics.length >= 6 || !item || typeof item !== 'object') continue
    const topic = item as Record<string, unknown>
    const name = str(topic.name, 12)
    if (!name) continue
    const noteIds: string[] = []
    for (const code of Array.isArray(topic.notes) ? topic.notes : []) {
      const id = idOf(code)
      if (id && !used.has(id)) {
        used.add(id)
        noteIds.push(id)
      }
    }
    topics.push({ name, noteIds, desc: str(topic.desc, 80) })
  }
  const stale: AiInsight['stale'] = []
  for (const item of Array.isArray(raw.stale) ? raw.stale : []) {
    if (stale.length >= 5 || !item || typeof item !== 'object') continue
    const id = idOf((item as Record<string, unknown>).note)
    if (id && !stale.some((entry) => entry.noteId === id)) stale.push({ noteId: id, reason: str((item as Record<string, unknown>).reason, 80) })
  }
  const insight: AiInsight = {
    headline: str(raw.headline, 30),
    summary: str(raw.summary, 400),
    topics,
    rhythm: str(raw.rhythm, 240),
    insights: strings(raw.insights, 4, 160),
    suggestions: strings(raw.suggestions, 3, 160),
    stale,
  }
  return insight.headline || insight.summary || topics.length > 0 ? insight : null
}
