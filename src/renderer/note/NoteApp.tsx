import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Clock3, Ellipsis, Layers, Pin, Plus } from 'lucide-react'
import type { NoteInit, NotePatch, NoteRecord } from '@shared/types'
import { NOTE_MAX_HEIGHT, NOTE_MAX_WIDTH, NOTE_MIN_HEIGHT, NOTE_MIN_WIDTH, TODO_CATEGORY_LABELS, formatDueLabel, isTodoOverdue } from '@shared/note-model'
import { getWindowMargin } from '@shared/geometry'
import { NoteEditor, type NoteEditorHandle } from './NoteEditor'
import { NoteMenu } from './NoteMenu'

const TEAR_DURATION_MS = 540
const DRAG_THRESHOLD = 3

const FONT_FAMILY_CSS: Record<NoteRecord['fontFamily'], string> = {
  system: 'system-ui, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", "SimSun", serif',
  mono: '"Cascadia Code", Consolas, "Microsoft YaHei UI", monospace',
  handwritten: '"Segoe Print", "Comic Sans MS", "KaiTi", cursive',
}

/**
 * Clicks on the transparent margin around the paper must reach whatever is
 * behind the note. The main process watches the cursor and asks the page
 * whether the paper, or a menu on it, is under that point.
 */
function useHitTest(busy: React.MutableRefObject<boolean>): void {
  useEffect(() => window.lavaNote.onHitTest((seq, x, y) => {
    const element = document.elementFromPoint(x, y)
    window.lavaNote.hitResult(seq, busy.current || Boolean(element?.closest('[data-hit]')))
  }), [busy])
}

export function NoteApp({ init }: { init: NoteInit }) {
  const [note, setNote] = useState<NoteRecord>(init.note)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [tearing, setTearing] = useState(false)
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const editorRef = useRef<NoteEditorHandle>(null)
  const busy = useRef(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const toastTimer = useRef<number | null>(null)

  useHitTest(busy)

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  const patch = useCallback(async (change: NotePatch) => {
    const next = await window.lavaNote.patch(change)
    if (next) setNote(next)
  }, [])

  useEffect(() => {
    const offUpdated = window.lavaNote.onUpdated((next) => setNote(next))
    const offTear = window.lavaNote.onPlayTear(() => {
      editorRef.current?.flush()
      setMenuOpen(false)
      setTearing(true)
      window.setTimeout(() => window.lavaNote.tearFinished(), TEAR_DURATION_MS)
    })
    const offFocus = window.lavaNote.onFocusEditor(() => editorRef.current?.focus())
    const offFlush = window.lavaNote.onFlushRequest(() => {
      editorRef.current?.flush()
      window.lavaNote.flushed()
    })
    if (init.focusEditor) window.requestAnimationFrame(() => editorRef.current?.focus())
    return () => {
      offUpdated()
      offTear()
      offFocus()
      offFlush()
    }
  }, [init.focusEditor])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        window.lavaNote.newNote()
      } else if (event.key === 'Escape') {
        if (menuOpen) setMenuOpen(false)
        else (document.activeElement as HTMLElement | null)?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  // ---- moving the window from the top bar, tape or paper edge ----
  const onDragPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select, textarea, a')) return
    const target = event.currentTarget
    const start = { x: event.screenX, y: event.screenY }
    let dragging = false
    let frame: number | null = null
    target.setPointerCapture(event.pointerId)
    busy.current = true
    const move = (moveEvent: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(moveEvent.screenX - start.x, moveEvent.screenY - start.y) < DRAG_THRESHOLD) return
        dragging = true
        window.lavaNote.dragStart()
      }
      if (frame === null) {
        frame = window.requestAnimationFrame(() => {
          frame = null
          window.lavaNote.dragMove()
        })
      }
    }
    const end = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
      if (frame !== null) window.cancelAnimationFrame(frame)
      if (dragging) window.lavaNote.dragEnd()
      busy.current = false
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  // ---- resizing from the folded bottom-right corner ----
  const onResizePointerDown = async (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    busy.current = true
    const start = { x: event.screenX, y: event.screenY, width: note.bounds.width, height: note.bounds.height }
    let latest = { width: start.width, height: start.height }
    let ended = false
    const sessionPromise = window.lavaNote.resizeBegin()
    const move = (moveEvent: PointerEvent) => {
      latest = {
        width: Math.round(Math.min(NOTE_MAX_WIDTH, Math.max(NOTE_MIN_WIDTH, start.width + moveEvent.screenX - start.x))),
        height: Math.round(Math.min(NOTE_MAX_HEIGHT, Math.max(NOTE_MIN_HEIGHT, start.height + moveEvent.screenY - start.y))),
      }
      setLiveSize(latest)
    }
    const end = async () => {
      if (ended) return
      ended = true
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
      await sessionPromise
      const next = await window.lavaNote.resizeEnd(latest)
      if (next) setNote(next)
      setLiveSize(null)
      busy.current = false
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  const margin = getWindowMargin(note.rotation)
  const size = liveSize ?? { width: note.bounds.width, height: note.bounds.height }
  const todo = note.todo
  const overdue = isTodoOverdue(todo)
  const style = {
    left: margin,
    top: margin,
    width: size.width,
    height: size.height,
    '--note-rotation': `${note.rotation}deg`,
    '--note-font-size': `${note.fontSize}px`,
    '--note-font-family': FONT_FAMILY_CSS[note.fontFamily],
  } as CSSProperties

  const compact = size.width < 210
  const short = size.height < 170

  return (
    <div className="note-stage">
      <section
        className="note"
        data-hit
        data-color={note.color}
        data-paper={note.paperStyle}
        data-tearing={tearing}
        data-editing={editing}
        data-compact={compact}
        data-short={short}
        style={style}
        onPointerDownCapture={() => window.lavaNote.activated()}
        aria-label="便签"
      >
        <div className="note__mount" onPointerDown={onDragPointerDown} aria-hidden>
          {note.paperStyle === 'pin' && <i />}
        </div>
        <div className="note__paper">
          <div className="note__grain" aria-hidden />
          <div className="note__tear-edge" aria-hidden />
          <header className="note__topbar" onPointerDown={onDragPointerDown}>
            <button type="button" className="note__icon" title="新建便签 Ctrl+N" aria-label="新建便签" onClick={() => window.lavaNote.newNote()}>
              <Plus size={16} strokeWidth={1.9} />
            </button>
            <div className="note__status">
              {todo ? (
                <>
                  <span className="note__chip" data-category={todo.category}><i />{TODO_CATEGORY_LABELS[todo.category]}</span>
                  {todo.dueAt !== undefined && !short && (
                    <time className="note__chip" data-overdue={overdue}>
                      <Clock3 size={10} />
                      {overdue ? '已逾期' : formatDueLabel(todo.dueAt)}
                    </time>
                  )}
                  {todo.priority === 'high' && !compact && <b className="note__chip note__chip--high">重要</b>}
                </>
              ) : null}
            </div>
            {note.layer === 'desktop' && <span className="note__icon note__icon--badge" title="已钉在桌面，可在 ⋯ → 窗口里取消"><Pin size={13} /></span>}
            {note.layer === 'top' && <span className="note__icon note__icon--badge" title="置顶"><Layers size={13} /></span>}
            <button
              type="button"
              className="note__icon note__icon--done"
              title="完成并撕下"
              aria-label="完成并撕下"
              disabled={tearing || todo?.done}
              onClick={() => window.lavaNote.complete()}
            >
              <Check size={15} strokeWidth={2.4} />
            </button>
            <button
              ref={menuButton}
              type="button"
              className="note__icon"
              title="更多：纸色、待办、窗口层级"
              aria-label="更多设置"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Ellipsis size={16} />
            </button>
          </header>

          {menuOpen && (
            <NoteMenu
              note={note}
              desktopPinSupported={init.desktopPinSupported}
              anchor={menuButton}
              onPatch={patch}
              onClose={() => setMenuOpen(false)}
            />
          )}

          <div className="note__content">
            <NoteEditor
              ref={editorRef}
              doc={init.doc}
              onFocusChange={setEditing}
              onTooLarge={() => showToast('内容太多了，这次修改没有保存。可以拆成两张便签。')}
              onImageFailed={() => showToast('这张图片没能加入：只支持 PNG、JPG、GIF、WebP，且不超过 15MB。')}
            />
          </div>

          {toast && <div className="note__toast" role="status">{toast}</div>}

          <div className="note__resize" title="拖动调整大小" onPointerDown={(event) => void onResizePointerDown(event)} aria-hidden />
          <div className="note__edge note__edge--left" onPointerDown={onDragPointerDown} aria-hidden />
          <div className="note__edge note__edge--right" onPointerDown={onDragPointerDown} aria-hidden />
        </div>
      </section>
    </div>
  )
}
