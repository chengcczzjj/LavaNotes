import { useEffect, useRef, type RefObject } from 'react'
import { ArchiveX, LayoutList, Trash2 } from 'lucide-react'
import type { NotePatch, NoteRecord } from '@shared/types'
import { NOTE_COLORS, NOTE_COLOR_LABELS } from '@shared/note-model'

interface NoteMenuProps {
  note: NoteRecord
  anchor: RefObject<HTMLButtonElement | null>
  onPatch(patch: NotePatch): void
  onClose(): void
}

export function NoteMenu({ note, anchor, onPatch, onClose }: NoteMenuProps) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [anchor, onClose])

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

      <section className="note-menu__actions">
        <button type="button" onClick={() => window.lavaNote.openManager('notes')}><LayoutList size={14} />便签管理</button>
        <button
          type="button"
          className="note-menu__abandon"
          title="不做了：揉掉收起，内容保留（便签管理里筛选“已废弃”可以找到），也计入统计"
          onClick={() => window.lavaNote.abandon()}
        >
          <ArchiveX size={14} />废弃
        </button>
        <button type="button" className="note-menu__danger" title="永久删除，不留记录" onClick={() => window.lavaNote.remove()}><Trash2 size={14} />删除</button>
      </section>
    </div>
  )
}
