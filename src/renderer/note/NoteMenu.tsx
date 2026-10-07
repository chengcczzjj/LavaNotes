import { useEffect, useRef, useState, type RefObject } from 'react'
import { EyeOff, LayoutList, Trash2 } from 'lucide-react'
import type { NoteLayer, NotePatch, NoteRecord, NoteTodo } from '@shared/types'
import {
  FONT_FAMILIES,
  FONT_FAMILY_LABELS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  NOTE_COLORS,
  NOTE_COLOR_LABELS,
  NOTE_LAYERS,
  NOTE_LAYER_LABELS,
  PAPER_STYLES,
  PAPER_STYLE_LABELS,
  ROTATION_LIMIT,
  TODO_CATEGORIES,
  TODO_CATEGORY_LABELS,
  createDueAt,
  createTodo,
} from '@shared/note-model'

interface NoteMenuProps {
  note: NoteRecord
  desktopPinSupported: boolean
  anchor: RefObject<HTMLButtonElement | null>
  onPatch(patch: NotePatch): void
  onClose(): void
}

function toLocalInput(value: number | undefined): string {
  if (value === undefined) return ''
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function NoteMenu({ note, desktopPinSupported, anchor, onPatch, onClose }: NoteMenuProps) {
  const panel = useRef<HTMLDivElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const todo = note.todo

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [anchor, onClose])

  const setTodo = (change: Partial<NoteTodo>) => {
    if (todo) onPatch({ todo: { ...todo, ...change } })
  }

  const layers = NOTE_LAYERS.filter((layer) => layer !== 'desktop' || desktopPinSupported)

  return (
    <div ref={panel} className="note-menu" role="dialog" aria-label="便签设置">
      <section>
        <small>纸色</small>
        <div className="note-menu__swatches">
          {NOTE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              data-color={color}
              data-selected={note.color === color}
              title={NOTE_COLOR_LABELS[color]}
              aria-label={NOTE_COLOR_LABELS[color]}
              aria-pressed={note.color === color}
              onClick={() => onPatch({ color })}
            />
          ))}
        </div>
      </section>

      <section>
        <small>固定方式</small>
        <div className="note-menu__segmented">
          {PAPER_STYLES.map((style) => (
            <button key={style} type="button" data-selected={note.paperStyle === style} onClick={() => onPatch({ paperStyle: style })}>
              {PAPER_STYLE_LABELS[style]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <small>窗口</small>
        <div className="note-menu__segmented">
          {layers.map((layer: NoteLayer) => (
            <button key={layer} type="button" data-selected={note.layer === layer} onClick={() => onPatch({ layer })}>
              {NOTE_LAYER_LABELS[layer]}
            </button>
          ))}
        </div>
        {note.layer === 'desktop' && <p>只在桌面露出时可见；显示桌面、最小化全部窗口都不会收起它。</p>}
      </section>

      <section>
        <label className="note-menu__switch">
          <input
            type="checkbox"
            checked={Boolean(todo)}
            onChange={(event) => onPatch({ todo: event.target.checked ? createTodo({ text: note.title }) : null })}
          />
          <span>设为待办</span>
        </label>
        {todo && (
          <div className="note-menu__todo">
            <div className="note-menu__segmented">
              <button type="button" data-selected={todo.dueAt === undefined} onClick={() => setTodo({ dueAt: undefined })}>无日期</button>
              <button type="button" onClick={() => setTodo({ dueAt: createDueAt('today') })}>今晚</button>
              <button type="button" onClick={() => setTodo({ dueAt: createDueAt('tomorrow') })}>明晚</button>
            </div>
            <input
              type="datetime-local"
              aria-label="截止时间"
              value={toLocalInput(todo.dueAt)}
              onChange={(event) => {
                const value = event.target.value ? new Date(event.target.value).getTime() : undefined
                setTodo({ dueAt: Number.isFinite(value) ? value : undefined })
              }}
            />
            <div className="note-menu__chips">
              {TODO_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  data-category={category}
                  data-selected={todo.category === category}
                  onClick={() => setTodo({ category })}
                >
                  <i />{TODO_CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>
            <div className="note-menu__row">
              <label><input type="checkbox" checked={todo.priority === 'high'} onChange={(event) => setTodo({ priority: event.target.checked ? 'high' : 'normal' })} />重要</label>
              <label><input type="checkbox" checked={todo.remind} onChange={(event) => setTodo({ remind: event.target.checked })} />到期提醒</label>
            </div>
          </div>
        )}
      </section>

      <section>
        <small>文字</small>
        <div className="note-menu__row">
          <select value={note.fontFamily} aria-label="字体" onChange={(event) => onPatch({ fontFamily: event.target.value as NoteRecord['fontFamily'] })}>
            {FONT_FAMILIES.map((family) => <option key={family} value={family}>{FONT_FAMILY_LABELS[family]}</option>)}
          </select>
          <button type="button" aria-label="减小字号" disabled={note.fontSize <= MIN_FONT_SIZE} onClick={() => onPatch({ fontSize: note.fontSize - 1 })}>A−</button>
          <span className="note-menu__value">{note.fontSize}</span>
          <button type="button" aria-label="增大字号" disabled={note.fontSize >= MAX_FONT_SIZE} onClick={() => onPatch({ fontSize: note.fontSize + 1 })}>A＋</button>
        </div>
      </section>

      <section>
        <small>倾斜</small>
        <div className="note-menu__row">
          <input
            type="range"
            min={-ROTATION_LIMIT}
            max={ROTATION_LIMIT}
            step={0.5}
            value={note.rotation}
            aria-label="倾斜角度"
            onChange={(event) => onPatch({ rotation: Number(event.target.value) })}
          />
          <button type="button" onClick={() => onPatch({ rotation: 0 })}>摆正</button>
        </div>
      </section>

      <section className="note-menu__actions">
        <button type="button" onClick={() => window.lavaNote.openManager()}><LayoutList size={14} />便签管理</button>
        <button type="button" onClick={() => window.lavaNote.hide()}><EyeOff size={14} />先收起</button>
        {confirmDelete ? (
          <button type="button" className="note-menu__danger" onClick={() => window.lavaNote.remove()}><Trash2 size={14} />确认删除</button>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)}><Trash2 size={14} />删除</button>
        )}
      </section>
    </div>
  )
}
