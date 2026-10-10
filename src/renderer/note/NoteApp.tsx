import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Ellipsis, Layers, Pin, Plus } from 'lucide-react'
import type { LeaveKind, NoteInit, NotePatch, NoteRecord } from '@shared/types'
import { NOTE_MAX_HEIGHT, NOTE_MAX_WIDTH, NOTE_MIN_HEIGHT, NOTE_MIN_WIDTH, formatStart, isInProgress } from '@shared/note-model'
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
 * The in-progress mark, shared with checklist items: a ring with a play
 * triangle that turns into a slowly breathing dot with an arc orbiting it.
 * Only transforms and opacity animate, so the compositor does the work.
 */
function DoingGlyph({ active }: { active: boolean }) {
  return (
    <span className="doing-glyph" data-active={active} aria-hidden>
      <span className="doing-glyph__orbit" />
      <span className="doing-glyph__play" />
      <span className="doing-glyph__dot" />
    </span>
  )
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
  const [leaving, setLeaving] = useState<LeaveKind | null>(null)
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [isDragging, setDragging] = useState(false)
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
    const offTear = window.lavaNote.onPlayTear((kind) => {
      editorRef.current?.flush()
      setMenuOpen(false)
      setLeaving(kind === 'crumple' ? 'crumple' : 'tear')
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
        setDragging(true)
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
      if (dragging) {
        window.lavaNote.dragEnd()
        setDragging(false)
      }
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
  const style = {
    left: margin,
    top: margin,
    width: size.width,
    height: size.height,
    '--note-rotation': `${note.rotation}deg`,
    '--note-font-size': `${note.fontSize}px`,
    '--note-font-family': FONT_FAMILY_CSS[note.fontFamily],
  } as CSSProperties

  const short = size.height < 170
  const doing = isInProgress(note)
  // Work often spans days, so the bar shows when it started rather than a running clock.
  const started = doing && note.startedAt !== undefined ? formatStart(note.startedAt, true) : ''

  return (
    <div className="note-stage">
      <section
        className="note"
        data-hit
        data-color={note.color}
        data-tearing={leaving === 'tear'}
        data-leaving={leaving ?? undefined}
        data-editing={editing}
        data-short={short}
        data-doing={doing}
        data-dragging={isDragging || undefined}
        style={style}
        onPointerDownCapture={() => window.lavaNote.activated()}
        aria-label="便签"
      >
        <div className="note__glow" aria-hidden />
        <div className="note__mount" onPointerDown={onDragPointerDown} aria-hidden />
        <div className="note__paper">
          <div className="note__grain" aria-hidden />
          <div className="note__tear-edge" aria-hidden />
          <div className="note__crease" aria-hidden />
          <div className="note__doing-wash" aria-hidden />
          <header className="note__topbar" onPointerDown={onDragPointerDown}>
            <button type="button" className="note__icon" title="新建便签 Ctrl+N" aria-label="新建便签" onClick={() => window.lavaNote.newNote()}>
              <Plus size={16} strokeWidth={1.9} />
            </button>
            {doing && size.width >= 220 && (
              <span className="note__doing-label" title={`${started} 开始`}>
                进行中{size.width >= 250 && <span> · {size.width >= 300 ? started : formatStart(note.startedAt!, false)} 起</span>}
              </span>
            )}
            <span className="note__spacer" />
            {note.layer === 'desktop' && <span className="note__icon note__icon--badge" title="钉在桌面"><Pin size={13} /></span>}
            {note.layer === 'top' && <span className="note__icon note__icon--badge" title="置顶"><Layers size={13} /></span>}
            <button
              type="button"
              className="note__icon note__icon--doing"
              title={doing ? `进行中，${started} 开始。点一下取消` : '开始做：标记为进行中'}
              aria-label={doing ? '取消进行中' : '标记为进行中'}
              aria-pressed={doing}
              disabled={leaving !== null}
              onClick={() => void patch({ inProgress: !doing })}
            >
              <DoingGlyph active={doing} />
            </button>
            <button
              type="button"
              className="note__icon note__icon--done"
              title="完成并撕下"
              aria-label="完成并撕下"
              disabled={leaving !== null}
              onClick={() => window.lavaNote.complete()}
            >
              <Check size={15} strokeWidth={2.4} />
            </button>
            <button
              ref={menuButton}
              type="button"
              className="note__icon"
              title="更多：纸色、便签管理、废弃、删除"
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
              anchor={menuButton}
              onPatch={patch}
              onClose={() => setMenuOpen(false)}
            />
          )}

          <div className="note__content">
            <NoteEditor
              ref={editorRef}
              doc={init.doc}
              times={init.note}
              onFocusChange={setEditing}
              onTooLarge={() => showToast('内容太多了，这次修改没有保存。可以拆成两张便签。')}
              onImageFailed={() => showToast('这张图片没能加入：只支持 PNG、JPG、GIF、WebP，且不超过 15MB。')}
              onNothingToTranslate={() => showToast('这张便签还没有可以翻译的文字。')}
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
