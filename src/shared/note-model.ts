import type {
  AppSettings,
  NoteBounds,
  NoteColor,
  NoteDoc,
  NoteDocNode,
  NoteFontFamily,
  NoteLayer,
  NotePatch,
  NoteRecord,
} from './types.ts'

export const NOTE_COLORS: readonly NoteColor[] = ['butter', 'rose', 'mint', 'sky', 'lilac']
export const NOTE_LAYERS: readonly NoteLayer[] = ['normal', 'top', 'desktop']
export const FONT_FAMILIES: readonly NoteFontFamily[] = ['system', 'serif', 'mono', 'handwritten']

export const NOTE_LIMIT = 500
export const TITLE_LIMIT = 120
export const PREVIEW_LIMIT = 400
export const ROTATION_LIMIT = 4.5
export const MIN_FONT_SIZE = 11
export const MAX_FONT_SIZE = 36
export const DEFAULT_FONT_SIZE = 14

export const NOTE_MIN_WIDTH = 160
export const NOTE_MIN_HEIGHT = 130
export const NOTE_MAX_WIDTH = 900
export const NOTE_MAX_HEIGHT = 900
export const NOTE_DEFAULT_WIDTH = 300
export const NOTE_DEFAULT_HEIGHT = 290

/** Tilts taken in turn by new notes: left and right alternately, clearly visible but within ROTATION_LIMIT. */
export const ROTATION_SEQUENCE = [-3.0, 2.4, -1.8, 3.4, -2.6, 2.0]

export const NOTE_COLOR_LABELS: Record<NoteColor, string> = {
  butter: '奶油黄',
  rose: '珊瑚粉',
  mint: '薄荷绿',
  sky: '雾霭蓝',
  lilac: '丁香灰',
}

export const NOTE_LAYER_LABELS: Record<NoteLayer, string> = {
  normal: '普通窗口',
  top: '置顶',
  desktop: '钉在桌面',
}

export const FONT_FAMILY_LABELS: Record<NoteFontFamily, string> = {
  system: '系统',
  serif: '衬线',
  mono: '等宽',
  handwritten: '手写',
}

export const DEFAULT_SETTINGS: AppSettings = {
  launchAtLogin: true,
  defaultLayer: 'normal',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampRotation(value: unknown): number {
  const rotation = readNumber(value) ?? 0
  return Math.round(clamp(rotation, -ROTATION_LIMIT, ROTATION_LIMIT) * 10) / 10
}

export function clampFontSize(value: unknown): number {
  return Math.round(clamp(readNumber(value) ?? DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE))
}

export function clampNoteSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.round(clamp(width, NOTE_MIN_WIDTH, NOTE_MAX_WIDTH)),
    height: Math.round(clamp(height, NOTE_MIN_HEIGHT, NOTE_MAX_HEIGHT)),
  }
}

export function normalizeBounds(value: unknown, fallback: NoteBounds): NoteBounds {
  const source = isRecord(value) ? value : {}
  const size = clampNoteSize(readNumber(source.width) ?? fallback.width, readNumber(source.height) ?? fallback.height)
  return {
    x: Math.round(readNumber(source.x) ?? fallback.x),
    y: Math.round(readNumber(source.y) ?? fallback.y),
    ...size,
  }
}

export function sanitizeLine(value: string, limit: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function normalizeNoteRecord(value: unknown, now = Date.now()): NoteRecord | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) return null
  const createdAt = readNumber(value.createdAt) ?? now
  const archivedAt = readNumber(value.archivedAt)
  // A note is either done or given up; a file that says both keeps the earlier outcome.
  const abandonedRaw = readNumber(value.abandonedAt)
  const abandonedAt = abandonedRaw !== undefined && (archivedAt === undefined || abandonedRaw < archivedAt) ? abandonedRaw : undefined
  const torn = abandonedAt === undefined ? archivedAt : undefined
  const startedAt = readNumber(value.startedAt)
  return {
    id,
    createdAt,
    updatedAt: readNumber(value.updatedAt) ?? createdAt,
    title: typeof value.title === 'string' ? sanitizeLine(value.title, TITLE_LIMIT) : '',
    preview: typeof value.preview === 'string' ? value.preview.slice(0, PREVIEW_LIMIT) : '',
    imageCount: Math.max(0, Math.round(readNumber(value.imageCount) ?? 0)),
    color: readEnum(value.color, NOTE_COLORS, 'butter'),
    rotation: clampRotation(value.rotation),
    fontFamily: readEnum(value.fontFamily, FONT_FAMILIES, 'system'),
    fontSize: clampFontSize(value.fontSize),
    bounds: normalizeBounds(value.bounds, { x: 120, y: 120, width: NOTE_DEFAULT_WIDTH, height: NOTE_DEFAULT_HEIGHT }),
    layer: readEnum(value.layer, NOTE_LAYERS, 'normal'),
    // Archived and abandoned notes are never shown, whatever an older file says.
    visible: torn === undefined && abandonedAt === undefined && value.visible !== false,
    lastActiveAt: readNumber(value.lastActiveAt) ?? createdAt,
    ...(torn !== undefined ? { archivedAt: torn } : {}),
    ...(abandonedAt !== undefined ? { abandonedAt } : {}),
    ...(startedAt !== undefined && startedAt > 0 ? { startedAt } : {}),
  }
}

export function normalizeNoteList(value: unknown, now = Date.now()): NoteRecord[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const notes: NoteRecord[] = []
  for (const item of value) {
    if (notes.length >= NOTE_LIMIT) break
    const note = normalizeNoteRecord(item, now)
    if (!note || seen.has(note.id)) continue
    seen.add(note.id)
    notes.push(note)
  }
  return notes
}

export function normalizeSettings(value: unknown): AppSettings {
  const source = isRecord(value) ? value : {}
  return {
    launchAtLogin: source.launchAtLogin !== false,
    defaultLayer: readEnum(source.defaultLayer, NOTE_LAYERS, DEFAULT_SETTINGS.defaultLayer),
  }
}

export function createNoteId(now = Date.now(), random = Math.random): string {
  return `n${now.toString(36)}${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`
}

export function createNoteRecord(params: {
  id: string
  bounds: NoteBounds
  now?: number
  index?: number
  color?: NoteColor
  layer?: NoteLayer
}): NoteRecord {
  const now = params.now ?? Date.now()
  const index = params.index ?? 0
  return normalizeNoteRecord({
    id: params.id,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
    color: params.color ?? NOTE_COLORS[index % NOTE_COLORS.length],
    rotation: ROTATION_SEQUENCE[index % ROTATION_SEQUENCE.length],
    fontFamily: 'system',
    fontSize: DEFAULT_FONT_SIZE,
    bounds: params.bounds,
    layer: params.layer ?? 'normal',
    visible: true,
  }, now) as NoteRecord
}

/** Apply a renderer/manager patch through the same validation as stored data. */
export function applyNotePatch(note: NoteRecord, patch: NotePatch, now = Date.now()): NoteRecord {
  const next: Record<string, unknown> = { ...note, updatedAt: now }
  if (patch.color !== undefined) next.color = patch.color
  if (patch.rotation !== undefined) next.rotation = patch.rotation
  if (patch.fontFamily !== undefined) next.fontFamily = patch.fontFamily
  if (patch.fontSize !== undefined) next.fontSize = patch.fontSize
  if (patch.layer !== undefined) next.layer = patch.layer
  // Only a note on the desk can be started; stopping keeps nothing.
  if (patch.inProgress === true && noteState(note) === 'active') next.startedAt = note.startedAt ?? now
  if (patch.inProgress === false) delete next.startedAt
  return normalizeNoteRecord(next, now) ?? note
}

export function emptyDoc(text = ''): NoteDoc {
  const lines = text.split(/\r?\n/)
  return {
    type: 'doc',
    content: lines.map((line) => (line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' })),
  }
}

export function normalizeDoc(value: unknown): NoteDoc {
  if (isRecord(value) && value.type === 'doc') {
    const content = Array.isArray(value.content) ? value.content.filter(isRecord) : []
    return { type: 'doc', content: content as unknown as NoteDocNode[] }
  }
  return emptyDoc()
}

const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock',
  'tableRow', 'horizontalRule', 'hardBreak',
])

export const ASSET_URL_PREFIX = 'lavanote://asset/'
export const ASSET_FILE_PATTERN = /^[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/

export function assetFileFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(ASSET_URL_PREFIX)) return null
  const file = url.slice(ASSET_URL_PREFIX.length)
  return ASSET_FILE_PATTERN.test(file) ? file : null
}

export interface DocSummary {
  title: string
  preview: string
  imageCount: number
  assetFiles: string[]
  /** Number of table nodes, for the manager's badges. */
  tableCount: number
}

/** Plain-text and asset summary of a note body. Walks iteratively to bound deep input. */
export function summarizeDoc(doc: NoteDoc): DocSummary {
  const lines: string[] = []
  let current = ''
  const assets = new Set<string>()
  let imageCount = 0
  let tableCount = 0
  const stack: Array<NoteDocNode | 'break'> = [doc]
  let visited = 0
  while (stack.length > 0 && visited < 50_000) {
    const node = stack.pop()!
    visited += 1
    if (node === 'break') {
      if (current.trim()) lines.push(current.trim())
      current = ''
      continue
    }
    if (node.type === 'text' && typeof node.text === 'string') {
      current += node.text
      continue
    }
    if (node.type === 'image') {
      imageCount += 1
      const file = assetFileFromUrl(node.attrs?.src)
      if (file) assets.add(file)
      continue
    }
    if (node.type === 'table') tableCount += 1
    if (node.type === 'tableCell' || node.type === 'tableHeader') current += current ? ' ' : ''
    if (BLOCK_TYPES.has(node.type)) stack.push('break')
    const children = Array.isArray(node.content) ? node.content : []
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index])
  }
  if (current.trim()) lines.push(current.trim())
  const title = sanitizeLine(lines[0] ?? '', TITLE_LIMIT)
  const preview = lines.map((line) => sanitizeLine(line, PREVIEW_LIMIT)).join('\n').slice(0, PREVIEW_LIMIT)
  return { title, preview, imageCount, assetFiles: [...assets], tableCount }
}

/** Whether a note is still on the desk (shown or hidden), done, or given up. */
export function noteState(note: Pick<NoteRecord, 'archivedAt' | 'abandonedAt'>): 'active' | 'completed' | 'abandoned' {
  if (note.abandonedAt !== undefined) return 'abandoned'
  if (note.archivedAt !== undefined) return 'completed'
  return 'active'
}

/** A note on the desk that has been marked as being worked on. */
export function isInProgress(note: Pick<NoteRecord, 'archivedAt' | 'abandonedAt' | 'startedAt'>): boolean {
  return note.startedAt !== undefined && noteState(note) === 'active'
}

/**
 * A checklist item's attributes after a right click on its box: to do ⇄ in
 * progress, and a checked item goes back to in progress. The start time is
 * kept when an item is checked, so unchecking returns it to in progress.
 */
export function toggleTaskDoing(attrs: Record<string, unknown>, now: number): Record<string, unknown> {
  const started = readNumber(attrs.startedAt)
  const startedAt = started !== undefined && started > 0 ? started : null
  if (attrs.checked === true) return { ...attrs, checked: false, checkedAt: null, startedAt: startedAt ?? now }
  return { ...attrs, startedAt: startedAt === null ? now : null }
}

export function displayTitle(note: Pick<NoteRecord, 'title' | 'imageCount'>): string {
  if (note.title) return note.title
  return note.imageCount > 0 ? '图片便签' : '空白便签'
}
