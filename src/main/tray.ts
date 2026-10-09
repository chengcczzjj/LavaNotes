import { Menu, Tray, nativeImage } from 'electron'
import type { TrayCommand, TrayMenuState } from '@shared/ipc'
import type { UpdateState } from '@shared/types'
import { resourcePath } from './app-paths'
import { TrayPopup } from './tray-menu'

export interface TrayActions {
  newNote: () => void
  showAll: () => void
  openManager: () => void
  toggleLaunchAtLogin: () => void
  launchAtLogin: () => boolean
  updateState: () => UpdateState
  installUpdate: () => void
  quit: () => void
  /** Notes on the desk, and how many of them are marked in progress. */
  noteCounts: () => { notes: number; doing: number }
}

export interface TrayOptions {
  preload: string
  log: (event: string, data?: Record<string, unknown>) => void
}

let tray: Tray | null = null
let popup: TrayPopup | null = null

function menuState(actions: TrayActions): TrayMenuState {
  const update = actions.updateState()
  const counts = actions.noteCounts()
  return {
    launchAtLogin: actions.launchAtLogin(),
    updateVersion: update.status === 'downloaded' ? update.version : null,
    noteCount: counts.notes,
    doingCount: counts.doing,
  }
}

function run(actions: TrayActions, command: TrayCommand): void {
  const handlers: Record<TrayCommand, () => void> = {
    'new-note': actions.newNote,
    'show-all': actions.showAll,
    'open-manager': actions.openManager,
    'toggle-launch': actions.toggleLaunchAtLogin,
    'install-update': actions.installUpdate,
    quit: actions.quit,
  }
  handlers[command]()
}

/** The native menu: used on macOS and Linux, and on Windows if LavaNotes' own menu cannot open. */
function nativeMenu(actions: TrayActions): Menu {
  const state = menuState(actions)
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: '新建便签', click: actions.newNote },
    { label: '显示全部便签', click: actions.showAll },
    { label: '打开 LavaNotes', click: actions.openManager },
    { type: 'separator' },
    { label: '开机启动', type: 'checkbox', checked: state.launchAtLogin, click: actions.toggleLaunchAtLogin },
  ]
  if (state.updateVersion) template.push({ label: `重启并更新到 ${state.updateVersion}`, click: actions.installUpdate })
  template.push({ type: 'separator' }, { label: '退出', click: actions.quit })
  return Menu.buildFromTemplate(template)
}

export function createTray(actions: TrayActions, options: TrayOptions): Tray {
  const image = nativeImage.createFromPath(resourcePath(process.platform === 'win32' ? 'tray.ico' : 'tray.png'))
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('LavaNotes')
  tray.on('click', actions.showAll)
  tray.on('double-click', actions.newNote)
  if (process.platform === 'win32') {
    const menu = new TrayPopup({
      preload: options.preload,
      state: () => menuState(actions),
      run: (command) => run(actions, command),
      fallback: () => tray?.popUpContextMenu(nativeMenu(actions)),
      log: options.log,
    })
    popup = menu
    // Loading the page while the cursor rests on the icon makes the first right click instant.
    tray.on('mouse-move', () => menu.prepare())
    tray.on('right-click', () => void menu.open())
  }
  refreshTrayMenu(actions)
  return tray
}

export function refreshTrayMenu(actions: TrayActions): void {
  if (!tray) return
  if (popup) popup.refresh()
  else tray.setContextMenu(nativeMenu(actions))
}

/** LavaNotes' own tray menu on Windows (smoke test). */
export function trayPopup(): TrayPopup | null {
  return popup
}

export function destroyTray(): void {
  popup?.destroy()
  popup = null
  tray?.destroy()
  tray = null
}
