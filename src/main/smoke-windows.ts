import { BrowserWindow, desktopCapturer, screen } from 'electron'
import type { CreateNoteOptions, NoteRecord } from '@shared/types'
import { getWindowMargin } from '@shared/geometry'
import type { NotesService } from './notes-service'
import type { NoteWindowManager } from './note-windows'

/**
 * Windows-only part of the smoke test: what the user actually sees and clicks.
 * A red window is placed behind a note; a screen capture must show red through
 * the transparent margin and paper in the middle, and real mouse clicks must
 * reach the red window through the margin and the note on the paper.
 * Skipped (not failed) when the session has no usable desktop to capture.
 */

interface MouseApi {
  setCursor(x: number, y: number): boolean
  cursor(): { x: number; y: number }
  click(): void
}

interface Context {
  service: NotesService
  windows: NoteWindowManager
  createNote: (options: CreateNoteOptions) => Promise<NoteRecord | null>
  evalIn: (id: string, script: string) => Promise<unknown>
  check: (name: string, ok: unknown, detail?: unknown) => void
}

const MOUSEEVENTF_LEFTDOWN = 0x0002
const MOUSEEVENTF_LEFTUP = 0x0004

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function loadMouse(): MouseApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi')
    const lib = koffi.load('user32.dll')
    koffi.struct('SMOKE_POINT', { x: 'long', y: 'long' })
    const setCursorPos = lib.func('int __stdcall SetCursorPos(int X, int Y)')
    const getCursorPos = lib.func('int __stdcall GetCursorPos(_Out_ SMOKE_POINT *lpPoint)')
    const mouseEvent = lib.func('void __stdcall mouse_event(uint32_t dwFlags, uint32_t dx, uint32_t dy, uint32_t dwData, uintptr_t dwExtraInfo)')
    return {
      setCursor: (x, y) => Number(setCursorPos(x, y)) !== 0,
      cursor: () => {
        const point = { x: 0, y: 0 }
        getCursorPos(point)
        return point
      },
      click: () => {
        mouseEvent(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        mouseEvent(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
      },
    }
  } catch {
    return null
  }
}

async function captureDisplay(display: Electron.Display): Promise<{ bitmap: Buffer; width: number; height: number } | null> {
  const width = Math.round(display.size.width * display.scaleFactor)
  const height = Math.round(display.size.height * display.scaleFactor)
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })
  const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) return null
  const size = source.thumbnail.getSize()
  return { bitmap: source.thumbnail.toBitmap(), width: size.width, height: size.height }
}

/** BGRA pixel at a DIP screen point. */
function pixelAt(
  shot: { bitmap: Buffer; width: number; height: number },
  display: Electron.Display,
  point: { x: number; y: number },
): { r: number; g: number; b: number } {
  const scaleX = shot.width / display.size.width
  const scaleY = shot.height / display.size.height
  const x = Math.min(shot.width - 1, Math.max(0, Math.round((point.x - display.bounds.x) * scaleX)))
  const y = Math.min(shot.height - 1, Math.max(0, Math.round((point.y - display.bounds.y) * scaleY)))
  const index = (y * shot.width + x) * 4
  return { b: shot.bitmap[index], g: shot.bitmap[index + 1], r: shot.bitmap[index + 2] }
}

const isRed = (pixel: { r: number; g: number; b: number }) => pixel.r > 200 && pixel.g < 70 && pixel.b < 70

export async function runWindowsDesktopChecks({ service, windows, createNote, evalIn, check }: Context): Promise<void> {
  const note = await createNote({ text: 'desktop check', focus: false })
  if (!note) {
    check('windows: test note created', false)
    return
  }
  const ready = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      if (windows.isRevealed(note.id)) return true
      await sleep(100)
    }
    return false
  })()
  const win = windows.windowFor(note.id)
  if (!ready || !win) {
    check('windows: test note shown', false)
    return
  }

  const display = screen.getPrimaryDisplay()
  win.setPosition(display.workArea.x + 80, display.workArea.y + 80)
  await sleep(200)
  const bounds = win.getBounds()

  // A red, always-on-top window right behind the note.
  const backdrop = new BrowserWindow({
    x: bounds.x - 30,
    y: bounds.y - 30,
    width: bounds.width + 60,
    height: bounds.height + 60,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#ff0000',
    webPreferences: { sandbox: true, contextIsolation: true },
  })
  try {
    const page = '<body style="margin:0;height:100vh;background:#f00" onmousedown="document.title=\'clicked\'"></body>'
    await backdrop.loadURL(`data:text/html,${encodeURIComponent(page)}`)
    backdrop.setAlwaysOnTop(true, 'floating')
    backdrop.showInactive()
    await sleep(150)
    // Raise the note above it: a later always-on-top window stacks higher.
    service.patch(note.id, { layer: 'top' })
    await sleep(150)
    win.moveTop()
    await sleep(700)

    const margin = getWindowMargin(service.get(note.id)!.rotation)
    const paper = service.get(note.id)!.bounds
    const marginPoint = { x: bounds.x + 4, y: bounds.y + 4 }
    const paperPoint = { x: bounds.x + margin + Math.round(paper.width / 2), y: bounds.y + margin + Math.round(paper.height / 2) }

    const shot = await captureDisplay(display).catch(() => null)
    const outside = shot ? pixelAt(shot, display, { x: bounds.x - 15, y: bounds.y - 15 }) : null
    if (!shot || !outside || !isRed(outside)) {
      check('windows: transparent margin shows what is behind (skipped: no capturable desktop)', true, { outside })
    } else {
      const marginPixel = pixelAt(shot, display, marginPoint)
      const paperPixel = pixelAt(shot, display, paperPoint)
      check('windows: transparent margin shows what is behind', isRed(marginPixel), marginPixel)
      check('windows: the paper is drawn over it', !isRed(paperPixel) && !(paperPixel.r > 245 && paperPixel.g > 245 && paperPixel.b > 245), paperPixel)
    }

    const mouse = loadMouse()
    const toScreen = (point: { x: number; y: number }) => screen.dipToScreenPoint(point)
    const clickAt = async (point: { x: number; y: number }): Promise<boolean> => {
      const target = toScreen(point)
      if (!mouse || !mouse.setCursor(target.x, target.y) || Math.abs(mouse.cursor().x - target.x) > 1) return false
      await sleep(400)
      mouse.click()
      await sleep(300)
      return true
    }
    // Control: a click beside the note must reach the red window, or this
    // session cannot inject mouse input at all.
    const injected = await clickAt({ x: bounds.x - 15, y: bounds.y - 15 }) && backdrop.webContents.getTitle() === 'clicked'
    if (!injected) {
      check('windows: clicks pass through the margin (skipped: mouse input cannot be injected)', true, backdrop.webContents.getTitle())
      return
    }
    await backdrop.webContents.executeJavaScript(`document.title = 'idle'`)
    await clickAt(marginPoint)
    await sleep(300)
    check('windows: clicks pass through the margin', backdrop.webContents.getTitle() === 'clicked', backdrop.webContents.getTitle())

    await backdrop.webContents.executeJavaScript(`document.title = 'idle'`)
    await evalIn(note.id, `window.__smokeClicks = 0; document.addEventListener('pointerdown', () => { window.__smokeClicks += 1 }, true); true`)
    await clickAt(paperPoint)
    const clicks = await evalIn(note.id, 'window.__smokeClicks')
    check('windows: clicks on the paper reach the note', Number(clicks) > 0 && backdrop.webContents.getTitle() === 'idle', { clicks, backdrop: backdrop.webContents.getTitle() })
  } finally {
    backdrop.destroy()
    service.patch(note.id, { layer: 'normal' })
  }
}
