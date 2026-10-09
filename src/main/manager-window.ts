import { BrowserWindow, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { MANAGER_PAGES, type ManagerPage } from '@shared/types'
import { rendererUrl, resourcePath } from './app-paths'

let manager: BrowserWindow | null = null

export function getManagerWindow(): BrowserWindow | null {
  return manager && !manager.isDestroyed() ? manager : null
}

export function isManagerWebContents(id: number): boolean {
  return getManagerWindow()?.webContents.id === id
}

/** Open (or bring forward) the manager, optionally on a page such as the model settings. */
export function openManagerWindow(preload: string, page?: ManagerPage): BrowserWindow {
  const target = MANAGER_PAGES.includes(page as ManagerPage) ? page : undefined
  const existing = getManagerWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    if (target) existing.webContents.send(IPC.MANAGER_NAVIGATE, target)
    return existing
  }
  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: 'LavaNotes',
    backgroundColor: '#f6f1e6',
    icon: resourcePath('icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  manager = win
  win.setMenu(null)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (manager === win) manager = null
  })
  void win.loadURL(rendererUrl('manager', target ? { page: target } : {}))
  return win
}
