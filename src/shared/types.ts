export type NoteColor = 'butter' | 'rose' | 'mint' | 'sky' | 'lilac'
/** normal: an ordinary window; top: always on top; desktop: pinned to the desktop layer. */
export type NoteLayer = 'normal' | 'top' | 'desktop'
export type NoteFontFamily = 'system' | 'serif' | 'mono' | 'handwritten'

/** The unrotated paper rectangle in screen DIP coordinates. The window is larger. */
export interface NoteBounds {
  x: number
  y: number
  width: number
  height: number
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
  /** Degrees, kept within ±ROTATION_LIMIT. */
  rotation: number
  fontFamily: NoteFontFamily
  fontSize: number
  bounds: NoteBounds
  layer: NoteLayer
  /** Whether the note window is shown. */
  visible: boolean
  lastActiveAt: number
  /** Set when the note is finished and torn off. Archived notes stay hidden until restored. */
  archivedAt?: number
  /** Set when the note is given up (discarded). Kept, hidden and counted, like an archived note. */
  abandonedAt?: number
  /** Set while the note is marked as being worked on. Kept when it is torn off, cleared when it is put back. */
  startedAt?: number
}

/** How a note leaves the desk: torn off when done, crumpled when given up. */
export type LeaveKind = 'tear' | 'crumple'

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
  rotation?: number
  fontFamily?: NoteFontFamily
  fontSize?: number
  layer?: NoteLayer
  /** Mark the note as being worked on, or stop. */
  inProgress?: boolean
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
  layer?: NoteLayer
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

/** Pages of the manager window. */
export type ManagerPage = 'stats' | 'notes' | 'settings' | 'ai'

export const MANAGER_PAGES: readonly ManagerPage[] = ['stats', 'notes', 'settings', 'ai']

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'available'; version: string }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }
