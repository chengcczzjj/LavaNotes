import { BrowserWindow, shell } from 'electron'
import { rendererUrl, resourcePath } from './app-paths'

let manager: BrowserWindow | null = null

export function getManagerWindow(): BrowserWindow | null {
  return manager && !manager.isDestroyed() ? manager : null
}

export function isManagerWebContents(id: number): boolean {
  return getManagerWindow()?.webContents.id === id
}

export function openManagerWindow(preload: string): BrowserWindow {
  const existing = getManagerWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 760,
    minHeight: 540,
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
  void win.loadURL(rendererUrl('manager'))
  return win
}
