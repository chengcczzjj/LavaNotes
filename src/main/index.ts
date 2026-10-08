import { app, screen, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings, CreateNoteOptions, ManagerSnapshot, NoteRecord } from '@shared/types'
import { NOTE_DEFAULT_HEIGHT, NOTE_DEFAULT_WIDTH } from '@shared/note-model'
import { placeNewNote } from '@shared/geometry'
import { applyUserDataOverride } from './env'
import { preloadPath, registerProtocolHandlers, registerSchemes } from './app-paths'
import { NotesService } from './notes-service'
import { NoteWindowManager } from './note-windows'
import { registerIpc } from './ipc'
import { getManagerWindow, isManagerWebContents, openManagerWindow } from './manager-window'
import { createTray, destroyTray, refreshTrayMenu, type TrayActions } from './tray'
import { checkForUpdates, getUpdateState, installUpdate, onUpdateState, startAutoUpdates } from './updater'
import { log } from './log'

const PROTOCOL = 'lavanotes'
const AUTOSTART_ARG = '--autostart'
/** lavanotes://new?text=… comes from other apps (LavaDesk's assistant); keep it a short note. */
const NEW_NOTE_TEXT_LIMIT = 2000

applyUserDataOverride()
registerSchemes()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void main()
}

const WELCOME_TEXT = [
  '欢迎使用 LavaNotes',
  '拖动顶部纸条或胶带可以移动便签，拖右下角折角调整大小。',
  '写完的事点右上角 ✓ 撕下；点 ⋯ 可以换纸色、打开便签管理或删除。',
  '图片可以直接粘贴、拖进来；也可以插入简单表格。',
].join('\n')

async function main(): Promise<void> {
  app.setAppUserModelId('com.lavanotes.app')
  await app.whenReady()

  const service = new NotesService(app.getPath('userData'), {
    onError: (scope, error) => log('storage.error', { scope, message: error instanceof Error ? error.message : String(error) }),
  })
  const loaded = await service.load()
  log('app.start', { version: app.getVersion(), notes: service.list().length, index: loaded.source, quarantined: loaded.quarantined })

  registerProtocolHandlers(service.paths.assetsDir)
  const preload = preloadPath()
  const windows = new NoteWindowManager({
    service,
    preload,
    sharedProcess: process.env.LAVANOTES_SHARED_PROCESS === '1',
    log,
  })

  const createNote = async (options: CreateNoteOptions): Promise<NoteRecord | null> => {
    const near = options.nearNoteId ? service.get(options.nearNoteId) : undefined
    const size = { width: NOTE_DEFAULT_WIDTH, height: NOTE_DEFAULT_HEIGHT }
    const display = near
      ? screen.getDisplayMatching(near.bounds)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const onDisplay = service.list()
      .filter((note) => note.visible && screen.getDisplayMatching(note.bounds).id === display.id)
      .map((note) => note.bounds)
    const bounds = placeNewNote(size, display.workArea, onDisplay)
    try {
      const note = service.create({
        bounds,
        text: options.text,
        color: options.color,
        layer: options.layer,
      })
      await windows.open(note.id, { focus: options.focus !== false })
      return note
    } catch (error) {
      log('note.create-failed', { message: (error as Error).message })
      return null
    }
  }

  // ✓ means done: play the tear animation, then archive the note.
  const tearing = new Set<string>()
  const finishTear = (id: string): void => {
    if (!tearing.delete(id)) return
    service.archive(id)
  }
  const completeNote = (id: string): void => {
    const note = service.get(id)
    if (!note || note.archivedAt !== undefined || tearing.has(id)) return
    if (!windows.playTear(id)) {
      service.archive(id)
      return
    }
    tearing.add(id)
    // The window reports the end of the animation; this covers a window that never answers.
    setTimeout(() => finishTear(id), 2500)
  }

  const applyLaunchAtLogin = (enabled: boolean): void => {
    if (!app.isPackaged || process.platform !== 'win32') return
    try {
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [AUTOSTART_ARG] })
    } catch (error) {
      log('autostart.failed', { message: (error as Error).message })
    }
  }

  const setSettings = (patch: Partial<AppSettings>): AppSettings => {
    const next = service.setSettings(patch)
    if (patch.launchAtLogin !== undefined) applyLaunchAtLogin(next.launchAtLogin)
    refreshTrayMenu(trayActions)
    return next
  }

  const openManager = () => {
    openManagerWindow(preload)
  }

  const flushEverything = async () => {
    await windows.flushAll()
    await service.flush()
  }

  const snapshot = (): ManagerSnapshot => ({
    notes: service.list(),
    settings: service.settings,
    version: app.getVersion(),
    platform: process.platform,
    desktopPinSupported: windows.desktopPinSupported,
    dataDir: service.paths.root,
  })

  let managerNotifyTimer: NodeJS.Timeout | null = null
  const notifyManager = () => {
    if (managerNotifyTimer) return
    managerNotifyTimer = setTimeout(() => {
      managerNotifyTimer = null
      getManagerWindow()?.webContents.send(IPC.MANAGER_CHANGED)
    }, 120)
  }
  service.on('change', notifyManager)
  service.on('settings', notifyManager)

  registerIpc({
    service,
    windows,
    isManager: isManagerWebContents,
    createNote,
    completeNote,
    finishTear,
    setSettings,
    openManager,
    managerSnapshot: snapshot,
    openDataDir: async () => {
      await shell.openPath(service.paths.root)
    },
    checkUpdate: checkForUpdates,
    installUpdate: () => installUpdate(flushEverything),
    log,
  })

  const trayActions: TrayActions = {
    newNote: () => void createNote({ focus: true }),
    showAll: () => windows.showAll(),
    openManager,
    toggleLaunchAtLogin: () => {
      setSettings({ launchAtLogin: !service.settings.launchAtLogin })
    },
    launchAtLogin: () => service.settings.launchAtLogin,
    updateState: getUpdateState,
    installUpdate: () => installUpdate(flushEverything),
    quit: () => app.quit(),
  }
  createTray(trayActions)
  onUpdateState((state) => {
    refreshTrayMenu(trayActions)
    getManagerWindow()?.webContents.send(IPC.MANAGER_UPDATE_STATE, state)
  })

  if (app.isPackaged && !app.isDefaultProtocolClient(PROTOCOL)) app.setAsDefaultProtocolClient(PROTOCOL)
  applyLaunchAtLogin(service.settings.launchAtLogin)

  if (loaded.source === 'empty' && !loaded.quarantined && service.list().length === 0) {
    service.create({
      bounds: placeNewNote({ width: NOTE_DEFAULT_WIDTH, height: NOTE_DEFAULT_HEIGHT }, screen.getPrimaryDisplay().workArea, []),
      text: WELCOME_TEXT,
      color: 'butter',
    })
  }

  await windows.start()
  startAutoUpdates(log)
  setTimeout(() => {
    void service.collectGarbage().then((removed) => {
      if (removed.length > 0) log('assets.collected', { count: removed.length })
    })
  }, 60_000)

  const handleCommand = (argv: string[], source: 'launch' | 'second-instance') => {
    const raw = argv.find((arg) => arg.toLowerCase().startsWith(`${PROTOCOL}://`))
    let command = ''
    let text: string | undefined
    if (raw) {
      try {
        const url = new URL(raw)
        command = (url.hostname || url.pathname.replace(/^\/+/, '').split('/')[0]).toLowerCase()
        text = url.searchParams.get('text')?.slice(0, NEW_NOTE_TEXT_LIMIT) || undefined
      } catch {
        command = ''
      }
    }
    if (command === 'new') {
      void createNote({ focus: true, text })
      return
    }
    if (command === 'manager') {
      openManager()
      return
    }
    if (source === 'launch' && argv.includes(AUTOSTART_ARG)) return
    windows.showAll()
    if (windows.visibleCount() === 0) openManager()
  }

  app.on('second-instance', (_event, argv) => handleCommand(argv, 'second-instance'))
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleCommand([url], 'second-instance')
  })
  // A tray app: closing windows never quits.
  app.on('window-all-closed', () => undefined)

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void (async () => {
      try {
        await windows.shutdown()
        await service.flush()
      } catch (error) {
        log('quit.flush-failed', { message: (error as Error).message })
      } finally {
        destroyTray()
        // quit() rather than exit(): electron-updater installs a downloaded update on 'quit'.
        app.quit()
      }
    })()
  })

  if (process.env.LAVANOTES_SMOKE === '1') {
    const { runSmoke } = await import('./smoke')
    await runSmoke({ service, windows, createNote, completeNote })
    return
  }

  handleCommand(process.argv, 'launch')
}
