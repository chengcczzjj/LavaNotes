import { app } from 'electron'
import type { UpdateState } from '@shared/types'

type Listener = (state: UpdateState) => void

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle' }
let listeners: Listener[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let updater: any = null

function setState(next: UpdateState): void {
  state = next
  for (const listener of listeners) listener(state)
}

export function getUpdateState(): UpdateState {
  return state
}

export function onUpdateState(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((item) => item !== listener)
  }
}

/** Updates come from GitHub Releases (electron-builder.yml → publish). Only installed builds update. */
export function startAutoUpdates(log: (event: string, data?: Record<string, unknown>) => void): void {
  if (!app.isPackaged || process.env.LAVANOTES_DISABLE_UPDATES === '1') return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    updater = require('electron-updater').autoUpdater
  } catch (error) {
    log('update.unavailable', { message: String(error) })
    return
  }
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.on('checking-for-update', () => setState({ status: 'checking' }))
  updater.on('update-not-available', () => setState({ status: 'none' }))
  updater.on('update-available', (info: { version: string }) => setState({ status: 'available', version: info.version }))
  updater.on('update-downloaded', (info: { version: string }) => setState({ status: 'downloaded', version: info.version }))
  updater.on('error', (error: Error) => {
    log('update.error', { message: error.message })
    setState({ status: 'error', message: error.message })
  })
  setTimeout(() => void checkForUpdates(), 15_000)
  setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
}

export async function checkForUpdates(): Promise<void> {
  if (!updater) {
    setState({ status: 'error', message: app.isPackaged ? '更新服务不可用' : '开发版不检查更新' })
    return
  }
  try {
    await updater.checkForUpdates()
  } catch (error) {
    setState({ status: 'error', message: (error as Error).message })
  }
}

export function installUpdate(beforeQuit: () => Promise<void>): void {
  if (!updater || state.status !== 'downloaded') return
  void beforeQuit().finally(() => updater.quitAndInstall(false, true))
}
