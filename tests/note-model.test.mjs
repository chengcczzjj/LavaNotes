import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyNotePatch,
  createDueAt,
  createNoteId,
  createNoteRecord,
  createTodo,
  displayTitle,
  emptyDoc,
  getDueReminders,
  getTodoBucket,
  inferTodoCategory,
  normalizeDoc,
  normalizeNoteList,
  normalizeNoteRecord,
  normalizeSettings,
  setTodoDone,
  summarizeDoc,
  summarizeWeek,
} from '../src/shared/note-model.ts'

const bounds = { x: 100, y: 120, width: 240, height: 220 }

test('a new note is a plain note: no to-do until the user asks for one', () => {
  const note = createNoteRecord({ id: 'n-test-001', bounds, now: 1000 })
  assert.equal(note.todo, undefined)
  assert.equal(note.visible, true)
  assert.equal(note.layer, 'normal')
  assert.ok(Math.abs(note.rotation) <= 4.5)
})

test('note ids are url-safe and accepted by the record validator', () => {
  const id = createNoteId(Date.now())
  assert.match(id, /^[A-Za-z0-9_-]{6,80}$/)
  assert.ok(normalizeNoteRecord({ id, bounds }))
  assert.equal(normalizeNoteRecord({ id: '../evil', bounds }), null)
})

test('stored records are clamped: size, tilt, font size and enums', () => {
  const note = normalizeNoteRecord({
    id: 'n-clamp-01',
    bounds: { x: 1.4, y: 2.6, width: 5000, height: 20 },
    rotation: 30,
    fontSize: 200,
    color: 'neon',
    layer: 'desktop',
  })
  assert.deepEqual(note.bounds, { x: 1, y: 3, width: 900, height: 130 })
  assert.equal(note.rotation, 4.5)
  assert.equal(note.fontSize, 36)
  assert.equal(note.color, 'butter')
  assert.equal(note.layer, 'desktop')
})

test('archived notes are never visible even if the file says so', () => {
  const note = normalizeNoteRecord({ id: 'n-arch-001', bounds, visible: true, archivedAt: 5, todo: { done: true } })
  assert.equal(note.visible, false)
})

test('note lists drop duplicates and invalid rows', () => {
  const notes = normalizeNoteList([
    { id: 'n-dup-0001', bounds },
    { id: 'n-dup-0001', bounds },
    { id: '', bounds },
    null,
    { id: 'n-ok-00002', bounds },
  ])
  assert.deepEqual(notes.map((note) => note.id), ['n-dup-0001', 'n-ok-00002'])
})

test('turning a note into a to-do and back keeps the content model separate', () => {
  const note = createNoteRecord({ id: 'n-todo-001', bounds, now: 1000 })
  const todo = applyNotePatch(note, { todo: createTodo({ text: '明天交周报', dueAt: 5000 }) }, 2000)
  assert.equal(todo.todo.category, 'work')
  assert.equal(todo.todo.done, false)
  const plain = applyNotePatch({ ...todo, archivedAt: 3000 }, { todo: null }, 4000)
  assert.equal(plain.todo, undefined)
  assert.equal(plain.archivedAt, undefined)
})

test('changing a due time re-arms its reminder', () => {
  const note = createNoteRecord({ id: 'n-remind1', bounds, todo: { ...createTodo({ dueAt: 1000 }), remindedFor: 1000 } })
  const moved = applyNotePatch(note, { todo: { ...note.todo, dueAt: 9000 } })
  assert.equal(moved.todo.remindedFor, undefined)
  assert.deepEqual(getDueReminders([moved], 10_000).map((item) => item.id), ['n-remind1'])
  assert.deepEqual(getDueReminders([note], 10_000), [])
})

test('category inference keeps the useful keyword rules', () => {
  assert.equal(inferTodoCategory('下午三点项目会议'), 'work')
  assert.equal(inferTodoCategory('背单词'), 'study')
  assert.equal(inferTodoCategory('晚上跑步'), 'health')
  assert.equal(inferTodoCategory('买菜'), 'life')
  assert.equal(inferTodoCategory('随便写点'), 'other')
})

test('doc summary: title, preview, images and tables come from the body only', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: '  购物  清单 ' }] },
      { type: 'image', attrs: { src: `lavanote://asset/${'a'.repeat(64)}.png` } },
      { type: 'image', attrs: { src: 'https://tracker.example/x.png' } },
      {
        type: 'table',
        content: [{
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '牛奶' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
          ],
        }],
      },
    ],
  }
  const summary = summarizeDoc(doc)
  assert.equal(summary.title, '购物 清单')
  assert.equal(summary.imageCount, 2)
  assert.deepEqual(summary.assetFiles, [`${'a'.repeat(64)}.png`])
  assert.equal(summary.tableCount, 1)
  assert.match(summary.preview, /牛奶/)
})

test('an image-only note is still a valid note with a readable title', () => {
  const summary = summarizeDoc({ type: 'doc', content: [{ type: 'image', attrs: { src: `lavanote://asset/${'b'.repeat(64)}.webp` } }] })
  assert.equal(summary.title, '')
  assert.equal(displayTitle({ title: summary.title, imageCount: summary.imageCount }), '图片便签')
})

test('docs from disk are normalized and plain text becomes paragraphs', () => {
  assert.deepEqual(normalizeDoc(null), emptyDoc())
  assert.equal(emptyDoc('a\nb').content.length, 2)
  assert.equal(normalizeDoc({ type: 'doc', content: [1, { type: 'paragraph' }] }).content.length, 1)
})

test('to-do buckets and the weekly review only count to-do notes', () => {
  const now = new Date(2026, 9, 7, 12).getTime()
  const overdue = createTodo({ dueAt: now - 60_000 })
  const today = createTodo({ dueAt: createDueAt('today', now) })
  const tomorrow = createTodo({ dueAt: createDueAt('tomorrow', now) })
  assert.equal(getTodoBucket(overdue, now), 'overdue')
  assert.equal(getTodoBucket(today, now), 'today')
  assert.equal(getTodoBucket(tomorrow, now), 'upcoming')
  assert.equal(getTodoBucket(createTodo(), now), 'undated')

  const done = createNoteRecord({ id: 'n-week-001', bounds, now, todo: setTodoDone(createTodo(), true, now) })
  const open = createNoteRecord({ id: 'n-week-002', bounds, now, todo: createTodo() })
  const plain = createNoteRecord({ id: 'n-week-003', bounds, now })
  const summary = summarizeWeek([done, open, plain], now)
  assert.equal(summary.completed.length, 1)
  assert.equal(summary.unfinished.length, 1)
  assert.equal(summary.plannedCount, 2)
  assert.equal(summary.completionRate, 50)
})

test('settings default to launching at login with ordinary windows', () => {
  assert.deepEqual(normalizeSettings(undefined), { launchAtLogin: true, defaultLayer: 'normal' })
  assert.equal(normalizeSettings({ defaultLayer: 'desktop' }).defaultLayer, 'desktop')
  assert.equal(normalizeSettings({ defaultLayer: 'x' }).defaultLayer, 'normal')
})
