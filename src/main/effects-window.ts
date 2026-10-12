import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type Point, type Rectangle } from 'electron'
import { IPC } from '@shared/ipc'
import type { CelebrationGeometry, CelebrationRequest } from '@shared/effects'
import { rendererUrl } from './app-paths'

const TRANSPARENT = '#00000000'
const LOAD_TIMEOUT_MS = 5000
/** The page must draw the note's picture within this, or the note plays its own animation instead. */
const READY_TIMEOUT_MS = 1500
/** How long a newly shown transparent window stays invisible so DWM composes its alpha (see note-windows.ts). */
const FIRST_SETTLE_MS = 150
const SETTLE_MS = 50
/** Kept on screen (invisible) a moment after the last effect, for the next finish in a row. */
const HIDE_AFTER_IDLE_MS = 1500
/** Shown ahead of time when the cursor is on ✓; hidden again if nothing is finished. */
const PREPARED_KEEP_MS = 4000
/** A page nobody used for this long gives its renderer process back. */
const DESTROY_AFTER_MS = 10 * 60_000

export interface EffectsOverlayOptions {
  preload: string
  log: (event: string, data?: Record<string, unknown>) => void
}

/** A celebration with the note window's place on screen (DIP), before it is made relative to the overlay. */
export interface CelebrationInput extends Omit<CelebrationRequest, 'seq' | 'geometry'> {
  frame: Rectangle
  paper: CelebrationGeometry['paper']
}

function sameRect(a: Rectangle | null, b: Rectangle): boolean {
  return Boolean(a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * A transparent, click-through window over the work area of one display, on
 * top of everything, where finished notes are celebrated: a note window is
 * only a little larger than its paper, so confetti and fireworks need room of
 * their own. It is invisible (opacity 0) whenever nothing plays and hidden
 * soon after; the first frame of an effect is the note exactly as it was, so
 * the note window can disappear underneath without a jump.
 *
 * Only on Windows and macOS: elsewhere a transparent window may come up as an
 * opaque rectangle over the whole screen.
 */
export class EffectsOverlay {
  readonly supported = process.platform === 'win32' || process.platform === 'darwin'
  private win: BrowserWindow | null = null
  private loading: Promise<BrowserWindow | null> | null = null
  private area: Rectangle | null = null
  private settleUntil = 0
  private everShown = false
  private active = false
  private seq = 0
  private readonly waiters = new Map<number, (ok: boolean) => void>()
  private hideTimer: NodeJS.Timeout | null = null
  private destroyTimer: NodeJS.Timeout | null = null
  private readonly options: EffectsOverlayOptions
  /** The last celebration played (smoke test). */
  lastPlayed: { effect: string; at: number } | null = null

  constructor(options: EffectsOverlayOptions) {
    this.options = options
    ipcMain.on(IPC.EFFECTS_READY, (event, seq: unknown) => {
      if (this.fromOverlay(event) && typeof seq === 'number') this.waiters.get(seq)?.(true)
    })
    ipcMain.on(IPC.EFFECTS_IDLE, (event) => {
      if (!this.fromOverlay(event)) return
      this.active = false
      this.win?.setOpacity(0)
      this.scheduleHide(HIDE_AFTER_IDLE_MS)
    })
  }

  /** Load the page and put it, invisible, over the display at this point, so a finish right after starts at once. */
  prepare(at: Point): void {
    if (!this.supported) return
    void this.showOn(screen.getDisplayNearestPoint(at).workArea).then((win) => {
      if (win && !this.active) this.scheduleHide(PREPARED_KEEP_MS)
    })
  }

  /**
   * Play a celebration. Resolves true once the overlay shows its first frame,
   * so the note window can go; false when it cannot, and the note plays its
   * own animation instead.
   */
  async play(input: CelebrationInput): Promise<boolean> {
    if (!this.supported) return false
    const center = { x: Math.round(input.frame.x + input.frame.width / 2), y: Math.round(input.frame.y + input.frame.height / 2) }
    const area = screen.getDisplayNearestPoint(center).workArea
    // Still playing on another display: that one would be cut off by moving.
    if (this.active && !sameRect(this.area, area)) return false
    const win = await this.showOn(area)
    if (!win || win.isDestroyed()) return false
    this.seq += 1
    const seq = this.seq
    const { frame, paper, ...rest } = input
    const request: CelebrationRequest = {
      ...rest,
      seq,
      geometry: { frame: { x: frame.x - area.x, y: frame.y - area.y, width: frame.width, height: frame.height }, paper },
    }
    const ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), READY_TIMEOUT_MS)
      const finish = (ok: boolean) => {
        clearTimeout(timer)
        this.waiters.delete(seq)
        resolve(ok)
      }
      this.waiters.set(seq, finish)
    })
    win.webContents.send(IPC.EFFECTS_PLAY, request)
    const ok = await ready
    if (!ok || win.isDestroyed()) {
      this.options.log('effects.not-ready', { effect: input.effect })
      return false
    }
    this.active = true
    this.cancelTimers()
    win.setOpacity(1)
    this.lastPlayed = { effect: input.effect, at: Date.now() }
    return true
  }

  /** The overlay window (smoke test). */
  window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  destroy(): void {
    this.cancelTimers()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
    this.loading = null
    this.area = null
    this.active = false
  }

  private fromOverlay(event: IpcMainEvent): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && event.sender.id === this.win.webContents.id)
  }

  private cancelTimers(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    if (this.destroyTimer) clearTimeout(this.destroyTimer)
    this.hideTimer = null
    this.destroyTimer = null
  }

  private scheduleHide(delay: number): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      if (this.active) return
      const win = this.win
      if (win && !win.isDestroyed() && win.isVisible()) {
        win.setOpacity(0)
        win.hide()
      }
      if (this.destroyTimer) clearTimeout(this.destroyTimer)
      this.destroyTimer = setTimeout(() => {
        if (!this.active && !this.win?.isVisible()) this.destroy()
      }, DESTROY_AFTER_MS)
    }, delay)
  }

  /** On screen over this work area, invisible, settled. */
  private async showOn(area: Rectangle): Promise<BrowserWindow | null> {
    const win = await this.ensure()
    if (!win || win.isDestroyed()) return null
    this.cancelTimers()
    const visible = win.isVisible()
    if (!visible || !sameRect(this.area, area)) {
      win.setOpacity(0)
      win.setBackgroundColor(TRANSPARENT)
      win.setBounds(area)
      // Moving to a display with another scale can round the size; one more pass settles it.
      if (!sameRect(win.getBounds(), area)) win.setBounds(area)
      this.area = area
      if (!visible) {
        win.showInactive()
        win.setAlwaysOnTop(true, 'screen-saver')
        win.setIgnoreMouseEvents(true)
      }
      this.settleUntil = Date.now() + (this.everShown ? SETTLE_MS : FIRST_SETTLE_MS)
      this.everShown = true
    }
    const wait = this.settleUntil - Date.now()
    if (wait > 0) await sleep(wait)
    return win.isDestroyed() ? null : win
  }

  private ensure(): Promise<BrowserWindow | null> {
    if (this.loading && this.win && !this.win.isDestroyed()) return this.loading
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: TRANSPARENT,
      hasShadow: false,
      thickFrame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      // A tool window: kept out of Alt+Tab.
      type: process.platform === 'win32' ? 'toolbar' : undefined,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      title: 'LavaNotes',
      webPreferences: {
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    this.win = win
    this.everShown = false
    this.area = null
    win.setMenu(null)
    win.setIgnoreMouseEvents(true)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) win.setBackgroundColor(TRANSPARENT)
    })
    win.webContents.on('render-process-gone', () => {
      this.options.log('effects.renderer-gone')
      if (this.win === win) this.destroy()
    })
    win.on('closed', () => {
      if (this.win !== win) return
      this.win = null
      this.loading = null
      this.area = null
      this.active = false
    })
    const loading = new Promise<BrowserWindow | null>((resolve) => {
      let settled = false
      const done = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (!ok) {
          this.options.log('effects.load-failed')
          if (this.win === win) this.destroy()
          else if (!win.isDestroyed()) win.destroy()
        }
        resolve(ok ? win : null)
      }
      const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS)
      win.webContents.once('did-finish-load', () => done(true))
      win.webContents.once('did-fail-load', () => done(false))
    })
    this.loading = loading
    void win.loadURL(rendererUrl('effects')).catch(() => undefined)
    return loading
  }
}
