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
  NoteTodo,
  PaperStyle,
  TodoCategory,
  TodoPriority,
} from './types.ts'

export const NOTE_COLORS: readonly NoteColor[] = ['butter', 'rose', 'mint', 'sky', 'lilac']
export const PAPER_STYLES: readonly PaperStyle[] = ['tape', 'pin', 'plain']
export const NOTE_LAYERS: readonly NoteLayer[] = ['normal', 'top', 'desktop']
export const FONT_FAMILIES: readonly NoteFontFamily[] = ['system', 'serif', 'mono', 'handwritten']
export const TODO_CATEGORIES: readonly TodoCategory[] = ['work', 'study', 'life', 'health', 'other']
export const TODO_PRIORITIES: readonly TodoPriority[] = ['high', 'normal', 'low']

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

/** A few hand-picked tilts, alternating left and right, so a fresh stack looks like real paper. */
export const ROTATION_SEQUENCE = [-1.6, 1.2, -0.7, 2.0, -1.1, 0.6]

/**
 * Sequence slot for the next new note. A note made beside another one skips a
 * slot when needed so the two lean opposite ways.
 */
export function nextRotationIndex(index: number, besideRotation?: number): number {
  if (!besideRotation) return index
  const rotation = ROTATION_SEQUENCE[index % ROTATION_SEQUENCE.length]
  return Math.sign(rotation) === Math.sign(besideRotation) ? index + 1 : index
}

export const TODO_CATEGORY_LABELS: Record<TodoCategory, string> = {
  work: '工作',
  study: '学习',
  life: '生活',
  health: '健康',
  other: '其他',
}

export const NOTE_COLOR_LABELS: Record<NoteColor, string> = {
  butter: '奶油黄',
  rose: '珊瑚粉',
  mint: '薄荷绿',
  sky: '雾霭蓝',
  lilac: '丁香灰',
}

export const PAPER_STYLE_LABELS: Record<PaperStyle, string> = {
  tape: '纸胶带',
  pin: '图钉',
  plain: '自然贴',
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

const CATEGORY_KEYWORDS: Record<Exclude<TodoCategory, 'other'>, RegExp> = {
  work: /工作|会议|汇报|周报|客户|项目|需求|版本|发布|邮件|合同|报表|复盘|同事|office|meeting|project|report|email/i,
  study: /学习|阅读|课程|作业|考试|背诵|练习|论文|笔记|教程|单词|study|learn|read|course|exam/i,
  health: /健身|跑步|散步|运动|喝水|睡眠|体检|吃药|瑜伽|拉伸|训练|workout|run|walk|health|medicine/i,
  life: /买菜|购物|快递|家务|缴费|做饭|打扫|洗衣|旅行|预约|家人|朋友|生日|生活|shop|home|family|travel/i,
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

export function inferTodoCategory(text: string): TodoCategory {
  const explicit = [
    ['work', /#(?:工作|work)/i],
    ['study', /#(?:学习|study)/i],
    ['life', /#(?:生活|life)/i],
    ['health', /#(?:健康|health)/i],
  ] as const
  for (const [category, pattern] of explicit) {
    if (pattern.test(text)) return category
  }
  for (const category of ['work', 'study', 'health', 'life'] as const) {
    if (CATEGORY_KEYWORDS[category].test(text)) return category
  }
  return 'other'
}

export function normalizeTodo(value: unknown): NoteTodo | undefined {
  if (!isRecord(value)) return undefined
  const done = value.done === true
  const dueAt = readNumber(value.dueAt)
  const completedAt = done ? readNumber(value.completedAt) ?? Date.now() : undefined
  const remindedFor = readNumber(value.remindedFor)
  return {
    done,
    ...(dueAt !== undefined ? { dueAt } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
    category: readEnum(value.category, TODO_CATEGORIES, 'other'),
    priority: readEnum(value.priority, TODO_PRIORITIES, 'normal'),
    remind: value.remind !== false,
    ...(remindedFor !== undefined ? { remindedFor } : {}),
  }
}

export function createTodo(params: Partial<NoteTodo> & { text?: string } = {}): NoteTodo {
  return normalizeTodo({
    done: false,
    dueAt: params.dueAt,
    category: params.category ?? inferTodoCategory(params.text ?? ''),
    priority: params.priority ?? 'normal',
    remind: params.remind ?? true,
  }) as NoteTodo
}

export function setTodoDone(todo: NoteTodo, done: boolean, now = Date.now()): NoteTodo {
  const next: NoteTodo = { ...todo, done }
  if (done) next.completedAt = now
  else delete next.completedAt
  return next
}

export function sanitizeLine(value: string, limit: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function normalizeNoteRecord(value: unknown, now = Date.now()): NoteRecord | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) return null
  const createdAt = readNumber(value.createdAt) ?? now
  const todo = normalizeTodo(value.todo)
  const archivedAt = readNumber(value.archivedAt)
  return {
    id,
    createdAt,
    updatedAt: readNumber(value.updatedAt) ?? createdAt,
    title: typeof value.title === 'string' ? sanitizeLine(value.title, TITLE_LIMIT) : '',
    preview: typeof value.preview === 'string' ? value.preview.slice(0, PREVIEW_LIMIT) : '',
    imageCount: Math.max(0, Math.round(readNumber(value.imageCount) ?? 0)),
    color: readEnum(value.color, NOTE_COLORS, 'butter'),
    paperStyle: readEnum(value.paperStyle, PAPER_STYLES, 'tape'),
    rotation: clampRotation(value.rotation),
    fontFamily: readEnum(value.fontFamily, FONT_FAMILIES, 'system'),
    fontSize: clampFontSize(value.fontSize),
    bounds: normalizeBounds(value.bounds, { x: 120, y: 120, width: NOTE_DEFAULT_WIDTH, height: NOTE_DEFAULT_HEIGHT }),
    layer: readEnum(value.layer, NOTE_LAYERS, 'normal'),
    // Archived notes are never shown, whatever an older file says.
    visible: archivedAt === undefined && value.visible !== false,
    lastActiveAt: readNumber(value.lastActiveAt) ?? createdAt,
    ...(todo ? { todo } : {}),
    ...(archivedAt !== undefined ? { archivedAt } : {}),
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
  paperStyle?: PaperStyle
  layer?: NoteLayer
  todo?: NoteTodo
}): NoteRecord {
  const now = params.now ?? Date.now()
  const index = params.index ?? 0
  return normalizeNoteRecord({
    id: params.id,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
    color: params.color ?? NOTE_COLORS[index % NOTE_COLORS.length],
    paperStyle: params.paperStyle ?? PAPER_STYLES[index % PAPER_STYLES.length],
    rotation: ROTATION_SEQUENCE[index % ROTATION_SEQUENCE.length],
    fontFamily: 'system',
    fontSize: DEFAULT_FONT_SIZE,
    bounds: params.bounds,
    layer: params.layer ?? 'normal',
    visible: true,
    todo: params.todo,
  }, now) as NoteRecord
}

/** Apply a renderer/manager patch through the same validation as stored data. */
export function applyNotePatch(note: NoteRecord, patch: NotePatch, now = Date.now()): NoteRecord {
  const next: Record<string, unknown> = { ...note, updatedAt: now }
  if (patch.color !== undefined) next.color = patch.color
  if (patch.paperStyle !== undefined) next.paperStyle = patch.paperStyle
  if (patch.rotation !== undefined) next.rotation = patch.rotation
  if (patch.fontFamily !== undefined) next.fontFamily = patch.fontFamily
  if (patch.fontSize !== undefined) next.fontSize = patch.fontSize
  if (patch.layer !== undefined) next.layer = patch.layer
  if (patch.todo === null) {
    delete next.todo
    delete next.archivedAt
  } else if (patch.todo !== undefined) {
    const todo = normalizeTodo(patch.todo)
    if (todo && todo.dueAt !== note.todo?.dueAt) delete todo.remindedFor
    next.todo = todo
  }
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

export function displayTitle(note: Pick<NoteRecord, 'title' | 'imageCount'>): string {
  if (note.title) return note.title
  return note.imageCount > 0 ? '图片便签' : '空白便签'
}

// ---- dates and weekly review ----

export function startOfLocalDay(value: number | Date): number {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function endOfLocalDay(value: number | Date): number {
  const date = new Date(startOfLocalDay(value))
  date.setDate(date.getDate() + 1)
  return date.getTime() - 1
}

export function createDueAt(kind: 'today' | 'tomorrow', now = Date.now()): number {
  const date = new Date(now)
  if (kind === 'tomorrow') date.setDate(date.getDate() + 1)
  date.setHours(21, 0, 0, 0)
  return date.getTime()
}

export type TodoBucket = 'overdue' | 'today' | 'upcoming' | 'later' | 'undated' | 'done'

export const TODO_BUCKET_LABELS: Record<Exclude<TodoBucket, 'done'>, string> = {
  overdue: '已经逾期',
  today: '今天要做',
  upcoming: '接下来七天',
  later: '以后',
  undated: '没有日期',
}

export function getTodoBucket(todo: NoteTodo, now = Date.now()): TodoBucket {
  if (todo.done) return 'done'
  if (todo.dueAt === undefined) return 'undated'
  if (todo.dueAt < now) return 'overdue'
  if (todo.dueAt <= endOfLocalDay(now)) return 'today'
  const upcomingEnd = new Date(startOfLocalDay(now))
  upcomingEnd.setDate(upcomingEnd.getDate() + 7)
  return todo.dueAt < upcomingEnd.getTime() ? 'upcoming' : 'later'
}

export function isTodoOverdue(todo: NoteTodo | undefined, now = Date.now()): boolean {
  return Boolean(todo && !todo.done && todo.dueAt !== undefined && todo.dueAt < now)
}

export function formatDueLabel(dueAt: number | undefined, now = Date.now()): string {
  if (dueAt === undefined) return ''
  const dueDay = startOfLocalDay(dueAt)
  const today = startOfLocalDay(now)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const time = new Date(dueAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (dueDay === today) return `今天 ${time}`
  if (dueDay === tomorrow.getTime()) return `明天 ${time}`
  return new Date(dueAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function getWeekRange(now = Date.now(), weekOffset = 0): { start: number; end: number; days: number[] } {
  const date = new Date(startOfLocalDay(now))
  const day = date.getDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  date.setDate(date.getDate() - daysSinceMonday + weekOffset * 7)
  const start = date.getTime()
  const days = Array.from({ length: 7 }, (_, index) => {
    const item = new Date(start)
    item.setDate(item.getDate() + index)
    return item.getTime()
  })
  const endDate = new Date(start)
  endDate.setDate(endDate.getDate() + 7)
  return { start, end: endDate.getTime() - 1, days }
}

export interface WeekSummary {
  completed: NoteRecord[]
  unfinished: NoteRecord[]
  plannedCount: number
  completionRate: number
  activeDays: number
  dayCounts: number[]
  headline: string
}

/** Weekly review over to-do notes only; plain notes are not tasks. */
export function summarizeWeek(notes: NoteRecord[], now = Date.now(), weekOffset = 0): WeekSummary {
  const { start, end, days } = getWeekRange(now, weekOffset)
  const todos = notes.filter((note): note is NoteRecord & { todo: NoteTodo } => Boolean(note.todo))
  const completed = todos
    .filter((note) => note.todo.done && note.todo.completedAt !== undefined && note.todo.completedAt >= start && note.todo.completedAt <= end)
    .sort((a, b) => (b.todo.completedAt ?? 0) - (a.todo.completedAt ?? 0))
  const unfinished = todos
    .filter((note) => !note.todo.done && note.createdAt <= end && (note.todo.dueAt === undefined || note.todo.dueAt <= end))
    .sort((a, b) => (a.todo.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.todo.dueAt ?? Number.MAX_SAFE_INTEGER))
  const dayCounts = days.map((dayStart) => {
    const dayEnd = endOfLocalDay(dayStart)
    return completed.filter((note) => (note.todo.completedAt ?? 0) >= dayStart && (note.todo.completedAt ?? 0) <= dayEnd).length
  })
  const activeDays = dayCounts.filter((count) => count > 0).length
  const plannedCount = completed.length + unfinished.length
  const completionRate = plannedCount > 0 ? Math.round((completed.length / plannedCount) * 100) : 0
  const bestCount = Math.max(...dayCounts)
  const weekday = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const bestDay = bestCount > 0 ? weekday[dayCounts.indexOf(bestCount)] : ''
  const headline = completed.length === 0
    ? unfinished.length > 0
      ? `这一周还没有完成记录，有 ${unfinished.length} 项可以继续推进。`
      : '这一周很轻盈，还没有待办记录。'
    : `这一周完成 ${completed.length} 项${bestDay ? `，${bestDay}最有进展` : ''}${unfinished.length > 0 ? `，还有 ${unfinished.length} 项未收尾。` : '，所有计划都收尾了。'}`
  return { completed, unfinished, plannedCount, completionRate, activeDays, dayCounts, headline }
}

/** To-dos whose reminder should fire now. */
export function getDueReminders(notes: NoteRecord[], now = Date.now()): NoteRecord[] {
  return notes.filter((note) => {
    const todo = note.todo
    return Boolean(
      todo && !todo.done && todo.remind && note.archivedAt === undefined
      && todo.dueAt !== undefined && todo.dueAt <= now && todo.remindedFor !== todo.dueAt,
    )
  })
}
