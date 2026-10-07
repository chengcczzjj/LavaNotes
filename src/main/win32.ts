import type { BrowserWindow } from 'electron'

/**
 * Win32 calls for "pin to desktop".
 *
 * A pinned note is owned by the desktop's SHELLDLL_DefView window and pushed to
 * HWND_BOTTOM. Windows keeps an owned window above its owner, so the note sits
 * just above the desktop icons and below every normal window. Show Desktop
 * (Win+D) and Minimize All (Win+M) treat it as part of the desktop and leave it
 * visible. LavaDesk's desktop layer has used the same two calls since 1.0.
 */

interface User32 {
  FindWindowExA(parent: number, after: number, className: string | null, title: string | null): number
  GetWindowLongPtrW(hwnd: number, index: number): number
  SetWindowLongPtrW(hwnd: number, index: number, value: number): number
  SetWindowPos(hwnd: number, after: number, x: number, y: number, cx: number, cy: number, flags: number): number
  IsWindow(hwnd: number): number
}

const GWLP_HWNDPARENT = -8
const HWND_BOTTOM = 1
const SWP_NOSIZE = 0x0001
const SWP_NOMOVE = 0x0002
const SWP_NOACTIVATE = 0x0010
const SWP_NOOWNERZORDER = 0x0200

let api: User32 | null | undefined
let cachedDefView = 0

function user32(): User32 | null {
  if (api !== undefined) return api
  if (process.platform !== 'win32') {
    api = null
    return api
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { load } = require('koffi') as typeof import('koffi')
    const lib = load('user32.dll')
    const findWindowEx = lib.func('intptr_t __stdcall FindWindowExA(intptr_t hWndParent, intptr_t hWndChildAfter, const char *lpszClass, const char *lpszWindow)')
    const getLong = lib.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int nIndex)')
    const setLong = lib.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hWnd, int nIndex, intptr_t dwNewLong)')
    const setPos = lib.func('int __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)')
    const isWindow = lib.func('int __stdcall IsWindow(intptr_t hWnd)')
    api = {
      FindWindowExA: (parent, after, className, title) => Number(findWindowEx(parent, after, className, title)),
      GetWindowLongPtrW: (hwnd, index) => Number(getLong(hwnd, index)),
      SetWindowLongPtrW: (hwnd, index, value) => Number(setLong(hwnd, index, value)),
      SetWindowPos: (hwnd, after, x, y, cx, cy, flags) => Number(setPos(hwnd, after, x, y, cx, cy, flags)),
      IsWindow: (hwnd) => Number(isWindow(hwnd)),
    }
  } catch (error) {
    console.error('[win32] user32 unavailable', error)
    api = null
  }
  return api
}

export function isDesktopPinSupported(): boolean {
  return user32() !== null
}

export function hwndOf(win: BrowserWindow): number {
  const handle = win.getNativeWindowHandle()
  return handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0)
}

/** SHELLDLL_DefView, wherever this Windows build keeps it. */
export function findDesktopView(): number {
  const u = user32()
  if (!u) return 0
  if (cachedDefView && u.IsWindow(cachedDefView)) return cachedDefView
  cachedDefView = 0
  try {
    const progman = u.FindWindowExA(0, 0, 'Progman', null)
    let defView = progman ? u.FindWindowExA(progman, 0, 'SHELLDLL_DefView', null) : 0
    // Windows 11 24H2 nests DefView in a WorkerW child of Progman.
    let inner = progman ? u.FindWindowExA(progman, 0, 'WorkerW', null) : 0
    while (!defView && inner) {
      defView = u.FindWindowExA(inner, 0, 'SHELLDLL_DefView', null)
      inner = u.FindWindowExA(progman, inner, 'WorkerW', null)
    }
    // After a wallpaper engine spawned WorkerW, DefView moves to a top-level WorkerW.
    let worker = u.FindWindowExA(0, 0, 'WorkerW', null)
    let guard = 0
    while (!defView && worker && guard < 64) {
      defView = u.FindWindowExA(worker, 0, 'SHELLDLL_DefView', null)
      worker = u.FindWindowExA(0, worker, 'WorkerW', null)
      guard += 1
    }
    cachedDefView = defView
  } catch (error) {
    console.error('[win32] DefView lookup failed', error)
  }
  return cachedDefView
}

/** Own the window by the desktop and push it to the bottom. Returns false if the desktop was not found. */
export function pinToDesktop(win: BrowserWindow): boolean {
  const u = user32()
  if (!u || win.isDestroyed()) return false
  const defView = findDesktopView()
  if (!defView) return false
  try {
    const hwnd = hwndOf(win)
    u.SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, defView)
    u.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER)
    return true
  } catch (error) {
    console.error('[win32] pin failed', error)
    return false
  }
}

export function unpinFromDesktop(win: BrowserWindow): void {
  const u = user32()
  if (!u || win.isDestroyed()) return
  try {
    u.SetWindowLongPtrW(hwndOf(win), GWLP_HWNDPARENT, 0)
  } catch (error) {
    console.error('[win32] unpin failed', error)
  }
}

/** Move a pinned window back under the other windows without activating anything. */
export function sendToBottom(win: BrowserWindow): void {
  const u = user32()
  if (!u || win.isDestroyed()) return
  try {
    u.SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER)
  } catch {
    // The window may be closing; the next restack fixes the order.
  }
}

/** False when Explorer restarted and the window lost (or never had) its desktop owner. */
export function isPinIntact(win: BrowserWindow): boolean {
  const u = user32()
  if (!u || win.isDestroyed()) return true
  try {
    const owner = u.GetWindowLongPtrW(hwndOf(win), GWLP_HWNDPARENT)
    return owner !== 0 && u.IsWindow(owner) !== 0 && owner === findDesktopView()
  } catch {
    return true
  }
}
