import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { AppWindow, Download, Eye, LogOut, Plus, Power } from 'lucide-react'
import type { TrayCommand, TrayMenuState } from '@shared/ipc'

const api = window.lavaTray

/**
 * The latest state from the main process. Subscribed when the page loads, not
 * when React mounts, so the first request cannot arrive before anyone listens.
 * Store updates render synchronously, also while the window is still hidden,
 * so the size is known before it is shown.
 */
const menuStore = (() => {
  let current: { seq: number; state: TrayMenuState } | null = null
  const listeners = new Set<() => void>()
  api.onShow((seq, state) => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    current = { seq, state }
    for (const listener of listeners) listener()
  })
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get: () => current,
  }
})()

/**
 * The tray menu on Windows. A native popup menu keeps an empty column on the
 * left for check marks and icons, so LavaNotes draws its own: a small paper
 * card in a transparent window that the main process places by the cursor.
 */
export function TrayMenu() {
  const view = useSyncExternalStore(menuStore.subscribe, menuStore.get)
  const card = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!view || !card.current) return
    const rect = card.current.getBoundingClientRect()
    api.ready(view.seq, Math.ceil(rect.width), Math.ceil(rect.height))
  }, [view])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      card.current?.animate(
        [{ opacity: 0, transform: 'translateY(5px) scale(0.985)' }, { opacity: 1, transform: 'none' }],
        { duration: 150, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
      )
    }
    const onKey = (event: KeyboardEvent) => {
      const items = Array.from(card.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      let next = -1
      if (event.key === 'Escape') {
        api.close()
      } else if (event.key === 'ArrowDown') {
        next = index < 0 ? 0 : (index + 1) % items.length
      } else if (event.key === 'ArrowUp') {
        next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
      } else if (event.key === 'Home') {
        next = 0
      } else if (event.key === 'End') {
        next = items.length - 1
      }
      if (next >= 0) {
        event.preventDefault()
        items[next]?.focus()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  if (!view) return null
  const { state } = view

  const item = (command: TrayCommand, icon: ReactNode, label: string, extra?: ReactNode, tone?: 'accent', checked?: boolean) => (
    <button
      type="button"
      className="tray__item"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      data-tone={tone}
      onClick={() => api.run(command)}
    >
      <span className="tray__icon">{icon}</span>
      <span className="tray__label">{label}</span>
      {extra}
    </button>
  )

  return (
    <div ref={card} className="tray" role="menu" aria-label="LavaNotes">
      <header className="tray__head">
        <span className="tray__mark" aria-hidden />
        <strong>LavaNotes</strong>
        <span className="tray__summary">
          {state.noteCount} 张便签
          {state.doingCount > 0 && <em><i aria-hidden />{state.doingCount} 进行中</em>}
        </span>
      </header>
      <div className="tray__group">
        {item('new-note', <Plus size={16} strokeWidth={2} />, '新建便签', <kbd>双击图标</kbd>)}
        {item('show-all', <Eye size={16} />, '显示全部便签', <kbd>单击图标</kbd>)}
        {item('open-manager', <AppWindow size={16} />, '打开 LavaNotes')}
      </div>
      <hr />
      <div className="tray__group">
        {item('toggle-launch', <Power size={16} />, '开机启动', <span className="tray__switch" data-on={state.launchAtLogin} aria-hidden><i /></span>, undefined, state.launchAtLogin)}
        {state.updateVersion && item('install-update', <Download size={16} />, `重启并更新到 ${state.updateVersion}`, undefined, 'accent')}
      </div>
      <hr />
      <div className="tray__group">
        {item('quit', <LogOut size={16} />, '退出')}
      </div>
    </div>
  )
}
