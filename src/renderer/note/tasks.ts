import { TaskItem } from '@tiptap/extension-list'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { NoteDoc, NoteDocNode } from '@shared/types'
import { toggleTaskDoing } from '@shared/note-model'

/**
 * Checklist items keep their own timeline for the statistics: an id, when the
 * item was added, when work on it started (right click: in progress) and when
 * it was checked. The attributes live in the note body, so they survive
 * restarts and undo/redo restores them together with the text.
 */

function newTaskId(): string {
  return `t${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 5).toString(36).padStart(5, '0')}`
}

function readTime(value: unknown): number | null {
  const time = typeof value === 'string' ? Number(value) : value
  return typeof time === 'number' && Number.isFinite(time) && time > 0 ? time : null
}

const taskTimesKey = new PluginKey('lavanote-task-times')
const taskDoingKey = new PluginKey('lavanote-task-doing')

export const TrackedTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // Not kept on split: pressing Enter starts a new item with its own timeline.
      tid: {
        default: null,
        keepOnSplit: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-tid'),
        renderHTML: (attributes: Record<string, unknown>) => (attributes.tid ? { 'data-tid': String(attributes.tid) } : {}),
      },
      createdAt: {
        default: null,
        keepOnSplit: false,
        parseHTML: (element: HTMLElement) => readTime(element.getAttribute('data-created-at')),
        renderHTML: (attributes: Record<string, unknown>) => (attributes.createdAt ? { 'data-created-at': String(attributes.createdAt) } : {}),
      },
      checkedAt: {
        default: null,
        keepOnSplit: false,
        parseHTML: (element: HTMLElement) => readTime(element.getAttribute('data-checked-at')),
        renderHTML: (attributes: Record<string, unknown>) => (attributes.checkedAt ? { 'data-checked-at': String(attributes.checkedAt) } : {}),
      },
      // When work on the item started. Unchecked with a start time = in progress;
      // kept when the item is checked, so unchecking it goes back to in progress.
      startedAt: {
        default: null,
        keepOnSplit: false,
        parseHTML: (element: HTMLElement) => readTime(element.getAttribute('data-started-at')),
        renderHTML: (attributes: Record<string, unknown>) => (attributes.startedAt ? { 'data-started-at': String(attributes.startedAt) } : {}),
      },
    }
  },

  addNodeView() {
    const parent = this.parent?.()
    if (!parent) return null
    return (props) => {
      const view = parent(props)
      ;(view.dom as HTMLElement).querySelector(':scope > label')?.setAttribute('title', '单击：完成　右键：进行中')
      return view
    }
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: taskDoingKey,
        props: {
          handleDOMEvents: {
            // Right click on the box: to do ⇄ in progress; a done item goes back to in progress.
            contextmenu: (view, event) => {
              const label = (event.target as HTMLElement | null)?.closest('label')
              const item = label?.parentElement
              if (!label || !item || item.parentElement?.getAttribute('data-type') !== 'taskList') return false
              event.preventDefault()
              const content = item.querySelector(':scope > div')
              if (!view.editable || !content) return true
              const $inside = view.state.doc.resolve(view.posAtDOM(content, 0))
              for (let depth = $inside.depth; depth > 0; depth -= 1) {
                const node = $inside.node(depth)
                if (node.type.name !== 'taskItem') continue
                view.dispatch(view.state.tr.setNodeMarkup($inside.before(depth), undefined, toggleTaskDoing(node.attrs, Date.now())))
                return true
              }
              return true
            },
          },
        },
      }),
      new Plugin({
        key: taskTimesKey,
        // Runs with every edit: new or duplicated items get a fresh id and creation
        // time, checking stamps the time, unchecking clears it.
        appendTransaction: (transactions, _oldState, state) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null
          const now = Date.now()
          const seen = new Set<string>()
          const transaction = state.tr
          let changed = false
          state.doc.descendants((node, position) => {
            if (node.type.name !== 'taskItem') return true
            const attrs = node.attrs
            let tid = typeof attrs.tid === 'string' && attrs.tid ? attrs.tid : null
            let createdAt = readTime(attrs.createdAt)
            if (!tid || seen.has(tid)) {
              tid = newTaskId()
              createdAt = now
            }
            seen.add(tid)
            createdAt ??= now
            let checkedAt = readTime(attrs.checkedAt)
            if (attrs.checked && checkedAt === null) checkedAt = now
            if (!attrs.checked) checkedAt = null
            if (tid !== attrs.tid || createdAt !== attrs.createdAt || checkedAt !== attrs.checkedAt) {
              transaction.setNodeMarkup(position, undefined, { ...attrs, tid, createdAt, checkedAt })
              changed = true
            }
            return true
          })
          return changed ? transaction : null
        },
      }),
    ]
  },
})

/**
 * Items saved before the timeline existed get the note's own times when the
 * body is loaded, so the first edit does not date them all "now".
 */
export function withTaskTimes(doc: NoteDoc, note: { createdAt: number; updatedAt: number }): NoteDoc {
  let touched = false
  const visit = (node: NoteDocNode): NoteDocNode => {
    let next = node
    if (node.type === 'taskItem') {
      const attrs = node.attrs ?? {}
      if (!attrs.tid || !readTime(attrs.createdAt)) {
        touched = true
        const createdAt = readTime(attrs.createdAt) ?? note.createdAt
        next = {
          ...node,
          attrs: {
            ...attrs,
            tid: typeof attrs.tid === 'string' && attrs.tid ? attrs.tid : newTaskId(),
            createdAt,
            checkedAt: attrs.checked === true ? readTime(attrs.checkedAt) ?? Math.max(createdAt, note.updatedAt) : null,
          },
        }
      }
    }
    if (next.content) {
      const content = next.content.map(visit)
      if (content.some((child, index) => child !== next.content![index])) next = { ...next, content }
    }
    return next
  }
  const result = visit(doc) as NoteDoc
  return touched ? result : doc
}
