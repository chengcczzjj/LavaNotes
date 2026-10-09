import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import {
  Bold,
  ChevronUp,
  Columns3,
  ImagePlus,
  Italic,
  Languages,
  List,
  ListChecks,
  ListOrdered,
  Rows3,
  Strikethrough,
  Table2,
  Trash2,
  Type,
  Underline as UnderlineIcon,
} from 'lucide-react'
import type { NoteDoc, NoteDocNode } from '@shared/types'
import {
  applyTranslations,
  docSegments,
  joinTranslatedLines,
  stripTaskTracking,
  textSegments,
  type TranslateSegment,
} from '@shared/translate'
import { isSupportedImage, prepareImageBytes } from '../common/image'
import { TrackedTaskItem, withTaskTimes } from './tasks'
import { TranslatePanel, type TranslateSource } from './TranslatePanel'

/** The note body as saved; larger bodies are refused by the main process too. */
const MAX_DOC_BYTES = 2 * 1024 * 1024
const SAVE_DELAY_MS = 400

export interface NoteEditorHandle {
  focus(): void
  /** Send pending changes now. */
  flush(): void
  insertImages(files: File[]): void
}

interface NoteEditorProps {
  doc: NoteDoc
  /** The note's own times, for checklist items saved before they had a timeline. */
  times: { createdAt: number; updatedAt: number }
  onFocusChange(focused: boolean): void
  onTooLarge(): void
  onImageFailed(): void
  onNothingToTranslate(): void
}

/** Only images stored by LavaNotes are accepted, so pasted web pages cannot load remote pictures. */
const NoteImage = Image.extend({
  parseHTML() {
    return [{ tag: 'img[src^="lavanote://asset/"]' }]
  },
}).configure({
  allowBase64: false,
  resize: {
    enabled: true,
    directions: ['bottom-right', 'bottom-left', 'top-right', 'top-left'],
    minWidth: 40,
    minHeight: 30,
    alwaysPreserveAspectRatio: true,
  },
})

function imagesFrom(list: FileList | null | undefined): File[] {
  return list ? Array.from(list).filter(isSupportedImage) : []
}

/** What a running translation was made from, so its result can be put back in the same place. */
type TranslateJob = TranslateSource & {
  key: number
} & (
  | { mode: 'doc'; snapshot: NoteDoc; snapshotJson: string; blocks: TranslateSegment[] }
  | { mode: 'selection'; from: number; to: number; text: string }
)

function paragraphsOf(text: string): NoteDocNode[] {
  return text.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
}

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { doc, times, onFocusChange, onTooLarge, onImageFailed, onNothingToTranslate },
  ref,
) {
  const saveTimer = useRef<number | null>(null)
  const dirty = useRef(false)
  const editorRef = useRef<Editor | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const [focused, setFocused] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [job, setJob] = useState<TranslateJob | null>(null)
  const [initialDoc] = useState(() => withTaskTimes(doc, times))

  const save = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const editor = editorRef.current
    if (!editor || !dirty.current) return
    const json = editor.getJSON() as NoteDoc
    if (new TextEncoder().encode(JSON.stringify(json)).length > MAX_DOC_BYTES) {
      onTooLarge()
      return
    }
    dirty.current = false
    window.lavaNote.saveContent(json)
  }, [onTooLarge])

  const insertImages = useCallback(async (files: File[], position?: number) => {
    const editor = editorRef.current
    if (!editor) return
    let at = position
    for (const file of files) {
      const bytes = await prepareImageBytes(file).catch(() => null)
      const src = bytes ? await window.lavaNote.storeImage(bytes) : null
      if (!src) {
        onImageFailed()
        continue
      }
      const chain = editor.chain().focus()
      if (at !== undefined) {
        chain.insertContentAt(at, { type: 'image', attrs: { src } }).run()
        at = undefined
      } else {
        chain.setImage({ src }).run()
      }
    }
  }, [onImageFailed])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
        codeBlock: false,
      }),
      NoteImage,
      TableKit.configure({ table: { resizable: true, cellMinWidth: 36 } }),
      TaskList,
      TrackedTaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: '写点什么…' }),
    ],
    content: initialDoc,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'note-editor', spellcheck: 'false' },
      handlePaste: (_view, event) => {
        const files = imagesFrom(event.clipboardData?.files)
        if (files.length === 0) return false
        event.preventDefault()
        void insertImages(files)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = imagesFrom(event.dataTransfer?.files)
        if (files.length === 0) return false
        event.preventDefault()
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void insertImages(files, position)
        return true
      },
      handleClick: (_view, _pos, event) => {
        const anchor = (event.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null
        if (anchor && (event.ctrlKey || event.metaKey)) {
          window.lavaNote.openExternal(anchor.href)
          return true
        }
        return false
      },
    },
    onUpdate: () => {
      dirty.current = true
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(save, SAVE_DELAY_MS)
    },
    // Moving the caret in the text closes the secondary menu.
    onSelectionUpdate: () => setMoreOpen(false),
    onFocus: () => {
      setFocused(true)
      onFocusChange(true)
    },
    onBlur: ({ event }) => {
      // Clicking the toolbar keeps the editing session.
      const next = event.relatedTarget as HTMLElement | null
      if (next?.closest('.note-toolbar, .note-translate')) return
      setFocused(false)
      setMoreOpen(false)
      onFocusChange(false)
      save()
    },
  })
  editorRef.current = editor

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus('end'),
    flush: save,
    insertImages: (files) => void insertImages(files),
  }), [editor, insertImages, save])

  useEffect(() => {
    const flushOnHide = () => save()
    window.addEventListener('blur', flushOnHide)
    window.addEventListener('pagehide', flushOnHide)
    return () => {
      window.removeEventListener('blur', flushOnHide)
      window.removeEventListener('pagehide', flushOnHide)
    }
  }, [save])

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      underline: current?.isActive('underline') ?? false,
      strike: current?.isActive('strike') ?? false,
      bullet: current?.isActive('bulletList') ?? false,
      ordered: current?.isActive('orderedList') ?? false,
      task: current?.isActive('taskList') ?? false,
      inTable: current?.isActive('table') ?? false,
      selection: current ? !current.state.selection.empty : false,
    }),
  })

  const run = (action: (editor: Editor) => void) => (event: React.MouseEvent) => {
    event.preventDefault()
    if (editor) action(editor)
  }

  // ---- translation: the selection if there is one, otherwise the whole note ----

  const startTranslate = () => {
    setMoreOpen(false)
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    const key = Date.now()
    if (!empty) {
      const text = editor.state.doc.textBetween(from, to, '\n', ' ')
      const segments = textSegments(text)
      if (segments.length > 0) {
        setJob({ key, mode: 'selection', segments, from, to, text })
        return
      }
    }
    save()
    const snapshot = editor.getJSON() as NoteDoc
    const blocks = docSegments(snapshot)
    if (blocks.length === 0) {
      onNothingToTranslate()
      return
    }
    setJob({
      key,
      mode: 'doc',
      segments: blocks.map((block) => ({ index: block.index, text: block.text })),
      snapshot,
      snapshotJson: JSON.stringify(snapshot),
      blocks,
    })
  }

  const translatedText = (translations: ReadonlyMap<number, string>): string => {
    if (!job) return ''
    if (job.mode === 'selection') return joinTranslatedLines(job.text, translations)
    return job.segments.map((segment) => translations.get(segment.index) ?? segment.text).join('\n')
  }

  const applyTranslation = (action: 'replace' | 'insert', translations: ReadonlyMap<number, string>): string | null => {
    if (!editor || !job) return null
    if (job.mode === 'doc') {
      const translated = applyTranslations(job.snapshot, job.blocks, translations)
      if (action === 'replace') {
        if (JSON.stringify(editor.getJSON()) !== job.snapshotJson) return '便签在翻译后改动过，请关闭后重新翻译。'
        editor.chain().focus().setContent(translated, { emitUpdate: true }).run()
      } else {
        const nodes = [{ type: 'horizontalRule' }, ...stripTaskTracking(translated.content ?? [])]
        editor.chain().focus().insertContentAt(editor.state.doc.content.size, nodes).run()
      }
    } else {
      const text = joinTranslatedLines(job.text, translations)
      const size = editor.state.doc.content.size
      const current = job.to <= size ? editor.state.doc.textBetween(job.from, job.to, '\n', ' ') : ''
      if (action === 'replace') {
        if (current !== job.text) return '选中的文字已经改动，请重新选中后翻译。'
        // JSON, not a string: a string would be parsed as HTML and drop text like "<b>".
        const content = text.includes('\n') ? paragraphsOf(text) : { type: 'text', text }
        editor.chain().focus().insertContentAt({ from: job.from, to: job.to }, content).run()
      } else {
        const end = editor.state.doc.resolve(Math.min(job.to, size))
        const after = end.depth > 0 ? end.after(1) : size
        editor.chain().focus().insertContentAt(after, paragraphsOf(text)).run()
      }
    }
    setJob(null)
    return null
  }

  const moreLeft = moreButton.current ? moreButton.current.offsetLeft - (moreButton.current.parentElement?.scrollLeft ?? 0) : 0

  return (
    <>
      <EditorContent editor={editor} className="note-body" />
      {focused && editor && (
        <div className="note-toolbar" role="toolbar" aria-label="格式" onMouseDown={(event) => event.preventDefault()}>
          {state?.inTable && (
            <div className="note-toolbar__row note-toolbar__row--table">
              <button type="button" title="下方插入一行" onClick={run((e) => e.chain().focus().addRowAfter().run())}><Rows3 size={15} /><span>+行</span></button>
              <button type="button" title="右侧插入一列" onClick={run((e) => e.chain().focus().addColumnAfter().run())}><Columns3 size={15} /><span>+列</span></button>
              <button type="button" title="删除当前行" onClick={run((e) => e.chain().focus().deleteRow().run())}><span>−行</span></button>
              <button type="button" title="删除当前列" onClick={run((e) => e.chain().focus().deleteColumn().run())}><span>−列</span></button>
              <button type="button" title="切换表头" onClick={run((e) => e.chain().focus().toggleHeaderRow().run())}><span>表头</span></button>
              <button type="button" title="删除表格" onClick={run((e) => e.chain().focus().deleteTable().run())}><Trash2 size={15} /></button>
            </div>
          )}
          {moreOpen && (
            <div className="note-toolbar__more" role="menu" aria-label="更多格式与翻译" style={{ left: Math.max(4, moreLeft - 4) }}>
              <button type="button" role="menuitem" data-active={state?.italic} title="斜体 Ctrl+I" onClick={run((e) => e.chain().focus().toggleItalic().run())}>
                <Italic size={15} /><span>斜体</span><kbd>Ctrl I</kbd>
              </button>
              <button type="button" role="menuitem" data-active={state?.strike} title="删除线 Ctrl+Shift+S" onClick={run((e) => e.chain().focus().toggleStrike().run())}>
                <Strikethrough size={15} /><span>删除线</span>
              </button>
              <i aria-hidden />
              <button
                type="button"
                role="menuitem"
                className="note-toolbar__translate"
                title="有选中的文字就翻译选中，否则翻译整张便签"
                onClick={(event) => {
                  event.preventDefault()
                  startTranslate()
                }}
              >
                <Languages size={15} /><span>翻译</span><kbd>{state?.selection ? '选中' : '全文'}</kbd>
              </button>
            </div>
          )}
          <div className="note-toolbar__row">
            <button type="button" data-active={state?.bold} title="粗体 Ctrl+B" onClick={run((e) => e.chain().focus().toggleBold().run())}><Bold size={16} /></button>
            <button type="button" data-active={state?.underline} title="下划线 Ctrl+U" onClick={run((e) => e.chain().focus().toggleUnderline().run())}><UnderlineIcon size={16} /></button>
            <button
              ref={moreButton}
              type="button"
              className="note-toolbar__more-button"
              data-active={moreOpen || state?.italic || state?.strike}
              title="更多：斜体、删除线、翻译"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={(event) => {
                event.preventDefault()
                setMoreOpen((open) => !open)
              }}
            >
              <Type size={15} /><ChevronUp size={11} />
            </button>
            <i aria-hidden />
            <button type="button" data-active={state?.bullet} title="项目列表" onClick={run((e) => e.chain().focus().toggleBulletList().run())}><List size={16} /></button>
            <button type="button" data-active={state?.ordered} title="编号列表" onClick={run((e) => e.chain().focus().toggleOrderedList().run())}><ListOrdered size={16} /></button>
            <button type="button" data-active={state?.task} title="勾选清单（每一项的添加和勾选时间会单独统计）" onClick={run((e) => e.chain().focus().toggleTaskList().run())}><ListChecks size={16} /></button>
            <i aria-hidden />
            <button type="button" title="插入图片（也可以直接粘贴或拖进来）" onClick={run(() => imageInput.current?.click())}><ImagePlus size={16} /></button>
            <button
              type="button"
              title="插入 3×3 表格"
              onClick={run((e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
            >
              <Table2 size={16} />
            </button>
          </div>
        </div>
      )}
      {job && (
        <TranslatePanel
          key={job.key}
          source={job}
          plainText={translatedText}
          onApply={applyTranslation}
          onClose={() => setJob(null)}
        />
      )}
      {/* Outside the toolbar: the file dialog blurs the editor, which hides the toolbar. */}
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(event) => {
          const files = imagesFrom(event.currentTarget.files)
          event.currentTarget.value = ''
          if (files.length > 0) void insertImages(files)
        }}
      />
    </>
  )
})
