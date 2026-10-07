import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions, type Rectangle } from 'electron'
import { IPC, type HostOpenRequest } from '@shared/ipc'
import type { NoteLayer, NoteRecord, ResizeSession } from '@shared/types'
import { NOTE_MAX_HEIGHT, NOTE_MAX_WIDTH, clampNoteSize } from '@shared/note-model'
import {
  ensurePaperReachable,
  getWindowMargin,
  paperOriginForWindow,
  windowBoundsForPaper,
} from '@shared/geometry'
import { isRendererUrl, rendererUrl } from './app-paths'
import type { NotesService } from './notes-service'
import { isDesktopPinSupported, isPinIntact, pinToDesktop, sendToBottom, unpinFromDesktop } from './win32'

interface Entry {
  id: string
  win: BrowserWindow
  layer: NoteLayer | null
  rotation: number
  intentionalClose: boolean
  focusEditor: boolean
  drag: { cursor: Electron.Point; window: Electron.Point } | null
  resizeTimer: NodeJS.Timeout | null
  revealed: boolean
}

export interface NoteWindowManagerOptions {
  service: NotesService
  preload: string
  /** Open notes from one hidden host page so they share its renderer process. */
  sharedProcess: boolean
  log: (event: string, data?: Record<string, unknown>) => void
}

const OPEN_TIMEOUT_MS = 5000
const REVEAL_FALLBACK_MS = 2500
const FLUSH_TIMEOUT_MS = 600
const RESIZE_SAFETY_MS = 60_000
const PIN_HEALTH_INTERVAL_MS = 3000
const REOPEN_WINDOW_MS = 60_000
const REOPEN_LIMIT = 3

/** Electron forwards mouse moves to ignored windows only on Windows and macOS. */
const canPassThrough = process.platform === 'win32' || process.platform === 'darwin'

export class NoteWindowManager {
  private host: BrowserWindow | null = null
  private hostLoad: Promise<boolean> | null = null
  private readonly entries = new Map<string, Entry>()
  private readonly byWebContents = new Map<number, string>()
  private readonly opening = new Map<string, { focus: boolean; timer: NodeJS.Timeout }>()
  private readonly reopenHistory = new Map<string, number[]>()
  private readonly flushWaiters = new Map<number, () => void>()
  private quitting = false
  private recoveringHost = false
  private pinTimer: NodeJS.Timeout | null = null
  private restackTimer: NodeJS.Timeout | null = null
  private readonly options: NoteWindowManagerOptions

  constructor(options: NoteWindowManagerOptions) {
    this.options = options
    options.service.on('change', (kind: string, note: NoteRecord, meta?: { silent?: boolean }) => {
      this.onNoteChanged(kind, note, meta?.silent === true)
    })
    screen.on('display-removed', () => this.keepNotesReachable())
    screen.on('display-metrics-changed', () => this.keepNotesReachable())
  }

  get desktopPinSupported(): boolean {
    return isDesktopPinSupported()
  }

  /** Open every visible note, oldest first so the most recently used ends on top. */
  async start(): Promise<void> {
    const visible = this.options.service.list().filter((note) => note.visible)
    const ordered = [
      ...visible.filter((note) => note.layer !== 'desktop').sort((a, b) => a.lastActiveAt - b.lastActiveAt),
      ...visible.filter((note) => note.layer === 'desktop').sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    ]
    for (const note of ordered) await this.open(note.id)
  }

  noteIdFor(webContentsId: number): string | undefined {
    return this.byWebContents.get(webContentsId)
  }

  isHost(webContentsId: number): boolean {
    return Boolean(this.host && !this.host.isDestroyed() && this.host.webContents.id === webContentsId)
  }

  consumeFocusEditor(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    const focus = entry.focusEditor
    entry.focusEditor = false
    return focus
  }

  async open(id: string, options: { focus?: boolean } = {}): Promise<void> {
    if (this.quitting) return
    const existing = this.entries.get(id)
    if (existing) {
      if (options.focus) this.focusEntry(existing)
      return
    }
    const note = this.options.service.get(id)
    if (!note || !note.visible) return
    this.ensureReachable(note)
    const pending = this.opening.get(id)
    if (pending) {
      pending.focus ||= Boolean(options.focus)
      return
    }
    if (this.options.sharedProcess && await this.ensureHost()) {
      const timer = setTimeout(() => {
        if (!this.opening.has(id)) return
        this.opening.delete(id)
        this.options.log('note.open-timeout', { id })
        this.openIsolated(id, Boolean(options.focus))
      }, OPEN_TIMEOUT_MS)
      this.opening.set(id, { focus: Boolean(options.focus), timer })
      const request: HostOpenRequest = { id, url: rendererUrl('note', { id }), frameName: `note-${id}` }
      this.host!.webContents.send(IPC.HOST_OPEN, request)
      return
    }
    this.openIsolated(id, Boolean(options.focus))
  }

  async close(id: string, options: { flush?: boolean } = {}): Promise<void> {
    const pending = this.opening.get(id)
    if (pending) {
      clearTimeout(pending.timer)
      this.opening.delete(id)
    }
    const entry = this.entries.get(id)
    if (!entry) return
    entry.intentionalClose = true
    if (options.flush !== false) await this.requestFlush(entry)
    if (!entry.win.isDestroyed()) entry.win.destroy()
  }

  /** Ask a note to save its editor now. Resolves when it confirmed or after a short timeout. */
  requestFlush(entry: Entry): Promise<void> {
    const win = entry.win
    if (win.isDestroyed() || win.webContents.isCrashed()) return Promise.resolve()
    const webContentsId = win.webContents.id
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.flushWaiters.delete(webContentsId)
        resolve()
      }
      const timer = setTimeout(done, FLUSH_TIMEOUT_MS)
      this.flushWaiters.set(webContentsId, done)
      win.webContents.send(IPC.NOTE_FLUSH_REQUEST)
    })
  }

  flushConfirmed(webContentsId: number): void {
    this.flushWaiters.get(webContentsId)?.()
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => this.requestFlush(entry)))
  }

  /** Bring every ordinary note in front of other windows (tray click, second launch). */
  showAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.layer === 'desktop' || entry.win.isDestroyed()) continue
      if (entry.win.isMinimized()) entry.win.restore()
      entry.win.showInactive()
      entry.win.moveTop()
    }
  }

  focus(id: string): void {
    const entry = this.entries.get(id)
    if (entry) this.focusEntry(entry)
    else void this.open(id, { focus: true })
  }

  playTear(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry || entry.win.isDestroyed()) return false
    entry.win.webContents.send(IPC.NOTE_PLAY_TEAR)
    return true
  }

  visibleCount(): number {
    return this.entries.size + this.opening.size
  }

  /** The open window of a note, for diagnostics and the smoke test. */
  windowFor(id: string): BrowserWindow | undefined {
    const win = this.entries.get(id)?.win
    return win && !win.isDestroyed() ? win : undefined
  }

  isRevealed(id: string): boolean {
    return this.entries.get(id)?.revealed === true
  }

  // ---- drag, resize and click-through, driven by the note's renderer ----

  dragStart(id: string): void {
    const entry = this.entries.get(id)
    if (!entry || entry.win.isDestroyed()) return
    const [x, y] = entry.win.getPosition()
    entry.drag = { cursor: screen.getCursorScreenPoint(), window: { x, y } }
    this.setPassthrough(id, false)
  }

  dragMove(id: string): void {
    const entry = this.entries.get(id)
    if (!entry?.drag || entry.win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    entry.win.setPosition(
      Math.round(entry.drag.window.x + cursor.x - entry.drag.cursor.x),
      Math.round(entry.drag.window.y + cursor.y - entry.drag.cursor.y),
    )
  }

  dragEnd(id: string): void {
    const entry = this.entries.get(id)
    if (!entry?.drag) return
    this.dragMove(id)
    entry.drag = null
    this.syncBoundsFromWindow(entry)
  }

  /**
   * Transparent windows cannot be resized by the system, so a resize grows the
   * window to the largest paper first. The renderer then resizes the paper with
   * CSS alone, and resizeEnd shrinks the window around the final paper.
   */
  resizeBegin(id: string): ResizeSession | null {
    const entry = this.entries.get(id)
    if (!entry || entry.win.isDestroyed()) return null
    const margin = getWindowMargin(entry.rotation)
    const [x, y] = entry.win.getPosition()
    this.setPassthrough(id, false)
    entry.win.setBounds({ x, y, width: NOTE_MAX_WIDTH + margin * 2, height: NOTE_MAX_HEIGHT + margin * 2 })
    if (entry.resizeTimer) clearTimeout(entry.resizeTimer)
    entry.resizeTimer = setTimeout(() => this.resizeEnd(id, null), RESIZE_SAFETY_MS)
    return { maxWidth: NOTE_MAX_WIDTH, maxHeight: NOTE_MAX_HEIGHT }
  }

  resizeEnd(id: string, size: { width: number; height: number } | null): NoteRecord | null {
    const entry = this.entries.get(id)
    const note = this.options.service.get(id)
    if (!entry || !note || entry.win.isDestroyed()) return note ?? null
    if (entry.resizeTimer) clearTimeout(entry.resizeTimer)
    entry.resizeTimer = null
    const nextSize = clampNoteSize(size?.width ?? note.bounds.width, size?.height ?? note.bounds.height)
    const [x, y] = entry.win.getPosition()
    const paper = { ...paperOriginForWindow(x, y, entry.rotation), ...nextSize }
    entry.win.setBounds(windowBoundsForPaper(paper, entry.rotation))
    return this.options.service.setBounds(id, paper)
  }

  setPassthrough(id: string, ignore: boolean): void {
    const entry = this.entries.get(id)
    if (!entry || entry.win.isDestroyed() || !canPassThrough) return
    const busy = entry.drag !== null || entry.resizeTimer !== null
    if (ignore && !busy) entry.win.setIgnoreMouseEvents(true, { forward: true })
    else entry.win.setIgnoreMouseEvents(false)
  }

  async shutdown(): Promise<void> {
    this.quitting = true
    await this.flushAll()
    if (this.pinTimer) clearInterval(this.pinTimer)
    for (const entry of this.entries.values()) {
      entry.intentionalClose = true
      if (!entry.win.isDestroyed()) entry.win.destroy()
    }
    if (this.host && !this.host.isDestroyed()) this.host.destroy()
  }

  // ---- internals ----

  private windowOptions(note: NoteRecord): BrowserWindowConstructorOptions {
    return {
      ...windowBoundsForPaper(note.bounds, note.rotation),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      thickFrame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      minimizable: note.layer !== 'desktop',
      alwaysOnTop: note.layer === 'top',
      skipTaskbar: true,
      title: 'LavaNotes',
      webPreferences: this.webPreferences(),
    }
  }

  private webPreferences(): Electron.WebPreferences {
    return {
      preload: this.options.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    }
  }

  private ensureHost(): Promise<boolean> {
    if (this.host && !this.host.isDestroyed() && this.hostLoad) return this.hostLoad
    const host = new BrowserWindow({
      show: false,
      width: 120,
      height: 80,
      skipTaskbar: true,
      focusable: false,
      paintWhenInitiallyHidden: false,
      webPreferences: { ...this.webPreferences(), backgroundThrottling: false },
    })
    this.host = host
    host.webContents.setWindowOpenHandler((details) => {
      const id = details.frameName.startsWith('note-') ? details.frameName.slice(5) : ''
      const note = this.options.service.get(id)
      const valid = Boolean(note) && this.opening.has(id) && isRendererUrl(details.url, 'note')
        && new URL(details.url).searchParams.get('id') === id
      if (!valid || !note) return { action: 'deny' }
      return { action: 'allow', overrideBrowserWindowOptions: this.windowOptions(note) }
    })
    host.webContents.on('did-create-window', (win, details) => {
      const id = details.frameName.startsWith('note-') ? details.frameName.slice(5) : ''
      const pending = this.opening.get(id)
      if (!pending) {
        win.destroy()
        return
      }
      clearTimeout(pending.timer)
      this.opening.delete(id)
      this.attach(id, win, pending.focus)
    })
    host.webContents.on('render-process-gone', (_event, details) => this.recoverRendererCrash('host', details.reason))
    host.on('closed', () => {
      if (this.host === host) {
        this.host = null
        this.hostLoad = null
      }
    })
    this.hostLoad = host.loadURL(rendererUrl('host')).then(() => true).catch((error) => {
      this.options.log('host.load-failed', { message: String(error) })
      return false
    })
    return this.hostLoad
  }

  private openIsolated(id: string, focus: boolean): void {
    const note = this.options.service.get(id)
    if (!note || !note.visible || this.entries.has(id) || this.quitting) return
    const win = new BrowserWindow(this.windowOptions(note))
    this.attach(id, win, focus)
    void win.loadURL(rendererUrl('note', { id }))
  }

  private attach(id: string, win: BrowserWindow, focus: boolean): void {
    const note = this.options.service.get(id)
    if (!note || this.entries.has(id)) {
      win.destroy()
      return
    }
    const entry: Entry = {
      id,
      win,
      layer: null,
      rotation: note.rotation,
      intentionalClose: false,
      focusEditor: focus,
      drag: null,
      resizeTimer: null,
      revealed: false,
    }
    this.entries.set(id, entry)
    const webContentsId = win.webContents.id
    this.byWebContents.set(webContentsId, id)
    win.setMenu(null)
    if (canPassThrough) win.setIgnoreMouseEvents(true, { forward: true })
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    // The first load of a window.open child counts as a navigation; allow only this note's page.
    win.webContents.on('will-navigate', (event, url) => {
      const own = isRendererUrl(url, 'note') && new URL(url).searchParams.get('id') === id
      if (!own) event.preventDefault()
    })
    win.webContents.on('render-process-gone', (_event, details) => this.recoverRendererCrash(id, details.reason))
    const reveal = () => this.reveal(entry, focus)
    win.once('ready-to-show', reveal)
    setTimeout(reveal, REVEAL_FALLBACK_MS)
    win.on('focus', () => this.options.service.touch(id))
    win.on('blur', () => {
      if (entry.layer === 'desktop') this.scheduleRestack()
    })
    win.on('moved', () => {
      if (!entry.drag && !entry.resizeTimer) this.syncBoundsFromWindow(entry)
    })
    win.on('closed', () => this.handleClosed(entry, webContentsId))
  }

  private reveal(entry: Entry, focus: boolean): void {
    if (entry.revealed || entry.win.isDestroyed()) return
    entry.revealed = true
    const note = this.options.service.get(entry.id)
    if (!note) {
      void this.close(entry.id, { flush: false })
      return
    }
    const win = entry.win
    if (note.layer === 'desktop' && this.desktopPinSupported && !focus) {
      // DWM only composes a transparent window's alpha correctly once it has
      // been visible unobscured. Show it on top while invisible, then pin it.
      win.setOpacity(0)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.showInactive()
      setTimeout(() => {
        if (win.isDestroyed()) return
        win.setAlwaysOnTop(false)
        this.applyLayer(entry, 'desktop')
        win.setOpacity(1)
      }, 90)
      return
    }
    this.applyLayer(entry, note.layer)
    if (focus) {
      win.show()
      win.focus()
      win.webContents.send(IPC.NOTE_FOCUS_EDITOR)
    } else {
      win.showInactive()
    }
  }

  private focusEntry(entry: Entry): void {
    const win = entry.win
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send(IPC.NOTE_FOCUS_EDITOR)
  }

  private applyLayer(entry: Entry, layer: NoteLayer): void {
    const win = entry.win
    if (win.isDestroyed()) return
    const wasPinned = entry.layer === 'desktop'
    if (layer === 'desktop' && this.desktopPinSupported) {
      win.setAlwaysOnTop(false)
      win.setMinimizable(false)
      if (win.isMinimized()) win.restore()
      if (!pinToDesktop(win)) this.options.log('note.pin-failed', { id: entry.id })
      entry.layer = 'desktop'
      this.scheduleRestack()
    } else {
      if (wasPinned) unpinFromDesktop(win)
      win.setMinimizable(true)
      win.setAlwaysOnTop(layer === 'top', 'floating')
      if (wasPinned) win.moveTop()
      entry.layer = layer
    }
    this.updatePinTimer()
  }

  /**
   * Keep pinned notes in "last used on top" order inside the desktop layer.
   * Each HWND_BOTTOM goes under the previous one, so the newest goes first.
   */
  private scheduleRestack(): void {
    if (this.restackTimer) clearTimeout(this.restackTimer)
    this.restackTimer = setTimeout(() => {
      this.restackTimer = null
      const focused = BrowserWindow.getFocusedWindow()
      const pinned = [...this.entries.values()]
        .filter((entry) => entry.layer === 'desktop' && !entry.win.isDestroyed() && entry.win !== focused)
        .sort((a, b) => (this.options.service.get(b.id)?.lastActiveAt ?? 0) - (this.options.service.get(a.id)?.lastActiveAt ?? 0))
      for (const entry of pinned) sendToBottom(entry.win)
    }, 40)
  }

  /** Explorer restarts replace the desktop window; re-own pinned notes when that happens. */
  private updatePinTimer(): void {
    const anyPinned = [...this.entries.values()].some((entry) => entry.layer === 'desktop')
    if (anyPinned && !this.pinTimer) {
      this.pinTimer = setInterval(() => {
        let repinned = false
        for (const entry of this.entries.values()) {
          if (entry.layer !== 'desktop' || entry.win.isDestroyed() || isPinIntact(entry.win)) continue
          repinned = pinToDesktop(entry.win) || repinned
          this.options.log('note.repinned', { id: entry.id })
        }
        if (repinned) this.scheduleRestack()
      }, PIN_HEALTH_INTERVAL_MS)
    } else if (!anyPinned && this.pinTimer) {
      clearInterval(this.pinTimer)
      this.pinTimer = null
    }
  }

  private handleClosed(entry: Entry, webContentsId: number): void {
    if (entry.resizeTimer) clearTimeout(entry.resizeTimer)
    if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id)
    this.byWebContents.delete(webContentsId)
    this.flushWaiters.get(webContentsId)?.()
    this.updatePinTimer()
    if (entry.intentionalClose || this.quitting) return
    // Not closed by us: Explorer took an owned window down, or the system did.
    const note = this.options.service.get(entry.id)
    if (!note?.visible) return
    const now = Date.now()
    const history = (this.reopenHistory.get(entry.id) ?? []).filter((at) => now - at < REOPEN_WINDOW_MS)
    if (history.length >= REOPEN_LIMIT) {
      this.options.log('note.reopen-gave-up', { id: entry.id })
      return
    }
    history.push(now)
    this.reopenHistory.set(entry.id, history)
    this.options.log('note.reopen-after-unexpected-close', { id: entry.id })
    setTimeout(() => void this.open(entry.id), 1200 * history.length)
  }

  private recoverRendererCrash(source: string, reason: string): void {
    if (this.quitting || this.recoveringHost) return
    this.recoveringHost = true
    this.options.log('renderer.gone', { source, reason })
    // Notes share the host's process: rebuild the host and every open note.
    setTimeout(() => {
      for (const entry of this.entries.values()) {
        entry.intentionalClose = true
        if (!entry.win.isDestroyed()) entry.win.destroy()
      }
      if (this.host && !this.host.isDestroyed()) this.host.destroy()
      this.host = null
      this.hostLoad = null
      this.recoveringHost = false
      void this.start()
    }, 800)
  }

  private syncBoundsFromWindow(entry: Entry): void {
    const note = this.options.service.get(entry.id)
    if (!note || entry.win.isDestroyed()) return
    const [x, y] = entry.win.getPosition()
    this.options.service.setBounds(entry.id, { ...note.bounds, ...paperOriginForWindow(x, y, entry.rotation) })
  }

  private onNoteChanged(kind: string, note: NoteRecord, silent: boolean): void {
    if (kind === 'deleted') {
      void this.close(note.id, { flush: false })
      return
    }
    const entry = this.entries.get(note.id)
    if (!note.visible) {
      if (entry || this.opening.has(note.id)) void this.close(note.id)
      return
    }
    if (!entry) {
      // Created notes are opened by whoever created them, with focus if wanted.
      if (kind === 'updated' && !this.opening.has(note.id)) void this.open(note.id)
      return
    }
    if (silent || kind === 'content') return
    if (entry.layer !== note.layer && entry.revealed) this.applyLayer(entry, note.layer)
    if (entry.rotation !== note.rotation) {
      entry.rotation = note.rotation
      if (!entry.resizeTimer) entry.win.setBounds(windowBoundsForPaper(note.bounds, note.rotation))
    }
    entry.win.webContents.send(IPC.NOTE_UPDATED, note)
  }

  private workAreas(): { all: Rectangle[]; primary: Rectangle } {
    return {
      all: screen.getAllDisplays().map((display) => display.workArea),
      primary: screen.getPrimaryDisplay().workArea,
    }
  }

  private ensureReachable(note: NoteRecord): void {
    const { all, primary } = this.workAreas()
    const next = ensurePaperReachable(note.bounds, all, primary)
    if (next.x !== note.bounds.x || next.y !== note.bounds.y) this.options.service.setBounds(note.id, next)
  }

  private keepNotesReachable(): void {
    setTimeout(() => {
      for (const entry of this.entries.values()) {
        const note = this.options.service.get(entry.id)
        if (!note || entry.win.isDestroyed()) continue
        this.ensureReachable(note)
        const latest = this.options.service.get(entry.id)
        if (latest && (latest.bounds.x !== note.bounds.x || latest.bounds.y !== note.bounds.y)) {
          entry.win.setBounds(windowBoundsForPaper(latest.bounds, entry.rotation))
        }
      }
    }, 500)
  }
}
