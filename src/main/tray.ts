import { Menu, Tray, nativeImage } from 'electron'
import type { UpdateState } from '@shared/types'
import { resourcePath } from './app-paths'

export interface TrayActions {
  newNote: () => void
  showAll: () => void
  openManager: () => void
  toggleLaunchAtLogin: () => void
  launchAtLogin: () => boolean
  updateState: () => UpdateState
  installUpdate: () => void
  quit: () => void
}

let tray: Tray | null = null

export function createTray(actions: TrayActions): Tray {
  const image = nativeImage.createFromPath(resourcePath(process.platform === 'win32' ? 'tray.ico' : 'tray.png'))
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('LavaNotes')
  tray.on('click', actions.showAll)
  tray.on('double-click', actions.newNote)
  refreshTrayMenu(actions)
  return tray
}

export function refreshTrayMenu(actions: TrayActions): void {
  if (!tray) return
  const update = actions.updateState()
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: '新建便签', click: actions.newNote },
    { label: '显示全部便签', click: actions.showAll },
    { label: '便签管理', click: actions.openManager },
    { type: 'separator' },
    { label: '开机启动', type: 'checkbox', checked: actions.launchAtLogin(), click: actions.toggleLaunchAtLogin },
  ]
  if (update.status === 'downloaded') {
    template.push({ label: `重启并更新到 ${update.version}`, click: actions.installUpdate })
  }
  template.push({ type: 'separator' }, { label: '退出', click: actions.quit })
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
