import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import type {
  AppSettings,
  NoteBounds,
  NoteColor,
  NoteDoc,
  NoteLayer,
  NotePatch,
  NoteRecord,
  NoteTodo,
  PaperStyle,
} from '../shared/types.ts'
import {
  NOTE_LIMIT,
  applyNotePatch,
  createNoteId,
  createNoteRecord,
  createTodo,
  emptyDoc,
  nextRotationIndex,
  normalizeBounds,
  normalizeDoc,
  normalizeNoteList,
  normalizeSettings,
  setTodoDone,
  summarizeDoc,
} from '../shared/note-model.ts'
import {
  KeyedWriter,
  getDataPaths,
  loadIndexFile,
  noteContentPath,
  readJsonFile,
  writeJsonAtomic,
  type DataPaths,
} from './storage.ts'
import { collectUnusedAssets } from './assets.ts'

/** Serialized note bodies above this are refused; images live in separate files. */
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024

export type NoteChangeKind = 'created' | 'updated' | 'content' | 'deleted'

export interface NotesServiceOptions {
  now?: () => number
  onError?: (scope: string, error: unknown) => void
  indexDelayMs?: number
  contentDelayMs?: number
}

export interface CreateNoteParams {
  bounds: NoteBounds
  text?: string
  color?: NoteColor
  paperStyle?: PaperStyle
  layer?: NoteLayer
  todo?: NoteTodo
  /** Tilt of the note this one is placed beside; the new note leans the other way. */
  besideRotation?: number
}

export class NotesService extends EventEmitter {
  readonly paths: DataPaths
  private notes = new Map<string, NoteRecord>()
  private settingsValue: AppSettings = normalizeSettings({})
  private readonly now: () => number
  private readonly onError: (scope: string, error: unknown) => void
  private readonly indexWriter: KeyedWriter<NoteRecord[]>
  private readonly settingsWriter: KeyedWriter<AppSettings>
  private readonly contentWriter: KeyedWriter<NoteDoc>
  /** Bodies saved in this session, so reads never return an older file. */
  private readonly contentCache = new Map<string, NoteDoc>()
  /** Next slot in the tilt/color sequence; consecutive notes take consecutive slots. */
  private nextIndex = 0

  constructor(root: string, options: NotesServiceOptions = {}) {
    super()
    this.paths = getDataPaths(root)
    this.now = options.now ?? Date.now
    this.onError = options.onError ?? (() => undefined)
    this.indexWriter = new KeyedWriter(
      (_key, notes) => writeJsonAtomic(this.paths.index, { version: 1, notes }),
      options.indexDelayMs ?? 250,
      (_key, error) => this.onError('index-write', error),
    )
    this.settingsWriter = new KeyedWriter(
      (_key, settings) => writeJsonAtomic(this.paths.settings, settings),
      options.indexDelayMs ?? 250,
      (_key, error) => this.onError('settings-write', error),
    )
    this.contentWriter = new KeyedWriter(
      (id, doc) => writeJsonAtomic(noteContentPath(this.paths, id), { version: 1, doc }),
      options.contentDelayMs ?? 400,
      (id, error) => this.onError(`content-write:${id}`, error),
    )
  }

  async load(): Promise<{ source: string; quarantined?: string }> {
    await fs.mkdir(this.paths.notesDir, { recursive: true })
    await fs.mkdir(this.paths.assetsDir, { recursive: true })
    const loaded = await loadIndexFile(this.paths, this.now())
    const source = loaded.value && typeof loaded.value === 'object' ? (loaded.value as { notes?: unknown }).notes : undefined
    this.notes = new Map(normalizeNoteList(source, this.now()).map((note) => [note.id, note]))
    this.nextIndex = this.notes.size
    const settings = await readJsonFile(this.paths.settings)
    this.settingsValue = normalizeSettings(settings.status === 'ok' ? settings.value : {})
    // A recovered index must be written back so the next start reads it directly.
    if (loaded.source !== 'index' && this.notes.size > 0) this.scheduleIndexSave()
    return { source: loaded.source, quarantined: loaded.quarantined }
  }

  list(): NoteRecord[] {
    return [...this.notes.values()]
  }

  get(id: string): NoteRecord | undefined {
    return this.notes.get(id)
  }

  get settings(): AppSettings {
    return this.settingsValue
  }

  setSettings(patch: Partial<AppSettings>): AppSettings {
    this.settingsValue = normalizeSettings({ ...this.settingsValue, ...patch })
    this.settingsWriter.schedule('settings', this.settingsValue)
    this.emit('settings', this.settingsValue)
    return this.settingsValue
  }

  async readContent(id: string): Promise<NoteDoc> {
    const cached = this.contentCache.get(id)
    if (cached) return cached
    const note = this.notes.get(id)
    const file = await readJsonFile(noteContentPath(this.paths, id))
    if (file.status === 'ok') {
      const doc = normalizeDoc((file.value as { doc?: unknown } | null)?.doc)
      this.contentCache.set(id, doc)
      return doc
    }
    if (file.status === 'corrupt') this.onError(`content-read:${id}`, file.error)
    // A missing body still shows what the index knows instead of a blank note.
    return emptyDoc(note?.preview ?? '')
  }

  create(params: CreateNoteParams): NoteRecord {
    if (this.notes.size >= NOTE_LIMIT) throw new Error('note-limit')
    const now = this.now()
    let id = createNoteId(now)
    while (this.notes.has(id)) id = createNoteId(now)
    const index = nextRotationIndex(this.nextIndex, params.besideRotation)
    const record = createNoteRecord({
      id,
      bounds: normalizeBounds(params.bounds, params.bounds),
      now,
      index,
      color: params.color,
      paperStyle: params.paperStyle,
      layer: params.layer ?? this.settingsValue.defaultLayer,
      todo: params.todo,
    })
    this.nextIndex = index + 1
    const doc = emptyDoc(params.text ?? '')
    const summary = summarizeDoc(doc)
    const note: NoteRecord = { ...record, title: summary.title, preview: summary.preview, imageCount: summary.imageCount }
    this.notes.set(id, note)
    this.contentCache.set(id, doc)
    this.contentWriter.schedule(id, doc)
    this.scheduleIndexSave()
    this.emit('change', 'created', note)
    return note
  }

  /** Store a new body. Returns null when the note is gone or the body is too large. */
  saveContent(id: string, value: unknown): NoteRecord | null {
    const note = this.notes.get(id)
    if (!note) return null
    const doc = normalizeDoc(value)
    if (Buffer.byteLength(JSON.stringify(doc)) > MAX_CONTENT_BYTES) {
      this.onError(`content-too-large:${id}`, new Error('content-too-large'))
      return null
    }
    const summary = summarizeDoc(doc)
    const next: NoteRecord = {
      ...note,
      title: summary.title,
      preview: summary.preview,
      imageCount: summary.imageCount,
      updatedAt: this.now(),
    }
    this.notes.set(id, next)
    this.contentCache.set(id, doc)
    this.contentWriter.schedule(id, doc)
    this.scheduleIndexSave()
    this.emit('change', 'content', next)
    return next
  }

  patch(id: string, patch: NotePatch): NoteRecord | null {
    const note = this.notes.get(id)
    if (!note) return null
    let next = applyNotePatch(note, patch, this.now())
    // A note that stops being a to-do also leaves the archive.
    if (patch.todo === null && note.archivedAt !== undefined) next = { ...next, visible: true }
    return this.commit(next)
  }

  setBounds(id: string, bounds: NoteBounds): NoteRecord | null {
    const note = this.notes.get(id)
    if (!note) return null
    const next = { ...note, bounds: normalizeBounds(bounds, note.bounds) }
    if (next.bounds.x === note.bounds.x && next.bounds.y === note.bounds.y
      && next.bounds.width === note.bounds.width && next.bounds.height === note.bounds.height) return note
    return this.commit(next, false)
  }

  setVisible(id: string, visible: boolean): NoteRecord | null {
    const note = this.notes.get(id)
    if (!note || note.visible === visible) return note ?? null
    if (visible && note.archivedAt !== undefined) return note
    return this.commit({ ...note, visible, ...(visible ? { lastActiveAt: this.now() } : {}) })
  }

  touch(id: string): void {
    const note = this.notes.get(id)
    if (!note) return
    this.notes.set(id, { ...note, lastActiveAt: this.now() })
    this.scheduleIndexSave()
  }

  /**
   * First half of finishing a note: mark it done. archive() hides it after the tear animation.
   * A plain note becomes a finished to-do so it can be found in the archive and restored.
   */
  markDone(id: string): NoteRecord | null {
    const note = this.notes.get(id)
    if (!note || note.todo?.done) return note ?? null
    const todo = note.todo ?? createTodo({ text: note.title })
    return this.commit({ ...note, todo: setTodoDone(todo, true, this.now()), updatedAt: this.now() })
  }

  archive(id: string): NoteRecord | null {
    const note = this.notes.get(id)
    if (!note?.todo?.done) return note ?? null
    return this.commit({ ...note, visible: false, archivedAt: this.now() })
  }

  reopen(id: string): NoteRecord | null {
    const note = this.notes.get(id)
    if (!note?.todo) return note ?? null
    const next: NoteRecord = { ...note, todo: setTodoDone(note.todo, false), visible: true, lastActiveAt: this.now(), updatedAt: this.now() }
    delete next.archivedAt
    return this.commit(next)
  }

  markReminded(id: string, dueAt: number): void {
    const note = this.notes.get(id)
    if (!note?.todo) return
    this.commit({ ...note, todo: { ...note.todo, remindedFor: dueAt } }, false)
  }

  async remove(id: string): Promise<boolean> {
    const note = this.notes.get(id)
    if (!note) return false
    this.notes.delete(id)
    this.contentCache.delete(id)
    this.contentWriter.cancel(id)
    this.scheduleIndexSave()
    this.emit('change', 'deleted', note)
    await fs.rm(noteContentPath(this.paths, id), { force: true }).catch((error) => this.onError(`content-delete:${id}`, error))
    return true
  }

  async clearArchived(): Promise<number> {
    const archived = this.list().filter((note) => note.archivedAt !== undefined)
    for (const note of archived) await this.remove(note.id)
    return archived.length
  }

  async flush(): Promise<void> {
    await Promise.all([this.contentWriter.flush(), this.indexWriter.flush(), this.settingsWriter.flush()])
  }

  /** Remove images that no note references any more (after a grace period). */
  async collectGarbage(): Promise<string[]> {
    await this.contentWriter.flush()
    const referenced = new Set<string>()
    for (const note of this.notes.values()) {
      const doc = await this.readContent(note.id)
      for (const file of summarizeDoc(doc).assetFiles) referenced.add(file)
    }
    return collectUnusedAssets(this.paths.assetsDir, referenced, this.now())
  }

  private commit(next: NoteRecord, notify = true): NoteRecord {
    this.notes.set(next.id, next)
    this.scheduleIndexSave()
    if (notify) this.emit('change', 'updated', next)
    else this.emit('change', 'updated', next, { silent: true })
    return next
  }

  private scheduleIndexSave(): void {
    this.indexWriter.schedule('index', this.list())
  }
}
