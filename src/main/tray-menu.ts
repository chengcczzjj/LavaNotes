import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type Point, type Rectangle } from 'electron'
import { IPC, TRAY_COMMANDS, type TrayCommand, type TrayMenuState } from '@shared/ipc'
import { rendererUrl } from './app-paths'
import { isMouseButtonDown } from './win32'

/** Transparent space around the card for its shadow; --shadow in tray.css. */
const TRAY_SHADOW = 14
/** Distance kept from the edges of the work area. */
const EDGE_GAP = 4
const LOAD_TIMEOUT_MS = 4000
const READY_TIMEOUT_MS = 800
const OUTSIDE_POLL_MS = 60
const OUTSIDE_GRACE_MS = 150
/** A menu nobody opened for this long gives its renderer process back. */
const IDLE_DESTROY_MS = 10 * 60_000
const TRANSPARENT = '#00000000'

export interface TrayPopupOptions {
  preload: string
  state: () => TrayMenuState
  run: (command: TrayCommand) => void
  /** Show the native menu instead, when the page cannot be loaded or does not answer. */
  fallback: () => void
  log: (event: string, data?: Record<string, unknown>) => void
}

/**
 * The tray menu on Windows, drawn by LavaNotes: a native popup menu reserves an
 * empty column on the left for check marks and icons. The page lays out the
 * card for the current state and reports its size; the window is then placed
 * by the cursor, above it (below for a taskbar at the top), inside the work
 * area. It closes when it loses focus, on Escape, or on a click anywhere else.
 */
export class TrayPopup {
  private win: BrowserWindow | null = null
  private loading: Promise<BrowserWindow | null> | null = null
  private seq = 0
  private anchor: Point = { x: 0, y: 0 }
  private shownAt = 0
  private readyTimer: NodeJS.Timeout | null = null
  private outsideTimer: NodeJS.Timeout | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private readonly options: TrayPopupOptions

  constructor(options: TrayPopupOptions) {
    this.options = options
    ipcMain.on(IPC.TRAY_READY, (event, seq: unknown, width: unknown, height: unknown) => {
      if (!this.fromPopup(event) || typeof seq !== 'number') return
      if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0 && height > 0)) return
      this.onReady(seq, Math.min(width, 600), Math.min(height, 800))
    })
    ipcMain.on(IPC.TRAY_RUN, (event, command: unknown) => {
      if (!this.fromPopup(event) || !TRAY_COMMANDS.includes(command as TrayCommand)) return
      // Toggling an option keeps the menu open so the switch can be seen to move.
      if (command !== 'toggle-launch') this.hide()
      this.options.run(command as TrayCommand)
    })
    ipcMain.on(IPC.TRAY_CLOSE, (event) => {
      if (this.fromPopup(event)) this.hide()
    })
  }

  /** Load the page ahead of time, e.g. when the cursor moves over the tray icon. */
  prepare(): void {
    void this.ensure()
  }

  async open(at: Point = screen.getCursorScreenPoint()): Promise<void> {
    const win = await this.ensure()
    if (!win) {
      this.options.fallback()
      return
    }
    this.anchor = at
    this.send(win)
    if (this.readyTimer) clearTimeout(this.readyTimer)
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null
      if (win.isDestroyed() || win.isVisible()) return
      this.options.log('tray.popup-timeout')
      this.options.fallback()
    }, READY_TIMEOUT_MS)
  }

  /** Send fresh state to the menu while it is open, e.g. after toggling an option. */
  refresh(): void {
    const win = this.win
    if (win && !win.isDestroyed() && win.isVisible()) this.send(win)
  }

  /** The menu window and its page (smoke test). */
  window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  contents(): Electron.WebContents | null {
    return this.window()?.webContents ?? null
  }

  isOpen(): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible())
  }

  /** The card's screen rectangle while open (smoke test). */
  cardBounds(): Rectangle | null {
    if (!this.isOpen()) return null
    const bounds = this.win!.getBounds()
    return {
      x: bounds.x + TRAY_SHADOW,
      y: bounds.y + TRAY_SHADOW,
      width: bounds.width - TRAY_SHADOW * 2,
      height: bounds.height - TRAY_SHADOW * 2,
    }
  }

  hide(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer)
    if (this.outsideTimer) clearInterval(this.outsideTimer)
    this.readyTimer = null
    this.outsideTimer = null
    const win = this.win
    if (win && !win.isDestroyed() && win.isVisible()) win.hide()
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.destroy(), IDLE_DESTROY_MS)
  }

  destroy(): void {
    this.hide()
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
    this.loading = null
  }

  private fromPopup(event: IpcMainEvent): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && event.sender.id === this.win.webContents.id)
  }

  private send(win: BrowserWindow): void {
    this.seq += 1
    win.webContents.send(IPC.TRAY_SHOW, this.seq, this.options.state())
  }

  private ensure(): Promise<BrowserWindow | null> {
    if (this.loading) return this.loading
    const win = new BrowserWindow({
      width: 264,
      height: 320,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: TRANSPARENT,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // A tool window: kept out of Alt+Tab.
      type: process.platform === 'win32' ? 'toolbar' : undefined,
      alwaysOnTop: true,
      title: 'LavaNotes',
      webPreferences: {
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    })
    this.win = win
    win.setMenu(null)
    win.setAlwaysOnTop(true, 'pop-up-menu')
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.on('blur', () => this.hide())
    win.on('closed', () => {
      if (this.win !== win) return
      this.win = null
      this.loading = null
    })
    const loading = new Promise<BrowserWindow | null>((resolve) => {
      let settled = false
      const done = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (!ok) {
          this.options.log('tray.popup-load-failed')
          if (this.win === win) this.destroy()
          else if (!win.isDestroyed()) win.destroy()
        }
        resolve(ok ? win : null)
      }
      const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS)
      win.webContents.once('did-finish-load', () => done(true))
      win.webContents.once('did-fail-load', () => done(false))
      win.webContents.once('render-process-gone', () => done(false))
    })
    this.loading = loading
    void win.loadURL(rendererUrl('tray')).catch(() => undefined)
    return loading
  }

  private onReady(seq: number, width: number, height: number): void {
    const win = this.win
    if (seq !== this.seq || !win || win.isDestroyed()) return
    if (this.readyTimer) clearTimeout(this.readyTimer)
    this.readyTimer = null
    const bounds = this.place(width, height)
    win.setBounds(bounds)
    // Moving to a display with another scale can round the size; one more pass settles it.
    const placed = win.getBounds()
    if (placed.width !== bounds.width || placed.height !== bounds.height) win.setBounds(bounds)
    if (win.isVisible()) return
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    // Shown invisible for a moment: the first frame may still be the last menu, or an
    // opaque background on Windows (see note-windows.ts).
    win.setBackgroundColor(TRANSPARENT)
    win.setOpacity(0)
    win.show()
    win.focus()
    setTimeout(() => {
      if (!win.isDestroyed() && win.isVisible()) win.setOpacity(1)
    }, 40)
    this.shownAt = Date.now()
    this.watchOutside(win)
  }

  /** The card's corner at the cursor, opening up and to the right where it fits. */
  private place(width: number, height: number): Rectangle {
    const at = this.anchor
    const area = screen.getDisplayNearestPoint(at).workArea
    let x = at.x
    let y = at.y - height
    if (x + width > area.x + area.width - EDGE_GAP) x = at.x - width
    if (y < area.y + EDGE_GAP) y = at.y
    x = Math.min(Math.max(x, area.x + EDGE_GAP), area.x + area.width - width - EDGE_GAP)
    y = Math.min(Math.max(y, area.y + EDGE_GAP), area.y + area.height - height - EDGE_GAP)
    return {
      x: Math.round(x - TRAY_SHADOW),
      y: Math.round(y - TRAY_SHADOW),
      width: Math.ceil(width + TRAY_SHADOW * 2),
      height: Math.ceil(height + TRAY_SHADOW * 2),
    }
  }

  /**
   * Losing focus closes the menu, but Windows does not always hand focus to a
   * window that was not clicked on, so a press outside the card closes it too.
   */
  private watchOutside(win: BrowserWindow): void {
    if (this.outsideTimer) clearInterval(this.outsideTimer)
    this.outsideTimer = setInterval(() => {
      if (win.isDestroyed() || !win.isVisible()) {
        this.hide()
        return
      }
      if (Date.now() - this.shownAt < OUTSIDE_GRACE_MS || !isMouseButtonDown()) return
      const card = this.cardBounds()
      const cursor = screen.getCursorScreenPoint()
      const inside = card !== null && cursor.x >= card.x && cursor.x < card.x + card.width
        && cursor.y >= card.y && cursor.y < card.y + card.height
      if (!inside) this.hide()
    }, OUTSIDE_POLL_MS)
  }
}
