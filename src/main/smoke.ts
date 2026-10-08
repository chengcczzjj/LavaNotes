import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { CreateNoteOptions, NoteRecord } from '@shared/types'
import { NOTE_MAX_HEIGHT, NOTE_MAX_WIDTH } from '@shared/note-model'
import { getWindowMargin, windowBoundsForPaper } from '@shared/geometry'
import type { NotesService } from './notes-service'
import type { NoteWindowManager } from './note-windows'
import { storeImage } from './assets'
import { openManagerWindow } from './manager-window'
import { preloadPath } from './app-paths'
import { runWindowsDesktopChecks } from './smoke-windows'

interface SmokeContext {
  service: NotesService
  windows: NoteWindowManager
  createNote: (options: CreateNoteOptions) => Promise<NoteRecord | null>
  completeNote: (id: string) => void
}

interface Check {
  name: string
  ok: boolean
  detail?: unknown
}

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs = 8000): Promise<T> {
  const started = Date.now()
  let last: T = await probe()
  while (!last && Date.now() - started < timeoutMs) {
    await sleep(100)
    last = await probe()
  }
  return last
}

/**
 * End-to-end check run with LAVANOTES_SMOKE=1 against a throwaway userData.
 * It drives real windows and writes a JSON report for tests/smoke/run-smoke.mjs.
 */
export async function runSmoke({ service, windows, createNote, completeNote }: SmokeContext): Promise<void> {
  const checks: Check[] = []
  const check = (name: string, ok: unknown, detail?: unknown) => {
    checks.push({ name, ok: Boolean(ok), detail })
    console.log(`[smoke] ${ok ? 'ok' : 'FAIL'} ${name}`)
  }
  const evalIn = async (id: string, script: string): Promise<unknown> => {
    const win = windows.windowFor(id)
    if (!win) return undefined
    // A page that never finished loading would keep executeJavaScript pending forever.
    return Promise.race([
      win.webContents.executeJavaScript(script, true),
      sleep(3000).then(() => { throw new Error(`script timed out in ${id}: ${win.webContents.getURL()}`) }),
    ])
  }
  const rendered = (id: string) => evalIn(id, `Boolean(document.querySelector('.note .note-editor'))`).catch(() => false)

  try {
    const welcome = service.list()[0]
    check('first start shows a welcome note', welcome && await waitFor(() => rendered(welcome.id)), welcome?.title)

    const a = await createNote({ text: 'smoke A', focus: false })
    const b = await createNote({ text: 'smoke B', focus: false })
    const c = await createNote({ text: 'smoke C', focus: false })
    if (!a || !b || !c) throw new Error('create failed')
    const allRendered = await waitFor(async () => (await Promise.all([a, b, c].map((note) => rendered(note.id)))).every(Boolean))
    check('note windows render the editor', allRendered)

    const opened = [a, b, c, welcome].filter(Boolean)
    const pids = new Set(opened.map((note) => windows.windowFor(note!.id)?.webContents.getOSProcessId()))
    if (windows.sharedProcess) check('note windows share one renderer process', pids.size === 1, [...pids])
    else check('each note window has its own renderer process', pids.size === opened.length, [...pids])

    const text = await evalIn(a.id, `document.querySelector('.note-editor').innerText`)
    check('saved text is shown', String(text).includes('smoke A'), text)

    const winA = windows.windowFor(a.id)!
    const expected = windowBoundsForPaper(service.get(a.id)!.bounds, service.get(a.id)!.rotation)
    const actual = winA.getBounds()
    check('window is the paper plus the transparent margin', actual.width === expected.width && actual.height === expected.height, { actual, expected })
    check('note windows are transparent', winA.getBackgroundColor().toLowerCase().startsWith('#00'), winA.getBackgroundColor())

    // Click-through: the page tells the main process whether the paper is under a point.
    const paperA = service.get(a.id)!.bounds
    const marginA = getWindowMargin(service.get(a.id)!.rotation)
    const onPaper = await windows.probeHit(a.id, marginA + paperA.width / 2, marginA + paperA.height / 2)
    const onMargin = await windows.probeHit(a.id, 2, 2)
    check('hit test finds the paper and lets the margin through', onPaper === true && onMargin === false, { onPaper, onMargin })

    // Resize: the window grows to the largest paper, then shrinks around the result.
    const margin = getWindowMargin(service.get(a.id)!.rotation)
    windows.resizeBegin(a.id)
    const grown = winA.getBounds()
    check('resize grows the window first', grown.width === NOTE_MAX_WIDTH + margin * 2 && grown.height === NOTE_MAX_HEIGHT + margin * 2, grown)
    const resized = windows.resizeEnd(a.id, { width: 333, height: 277 })
    const shrunk = winA.getBounds()
    check('resize stores the new paper size', resized?.bounds.width === 333 && resized?.bounds.height === 277, resized?.bounds)
    check('resize shrinks the window around the paper', shrunk.width === 333 + margin * 2 && shrunk.x === grown.x, { grown, shrunk })

    // Typing in the real editor reaches the main process.
    winA.show()
    winA.focus()
    winA.webContents.focus()
    await evalIn(a.id, `document.querySelector('.ProseMirror').focus()`)
    await sleep(150)
    winA.webContents.insertText(' typed')
    const typed = await waitFor(() => service.get(a.id)?.title.includes('typed'), 4000)
    check('typing is saved', typed, service.get(a.id)?.title)

    // Toolbar: insert a table into note A and check it is saved.
    const clicked = await waitFor(() => evalIn(a.id, `(() => { const button = document.querySelector('.note-toolbar button[title^="插入 3"]'); if (!button) return false; button.click(); return true })()`), 3000)
    const tableSaved = clicked && await waitFor(async () => JSON.stringify(await service.readContent(a.id)).includes('"table"'), 4000)
    check('a table can be inserted', tableSaved, clicked)

    // Images: store bytes, put them in a note, reopen it and check the picture loads.
    const src = await storeImage(service.paths.assetsDir, ONE_PIXEL_PNG)
    service.saveContent(b.id, { type: 'doc', content: [{ type: 'image', attrs: { src } }] })
    service.setVisible(b.id, false)
    await waitFor(() => !windows.windowFor(b.id))
    check('hiding closes the window', !windows.windowFor(b.id))
    service.setVisible(b.id, true)
    await waitFor(() => rendered(b.id))
    const imageLoaded = await waitFor(() => evalIn(b.id, `(() => { const img = document.querySelector('.note-editor img'); return Boolean(img && img.complete && img.naturalWidth === 1) })()`).catch(() => false), 5000)
    check('stored images load through lavanote://', imageLoaded, src)
    check('an image-only note has no text title', service.get(b.id)?.title === '' && service.get(b.id)?.imageCount === 1)

    // Layers.
    service.patch(b.id, { layer: 'top' })
    await sleep(200)
    check('top layer sets always-on-top', windows.windowFor(b.id)?.isAlwaysOnTop(), service.get(b.id)?.layer)
    service.patch(b.id, { layer: 'normal' })
    await sleep(200)
    check('normal layer clears always-on-top', windows.windowFor(b.id)?.isAlwaysOnTop() === false)
    service.patch(b.id, { layer: 'desktop' })
    await sleep(300)
    check('pin to desktop keeps the window open', Boolean(windows.windowFor(b.id)), { supported: windows.desktopPinSupported })
    service.patch(b.id, { layer: 'normal' })

    // Finishing a note plays the tear animation and archives it.
    completeNote(c.id)
    const archived = await waitFor(() => service.get(c.id)?.archivedAt !== undefined, 4000)
    check('completing a note tears it off into the archive', archived)
    await waitFor(() => !windows.windowFor(c.id), 3000)
    check('the torn-off note window closes', !windows.windowFor(c.id))

    // The ✓ in the top bar does the same from the page, and the note can be put back.
    const d = await createNote({ text: 'smoke D', focus: false })
    const dReady = Boolean(d) && await waitFor(() => rendered(d!.id))
    if (d && dReady) await evalIn(d.id, `document.querySelector('.note__icon--done').click()`)
    const dArchived = Boolean(d) && await waitFor(() => service.get(d!.id)?.archivedAt !== undefined, 4000)
    check('the ✓ in the top bar tears the note off into the archive', dReady && dArchived)
    if (d) service.reopen(d.id)
    const dBack = Boolean(d) && await waitFor(() => rendered(d!.id), 5000)
    check('a torn-off note can be put back', dBack && service.get(d!.id)?.visible === true)

    if (process.platform === 'win32') await runWindowsDesktopChecks({ service, windows, createNote, evalIn, check })

    // Manager window.
    const manager = openManagerWindow(preloadPath())
    const managerReady = await waitFor(() => manager.webContents.executeJavaScript(`Boolean(document.querySelector('.manager .card'))`, true).catch(() => false), 8000)
    check('manager window lists notes', managerReady)

    const shots = process.env.LAVANOTES_SMOKE_SHOTS
    if (shots) {
      const { join } = await import('node:path')
      const capture = async (name: string, target: Electron.BrowserWindow | undefined) => {
        if (!target) return
        const image = await target.webContents.capturePage()
        await writeFile(join(shots, `${name}.png`), image.toPNG())
      }
      await capture('note-a', windows.windowFor(a.id))
      await capture('note-b', windows.windowFor(b.id))
      await capture('welcome', welcome ? windows.windowFor(welcome.id) : undefined)
      await capture('manager', manager)
    }

    await windows.flushAll()
    await service.flush()
    check('everything flushes', true)
  } catch (error) {
    check('smoke run finished without errors', false, error instanceof Error ? error.stack : String(error))
  }

  const failed = checks.filter((item) => !item.ok)
  const report = { ok: failed.length === 0, checks, metrics: app.getAppMetrics().map((metric) => ({ type: metric.type, pid: metric.pid })) }
  const target = process.env.LAVANOTES_SMOKE_RESULT
  if (target) await writeFile(target, JSON.stringify(report, null, 2))
  else console.log(JSON.stringify(report, null, 2))
  app.quit()
}
