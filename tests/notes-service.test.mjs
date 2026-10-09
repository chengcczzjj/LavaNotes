import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotesService } from '../src/main/notes-service.ts'
import { ROTATION_SEQUENCE } from '../src/shared/note-model.ts'

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

test('a finished note is torn off into the archive and can be put back', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const note = service.create({ bounds, text: '交周报' })
  const archived = service.archive(note.id)
  assert.equal(archived.visible, false)
  assert.ok(archived.archivedAt)
  assert.equal(service.archive(note.id).archivedAt, archived.archivedAt, 'archiving twice keeps the first time')
  assert.equal(service.setVisible(note.id, true).visible, false, 'archived notes stay hidden until put back')
  service.reopen(note.id)
  assert.equal(service.get(note.id).visible, true)
  assert.equal(service.get(note.id).archivedAt, undefined)
  assert.equal(service.reopen(note.id).visible, true, 'putting back a note that is not archived changes nothing')
})

test('a note in progress keeps its start when torn off and starts fresh when put back', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const note = service.create({ bounds, text: '写方案' })
  const started = service.patch(note.id, { inProgress: true })
  assert.ok(started.startedAt)
  assert.equal(service.archive(note.id).startedAt, started.startedAt)
  assert.equal(service.reopen(note.id).startedAt, undefined)
})

test('new notes take the tilt sequence in turn, also after a restart', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const tilts = ROTATION_SEQUENCE.map(() => service.create({ bounds }).rotation)
  assert.deepEqual(tilts, ROTATION_SEQUENCE)
  assert.deepEqual(tilts.slice(0, 4).map(Math.sign), [-1, 1, -1, 1])
  service.create({ bounds })
  await service.flush()

  const restarted = new NotesService(dir)
  await restarted.load()
  assert.deepEqual(
    [restarted.create({ bounds }).rotation, restarted.create({ bounds }).rotation],
    [ROTATION_SEQUENCE[1], ROTATION_SEQUENCE[2]],
    'the sequence carries on from the number of notes',
  )
})

test('clearing the archive deletes only torn-off notes and their files', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const kept = service.create({ bounds, text: 'kept' })
  const torn = service.create({ bounds, text: 'torn' })
  service.archive(torn.id)
  await service.flush()
  await stat(join(dir, 'notes', `${torn.id}.json`))
  assert.equal(await service.clearArchived(), 1)
  await service.flush()
  await assert.rejects(stat(join(dir, 'notes', `${torn.id}.json`)))
  const index = JSON.parse(await readFile(join(dir, 'notes-index.json'), 'utf8'))
  assert.deepEqual(index.notes.map((item) => item.id), [kept.id])
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

test('an abandoned note is hidden but kept, and can be put back', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const note = service.create({ bounds, text: '学吉他' })
  const abandoned = service.abandon(note.id)
  assert.equal(abandoned.visible, false)
  assert.ok(abandoned.abandonedAt)
  assert.equal(abandoned.archivedAt, undefined)
  assert.equal(service.archive(note.id).archivedAt, undefined, 'an abandoned note is not also torn off')
  assert.equal(service.setVisible(note.id, true).visible, false, 'abandoned notes stay hidden until put back')
  await service.flush()

  const restarted = new NotesService(dir)
  await restarted.load()
  assert.equal(restarted.get(note.id).abandonedAt, abandoned.abandonedAt, 'the outcome survives a restart')
  restarted.reopen(note.id)
  assert.equal(restarted.get(note.id).visible, true)
  assert.equal(restarted.get(note.id).abandonedAt, undefined)
})

test('clearing abandoned notes leaves torn-off ones alone', async (t) => {
  const dir = await tempDir(t)
  const service = new NotesService(dir)
  await service.load()
  const torn = service.create({ bounds, text: 'torn' })
  const dropped = service.create({ bounds, text: 'dropped' })
  service.archive(torn.id)
  service.abandon(dropped.id)
  assert.equal(await service.clearAbandoned(), 1)
  assert.ok(service.get(torn.id))
  assert.equal(service.get(dropped.id), undefined)
})
