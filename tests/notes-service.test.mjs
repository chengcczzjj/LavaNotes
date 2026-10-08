import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotesService } from '../src/main/notes-service.ts'
import { createTodo } from '../src/shared/note-model.ts'

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lavanotes-service-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const bounds = { x: 40, y: 50, width: 240, height: 220 }

test('notes, bodies and settings survive a restart', async (t) => {
  const dir = await tempDir(t)
  const first = new NotesService(dir)
  await first.load()
  const note = first.create({ bounds, text: '第一行\n第二行' })
  first.saveContent(note.id, {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '改过的标题' }] }],
  })
  first.patch(note.id, { color: 'sky', layer: 'desktop' })
  first.setSettings({ defaultLayer: 'top' })
  await first.flush()

  const second = new NotesService(dir)
  await second.load()
  const loaded = second.get(note.id)
  assert.equal(loaded.title, '改过的标题')
  assert.equal(loaded.color, 'sky')
  assert.equal(loaded.layer, 'desktop')
  assert.equal(second.settings.defaultLayer, 'top')
  const doc = await second.readContent(note.id)
  assert.equal(doc.content[0].content[0].text, '改过的标题')
})

test('the body is the only content: there is no second title to drift', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const note = service.create({ bounds, text: '旧内容' })
  const imageOnly = service.saveContent(note.id, {
    type: 'doc',
    content: [{ type: 'image', attrs: { src: `lavanote://asset/${'c'.repeat(64)}.png` } }],
  })
  assert.equal(imageOnly.title, '')
  assert.equal(imageOnly.imageCount, 1)
  const cleared = service.saveContent(note.id, { type: 'doc', content: [{ type: 'paragraph' }] })
  assert.equal(cleared.title, '')
  assert.equal(cleared.preview, '')
})

test('oversized bodies are refused instead of being truncated', async (t) => {
  const dir = await tempDir(t)
  const errors = []
  const service = new NotesService(dir, { onError: (scope) => errors.push(scope) })
  await service.load()
  const note = service.create({ bounds, text: 'keep me' })
  const huge = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(2_200_000) }] }] }
  assert.equal(service.saveContent(note.id, huge), null)
  assert.equal(service.get(note.id).title, 'keep me')
  assert.ok(errors.some((scope) => scope.startsWith('content-too-large')))
})

test('finishing a to-do tears it off into the archive and it can be restored', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const note = service.create({ bounds, text: '交周报', todo: createTodo({ text: '交周报' }) })
  service.markDone(note.id)
  assert.equal(service.get(note.id).todo.done, true)
  assert.equal(service.get(note.id).visible, true)
  service.archive(note.id)
  assert.equal(service.get(note.id).visible, false)
  assert.ok(service.get(note.id).archivedAt)
  assert.equal(service.setVisible(note.id, true).visible, false, 'archived notes stay hidden until reopened')
  service.reopen(note.id)
  assert.equal(service.get(note.id).visible, true)
  assert.equal(service.get(note.id).todo.done, false)
  assert.equal(service.get(note.id).archivedAt, undefined)
})

test('finishing a plain note makes it a finished to-do that can be restored', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const note = service.create({ bounds, text: '买菜' })
  const done = service.markDone(note.id)
  assert.equal(done.todo.done, true)
  assert.equal(done.todo.category, 'life')
  service.archive(note.id)
  assert.ok(service.get(note.id).archivedAt)
  assert.equal(service.get(note.id).visible, false)
  service.reopen(note.id)
  assert.equal(service.get(note.id).visible, true)
  assert.equal(service.get(note.id).todo.done, false)
})

test('new notes lean left and right in turn; a note made beside another leans the other way', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const signs = Array.from({ length: 6 }, () => Math.sign(service.create({ bounds }).rotation))
  assert.deepEqual(signs, [-1, 1, -1, 1, -1, 1])
  const left = service.create({ bounds })
  assert.ok(left.rotation < 0)
  // The next slot leans right; beside a right-leaning note it skips to a left one.
  assert.ok(service.create({ bounds, besideRotation: 2 }).rotation < 0)
  assert.ok(service.create({ bounds, besideRotation: -1.6 }).rotation > 0)
  await service.flush()

  const restarted = new NotesService(dir)
  await restarted.load()
  const next = restarted.create({ bounds }).rotation
  const after = restarted.create({ bounds }).rotation
  assert.equal(Math.sign(next), -Math.sign(after), 'the alternation carries on after a restart')
})

test('unfinished notes are not archived and clearing the archive deletes files', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const plain = service.create({ bounds, text: 'plain' })
  assert.equal(service.archive(plain.id).archivedAt, undefined)
  const todo = service.create({ bounds, text: 'todo', todo: createTodo() })
  service.markDone(todo.id)
  service.archive(todo.id)
  await service.flush()
  await stat(join(dir, 'notes', `${todo.id}.json`))
  assert.equal(await service.clearArchived(), 1)
  await service.flush()
  await assert.rejects(stat(join(dir, 'notes', `${todo.id}.json`)))
  const index = JSON.parse(await readFile(join(dir, 'notes-index.json'), 'utf8'))
  assert.deepEqual(index.notes.map((item) => item.id), [plain.id])
})

test('change events tell windows what to refresh, bounds updates stay silent', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const events = []
  service.on('change', (kind, note, meta) => events.push([kind, note.id, meta?.silent === true]))
  const note = service.create({ bounds })
  service.setBounds(note.id, { ...bounds, x: 400 })
  service.patch(note.id, { color: 'rose' })
  assert.deepEqual(events, [['created', note.id, false], ['updated', note.id, true], ['updated', note.id, false]])
})
