import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type HostBridge, type HostOpenRequest, type ManagerBridge, type NoteBridge } from '@shared/ipc'
import type { NoteRecord, UpdateState } from '@shared/types'

/**
 * One sandboxed preload for every window. Note windows share the host's renderer
 * process, so the role cannot come from process arguments; it comes from the
 * page that is loading, and each page only gets its own API.
 */
function pageRole(): 'host' | 'note' | 'manager' | null {
  const path = (globalThis as { location?: { pathname?: string } }).location?.pathname ?? ''
  if (path.endsWith('/note/index.html')) return 'note'
  if (path.endsWith('/manager/index.html')) return 'manager'
  if (path.endsWith('/host/index.html')) return 'host'
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
    tearFinished: () => ipcRenderer.send(IPC.NOTE_TEAR_FINISHED),
    storeImage: (bytes) => ipcRenderer.invoke(IPC.NOTE_STORE_IMAGE, bytes),
    openExternal: (url) => ipcRenderer.send(IPC.NOTE_OPEN_EXTERNAL, url),
    openManager: () => ipcRenderer.send(IPC.NOTE_OPEN_MANAGER),
    activated: () => ipcRenderer.send(IPC.NOTE_ACTIVATED),
    flushed: () => ipcRenderer.send(IPC.NOTE_FLUSHED),
    onUpdated: (listener) => subscribe<[NoteRecord]>(IPC.NOTE_UPDATED, listener),
    onPlayTear: (listener) => subscribe(IPC.NOTE_PLAY_TEAR, listener),
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
    setSettings: (settings) => ipcRenderer.invoke(IPC.MANAGER_SET_SETTINGS, settings),
    showAll: () => ipcRenderer.invoke(IPC.MANAGER_SHOW_ALL),
    openDataDir: () => ipcRenderer.invoke(IPC.MANAGER_OPEN_DATA_DIR),
    checkUpdate: () => ipcRenderer.invoke(IPC.MANAGER_CHECK_UPDATE),
    installUpdate: () => ipcRenderer.invoke(IPC.MANAGER_INSTALL_UPDATE),
    onChanged: (listener) => subscribe(IPC.MANAGER_CHANGED, listener),
    onUpdateState: (listener) => subscribe<[UpdateState]>(IPC.MANAGER_UPDATE_STATE, listener),
  }
  contextBridge.exposeInMainWorld('lavaManager', api)
} else if (role === 'host') {
  const api: HostBridge = {
    onOpen: (listener) => subscribe<[HostOpenRequest]>(IPC.HOST_OPEN, listener),
  }
  contextBridge.exposeInMainWorld('lavaHost', api)
}
