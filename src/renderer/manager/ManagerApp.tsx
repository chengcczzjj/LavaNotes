import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  ListTodo,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  StickyNote,
  Trash2,
} from 'lucide-react'
import type { ManagerSnapshot, NoteLayer, NoteRecord, TodoCategory, UpdateState } from '@shared/types'
import {
  NOTE_COLORS,
  NOTE_COLOR_LABELS,
  NOTE_LAYERS,
  NOTE_LAYER_LABELS,
  TODO_BUCKET_LABELS,
  TODO_CATEGORIES,
  TODO_CATEGORY_LABELS,
  createDueAt,
  createTodo,
  displayTitle,
  formatDueLabel,
  getTodoBucket,
  getWeekRange,
  summarizeWeek,
  type TodoBucket,
} from '@shared/note-model'

type Tab = 'notes' | 'todos' | 'week' | 'archive' | 'settings'
type DueChoice = 'none' | 'today' | 'tomorrow'

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

/** Current time, refreshed every minute so due labels and buckets move on. */
function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
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
  const [confirm, setConfirm] = useState(false)
  return (
    <article className="card" data-color={note.color} data-hidden={!note.visible}>
      <div className="card__paper" onDoubleClick={() => void api.focus(note.id)} title="双击打开">
        <strong>{displayTitle(note)}</strong>
        <p>{note.preview.split('\n').slice(1).join(' ') || (note.imageCount > 0 ? '' : '（还没有内容）')}</p>
        <div className="card__badges">
          {note.todo && <span className="badge"><ListTodo size={11} />{note.todo.done ? '已完成' : '待办'}</span>}
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
        {confirm ? (
          <button type="button" className="danger" onClick={() => void api.remove(note.id)}>确认删除</button>
        ) : (
          <button type="button" title="删除" onClick={() => setConfirm(true)}><Trash2 size={14} /></button>
        )}
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

function TodosTab({ notes }: { notes: NoteRecord[] }) {
  const [draft, setDraft] = useState('')
  const [due, setDue] = useState<DueChoice>('none')
  const [important, setImportant] = useState(false)
  const [color, setColor] = useState<NoteRecord['color']>('butter')
  const now = useNow()
  const open = notes.filter((note) => note.todo && !note.todo.done && note.archivedAt === undefined)
  const groups = (['overdue', 'today', 'upcoming', 'later', 'undated'] as const).map((bucket) => ({
    bucket,
    items: open
      .filter((note) => getTodoBucket(note.todo!, now) === bucket)
      .sort((a, b) => (a.todo!.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.todo!.dueAt ?? Number.MAX_SAFE_INTEGER)),
  }))

  const add = async () => {
    const text = draft.trim()
    if (!text) return
    await api.create({
      text,
      color,
      focus: false,
      todo: createTodo({
        text,
        dueAt: due === 'none' ? undefined : createDueAt(due),
        priority: important ? 'high' : 'normal',
      }),
    })
    setDraft('')
    setImportant(false)
  }

  return (
    <section className="panel">
      <div className="composer">
        <textarea
          value={draft}
          placeholder="现在最想完成哪一件事？Ctrl + Enter 贴到桌面"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void add()
          }}
        />
        <div className="composer__options">
          <div className="segmented">
            {(['none', 'today', 'tomorrow'] as const).map((choice) => (
              <button key={choice} type="button" data-selected={due === choice} onClick={() => setDue(choice)}>
                {choice === 'none' ? '无日期' : choice === 'today' ? '今晚 21:00' : '明晚 21:00'}
              </button>
            ))}
          </div>
          <div className="swatches">
            {NOTE_COLORS.map((item) => (
              <button key={item} type="button" data-color={item} data-selected={item === color} title={NOTE_COLOR_LABELS[item]} onClick={() => setColor(item)} />
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={important} onChange={(event) => setImportant(event.target.checked)} />重要</label>
          <button type="button" className="primary" disabled={!draft.trim()} onClick={() => void add()}><Plus size={15} />贴到桌面</button>
        </div>
      </div>
      {open.length === 0 && <p className="empty">没有进行中的待办。任何便签都可以在 ⋯ 菜单里“设为待办”。</p>}
      {groups.filter((group) => group.items.length > 0).map((group) => (
        <div key={group.bucket} className="todo-group" data-bucket={group.bucket}>
          <h3>{TODO_BUCKET_LABELS[group.bucket as Exclude<TodoBucket, 'done'>]}<span>{group.items.length}</span></h3>
          {group.items.map((note) => (
            <div key={note.id} className="todo-row" data-color={note.color}>
              <button type="button" className="todo-row__check" title="完成并撕下" onClick={() => void api.complete(note.id)}><Check size={14} /></button>
              <div className="todo-row__main">
                <strong>{displayTitle(note)}</strong>
                <span>
                  {note.todo!.dueAt !== undefined && <><Clock3 size={11} />{formatDueLabel(note.todo!.dueAt, now)}</>}
                  {note.todo!.priority === 'high' && <b>重要</b>}
                  {!note.visible && <em>已收起</em>}
                </span>
              </div>
              <select
                value={note.todo!.category}
                aria-label="分类"
                onChange={(event) => void api.patch(note.id, { todo: { ...note.todo!, category: event.target.value as TodoCategory } })}
              >
                {TODO_CATEGORIES.map((category) => <option key={category} value={category}>{TODO_CATEGORY_LABELS[category]}</option>)}
              </select>
              <button type="button" onClick={() => void api.focus(note.id)}>打开</button>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

function WeekTab({ notes }: { notes: NoteRecord[] }) {
  const [offset, setOffset] = useState(0)
  const now = useNow()
  const summary = summarizeWeek(notes, now, offset)
  const range = getWeekRange(now, offset)
  const max = Math.max(1, ...summary.dayCounts)
  const label = (value: number) => new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return (
    <section className="panel">
      <div className="week-nav">
        <button type="button" disabled={offset <= -52} onClick={() => setOffset(offset - 1)}><ChevronLeft size={16} /></button>
        <strong>{offset === 0 ? '本周' : `${-offset} 周前`}</strong>
        <span>{label(range.start)} – {label(range.end)}</span>
        <button type="button" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}><ChevronRight size={16} /></button>
      </div>
      <p className="headline">{summary.headline}</p>
      <div className="stats">
        <div><strong>{summary.completed.length}</strong><span>完成</span></div>
        <div><strong>{summary.completionRate}%</strong><span>收尾率</span></div>
        <div><strong>{summary.activeDays}</strong><span>活跃天</span></div>
        <div><strong>{summary.unfinished.length}</strong><span>未收尾</span></div>
      </div>
      <div className="bars" aria-label="每天完成数">
        {summary.dayCounts.map((count, index) => (
          <div key={index} className="bars__day">
            <div className="bars__track"><div className="bars__fill" style={{ height: `${(count / max) * 100}%` }} /></div>
            <span>{['一', '二', '三', '四', '五', '六', '日'][index]}</span>
            <em>{count}</em>
          </div>
        ))}
      </div>
      {summary.unfinished.length > 0 && (
        <div className="todo-group">
          <h3>还没收尾<span>{summary.unfinished.length}</span></h3>
          {summary.unfinished.map((note) => (
            <div key={note.id} className="todo-row" data-color={note.color}>
              <div className="todo-row__main"><strong>{displayTitle(note)}</strong></div>
              <button type="button" onClick={() => void api.focus(note.id)}>打开</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ArchiveTab({ notes }: { notes: NoteRecord[] }) {
  const archived = notes
    .filter((note) => note.archivedAt !== undefined)
    .sort((a, b) => (b.todo?.completedAt ?? 0) - (a.todo?.completedAt ?? 0))
  const [confirmClear, setConfirmClear] = useState(false)
  return (
    <section className="panel">
      <div className="panel__toolbar">
        <p className="hint">完成并撕下的待办会留在这里，统计和周复盘仍然算它们。</p>
        {archived.length > 0 && (confirmClear ? (
          <button type="button" className="danger" onClick={() => void api.clearArchived().then(() => setConfirmClear(false))}>确认清空 {archived.length} 张</button>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)}><Trash2 size={14} />清空</button>
        ))}
      </div>
      {archived.length === 0 && <p className="empty">还没有撕下的便签。</p>}
      {archived.map((note) => (
        <div key={note.id} className="todo-row" data-color={note.color} data-done>
          <div className="todo-row__main">
            <strong>{displayTitle(note)}</strong>
            <span>{note.todo?.completedAt ? `完成于 ${new Date(note.todo.completedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
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
  { id: 'todos', label: '待办', icon: <ListTodo size={15} /> },
  { id: 'week', label: '周复盘', icon: <Clock3 size={15} /> },
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
  const todos = active.filter((note) => note.todo && !note.todo.done).length
  return (
    <div className="manager">
      <aside className="sidebar">
        <div className="brand"><span className="brand__mark" />LavaNotes</div>
        <nav>
          {TABS.map((item) => (
            <button key={item.id} type="button" data-active={tab === item.id} onClick={() => setTab(item.id)}>
              {item.icon}{item.label}
              {item.id === 'todos' && todos > 0 && <em>{todos}</em>}
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
        {tab === 'todos' && <TodosTab notes={notes} />}
        {tab === 'week' && <WeekTab notes={notes} />}
        {tab === 'archive' && <ArchiveTab notes={notes} />}
        {tab === 'settings' && <SettingsTab snapshot={snapshot} />}
      </main>
    </div>
  )
}
