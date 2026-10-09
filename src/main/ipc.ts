import { ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import { MANAGER_PAGES, type AppSettings, type CreateNoteOptions, type ManagerPage, type NoteInit, type NotePatch } from '@shared/types'
import { FONT_FAMILIES, NOTE_COLORS, NOTE_LAYERS } from '@shared/note-model'
import { getWindowMargin } from '@shared/geometry'
import { PROVIDER_IDS, type AiSettingsPatch, type ProviderId } from '@shared/ai'
import { sanitizeTranslateRequest, type TranslateResult } from '@shared/translate'
import type { StatsDataset, StatsGranularity } from '@shared/stats'
import type { InsightRunResult } from '@shared/insights'
import type { NotesService } from './notes-service'
import type { NoteWindowManager } from './note-windows'
import type { AiService } from './ai/service'
import { storeImage } from './assets'

export interface IpcContext {
  service: NotesService
  windows: NoteWindowManager
  isManager: (webContentsId: number) => boolean
  createNote: (options: CreateNoteOptions) => Promise<ReturnType<NotesService['create']> | null>
  completeNote: (id: string) => void
  abandonNote: (id: string) => void
  /** The note window finished its tear or crumple animation. */
  finishTear: (id: string) => void
  setSettings: (patch: Partial<AppSettings>) => AppSettings
  openManager: (page?: ManagerPage) => void
  ai: AiService
  statsDataset: () => Promise<StatsDataset>
  runInsight: (granularity: StatsGranularity, start: number, signal: AbortSignal) => Promise<InsightRunResult>
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
  if (NOTE_LAYERS.includes(value.layer as never)) patch.layer = value.layer as NotePatch['layer']
  if (FONT_FAMILIES.includes(value.fontFamily as never)) patch.fontFamily = value.fontFamily as NotePatch['fontFamily']
  if (typeof value.rotation === 'number' && Number.isFinite(value.rotation)) patch.rotation = value.rotation
  if (typeof value.fontSize === 'number' && Number.isFinite(value.fontSize)) patch.fontSize = value.fontSize
  if (typeof value.inProgress === 'boolean') patch.inProgress = value.inProgress
  return patch
}

function sanitizeCreate(value: unknown): CreateNoteOptions {
  if (!isRecord(value)) return {}
  const patch = sanitizePatch(value)
  return {
    text: typeof value.text === 'string' ? value.text.slice(0, 20_000) : undefined,
    color: patch.color,
    layer: patch.layer,
    focus: value.focus === true,
  }
}

/** The manager may change the provider, its key/address/model and the translation target; nothing else. */
export function sanitizeAiPatch(value: unknown): AiSettingsPatch {
  if (!isRecord(value)) return {}
  const patch: AiSettingsPatch = {}
  if (PROVIDER_IDS.includes(value.provider as ProviderId)) patch.provider = value.provider as ProviderId
  if (typeof value.translateTarget === 'string') patch.translateTarget = value.translateTarget.slice(0, 20)
  if (isRecord(value.providers)) {
    const providers: NonNullable<AiSettingsPatch['providers']> = {}
    for (const id of PROVIDER_IDS) {
      const change = value.providers[id]
      if (!isRecord(change)) continue
      const next: { key?: string; baseUrl?: string; model?: string } = {}
      // A ChatGPT sign-in is only written by the main process.
      if (typeof change.key === 'string' && id !== 'chatgpt') next.key = change.key.slice(0, 4000)
      if (typeof change.baseUrl === 'string') next.baseUrl = /^(https?:\/\/\S*)?$/i.test(change.baseUrl.trim()) ? change.baseUrl.slice(0, 500) : ''
      if (typeof change.model === 'string') next.model = change.model.slice(0, 200)
      if (Object.keys(next).length > 0) providers[id] = next
    }
    patch.providers = providers
  }
  return patch
}

function readGranularity(value: unknown): StatsGranularity {
  return value === 'month' ? 'month' : 'week'
}

function readTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('invalid time')
  return value
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

  ipcMain.on(IPC.NOTE_HIT_RESULT, (event, seq: unknown, hit: unknown) => {
    const id = noteOf(event)
    if (id && typeof seq === 'number') windows.hitResult(id, seq, hit === true)
  })

  ipcMain.on(IPC.NOTE_NEW, (event) => {
    const id = noteOf(event)
    if (id) void context.createNote({ nearNoteId: id, focus: true, layer: service.get(id)?.layer })
  })

  ipcMain.on(IPC.NOTE_DELETE, (event) => {
    const id = noteOf(event)
    if (id) void service.remove(id)
  })

  ipcMain.on(IPC.NOTE_COMPLETE, (event) => {
    const id = noteOf(event)
    if (id) context.completeNote(id)
  })

  ipcMain.on(IPC.NOTE_ABANDON, (event) => {
    const id = noteOf(event)
    if (id) context.abandonNote(id)
  })

  ipcMain.on(IPC.NOTE_TEAR_FINISHED, (event) => {
    const id = noteOf(event)
    if (id) context.finishTear(id)
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

  ipcMain.on(IPC.NOTE_OPEN_MANAGER, (event, page: unknown) => {
    if (noteOf(event)) context.openManager(MANAGER_PAGES.includes(page as ManagerPage) ? page as ManagerPage : undefined)
  })

  // ---- translation: streamed back to the note that asked, cancelled when it closes ----

  const translations = new Map<string, AbortController>()

  ipcMain.handle(IPC.NOTE_AI_STATUS, (event) => {
    if (!noteOf(event)) return null
    return { ...context.ai.status(), target: context.ai.settings.get().translateTarget }
  })

  ipcMain.handle(IPC.NOTE_TRANSLATE, async (event, requestId: unknown, value: unknown): Promise<TranslateResult> => {
    const id = noteOf(event)
    const request = sanitizeTranslateRequest(value)
    if (!id || typeof requestId !== 'number' || !request) return { ok: false, message: '没有可以翻译的文字' }
    const sender = event.sender
    const key = `${sender.id}:${requestId}`
    translations.get(key)?.abort()
    const controller = new AbortController()
    translations.set(key, controller)
    const abort = () => controller.abort()
    sender.once('destroyed', abort)
    try {
      return await context.ai.translate(request, controller.signal, (translateEvent) => {
        if (!sender.isDestroyed()) sender.send(IPC.NOTE_TRANSLATE_EVENT, requestId, translateEvent)
      })
    } finally {
      if (translations.get(key) === controller) translations.delete(key)
      if (!sender.isDestroyed()) sender.removeListener('destroyed', abort)
    }
  })

  ipcMain.on(IPC.NOTE_TRANSLATE_CANCEL, (event, requestId: unknown) => {
    if (noteOf(event) && typeof requestId === 'number') translations.get(`${event.sender.id}:${requestId}`)?.abort()
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

  ipcMain.handle(IPC.MANAGER_CLEAR_ABANDONED, async (event) => {
    assertManager(event)
    return service.clearAbandoned()
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

  // ---- statistics ----

  let insightRun: AbortController | null = null

  ipcMain.handle(IPC.MANAGER_STATS, (event) => {
    assertManager(event)
    return context.statsDataset()
  })

  ipcMain.handle(IPC.MANAGER_INSIGHT_GET, (event, granularity: unknown, start: unknown) => {
    assertManager(event)
    return context.ai.getInsight(readGranularity(granularity), readTime(start))
  })

  ipcMain.handle(IPC.MANAGER_INSIGHT_RUN, async (event, granularity: unknown, start: unknown) => {
    assertManager(event)
    insightRun?.abort()
    const controller = new AbortController()
    insightRun = controller
    try {
      return await context.runInsight(readGranularity(granularity), readTime(start), controller.signal)
    } finally {
      if (insightRun === controller) insightRun = null
    }
  })

  ipcMain.handle(IPC.MANAGER_INSIGHT_CANCEL, (event) => {
    assertManager(event)
    insightRun?.abort()
  })

  // ---- language model settings ----

  const { ai } = context

  ipcMain.handle(IPC.MANAGER_AI_SETTINGS, (event) => {
    assertManager(event)
    return ai.publicSettings()
  })

  ipcMain.handle(IPC.MANAGER_AI_UPDATE, (event, patch: unknown) => {
    assertManager(event)
    return ai.update(sanitizeAiPatch(patch))
  })

  ipcMain.handle(IPC.MANAGER_AI_STATUS, (event) => {
    assertManager(event)
    return ai.status()
  })

  ipcMain.handle(IPC.MANAGER_AI_TEST, (event) => {
    assertManager(event)
    return ai.test()
  })

  ipcMain.handle(IPC.MANAGER_AI_MODELS, (event, provider: unknown) => {
    assertManager(event)
    return ai.listModels(PROVIDER_IDS.includes(provider as ProviderId) ? provider as ProviderId : undefined)
  })

  ipcMain.handle(IPC.MANAGER_AI_DETECT_KEY, (event, key: unknown) => {
    assertManager(event)
    return ai.detectKey(typeof key === 'string' ? key.slice(0, 4000) : '')
  })

  ipcMain.handle(IPC.MANAGER_AI_SOURCES, (event) => {
    assertManager(event)
    return ai.sources()
  })

  ipcMain.handle(IPC.MANAGER_AI_IMPORT, (event, id: unknown) => {
    assertManager(event)
    return ai.importSource(typeof id === 'string' ? id.slice(0, 200) : '')
  })

  ipcMain.handle(IPC.MANAGER_AI_SIGN_IN, (event) => {
    assertManager(event)
    return ai.signIn()
  })

  ipcMain.handle(IPC.MANAGER_AI_SIGN_IN_CANCEL, (event) => {
    assertManager(event)
    ai.cancelSignIn()
  })

  ipcMain.handle(IPC.MANAGER_AI_SIGN_OUT, (event) => {
    assertManager(event)
    return ai.signOut()
  })

  /** Provider pages (getting a key, docs); https only. */
  ipcMain.handle(IPC.MANAGER_OPEN_URL, async (event, url: unknown) => {
    assertManager(event)
    if (typeof url === 'string' && /^https:\/\//i.test(url)) await shell.openExternal(url)
  })
}
