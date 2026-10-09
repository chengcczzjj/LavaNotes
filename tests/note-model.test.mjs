import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ROTATION_LIMIT,
  ROTATION_SEQUENCE,
  applyNotePatch,
  createNoteId,
  createNoteRecord,
  displayTitle,
  emptyDoc,
  isInProgress,
  normalizeDoc,
  normalizeNoteList,
  normalizeNoteRecord,
  normalizeSettings,
  noteState,
  summarizeDoc,
  toggleTaskDoing,
} from '../src/shared/note-model.ts'

const bounds = { x: 100, y: 120, width: 240, height: 220 }

test('a new note is visible, in an ordinary window, with a clear tilt from the sequence', () => {
  const note = createNoteRecord({ id: 'n-test-001', bounds, now: 1000 })
  assert.equal(note.visible, true)
  assert.equal(note.layer, 'normal')
  assert.equal(note.rotation, ROTATION_SEQUENCE[0])
  for (const [index, rotation] of ROTATION_SEQUENCE.entries()) {
    assert.ok(Math.abs(rotation) >= 1.5 && Math.abs(rotation) <= ROTATION_LIMIT, `tilt ${rotation}`)
    if (index > 0) assert.equal(Math.sign(rotation), -Math.sign(ROTATION_SEQUENCE[index - 1]), 'tilts alternate')
  }
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
  const note = normalizeNoteRecord({ id: 'n-arch-001', bounds, visible: true, archivedAt: 5 })
  assert.equal(note.visible, false)
})

test('to-do fields and paper styles from older versions are dropped on load', () => {
  const note = normalizeNoteRecord({
    id: 'n-old-0001',
    bounds,
    paperStyle: 'pin',
    todo: { done: false, dueAt: 5, category: 'work', priority: 'high', remind: true },
  })
  assert.equal('todo' in note, false)
  assert.equal('paperStyle' in note, false)
  assert.equal(note.visible, true)
  const patched = applyNotePatch(note, { color: 'mint', todo: { done: true }, paperStyle: 'plain' }, 2000)
  assert.equal(patched.color, 'mint')
  assert.equal('todo' in patched, false)
  assert.equal('paperStyle' in patched, false)
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

test('settings default to launching at login with ordinary windows', () => {
  assert.deepEqual(normalizeSettings(undefined), { launchAtLogin: true, defaultLayer: 'normal' })
  assert.equal(normalizeSettings({ defaultLayer: 'desktop' }).defaultLayer, 'desktop')
  assert.equal(normalizeSettings({ defaultLayer: 'x' }).defaultLayer, 'normal')
})

test('abandoned notes load hidden; a file claiming both outcomes keeps the earlier one', () => {
  const abandoned = normalizeNoteRecord({ id: 'n-drop-001', bounds, visible: true, abandonedAt: 500 })
  assert.equal(abandoned.visible, false)
  assert.equal(abandoned.abandonedAt, 500)
  const both = normalizeNoteRecord({ id: 'n-both-001', bounds, archivedAt: 900, abandonedAt: 400 })
  assert.equal(both.abandonedAt, 400)
  assert.equal(both.archivedAt, undefined)
  const tornFirst = normalizeNoteRecord({ id: 'n-both-002', bounds, archivedAt: 300, abandonedAt: 400 })
  assert.equal(tornFirst.archivedAt, 300)
  assert.equal(tornFirst.abandonedAt, undefined)
  assert.equal(noteState(tornFirst), 'completed')
  assert.equal(noteState(both), 'abandoned')
  assert.equal(noteState(normalizeNoteRecord({ id: 'n-live-001', bounds })), 'active')
})

test('a note on the desk can be marked in progress; starting again keeps the first start', () => {
  const note = createNoteRecord({ id: 'n-doing-001', bounds, now: 1000 })
  assert.equal(isInProgress(note), false)
  const started = applyNotePatch(note, { inProgress: true }, 2000)
  assert.equal(started.startedAt, 2000)
  assert.equal(isInProgress(started), true)
  assert.equal(applyNotePatch(started, { inProgress: true }, 3000).startedAt, 2000)
  const stopped = applyNotePatch(started, { inProgress: false }, 4000)
  assert.equal(stopped.startedAt, undefined)
  assert.equal('startedAt' in stopped, false)
  assert.equal(normalizeNoteRecord({ ...started }).startedAt, 2000, 'the start time is stored')
})

test('a torn-off note keeps its start time but is no longer in progress, and cannot be started', () => {
  const note = { ...createNoteRecord({ id: 'n-doing-002', bounds, now: 1000 }), startedAt: 1500 }
  const torn = normalizeNoteRecord({ ...note, archivedAt: 2000 })
  assert.equal(torn.startedAt, 1500)
  assert.equal(isInProgress(torn), false)
  const fresh = normalizeNoteRecord({ id: 'n-doing-003', bounds, archivedAt: 2000 })
  assert.equal(applyNotePatch(fresh, { inProgress: true }, 3000).startedAt, undefined)
})

test('right click on a checklist box: to do and in progress swap, done goes back to in progress', () => {
  const todo = { checked: false, tid: 'a', createdAt: 100, checkedAt: null, startedAt: null }
  const doing = toggleTaskDoing(todo, 200)
  assert.equal(doing.startedAt, 200)
  assert.equal(doing.tid, 'a', 'other attributes stay')
  assert.equal(toggleTaskDoing(doing, 300).startedAt, null)
  const done = { ...doing, checked: true, checkedAt: 400 }
  assert.deepEqual(toggleTaskDoing(done, 500), { ...done, checked: false, checkedAt: null, startedAt: 200 })
  assert.equal(toggleTaskDoing({ checked: true, checkedAt: 400 }, 500).startedAt, 500)
})
