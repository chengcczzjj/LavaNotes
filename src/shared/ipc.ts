import type {
  AppSettings,
  CreateNoteOptions,
  ManagerSnapshot,
  NoteDoc,
  NoteInit,
  NotePatch,
  NoteRecord,
  ResizeSession,
  UpdateState,
} from './types.ts'

export const IPC = {
  // note window
  NOTE_INIT: 'note:init',
  NOTE_SAVE_CONTENT: 'note:save-content',
  NOTE_PATCH: 'note:patch',
  NOTE_DRAG_START: 'note:drag-start',
  NOTE_DRAG_MOVE: 'note:drag-move',
  NOTE_DRAG_END: 'note:drag-end',
  NOTE_RESIZE_BEGIN: 'note:resize-begin',
  NOTE_RESIZE_END: 'note:resize-end',
  NOTE_SET_PASSTHROUGH: 'note:set-passthrough',
  NOTE_NEW: 'note:new',
  NOTE_HIDE: 'note:hide',
  NOTE_DELETE: 'note:delete',
  NOTE_COMPLETE: 'note:complete',
  NOTE_TEAR_FINISHED: 'note:tear-finished',
  NOTE_STORE_IMAGE: 'note:store-image',
  NOTE_OPEN_EXTERNAL: 'note:open-external',
  NOTE_OPEN_MANAGER: 'note:open-manager',
  NOTE_ACTIVATED: 'note:activated',
  NOTE_FLUSHED: 'note:flushed',
  // pushed to a note window
  NOTE_UPDATED: 'note:updated',
  NOTE_PLAY_TEAR: 'note:play-tear',
  NOTE_FOCUS_EDITOR: 'note:focus-editor',
  NOTE_FLUSH_REQUEST: 'note:flush-request',
  // manager window
  MANAGER_SNAPSHOT: 'manager:snapshot',
  MANAGER_CREATE: 'manager:create',
  MANAGER_PATCH: 'manager:patch',
  MANAGER_SET_VISIBLE: 'manager:set-visible',
  MANAGER_FOCUS: 'manager:focus',
  MANAGER_COMPLETE: 'manager:complete',
  MANAGER_REOPEN: 'manager:reopen',
  MANAGER_DELETE: 'manager:delete',
  MANAGER_CLEAR_ARCHIVED: 'manager:clear-archived',
  MANAGER_SET_SETTINGS: 'manager:set-settings',
  MANAGER_SHOW_ALL: 'manager:show-all',
  MANAGER_OPEN_DATA_DIR: 'manager:open-data-dir',
  MANAGER_CHECK_UPDATE: 'manager:check-update',
  MANAGER_INSTALL_UPDATE: 'manager:install-update',
  // pushed to the manager
  MANAGER_CHANGED: 'manager:changed',
  MANAGER_UPDATE_STATE: 'manager:update-state',
  // host window
  HOST_OPEN: 'host:open',
} as const

export interface NoteBridge {
  init(): Promise<NoteInit | null>
  saveContent(doc: NoteDoc): void
  patch(patch: NotePatch): Promise<NoteRecord | null>
  dragStart(): void
  dragMove(): void
  dragEnd(): void
  resizeBegin(): Promise<ResizeSession | null>
  resizeEnd(size: { width: number; height: number } | null): Promise<NoteRecord | null>
  setPassthrough(ignore: boolean): void
  newNote(): void
  hide(): void
  remove(): void
  complete(): void
  tearFinished(): void
  storeImage(bytes: ArrayBuffer): Promise<string | null>
  openExternal(url: string): void
  openManager(): void
  activated(): void
  flushed(): void
  onUpdated(listener: (note: NoteRecord) => void): () => void
  onPlayTear(listener: () => void): () => void
  onFocusEditor(listener: () => void): () => void
  onFlushRequest(listener: () => void): () => void
}

export interface ManagerBridge {
  snapshot(): Promise<ManagerSnapshot>
  create(options: CreateNoteOptions): Promise<NoteRecord | null>
  patch(id: string, patch: NotePatch): Promise<NoteRecord | null>
  setVisible(id: string, visible: boolean): Promise<void>
  focus(id: string): Promise<void>
  complete(id: string): Promise<void>
  reopen(id: string): Promise<void>
  remove(id: string): Promise<void>
  clearArchived(): Promise<number>
  setSettings(settings: Partial<AppSettings>): Promise<AppSettings>
  showAll(): Promise<void>
  openDataDir(): Promise<void>
  checkUpdate(): Promise<void>
  installUpdate(): Promise<void>
  onChanged(listener: () => void): () => void
  onUpdateState(listener: (state: UpdateState) => void): () => void
}

export interface HostOpenRequest {
  id: string
  url: string
  frameName: string
}

export interface HostBridge {
  onOpen(listener: (request: HostOpenRequest) => void): () => void
}
