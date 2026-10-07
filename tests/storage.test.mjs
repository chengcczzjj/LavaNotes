import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KeyedWriter, getDataPaths, loadIndexFile, writeJsonAtomic } from '../src/main/storage.ts'
import { collectUnusedAssets, detectImageExtension, resolveAssetRequest, storeImage } from '../src/main/assets.ts'

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lavanotes-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

test('atomic writes leave no temp files behind', async (t) => {
  const dir = await tempDir(t)
  const path = join(dir, 'a.json')
  await writeJsonAtomic(path, { a: 1 })
  await writeJsonAtomic(path, { a: 2 })
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { a: 2 })
  assert.deepEqual(await readdir(dir), ['a.json'])
})

test('a corrupt index is moved aside and the backup is used', async (t) => {
  const dir = await tempDir(t)
  const paths = getDataPaths(dir)
  await writeJsonAtomic(paths.index, { version: 1, notes: [{ id: 'n-backup-1' }] })
  const first = await loadIndexFile(paths)
  assert.equal(first.source, 'index')
  await writeFile(paths.index, '{ broken')
  const second = await loadIndexFile(paths, 42)
  assert.equal(second.source, 'backup')
  assert.equal(second.value.notes[0].id, 'n-backup-1')
  assert.ok(second.quarantined.endsWith('notes-index.corrupt-42.json'))
  assert.equal(await readFile(second.quarantined, 'utf8'), '{ broken')
})

test('the keyed writer coalesces, keeps the newest value and flushes on demand', async () => {
  const writes = []
  const writer = new KeyedWriter(async (key, value) => { writes.push([key, value]) }, 10_000)
  writer.schedule('a', 1)
  writer.schedule('a', 2)
  writer.schedule('b', 3)
  await writer.flush()
  assert.deepEqual(writes.sort(), [['a', 2], ['b', 3]])
  assert.equal(writer.hasPending(), false)
})

test('a failed write is retried with the newest value instead of being dropped', async () => {
  let fail = true
  const writes = []
  const errors = []
  const writer = new KeyedWriter(async (_key, value) => {
    if (fail) throw new Error('disk busy')
    writes.push(value)
  }, 5, (_key, error) => errors.push(error.message))
  writer.schedule('a', 1)
  await writer.flush()
  assert.deepEqual(errors, ['disk busy'])
  assert.equal(writer.hasPending(), true)
  fail = false
  await writer.flush()
  assert.deepEqual(writes, [1])
})

test('images are recognised by their bytes, not their name or MIME', () => {
  assert.equal(detectImageExtension(PNG), 'png')
  assert.equal(detectImageExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpg')
  assert.equal(detectImageExtension(new TextEncoder().encode('GIF89a...')), 'gif')
  assert.equal(detectImageExtension(new TextEncoder().encode('RIFF1234WEBPVP8 ')), 'webp')
  assert.equal(detectImageExtension(new TextEncoder().encode('<svg onload=alert(1)>')), null)
})

test('stored images are content-addressed and served only from the assets folder', async (t) => {
  const dir = await tempDir(t)
  const url = await storeImage(dir, PNG)
  assert.match(url, /^lavanote:\/\/asset\/[a-f0-9]{64}\.png$/)
  assert.equal(await storeImage(dir, PNG), url)
  assert.equal((await readdir(dir)).length, 1)
  const resolved = resolveAssetRequest(dir, url)
  assert.equal(resolved.mime, 'image/png')
  assert.ok(resolved.path.startsWith(dir))
  assert.equal(resolveAssetRequest(dir, 'lavanote://asset/..%2F..%2Fsecret.png'), null)
  assert.equal(resolveAssetRequest(dir, 'lavanote://other/x.png'), null)
  await assert.rejects(storeImage(dir, new TextEncoder().encode('not an image')), /image-type/)
})

test('unused images are removed only after the grace period', async (t) => {
  const dir = await tempDir(t)
  const keep = (await storeImage(dir, PNG)).split('/').pop()
  const drop = (await storeImage(dir, new Uint8Array([...PNG, 9]))).split('/').pop()
  const fresh = (await storeImage(dir, new Uint8Array([...PNG, 8]))).split('/').pop()
  const old = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  await utimes(join(dir, drop), old, old)
  await utimes(join(dir, keep), old, old)
  const removed = await collectUnusedAssets(dir, new Set([keep]))
  assert.deepEqual(removed, [drop])
  assert.deepEqual((await readdir(dir)).sort(), [keep, fresh].sort())
})
