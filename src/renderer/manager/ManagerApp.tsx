import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Archive,
  ArchiveX,
  Bot,
  ChartColumn,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { MANAGER_PAGES, type ManagerPage, type ManagerSnapshot, type NoteLayer, type NoteRecord, type UpdateState } from '@shared/types'
import { NOTE_LAYERS, NOTE_LAYER_LABELS, displayTitle, isInProgress, noteState } from '@shared/note-model'
import { StatsPage } from './StatsPage'
import { AiPage } from './AiPage'

type Tab = ManagerPage

/** The page the window was opened on (?page=notes from a note's 便签管理, ?page=ai from 配置模型); statistics first otherwise. */
function initialTab(): Tab {
  const page = new URLSearchParams(window.location.search).get('page')
  return MANAGER_PAGES.includes(page as Tab) ? page as Tab : 'stats'
}

const api = window.lavaManager

/** Main-process snapshot kept outside React; the manager re-renders when it changes. */
const snapshotStore = (() => {
  let current: ManagerSnapshot | null = null
  const listeners = new Set<() => void>()
  let started = false
  const load = async () => {
    current = await api.snapshot()
    for (const listener of listeners) listener()
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (!started) {
        started = true
        api.onChanged(() => void load())
        void load()
      }
      return () => listeners.delete(listener)
    },
    get: () => current,
  }
})()

function useSnapshot(): ManagerSnapshot | null {
  return useSyncExternalStore(snapshotStore.subscribe, snapshotStore.get)
}

function LayerBadge({ layer }: { layer: NoteLayer }) {
  if (layer === 'normal') return null
  return (
    <span className="badge" title={NOTE_LAYER_LABELS[layer]}>
      {layer === 'desktop' ? <Pin size={11} /> : <Layers size={11} />}
      {NOTE_LAYER_LABELS[layer]}
    </span>
  )
}

type NoteFilter = 'active' | 'completed' | 'abandoned' | 'all'

const FILTERS: Array<{ id: NoteFilter; label: string }> = [
  // Notes still on the desk. 进行中 is the mark a note gets from its own button.
  { id: 'active', label: '未完成' },
  { id: 'completed', label: '已撕下' },
  { id: 'abandoned', label: '已废弃' },
  { id: 'all', label: '全部' },
]

const FILTER_HINTS: Partial<Record<NoteFilter, string>> = {
  completed: '点 ✓ 撕下的便签留在这里，可以重新贴回。',
  abandoned: '在 ⋯ 里点“废弃”的便签留在这里：不在桌面上，但内容还在，也计入统计，可以重新贴回。',
}

const FILTER_EMPTY: Record<NoteFilter, string> = {
  active: '还没有便签，点“新建便签”贴一张到桌面。',
  completed: '还没有撕下的便签。',
  abandoned: '还没有废弃的便签。',
  all: '还没有便签。',
}

function shortTime(time: number): string {
  return new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** When a note left the desk, used to sort torn-off and abandoned notes. */
function leftAt(note: NoteRecord): number {
  return note.archivedAt ?? note.abandonedAt ?? note.updatedAt
}

function NoteCard({ note }: { note: NoteRecord }) {
  const state = noteState(note)
  const active = state === 'active'
  return (
    <article className="card" data-color={note.color} data-hidden={active && !note.visible} data-state={state}>
      <div className="card__paper" onDoubleClick={active ? () => void api.focus(note.id) : undefined} title={active ? '双击打开' : undefined}>
        <strong>{displayTitle(note)}</strong>
        <p>{note.preview.split('\n').slice(1).join(' ') || (note.imageCount > 0 ? '' : '（还没有内容）')}</p>
        <div className="card__badges">
          {state === 'completed' && <span className="badge badge--state"><Archive size={11} />撕下于 {shortTime(note.archivedAt!)}</span>}
          {state === 'abandoned' && <span className="badge badge--state"><ArchiveX size={11} />废弃于 {shortTime(note.abandonedAt!)}</span>}
          {isInProgress(note) && <span className="badge badge--doing" title={`${shortTime(note.startedAt!)} 开始`}><i aria-hidden />进行中</span>}
          {note.imageCount > 0 && <span className="badge"><ImageIcon size={11} />{note.imageCount}</span>}
          {active && <LayerBadge layer={note.layer} />}
        </div>
      </div>
      <footer className="card__actions">
        {active ? (
          <>
            <button type="button" title={note.visible ? '从桌面收起' : '显示到桌面'} onClick={() => void api.setVisible(note.id, !note.visible)}>
              {note.visible ? <EyeOff size={14} /> : <Eye size={14} />}
              {note.visible ? '收起' : '显示'}
            </button>
            <button type="button" title="打开并定位" onClick={() => void api.focus(note.id)}>打开</button>
          </>
        ) : (
          <button type="button" title="重新贴回桌面" onClick={() => void api.reopen(note.id)}><RotateCcw size={14} />重新贴回</button>
        )}
        <button type="button" title={active ? '删除' : '永久删除'} onClick={() => void api.remove(note.id)}><Trash2 size={14} /></button>
      </footer>
    </article>
  )
}

function NotesTab({ notes }: { notes: NoteRecord[] }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<NoteFilter>('active')
  const [confirmClear, setConfirmClear] = useState(false)
  const counts = useMemo(() => {
    const result: Record<NoteFilter, number> = { active: 0, completed: 0, abandoned: 0, all: notes.length }
    for (const note of notes) result[noteState(note)] += 1
    return result
  }, [notes])
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return notes
      .filter((note) => filter === 'all' || noteState(note) === filter)
      .filter((note) => !text || `${note.title}\n${note.preview}`.toLowerCase().includes(text))
      .sort((a, b) => (filter === 'completed' || filter === 'abandoned' ? leftAt(b) - leftAt(a) : b.updatedAt - a.updatedAt))
  }, [notes, query, filter])
  const clearable = filter === 'completed' || filter === 'abandoned'
  const clear = filter === 'completed' ? api.clearArchived : api.clearAbandoned
  const choose = (next: NoteFilter) => {
    setFilter(next)
    setConfirmClear(false)
  }

  return (
    <section className="panel">
      <div className="panel__toolbar">
        <label className="search">
          <Search size={15} />
          <input value={query} placeholder="搜索便签内容" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="primary" onClick={() => void api.create({ focus: true })}><Plus size={15} />新建便签</button>
      </div>
      <div className="panel__toolbar">
        <div className="segmented note-filter" role="tablist" aria-label="按状态筛选">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} data-selected={filter === item.id} onClick={() => choose(item.id)}>
              {item.label}<span className="count">{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <p className="hint">{FILTER_HINTS[filter] ?? ''}</p>
        {clearable && filtered.length > 0 && !query && (confirmClear ? (
          <button type="button" className="danger" onClick={() => void clear().then(() => setConfirmClear(false))}>确认清空 {filtered.length} 张</button>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)}><Trash2 size={14} />清空</button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="empty">{query ? '没有找到相关便签。' : FILTER_EMPTY[filter]}</p>
      ) : (
        <div className="grid">{filtered.map((note) => <NoteCard key={note.id} note={note} />)}</div>
      )}
    </section>
  )
}

function SettingsTab({ snapshot }: { snapshot: ManagerSnapshot }) {
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => api.onUpdateState(setUpdate), [])
  const layers = NOTE_LAYERS.filter((layer) => layer !== 'desktop' || snapshot.desktopPinSupported)
  const updateText = {
    idle: '',
    checking: '正在检查更新…',
    none: '已经是最新版本。',
    available: update.status === 'available' ? `发现 ${update.version}，正在后台下载…` : '',
    downloaded: update.status === 'downloaded' ? `${update.version} 已下载，重启后完成更新。` : '',
    error: update.status === 'error' ? `检查更新失败：${update.message}` : '',
  }[update.status]
  return (
    <section className="panel settings">
      <label className="setting">
        <div><strong>开机启动</strong><span>登录 Windows 后自动把便签贴回桌面。</span></div>
        <input type="checkbox" checked={snapshot.settings.launchAtLogin} onChange={(event) => void api.setSettings({ launchAtLogin: event.target.checked })} />
      </label>
      <div className="setting">
        <div><strong>新便签的窗口层级</strong><span>普通窗口可以被其他软件盖住；钉在桌面只在桌面露出时可见，显示桌面和最小化全部窗口都不会收起它。</span></div>
        <div className="segmented">
          {layers.map((layer) => (
            <button key={layer} type="button" data-selected={snapshot.settings.defaultLayer === layer} onClick={() => void api.setSettings({ defaultLayer: layer })}>
              {NOTE_LAYER_LABELS[layer]}
            </button>
          ))}
        </div>
      </div>
      <div className="setting">
        <div><strong>数据位置</strong><span>{snapshot.dataDir}</span></div>
        <button type="button" onClick={() => void api.openDataDir()}><FolderOpen size={14} />打开</button>
      </div>
      <div className="setting">
        <div><strong>版本 {snapshot.version}</strong><span>{updateText || '更新来自 GitHub Releases，下载完成后会提示重启。'}</span></div>
        {update.status === 'downloaded' ? (
          <button type="button" className="primary" onClick={() => void api.installUpdate()}>重启并更新</button>
        ) : (
          <button type="button" disabled={update.status === 'checking'} onClick={() => void api.checkUpdate()}><RefreshCw size={14} />检查更新</button>
        )}
      </div>
      <p className="hint">LavaNotes 是开源软件（MIT）：github.com/chengcczzjj/LavaNotes</p>
    </section>
  )
}

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'stats', label: '便签统计', icon: <ChartColumn size={15} /> },
  { id: 'notes', label: '便签管理', icon: <StickyNote size={15} /> },
  { id: 'settings', label: '设置', icon: <Settings size={15} /> },
  { id: 'ai', label: 'AI 配置', icon: <Bot size={15} /> },
]

export function ManagerApp() {
  const snapshot = useSnapshot()
  const [tab, setTab] = useState<Tab>(initialTab)
  useEffect(() => api.onNavigate(setTab), [])
  if (!snapshot) return <div className="loading">LavaNotes</div>
  const notes = snapshot.notes
  const active = notes.filter((note) => noteState(note) === 'active')
  const visible = active.filter((note) => note.visible).length
  return (
    <div className="manager">
      <aside className="sidebar">
        <div className="brand"><span className="brand__mark" />LavaNotes</div>
        <nav>
          {TABS.map((item) => (
            <button key={item.id} type="button" data-active={tab === item.id} onClick={() => setTab(item.id)}>
              {item.icon}{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar__stats">
          <span><strong>{active.length}</strong>张未完成</span>
          <span><strong>{visible}</strong>在桌面</span>
        </div>
        <button type="button" className="sidebar__show" title="把桌面上的便签都调到其他窗口前面（已收起的和钉在桌面的不变），和单击托盘图标一样" onClick={() => void api.showAll()}><Eye size={14} />显示全部便签</button>
      </aside>
      <main data-tab={tab}>
        {tab === 'stats' && <StatsPage onOpenAi={() => setTab('ai')} />}
        {tab === 'notes' && <NotesTab notes={notes} />}
        {tab === 'settings' && <SettingsTab snapshot={snapshot} />}
        {tab === 'ai' && <AiPage />}
      </main>
    </div>
  )
}
