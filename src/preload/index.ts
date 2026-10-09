import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type HostBridge, type HostOpenRequest, type ManagerBridge, type NoteBridge, type TrayBridge, type TrayMenuState } from '@shared/ipc'
import type { LeaveKind, ManagerPage, NoteRecord, UpdateState } from '@shared/types'
import type { TranslateEvent } from '@shared/translate'

/**
 * One sandboxed preload for every window. Note windows share the host's renderer
 * process, so the role cannot come from process arguments; it comes from the
 * page that is loading, and each page only gets its own API.
 */
function pageRole(): 'host' | 'note' | 'manager' | 'tray' | null {
  const path = (globalThis as { location?: { pathname?: string } }).location?.pathname ?? ''
  if (path.endsWith('/note/index.html')) return 'note'
  if (path.endsWith('/manager/index.html')) return 'manager'
  if (path.endsWith('/host/index.html')) return 'host'
  if (path.endsWith('/tray/index.html')) return 'tray'
  return null
}

function subscribe<T extends unknown[]>(channel: string, listener: (...args: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as T))
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const role = pageRole()

if (role === 'note') {
  const api: NoteBridge = {
    init: () => ipcRenderer.invoke(IPC.NOTE_INIT),
    saveContent: (doc) => ipcRenderer.send(IPC.NOTE_SAVE_CONTENT, doc),
    patch: (patch) => ipcRenderer.invoke(IPC.NOTE_PATCH, patch),
    dragStart: () => ipcRenderer.send(IPC.NOTE_DRAG_START),
    dragMove: () => ipcRenderer.send(IPC.NOTE_DRAG_MOVE),
    dragEnd: () => ipcRenderer.send(IPC.NOTE_DRAG_END),
    resizeBegin: () => ipcRenderer.invoke(IPC.NOTE_RESIZE_BEGIN),
    resizeEnd: (size) => ipcRenderer.invoke(IPC.NOTE_RESIZE_END, size),
    hitResult: (seq, hit) => ipcRenderer.send(IPC.NOTE_HIT_RESULT, seq, hit),
    newNote: () => ipcRenderer.send(IPC.NOTE_NEW),
    remove: () => ipcRenderer.send(IPC.NOTE_DELETE),
    complete: () => ipcRenderer.send(IPC.NOTE_COMPLETE),
    abandon: () => ipcRenderer.send(IPC.NOTE_ABANDON),
    tearFinished: () => ipcRenderer.send(IPC.NOTE_TEAR_FINISHED),
    storeImage: (bytes) => ipcRenderer.invoke(IPC.NOTE_STORE_IMAGE, bytes),
    openExternal: (url) => ipcRenderer.send(IPC.NOTE_OPEN_EXTERNAL, url),
    openManager: (page?: ManagerPage) => ipcRenderer.send(IPC.NOTE_OPEN_MANAGER, page),
    activated: () => ipcRenderer.send(IPC.NOTE_ACTIVATED),
    flushed: () => ipcRenderer.send(IPC.NOTE_FLUSHED),
    aiStatus: () => ipcRenderer.invoke(IPC.NOTE_AI_STATUS),
    translate: (requestId, request) => ipcRenderer.invoke(IPC.NOTE_TRANSLATE, requestId, request),
    cancelTranslate: (requestId) => ipcRenderer.send(IPC.NOTE_TRANSLATE_CANCEL, requestId),
    onTranslateEvent: (listener) => subscribe<[number, TranslateEvent]>(IPC.NOTE_TRANSLATE_EVENT, listener),
    onUpdated: (listener) => subscribe<[NoteRecord]>(IPC.NOTE_UPDATED, listener),
    onPlayTear: (listener) => subscribe<[LeaveKind]>(IPC.NOTE_PLAY_TEAR, listener),
    onFocusEditor: (listener) => subscribe(IPC.NOTE_FOCUS_EDITOR, listener),
    onHitTest: (listener) => subscribe<[number, number, number]>(IPC.NOTE_HIT_TEST, listener),
    onFlushRequest: (listener) => subscribe(IPC.NOTE_FLUSH_REQUEST, listener),
  }
  contextBridge.exposeInMainWorld('lavaNote', api)
} else if (role === 'manager') {
  const api: ManagerBridge = {
    snapshot: () => ipcRenderer.invoke(IPC.MANAGER_SNAPSHOT),
    create: (options) => ipcRenderer.invoke(IPC.MANAGER_CREATE, options),
    setVisible: (id, visible) => ipcRenderer.invoke(IPC.MANAGER_SET_VISIBLE, id, visible),
    focus: (id) => ipcRenderer.invoke(IPC.MANAGER_FOCUS, id),
    reopen: (id) => ipcRenderer.invoke(IPC.MANAGER_REOPEN, id),
    remove: (id) => ipcRenderer.invoke(IPC.MANAGER_DELETE, id),
    clearArchived: () => ipcRenderer.invoke(IPC.MANAGER_CLEAR_ARCHIVED),
    clearAbandoned: () => ipcRenderer.invoke(IPC.MANAGER_CLEAR_ABANDONED),
    setSettings: (settings) => ipcRenderer.invoke(IPC.MANAGER_SET_SETTINGS, settings),
    showAll: () => ipcRenderer.invoke(IPC.MANAGER_SHOW_ALL),
    openDataDir: () => ipcRenderer.invoke(IPC.MANAGER_OPEN_DATA_DIR),
    checkUpdate: () => ipcRenderer.invoke(IPC.MANAGER_CHECK_UPDATE),
    installUpdate: () => ipcRenderer.invoke(IPC.MANAGER_INSTALL_UPDATE),
    stats: () => ipcRenderer.invoke(IPC.MANAGER_STATS),
    insight: (granularity, start) => ipcRenderer.invoke(IPC.MANAGER_INSIGHT_GET, granularity, start),
    runInsight: (granularity, start) => ipcRenderer.invoke(IPC.MANAGER_INSIGHT_RUN, granularity, start),
    cancelInsight: () => ipcRenderer.invoke(IPC.MANAGER_INSIGHT_CANCEL),
    aiSettings: () => ipcRenderer.invoke(IPC.MANAGER_AI_SETTINGS),
    updateAi: (patch) => ipcRenderer.invoke(IPC.MANAGER_AI_UPDATE, patch),
    aiStatus: () => ipcRenderer.invoke(IPC.MANAGER_AI_STATUS),
    testAi: () => ipcRenderer.invoke(IPC.MANAGER_AI_TEST),
    listModels: (provider) => ipcRenderer.invoke(IPC.MANAGER_AI_MODELS, provider),
    detectKey: (key) => ipcRenderer.invoke(IPC.MANAGER_AI_DETECT_KEY, key),
    credentialSources: () => ipcRenderer.invoke(IPC.MANAGER_AI_SOURCES),
    importCredentials: (id) => ipcRenderer.invoke(IPC.MANAGER_AI_IMPORT, id),
    chatgptSignIn: () => ipcRenderer.invoke(IPC.MANAGER_AI_SIGN_IN),
    chatgptCancel: () => ipcRenderer.invoke(IPC.MANAGER_AI_SIGN_IN_CANCEL),
    chatgptSignOut: () => ipcRenderer.invoke(IPC.MANAGER_AI_SIGN_OUT),
    openUrl: (url) => ipcRenderer.invoke(IPC.MANAGER_OPEN_URL, url),
    onChanged: (listener) => subscribe(IPC.MANAGER_CHANGED, listener),
    onUpdateState: (listener) => subscribe<[UpdateState]>(IPC.MANAGER_UPDATE_STATE, listener),
    onAiChanged: (listener) => subscribe(IPC.MANAGER_AI_CHANGED, listener),
    onNavigate: (listener) => subscribe<[ManagerPage]>(IPC.MANAGER_NAVIGATE, listener),
  }
  contextBridge.exposeInMainWorld('lavaManager', api)
} else if (role === 'host') {
  const api: HostBridge = {
    onOpen: (listener) => subscribe<[HostOpenRequest]>(IPC.HOST_OPEN, listener),
  }
  contextBridge.exposeInMainWorld('lavaHost', api)
} else if (role === 'tray') {
  const api: TrayBridge = {
    onShow: (listener) => subscribe<[number, TrayMenuState]>(IPC.TRAY_SHOW, listener),
    ready: (seq, width, height) => ipcRenderer.send(IPC.TRAY_READY, seq, width, height),
    run: (command) => ipcRenderer.send(IPC.TRAY_RUN, command),
    close: () => ipcRenderer.send(IPC.TRAY_CLOSE),
  }
  contextBridge.exposeInMainWorld('lavaTray', api)
}
