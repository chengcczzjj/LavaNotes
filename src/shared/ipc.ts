import type {
  AppSettings,
  CreateNoteOptions,
  LeaveKind,
  ManagerPage,
  ManagerSnapshot,
  NoteDoc,
  NoteInit,
  NotePatch,
  NoteRecord,
  ResizeSession,
  UpdateState,
} from './types.ts'
import type {
  AiCredentialSource,
  AiModelInfo,
  AiSettings,
  AiSettingsPatch,
  AiStatus,
  KeyDetection,
  ProviderId,
} from './ai.ts'
import type { TranslateEvent, TranslateRequest, TranslateResult } from './translate.ts'
import type { StatsDataset, StatsGranularity } from './stats.ts'
import type { InsightRecord, InsightRunResult } from './insights.ts'

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
  NOTE_HIT_TEST: 'note:hit-test',
  NOTE_HIT_RESULT: 'note:hit-result',
  NOTE_NEW: 'note:new',
  NOTE_DELETE: 'note:delete',
  NOTE_COMPLETE: 'note:complete',
  NOTE_ABANDON: 'note:abandon',
  NOTE_TEAR_FINISHED: 'note:tear-finished',
  NOTE_STORE_IMAGE: 'note:store-image',
  NOTE_OPEN_EXTERNAL: 'note:open-external',
  NOTE_OPEN_MANAGER: 'note:open-manager',
  NOTE_ACTIVATED: 'note:activated',
  NOTE_FLUSHED: 'note:flushed',
  NOTE_AI_STATUS: 'note:ai-status',
  NOTE_TRANSLATE: 'note:translate',
  NOTE_TRANSLATE_CANCEL: 'note:translate-cancel',
  // pushed to a note window
  NOTE_UPDATED: 'note:updated',
  NOTE_PLAY_TEAR: 'note:play-tear',
  NOTE_FOCUS_EDITOR: 'note:focus-editor',
  NOTE_FLUSH_REQUEST: 'note:flush-request',
  NOTE_TRANSLATE_EVENT: 'note:translate-event',
  NOTE_AI_CHANGED: 'note:ai-changed',
  // manager window
  MANAGER_SNAPSHOT: 'manager:snapshot',
  MANAGER_CREATE: 'manager:create',
  MANAGER_SET_VISIBLE: 'manager:set-visible',
  MANAGER_FOCUS: 'manager:focus',
  MANAGER_REOPEN: 'manager:reopen',
  MANAGER_DELETE: 'manager:delete',
  MANAGER_CLEAR_ARCHIVED: 'manager:clear-archived',
  MANAGER_CLEAR_ABANDONED: 'manager:clear-abandoned',
  MANAGER_SET_SETTINGS: 'manager:set-settings',
  MANAGER_SHOW_ALL: 'manager:show-all',
  MANAGER_OPEN_DATA_DIR: 'manager:open-data-dir',
  MANAGER_CHECK_UPDATE: 'manager:check-update',
  MANAGER_INSTALL_UPDATE: 'manager:install-update',
  MANAGER_STATS: 'manager:stats',
  MANAGER_INSIGHT_GET: 'manager:insight-get',
  MANAGER_INSIGHT_RUN: 'manager:insight-run',
  MANAGER_INSIGHT_CANCEL: 'manager:insight-cancel',
  MANAGER_AI_SETTINGS: 'manager:ai-settings',
  MANAGER_AI_UPDATE: 'manager:ai-update',
  MANAGER_AI_STATUS: 'manager:ai-status',
  MANAGER_AI_TEST: 'manager:ai-test',
  MANAGER_AI_MODELS: 'manager:ai-models',
  MANAGER_AI_DETECT_KEY: 'manager:ai-detect-key',
  MANAGER_AI_SOURCES: 'manager:ai-sources',
  MANAGER_AI_IMPORT: 'manager:ai-import',
  MANAGER_AI_SIGN_IN: 'manager:ai-sign-in',
  MANAGER_AI_SIGN_IN_CANCEL: 'manager:ai-sign-in-cancel',
  MANAGER_AI_SIGN_OUT: 'manager:ai-sign-out',
  MANAGER_OPEN_URL: 'manager:open-url',
  // pushed to the manager
  MANAGER_CHANGED: 'manager:changed',
  MANAGER_UPDATE_STATE: 'manager:update-state',
  MANAGER_AI_CHANGED: 'manager:ai-changed',
  MANAGER_NAVIGATE: 'manager:navigate',
  // host window
  HOST_OPEN: 'host:open',
  // tray menu (Windows): pushed state, then the page's size, a command or closing
  TRAY_SHOW: 'tray:show',
  TRAY_READY: 'tray:ready',
  TRAY_RUN: 'tray:run',
  TRAY_CLOSE: 'tray:close',
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
  /** Answer a hit test: is the paper (or a menu on it) under this window point? */
  hitResult(seq: number, hit: boolean): void
  newNote(): void
  remove(): void
  complete(): void
  /** Give the note up: it crumples away but is kept for the statistics. */
  abandon(): void
  tearFinished(): void
  storeImage(bytes: ArrayBuffer): Promise<string | null>
  openExternal(url: string): void
  openManager(page?: ManagerPage): void
  activated(): void
  flushed(): void
  aiStatus(): Promise<AiStatus & { target: string }>
  translate(requestId: number, request: TranslateRequest): Promise<TranslateResult>
  cancelTranslate(requestId: number): void
  onTranslateEvent(listener: (requestId: number, event: TranslateEvent) => void): () => void
  /** The model settings changed (a key saved, a model chosen). */
  onAiChanged(listener: () => void): () => void
  onUpdated(listener: (note: NoteRecord) => void): () => void
  onPlayTear(listener: (kind: LeaveKind) => void): () => void
  onFocusEditor(listener: () => void): () => void
  onHitTest(listener: (seq: number, x: number, y: number) => void): () => void
  onFlushRequest(listener: () => void): () => void
}

export interface ManagerBridge {
  snapshot(): Promise<ManagerSnapshot>
  create(options: CreateNoteOptions): Promise<NoteRecord | null>
  setVisible(id: string, visible: boolean): Promise<void>
  focus(id: string): Promise<void>
  reopen(id: string): Promise<void>
  remove(id: string): Promise<void>
  clearArchived(): Promise<number>
  clearAbandoned(): Promise<number>
  setSettings(settings: Partial<AppSettings>): Promise<AppSettings>
  showAll(): Promise<void>
  openDataDir(): Promise<void>
  checkUpdate(): Promise<void>
  installUpdate(): Promise<void>
  stats(): Promise<StatsDataset>
  insight(granularity: StatsGranularity, start: number): Promise<InsightRecord | null>
  runInsight(granularity: StatsGranularity, start: number): Promise<InsightRunResult>
  cancelInsight(): Promise<void>
  aiSettings(): Promise<AiSettings>
  updateAi(patch: AiSettingsPatch): Promise<AiSettings>
  aiStatus(): Promise<AiStatus>
  testAi(): Promise<{ ok: boolean; message: string }>
  listModels(provider?: ProviderId): Promise<{ ok: boolean; models: AiModelInfo[]; message?: string }>
  detectKey(key: string): Promise<KeyDetection>
  credentialSources(): Promise<AiCredentialSource[]>
  importCredentials(id: string): Promise<AiSettings>
  chatgptSignIn(): Promise<{ ok: boolean; message?: string }>
  chatgptCancel(): Promise<void>
  chatgptSignOut(): Promise<AiSettings>
  openUrl(url: string): Promise<void>
  onChanged(listener: () => void): () => void
  onUpdateState(listener: (state: UpdateState) => void): () => void
  onAiChanged(listener: () => void): () => void
  onNavigate(listener: (page: ManagerPage) => void): () => void
}

export interface HostOpenRequest {
  id: string
  url: string
  frameName: string
}

export interface HostBridge {
  onOpen(listener: (request: HostOpenRequest) => void): () => void
}

/** What the tray menu shows, sent each time it opens. */
export interface TrayMenuState {
  launchAtLogin: boolean
  /** A downloaded update waiting for a restart. */
  updateVersion: string | null
  /** Notes on the desk (shown or hidden). */
  noteCount: number
  /** Of those, notes marked in progress. */
  doingCount: number
}

export type TrayCommand = 'new-note' | 'show-all' | 'open-manager' | 'toggle-launch' | 'install-update' | 'quit'

export const TRAY_COMMANDS: readonly TrayCommand[] = ['new-note', 'show-all', 'open-manager', 'toggle-launch', 'install-update', 'quit']

export interface TrayBridge {
  onShow(listener: (seq: number, state: TrayMenuState) => void): () => void
  /** The menu card is laid out for this state; its size in CSS pixels. */
  ready(seq: number, width: number, height: number): void
  run(command: TrayCommand): void
  close(): void
}
