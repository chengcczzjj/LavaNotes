export type NoteColor = 'butter' | 'rose' | 'mint' | 'sky' | 'lilac'
export type PaperStyle = 'tape' | 'pin' | 'plain'
/** normal: an ordinary window; top: always on top; desktop: pinned to the desktop layer. */
export type NoteLayer = 'normal' | 'top' | 'desktop'
export type NoteFontFamily = 'system' | 'serif' | 'mono' | 'handwritten'
export type TodoCategory = 'work' | 'study' | 'life' | 'health' | 'other'
export type TodoPriority = 'high' | 'normal' | 'low'

/** The unrotated paper rectangle in screen DIP coordinates. The window is larger. */
export interface NoteBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Present only when the note is used as a to-do. Plain notes have no todo. */
export interface NoteTodo {
  done: boolean
  dueAt?: number
  completedAt?: number
  category: TodoCategory
  priority: TodoPriority
  remind: boolean
  /** The dueAt that already produced a reminder; changing dueAt re-arms it. */
  remindedFor?: number
}

export interface NoteRecord {
  id: string
  createdAt: number
  updatedAt: number
  /** Derived from the content: first non-empty line. */
  title: string
  /** Derived from the content: plain text for lists and search. */
  preview: string
  /** Derived from the content. */
  imageCount: number
  color: NoteColor
  paperStyle: PaperStyle
  /** Degrees, kept within ±ROTATION_LIMIT. */
  rotation: number
  fontFamily: NoteFontFamily
  fontSize: number
  bounds: NoteBounds
  layer: NoteLayer
  /** Whether the note window is shown. */
  visible: boolean
  lastActiveAt: number
  todo?: NoteTodo
  /** Set when a finished to-do is torn off. Archived notes stay hidden until restored. */
  archivedAt?: number
}

/** TipTap/ProseMirror JSON. Kept loose here; the editor owns the schema. */
export interface NoteDocNode {
  type: string
  attrs?: Record<string, unknown>
  content?: NoteDocNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

export interface NoteDoc extends NoteDocNode {
  type: 'doc'
}

export interface NoteContentFile {
  version: 1
  doc: NoteDoc
}

/** Appearance and behaviour fields a window or the manager may change. */
export interface NotePatch {
  color?: NoteColor
  paperStyle?: PaperStyle
  rotation?: number
  fontFamily?: NoteFontFamily
  fontSize?: number
  layer?: NoteLayer
  /** null turns the note back into a plain note. */
  todo?: NoteTodo | null
}

export interface AppSettings {
  launchAtLogin: boolean
  /** Layer used for newly created notes. */
  defaultLayer: NoteLayer
}

export interface NoteInit {
  note: NoteRecord
  doc: NoteDoc
  /** Distance from the window edge to the paper edge, in DIP. */
  margin: number
  platform: string
  desktopPinSupported: boolean
  /** True when the note was just created and should take keyboard focus. */
  focusEditor: boolean
}

export interface ResizeSession {
  maxWidth: number
  maxHeight: number
}

export interface CreateNoteOptions {
  text?: string
  color?: NoteColor
  paperStyle?: PaperStyle
  layer?: NoteLayer
  todo?: NoteTodo
  /** Start the new note in the cascade on the display showing this note. */
  nearNoteId?: string
  focus?: boolean
}

export interface ManagerSnapshot {
  notes: NoteRecord[]
  settings: AppSettings
  version: string
  platform: string
  desktopPinSupported: boolean
  dataDir: string
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'available'; version: string }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }
