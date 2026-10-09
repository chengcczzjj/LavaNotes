/// <reference types="vite/client" />
import type { HostBridge, ManagerBridge, NoteBridge, TrayBridge } from '@shared/ipc'

declare global {
  interface Window {
    lavaNote: NoteBridge
    lavaManager: ManagerBridge
    lavaHost: HostBridge
    lavaTray: TrayBridge
  }
}

export {}
