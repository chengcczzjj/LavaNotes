import type { NoteDoc, NoteDocNode } from './types.ts'

/**
 * Translation works on segments: every paragraph, heading, list item, checklist
 * item or table cell is one numbered segment. The model answers per segment, so
 * the translation can be put back into the same structure (lists, checkboxes,
 * tables and images stay where they were).
 */
export interface TranslateSegment {
  /** 1-based, as sent to the model. */
  index: number
  text: string
  /** Child indexes from the doc root to the text block. */
  path: number[]
  /** False when the block holds inline nodes other than text, which a plain translation would drop. */
  replaceable: boolean
}

export interface TranslateRequest {
  segments: Array<{ index: number; text: string }>
  /** 'auto' or a language code. */
  target: string
}

export type TranslateEvent =
  | { type: 'start'; target: string; targetName: string; model: string }
  | { type: 'segment'; index: number; text: string }

export interface TranslateResult {
  ok: boolean
  message?: string
  /** Set when the model or key is missing, so the note can offer to open the settings. */
  needsSetup?: boolean
}

export const TRANSLATE_SEGMENT_LIMIT = 400
export const TRANSLATE_TEXT_LIMIT = 24_000

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])

function blockText(node: NoteDocNode): { text: string; replaceable: boolean } {
  let text = ''
  let replaceable = true
  for (const child of node.content ?? []) {
    if (child.type === 'text' && typeof child.text === 'string') text += child.text
    else if (child.type === 'hardBreak') text += '\n'
    else replaceable = false
  }
  return { text, replaceable }
}

/** Number the text blocks of a note body in reading order. */
export function docSegments(doc: NoteDoc): TranslateSegment[] {
  const segments: TranslateSegment[] = []
  let total = 0
  const walk = (node: NoteDocNode, path: number[]) => {
    if (segments.length >= TRANSLATE_SEGMENT_LIMIT || total >= TRANSLATE_TEXT_LIMIT) return
    if (TEXT_BLOCKS.has(node.type)) {
      const { text, replaceable } = blockText(node)
      if (text.trim()) {
        segments.push({ index: segments.length + 1, text, path, replaceable })
        total += text.length
      }
      return
    }
    node.content?.forEach((child, index) => walk(child, [...path, index]))
  }
  walk(doc, [])
  return segments
}

/** Split selected plain text into segments, one per non-empty line. */
export function textSegments(text: string): Array<{ index: number; text: string }> {
  return text.split(/\r?\n/).filter((line) => line.trim()).slice(0, TRANSLATE_SEGMENT_LIMIT)
    .map((line, position) => ({ index: position + 1, text: line }))
}

/** Put translated lines back where the selected lines were, keeping blank lines. */
export function joinTranslatedLines(source: string, translations: ReadonlyMap<number, string>): string {
  let index = 0
  return source.split(/\r?\n/).map((line) => {
    if (!line.trim()) return line
    index += 1
    return translations.get(index) ?? line
  }).join('\n')
}

function nodeAt(doc: NoteDocNode, path: number[]): NoteDocNode | undefined {
  let node: NoteDocNode | undefined = doc
  for (const index of path) node = node?.content?.[index]
  return node
}

function uniformMarks(node: NoteDocNode): NoteDocNode['marks'] {
  const texts = (node.content ?? []).filter((child) => child.type === 'text')
  if (texts.length === 0) return undefined
  const first = JSON.stringify(texts[0].marks ?? [])
  if (texts.some((child) => JSON.stringify(child.marks ?? []) !== first)) return undefined
  return texts[0].marks && texts[0].marks.length > 0 ? texts[0].marks : undefined
}

function inlineContent(text: string, marks: NoteDocNode['marks']): NoteDocNode[] {
  const content: NoteDocNode[] = []
  text.split('\n').forEach((line, position) => {
    if (position > 0) content.push({ type: 'hardBreak' })
    if (line) content.push({ type: 'text', text: line, ...(marks ? { marks } : {}) })
  })
  return content
}

/**
 * A copy of the body with each translated block replaced. Blocks keep their
 * formatting when it covered the whole block; mixed inline formatting is dropped.
 */
export function applyTranslations(doc: NoteDoc, segments: TranslateSegment[], translations: ReadonlyMap<number, string>): NoteDoc {
  const copy = structuredClone(doc)
  for (const segment of segments) {
    const translated = translations.get(segment.index)
    if (!segment.replaceable || translated === undefined || !translated.trim()) continue
    const node = nodeAt(copy, segment.path)
    if (!node) continue
    node.content = inlineContent(translated, uniformMarks(node))
  }
  return copy
}

const TASK_TRACKING_ATTRS = new Set(['tid', 'createdAt', 'checkedAt', 'startedAt'])

/** Checklist items copied into a note start their own timeline (see tasks.ts). */
export function stripTaskTracking(nodes: NoteDocNode[]): NoteDocNode[] {
  const strip = (node: NoteDocNode): NoteDocNode => {
    const next: NoteDocNode = { ...node }
    if (node.type === 'taskItem' && node.attrs) {
      next.attrs = Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !TASK_TRACKING_ATTRS.has(key)))
    }
    if (node.content) next.content = node.content.map(strip)
    return next
  }
  return nodes.map(strip)
}

/**
 * Picks complete top-level JSON objects out of a model's streamed output,
 * whether it writes JSON Lines, an array, or indented multi-line objects.
 */
export class JsonObjectStream {
  private buffer = ''
  private depth = 0
  private inString = false
  private escaped = false
  private readonly onObject: (value: Record<string, unknown>) => void

  constructor(onObject: (value: Record<string, unknown>) => void) {
    this.onObject = onObject
  }

  push(chunk: string): void {
    for (const char of chunk) {
      if (this.depth > 0) this.buffer += char
      if (this.inString) {
        if (this.escaped) this.escaped = false
        else if (char === '\\') this.escaped = true
        else if (char === '"') this.inString = false
        continue
      }
      if (char === '"') {
        if (this.depth > 0) this.inString = true
      } else if (char === '{') {
        if (this.depth === 0) this.buffer = '{'
        this.depth += 1
      } else if (char === '}' && this.depth > 0) {
        this.depth -= 1
        if (this.depth === 0) {
          this.emit(this.buffer)
          this.buffer = ''
        }
      }
    }
  }

  private emit(raw: string): void {
    try {
      const value: unknown = JSON.parse(raw)
      if (value && typeof value === 'object' && !Array.isArray(value)) this.onObject(value as Record<string, unknown>)
    } catch {
      // A malformed object is skipped; the rest of the stream still counts.
    }
  }
}

export const TRANSLATE_INSTRUCTIONS = `You translate the text of a desktop sticky note. The note is split into numbered segments: each paragraph, heading, list item, checklist item or table cell is one segment.

- Translate every segment into the target language the way a native speaker would write a quick note: concise, natural, same tone.
- Keep each segment separate and in order. Never merge, split, skip or reorder segments; keep line breaks inside a segment.
- Leave code, commands, file paths, URLs, emails, @handles, numbers with units, and names of people, products, companies and projects as they are. Keep emoji.
- A segment that is already in the target language, or has nothing to translate, is copied unchanged.

Output JSON Lines only — one compact JSON object per segment, no prose, no markdown, no code fences:
{"i":<segment number>,"t":"<translation>"}`

export function translateUserText(segments: TranslateRequest['segments'], language: { native: string; code: string }): string {
  return [
    `Target language: ${language.native} (${language.code})`,
    'Segments (JSON Lines, s = source text):',
    ...segments.map((segment) => JSON.stringify({ i: segment.index, s: segment.text })),
  ].join('\n')
}

/** Validate what the renderer sends before it reaches a model. */
export function sanitizeTranslateRequest(value: unknown): TranslateRequest | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (!Array.isArray(source.segments)) return null
  const segments: TranslateRequest['segments'] = []
  let total = 0
  for (const item of source.segments) {
    if (segments.length >= TRANSLATE_SEGMENT_LIMIT) break
    if (!item || typeof item !== 'object') continue
    const { index, text } = item as Record<string, unknown>
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || typeof text !== 'string' || !text.trim()) continue
    const room = TRANSLATE_TEXT_LIMIT - total
    if (room <= 0) break
    const clipped = text.slice(0, room)
    segments.push({ index, text: clipped })
    total += clipped.length
  }
  if (segments.length === 0) return null
  return { segments, target: typeof source.target === 'string' ? source.target.slice(0, 20) : 'auto' }
}
