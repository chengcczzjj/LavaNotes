import { ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings, CreateNoteOptions, NoteInit, NotePatch } from '@shared/types'
import {
  FONT_FAMILIES,
  NOTE_COLORS,
  NOTE_LAYERS,
  PAPER_STYLES,
  normalizeTodo,
} from '@shared/note-model'
import { getWindowMargin } from '@shared/geometry'
import type { NotesService } from './notes-service'
import type { NoteWindowManager } from './note-windows'
import { storeImage } from './assets'

export interface IpcContext {
  service: NotesService
  windows: NoteWindowManager
  isManager: (webContentsId: number) => boolean
  createNote: (options: CreateNoteOptions) => Promise<ReturnType<NotesService['create']> | null>
  completeNote: (id: string) => void
  setSettings: (patch: Partial<AppSettings>) => AppSettings
  openManager: () => void
  managerSnapshot: () => unknown
  openDataDir: () => Promise<void>
  checkUpdate: () => Promise<void>
  installUpdate: () => void
  log: (event: string, data?: Record<string, unknown>) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** Only accept fields a note may change, with known values. */
export function sanitizePatch(value: unknown): NotePatch {
  if (!isRecord(value)) return {}
  const patch: NotePatch = {}
  if (NOTE_COLORS.includes(value.color as never)) patch.color = value.color as NotePatch['color']
  if (PAPER_STYLES.includes(value.paperStyle as never)) patch.paperStyle = value.paperStyle as NotePatch['paperStyle']
  if (NOTE_LAYERS.includes(value.layer as never)) patch.layer = value.layer as NotePatch['layer']
  if (FONT_FAMILIES.includes(value.fontFamily as never)) patch.fontFamily = value.fontFamily as NotePatch['fontFamily']
  if (typeof value.rotation === 'number' && Number.isFinite(value.rotation)) patch.rotation = value.rotation
  if (typeof value.fontSize === 'number' && Number.isFinite(value.fontSize)) patch.fontSize = value.fontSize
  if (value.todo === null) patch.todo = null
  else if (value.todo !== undefined) {
    const todo = normalizeTodo(value.todo)
    if (todo) patch.todo = todo
  }
  return patch
}

function sanitizeCreate(value: unknown): CreateNoteOptions {
  if (!isRecord(value)) return {}
  const patch = sanitizePatch(value)
  return {
    text: typeof value.text === 'string' ? value.text.slice(0, 20_000) : undefined,
    color: patch.color,
    paperStyle: patch.paperStyle,
    layer: patch.layer,
    todo: patch.todo ?? undefined,
    focus: value.focus === true,
  }
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(value)) throw new Error('invalid note id')
  return value
}

export function registerIpc(context: IpcContext): void {
  const { service, windows } = context

  const noteOf = (event: IpcMainEvent | IpcMainInvokeEvent): string | undefined => windows.noteIdFor(event.sender.id)
  const assertManager = (event: IpcMainInvokeEvent): void => {
    if (!context.isManager(event.sender.id)) throw new Error('forbidden')
  }

  // ---- note windows: each may only act on its own note ----

  ipcMain.handle(IPC.NOTE_INIT, async (event): Promise<NoteInit | null> => {
    const id = noteOf(event)
    const note = id ? service.get(id) : undefined
    if (!id || !note) return null
    return {
      note,
      doc: await service.readContent(id),
      margin: getWindowMargin(note.rotation),
      platform: process.platform,
      desktopPinSupported: windows.desktopPinSupported,
      focusEditor: windows.consumeFocusEditor(id),
    }
  })

  ipcMain.on(IPC.NOTE_SAVE_CONTENT, (event, doc: unknown) => {
    const id = noteOf(event)
    if (id) service.saveContent(id, doc)
  })

  ipcMain.on(IPC.NOTE_FLUSHED, (event) => windows.flushConfirmed(event.sender.id))

  ipcMain.handle(IPC.NOTE_PATCH, (event, patch: unknown) => {
    const id = noteOf(event)
    return id ? service.patch(id, sanitizePatch(patch)) : null
  })

  ipcMain.on(IPC.NOTE_DRAG_START, (event) => { const id = noteOf(event); if (id) windows.dragStart(id) })
  ipcMain.on(IPC.NOTE_DRAG_MOVE, (event) => { const id = noteOf(event); if (id) windows.dragMove(id) })
  ipcMain.on(IPC.NOTE_DRAG_END, (event) => { const id = noteOf(event); if (id) windows.dragEnd(id) })

  ipcMain.handle(IPC.NOTE_RESIZE_BEGIN, (event) => {
    const id = noteOf(event)
    return id ? windows.resizeBegin(id) : null
  })

  ipcMain.handle(IPC.NOTE_RESIZE_END, (event, size: unknown) => {
    const id = noteOf(event)
    if (!id) return null
    const valid = isRecord(size) && typeof size.width === 'number' && typeof size.height === 'number'
      && Number.isFinite(size.width) && Number.isFinite(size.height)
    return windows.resizeEnd(id, valid ? { width: size.width as number, height: size.height as number } : null)
  })

  ipcMain.on(IPC.NOTE_SET_PASSTHROUGH, (event, ignore: unknown) => {
    const id = noteOf(event)
    if (id) windows.setPassthrough(id, ignore === true)
  })

  ipcMain.on(IPC.NOTE_NEW, (event) => {
    const id = noteOf(event)
    if (id) void context.createNote({ nearNoteId: id, focus: true, layer: service.get(id)?.layer })
  })

  ipcMain.on(IPC.NOTE_HIDE, (event) => {
    const id = noteOf(event)
    if (id) service.setVisible(id, false)
  })

  ipcMain.on(IPC.NOTE_DELETE, (event) => {
    const id = noteOf(event)
    if (id) void service.remove(id)
  })

  ipcMain.on(IPC.NOTE_COMPLETE, (event) => {
    const id = noteOf(event)
    if (id) context.completeNote(id)
  })

  ipcMain.on(IPC.NOTE_TEAR_FINISHED, (event) => {
    const id = noteOf(event)
    if (id) service.archive(id)
  })

  ipcMain.on(IPC.NOTE_ACTIVATED, (event) => {
    const id = noteOf(event)
    if (id) service.touch(id)
  })

  ipcMain.handle(IPC.NOTE_STORE_IMAGE, async (event, bytes: unknown) => {
    if (!noteOf(event)) return null
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return null
    const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    try {
      return await storeImage(service.paths.assetsDir, view)
    } catch (error) {
      context.log('image.store-failed', { message: (error as Error).message })
      return null
    }
  })

  ipcMain.on(IPC.NOTE_OPEN_EXTERNAL, (event, url: unknown) => {
    if (!noteOf(event) || typeof url !== 'string') return
    if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) void shell.openExternal(url)
  })

  ipcMain.on(IPC.NOTE_OPEN_MANAGER, (event) => {
    if (noteOf(event)) context.openManager()
  })

  // ---- manager window ----

  ipcMain.handle(IPC.MANAGER_SNAPSHOT, (event) => {
    assertManager(event)
    return context.managerSnapshot()
  })

  ipcMain.handle(IPC.MANAGER_CREATE, async (event, options: unknown) => {
    assertManager(event)
    return context.createNote(sanitizeCreate(options))
  })

  ipcMain.handle(IPC.MANAGER_PATCH, (event, id: unknown, patch: unknown) => {
    assertManager(event)
    return service.patch(requireId(id), sanitizePatch(patch))
  })

  ipcMain.handle(IPC.MANAGER_SET_VISIBLE, (event, id: unknown, visible: unknown) => {
    assertManager(event)
    service.setVisible(requireId(id), visible === true)
  })

  ipcMain.handle(IPC.MANAGER_FOCUS, (event, id: unknown) => {
    assertManager(event)
    const noteId = requireId(id)
    service.setVisible(noteId, true)
    windows.focus(noteId)
  })

  ipcMain.handle(IPC.MANAGER_COMPLETE, (event, id: unknown) => {
    assertManager(event)
    context.completeNote(requireId(id))
  })

  ipcMain.handle(IPC.MANAGER_REOPEN, (event, id: unknown) => {
    assertManager(event)
    service.reopen(requireId(id))
  })

  ipcMain.handle(IPC.MANAGER_DELETE, async (event, id: unknown) => {
    assertManager(event)
    await service.remove(requireId(id))
  })

  ipcMain.handle(IPC.MANAGER_CLEAR_ARCHIVED, async (event) => {
    assertManager(event)
    return service.clearArchived()
  })

  ipcMain.handle(IPC.MANAGER_SET_SETTINGS, (event, patch: unknown) => {
    assertManager(event)
    const source = isRecord(patch) ? patch : {}
    const next: Partial<AppSettings> = {}
    if (typeof source.launchAtLogin === 'boolean') next.launchAtLogin = source.launchAtLogin
    if (NOTE_LAYERS.includes(source.defaultLayer as never)) next.defaultLayer = source.defaultLayer as AppSettings['defaultLayer']
    return context.setSettings(next)
  })

  ipcMain.handle(IPC.MANAGER_SHOW_ALL, (event) => {
    assertManager(event)
    windows.showAll()
  })

  ipcMain.handle(IPC.MANAGER_OPEN_DATA_DIR, async (event) => {
    assertManager(event)
    await context.openDataDir()
  })

  ipcMain.handle(IPC.MANAGER_CHECK_UPDATE, async (event) => {
    assertManager(event)
    await context.checkUpdate()
  })

  ipcMain.handle(IPC.MANAGER_INSTALL_UPDATE, (event) => {
    assertManager(event)
    context.installUpdate()
  })
}
