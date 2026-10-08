import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Archive,
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
import type { ManagerSnapshot, NoteLayer, NoteRecord, UpdateState } from '@shared/types'
import { NOTE_LAYERS, NOTE_LAYER_LABELS, displayTitle } from '@shared/note-model'

type Tab = 'notes' | 'archive' | 'settings'

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

function NoteCard({ note }: { note: NoteRecord }) {
  return (
    <article className="card" data-color={note.color} data-hidden={!note.visible}>
      <div className="card__paper" onDoubleClick={() => void api.focus(note.id)} title="双击打开">
        <strong>{displayTitle(note)}</strong>
        <p>{note.preview.split('\n').slice(1).join(' ') || (note.imageCount > 0 ? '' : '（还没有内容）')}</p>
        <div className="card__badges">
          {note.imageCount > 0 && <span className="badge"><ImageIcon size={11} />{note.imageCount}</span>}
          <LayerBadge layer={note.layer} />
        </div>
      </div>
      <footer className="card__actions">
        <button type="button" title={note.visible ? '从桌面收起' : '显示到桌面'} onClick={() => void api.setVisible(note.id, !note.visible)}>
          {note.visible ? <EyeOff size={14} /> : <Eye size={14} />}
          {note.visible ? '收起' : '显示'}
        </button>
        <button type="button" title="打开并定位" onClick={() => void api.focus(note.id)}>打开</button>
        <button type="button" title="删除" onClick={() => void api.remove(note.id)}><Trash2 size={14} /></button>
      </footer>
    </article>
  )
}

function NotesTab({ notes }: { notes: NoteRecord[] }) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return notes
      .filter((note) => note.archivedAt === undefined)
      .filter((note) => !text || `${note.title}\n${note.preview}`.toLowerCase().includes(text))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [notes, query])
  return (
    <section className="panel">
      <div className="panel__toolbar">
        <label className="search">
          <Search size={15} />
          <input value={query} placeholder="搜索便签内容" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="primary" onClick={() => void api.create({ focus: true })}><Plus size={15} />新建便签</button>
      </div>
      {filtered.length === 0 ? (
        <p className="empty">{query ? '没有找到相关便签。' : '还没有便签，点“新建便签”贴一张到桌面。'}</p>
      ) : (
        <div className="grid">{filtered.map((note) => <NoteCard key={note.id} note={note} />)}</div>
      )}
    </section>
  )
}

function ArchiveTab({ notes }: { notes: NoteRecord[] }) {
  const archived = notes
    .filter((note) => note.archivedAt !== undefined)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
  const [confirmClear, setConfirmClear] = useState(false)
  return (
    <section className="panel">
      <div className="panel__toolbar">
        <p className="hint">点 ✓ 撕下的便签会留在这里，可以重新贴回。</p>
        {archived.length > 0 && (confirmClear ? (
          <button type="button" className="danger" onClick={() => void api.clearArchived().then(() => setConfirmClear(false))}>确认清空 {archived.length} 张</button>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)}><Trash2 size={14} />清空</button>
        ))}
      </div>
      {archived.length === 0 && <p className="empty">还没有撕下的便签。</p>}
      {archived.map((note) => (
        <div key={note.id} className="archive-row" data-color={note.color}>
          <div className="archive-row__main">
            <strong>{displayTitle(note)}</strong>
            <span>{note.archivedAt ? `撕下于 ${new Date(note.archivedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
          </div>
          <button type="button" onClick={() => void api.reopen(note.id)}><RotateCcw size={14} />重新贴回</button>
          <button type="button" title="永久删除" onClick={() => void api.remove(note.id)}><Trash2 size={14} /></button>
        </div>
      ))}
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
  { id: 'notes', label: '全部便签', icon: <StickyNote size={15} /> },
  { id: 'archive', label: '已撕下', icon: <Archive size={15} /> },
  { id: 'settings', label: '设置', icon: <Settings size={15} /> },
]

export function ManagerApp() {
  const snapshot = useSnapshot()
  const [tab, setTab] = useState<Tab>('notes')
  if (!snapshot) return <div className="loading">LavaNotes</div>
  const notes = snapshot.notes
  const active = notes.filter((note) => note.archivedAt === undefined)
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
          <span><strong>{active.length}</strong>张便签</span>
          <span><strong>{visible}</strong>在桌面</span>
        </div>
        <button type="button" className="sidebar__show" onClick={() => void api.showAll()}><Eye size={14} />显示全部便签</button>
      </aside>
      <main>
        {tab === 'notes' && <NotesTab notes={notes} />}
        {tab === 'archive' && <ArchiveTab notes={notes} />}
        {tab === 'settings' && <SettingsTab snapshot={snapshot} />}
      </main>
    </div>
  )
}
