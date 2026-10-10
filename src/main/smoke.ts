import { app } from 'electron'
import { IPC } from '@shared/ipc'
import { writeFile } from 'node:fs/promises'
import type { CreateNoteOptions, NoteRecord } from '@shared/types'
import { periodStart, type StatsDataset, type StatsGranularity } from '@shared/stats'
import type { InsightRunResult } from '@shared/insights'
import type { AiService } from './ai/service'
import { startMockModelServer } from './smoke-ai'
import { NOTE_COLORS, NOTE_MAX_HEIGHT, NOTE_MAX_WIDTH } from '@shared/note-model'
import { getWindowMargin, windowBoundsForPaper } from '@shared/geometry'
import type { NotesService } from './notes-service'
import type { NoteWindowManager } from './note-windows'
import { storeImage } from './assets'
import { openManagerWindow } from './manager-window'
import { preloadPath } from './app-paths'
import { runWindowsDesktopChecks } from './smoke-windows'
import { trayPopup } from './tray'

interface SmokeContext {
  service: NotesService
  windows: NoteWindowManager
  createNote: (options: CreateNoteOptions) => Promise<NoteRecord | null>
  completeNote: (id: string) => void
  abandonNote: (id: string) => void
  statsDataset: () => Promise<StatsDataset>
  ai: AiService
  runInsight: (granularity: StatsGranularity, start: number, signal: AbortSignal) => Promise<InsightRunResult>
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
export async function runSmoke({ service, windows, createNote, completeNote, abandonNote, statsDataset, ai, runInsight }: SmokeContext): Promise<void> {
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
  const shot = async (name: string, target: Electron.BrowserWindow | undefined) => {
    const dir = process.env.LAVANOTES_SMOKE_SHOTS
    if (!dir || !target) return
    // Let the compositor draw the change just made; a capture can otherwise be a frame behind.
    await sleep(400)
    const { join } = await import('node:path')
    await writeFile(join(dir, `${name}.png`), (await target.webContents.capturePage()).toPNG())
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
    // Shown again while its window is still saving and closing (收起 then 显示 at once): it comes back.
    service.setVisible(b.id, false)
    service.setVisible(b.id, true)
    await sleep(900)
    const bBack = await waitFor(() => rendered(b.id), 5000)
    check('a note shown again while its window is closing comes back', bBack && service.get(b.id)?.visible === true)

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
    if (d && dBack) {
      // ▷ marks the note in progress (amber mark, light along the bar); a second click stops it.
      await evalIn(d.id, `document.querySelector('.note__icon--doing').click()`)
      const dStarted = await waitFor(() => service.get(d.id)?.startedAt !== undefined, 3000)
      const dMarked = await waitFor(() => evalIn(d.id, `Boolean(document.querySelector('.note[data-doing="true"] .note__doing-label'))`), 3000)
      check('▷ in the top bar marks the note in progress', dStarted && dMarked, service.get(d.id)?.startedAt)
      // Shown, not necessarily moving: with reduced motion (CI's Windows runner) the glow stays still.
      const glowing = await waitFor(() => evalIn(d.id, `Number(getComputedStyle(document.querySelector('.note__glow')).opacity) > 0.2`), 3000)
      const dNote = service.get(d.id)!
      const dMargin = getWindowMargin(dNote.rotation)
      const underPaper = await windows.probeHit(d.id, dMargin + dNote.bounds.width / 2, dMargin + dNote.bounds.height + 14)
      check('the glow under a note in progress breathes and lets clicks through', glowing && underPaper === false, { glowing, underPaper })
      await shot('note-doing', windows.windowFor(d.id))
      // The glow takes the paper's colour: one picture per colour, at the bright end of a breath.
      if (process.env.LAVANOTES_SMOKE_SHOTS) {
        const original = service.get(d.id)!.color
        for (const color of NOTE_COLORS) {
          service.patch(d.id, { color })
          await sleep(1300)
          await shot(`note-doing-${color}`, windows.windowFor(d.id))
        }
        service.patch(d.id, { color: original })
      }
      await evalIn(d.id, `document.querySelector('.note__icon--doing').click()`)
      const dStopped = await waitFor(() => service.get(d.id)?.startedAt === undefined, 3000)
      check('clicking ▷ again stops it', dStopped)
      // Left in progress for the manager's badge and the tray menu's count.
      service.patch(d.id, { inProgress: true })
    }

    // Checklist items record when they were added and checked; the secondary menu holds italic,
    // strikethrough and translate; ⋯ → 废弃 crumples the note away but keeps it.
    const e = await createNote({ text: '', focus: false })
    const eReady = Boolean(e) && await waitFor(() => rendered(e!.id))
    const winE = e ? windows.windowFor(e.id) : undefined
    if (e && eReady && winE) {
      winE.show()
      winE.focus()
      winE.webContents.focus()
      await evalIn(e.id, `document.querySelector('.ProseMirror').focus()`)
      await sleep(150)
      const listClicked = await waitFor(() => evalIn(e.id, `(() => { const button = document.querySelector('.note-toolbar button[title^="勾选清单"]'); if (!button) return false; button.click(); return true })()`), 3000)
      winE.webContents.insertText('smoke task')
      const stamped = listClicked && await waitFor(async () => {
        const item = JSON.stringify(await service.readContent(e.id))
        return item.includes('"taskItem"') && /"tid":"t/.test(item) && /"createdAt":\d+/.test(item)
      }, 4000)
      check('a new checklist item is stamped with an id and a time', stamped)
      await evalIn(e.id, `document.querySelector('.note-editor li[data-checked] input[type="checkbox"]').click()`)
      const checkedAt = await waitFor(async () => /"checkedAt":\d+/.test(JSON.stringify(await service.readContent(e.id))), 4000)
      check('checking an item records when it was checked', checkedAt)
      // Right click on the box: a checked item goes back to in progress; checking it again keeps the start.
      await evalIn(e.id, `document.querySelector('.note-editor li[data-checked] > label').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`)
      const doing = await waitFor(async () => {
        const body = JSON.stringify(await service.readContent(e.id))
        return /"startedAt":\d+/.test(body) && body.includes('"checked":false')
      }, 4000)
      const doingShown = await evalIn(e.id, `Boolean(document.querySelector('.note-editor li[data-checked="false"][data-started-at]'))`)
      const rowGlows = await evalIn(e.id, `getComputedStyle(document.querySelector('.note-editor li[data-started-at]'), '::before').content !== 'none'`)
      check('right click on a checklist box marks the item in progress, and its row glows', doing && doingShown && rowGlows, { doing, doingShown, rowGlows })
      await shot('note-task-doing', winE)
      if (process.env.LAVANOTES_SMOKE_SHOTS) {
        service.patch(e.id, { color: 'sky' })
        await shot('note-task-doing-sky', winE)
        service.patch(e.id, { color: 'butter' })
      }
      await evalIn(e.id, `document.querySelector('.note-editor li[data-checked] input[type="checkbox"]').click()`)
      const doneAgain = await waitFor(async () => {
        const body = JSON.stringify(await service.readContent(e.id))
        return /"checkedAt":\d+/.test(body) && /"startedAt":\d+/.test(body)
      }, 4000)
      check('checking an item in progress keeps when it started', doneAgain)
      await shot('note-task-done', winE)

      await evalIn(e.id, `document.querySelector('.ProseMirror').focus()`)
      await sleep(120)
      // Click once; React renders the menu after the click event, so wait for it separately.
      await waitFor(() => evalIn(e.id, `(() => { const button = document.querySelector('.note-toolbar__more-button'); if (!button) return false; button.click(); return true })()`), 3000)
      const menu = await waitFor(() => evalIn(e.id, `document.querySelector('.note-toolbar__more')?.innerText ?? ''`), 3000)
      check('the secondary menu holds italic, strikethrough and translate', /斜体/.test(String(menu)) && /删除线/.test(String(menu)) && /翻译/.test(String(menu)), menu)
      await sleep(300)
      await shot('note-menu-more', winE)
      await evalIn(e.id, `document.querySelector('.note-toolbar__translate')?.click()`)
      const setup = await waitFor(() => evalIn(e.id, `document.querySelector('.note-translate__message')?.innerText ?? ''`), 5000)
      check('translating without a model points to the model settings', /API Key|模型/.test(String(setup)), setup)
      await shot('note-translate', winE)

      await evalIn(e.id, `document.querySelector('.note__topbar button[aria-label="更多设置"]').click()`)
      const abandonClicked = await waitFor(() => evalIn(e.id, `(() => { const button = document.querySelector('.note-menu__abandon'); if (!button) return false; button.click(); return true })()`), 3000)
      const abandoned = abandonClicked && await waitFor(() => service.get(e.id)?.abandonedAt !== undefined, 4000)
      check('⋯ → 废弃 crumples the note away and keeps it', abandoned && service.get(e.id)?.archivedAt === undefined)
      await waitFor(() => !windows.windowFor(e.id), 3000)
      check('the abandoned note window closes', !windows.windowFor(e.id))
      const dataset = await statsDataset()
      const entry = dataset.notes.find((note) => note.id === e.id)
      check('statistics see the abandoned note and its checklist timeline', entry?.state === 'abandoned' && entry.tasks.length === 1 && entry.tasks[0].checkedAt !== null && entry.tasks[0].startedAt !== null, entry)
    } else {
      check('note E renders', false)
    }
    const f = await createNote({ text: 'smoke F', focus: false })
    if (f) abandonNote(f.id)
    const fAbandoned = Boolean(f) && await waitFor(() => service.get(f!.id)?.abandonedAt !== undefined, 4000)
    check('abandoning from the main process works too', fAbandoned)

    // The model pipeline end to end, against a local OpenAI-compatible stand-in. Translation is
    // opened before any model is set up, the way a first-time user meets it: the panel asks for
    // a model, then translates by itself once one has been configured.
    const mock = await startMockModelServer()
    try {
      const g = await createNote({ text: '早上好\n明天开会', focus: false })
      const gReady = Boolean(g) && await waitFor(() => rendered(g!.id))
      const winG = g ? windows.windowFor(g.id) : undefined
      let waitingForModel: unknown = ''
      if (g && gReady && winG) {
        winG.show()
        winG.focus()
        winG.webContents.focus()
        await evalIn(g.id, `document.querySelector('.ProseMirror').focus()`)
        await sleep(150)
        await waitFor(() => evalIn(g.id, `(() => { const button = document.querySelector('.note-toolbar__more-button'); if (!button) return false; button.click(); return true })()`), 3000)
        await waitFor(() => evalIn(g.id, `Boolean(document.querySelector('.note-toolbar__translate'))`), 3000)
        await evalIn(g.id, `document.querySelector('.note-toolbar__translate').click()`)
        waitingForModel = await waitFor(() => evalIn(g.id, `document.querySelector('.note-translate__message')?.innerText ?? ''`), 5000)
      }
      ai.update({ provider: 'custom', providers: { custom: { key: 'smoke-key', baseUrl: mock.baseUrl, model: 'mock-model' } } })
      check('a custom service with a model is ready', ai.status().ok, ai.status())
      const models = await ai.listModels('custom')
      check('the model list comes from the service', models.ok && models.models.some((model) => model.id === 'mock-model'), models)
      if (g && gReady && winG) {
        const shown = await waitFor(() => evalIn(g.id, `(() => { const body = document.querySelector('.note-translate__body')?.innerText ?? ''; const ready = !document.querySelector('.note-translate__actions button').disabled; return ready && body.includes('[EN] 明天开会') ? body : '' })()`), 8000)
        check('a note is translated segment by segment', String(shown).includes('[EN] 早上好'), shown)
        check('a translation waiting for a model runs by itself once one is set up', Boolean(waitingForModel) && String(shown).includes('[EN]'), { waitingForModel, shown })
        await shot('note-translated', winG)
        await evalIn(g.id, `document.querySelector('.note-translate__actions button').click()`)
        const replaced = await waitFor(async () => JSON.stringify(await service.readContent(g.id)).includes('[EN] 早上好'), 4000)
        check('the translation replaces the note text', replaced)
      } else {
        check('note G renders', false)
      }
      const insight = await runInsight('week', periodStart(Date.now(), 'week'), new AbortController().signal)
      check('the model reads the week and its answer is parsed', insight.ok && insight.record.insight.headline === '冒烟测试的一周' && insight.record.insight.topics[0].noteIds.length > 0, insight)
      check('the model was reached through chat completions after the responses endpoint was missing',
        mock.requests.some((line) => line.endsWith('/responses')) && mock.requests.some((line) => line.endsWith('/chat/completions')), mock.requests)
    } finally {
      await mock.close()
    }

    if (process.platform === 'win32') await runWindowsDesktopChecks({ service, windows, createNote, evalIn, check })

    // LavaNotes' own tray menu (Windows): placed by the cursor inside the work area, an option
    // toggles in place, Escape closes it.
    const tray = trayPopup()
    if (tray) {
      const { screen } = await import('electron')
      const area = screen.getPrimaryDisplay().workArea
      await tray.open({ x: area.x + area.width - 30, y: area.y + area.height + 10 })
      const opened = await waitFor(() => tray.isOpen(), 4000)
      const card = tray.cardBounds()
      const inside = card !== null && card.x >= area.x && card.y >= area.y
        && card.x + card.width <= area.x + area.width && card.y + card.height <= area.y + area.height
      check('the tray menu opens inside the work area', opened && inside, { card, area })
      const page = tray.contents()
      const inTray = (script: string) => page ? page.executeJavaScript(script, true).catch(() => null) : Promise.resolve(null)
      const items = await inTray(`[...document.querySelectorAll('.tray__item .tray__label')].map((label) => label.textContent).join('|')`)
      check('the tray menu lists its commands', /新建便签/.test(String(items)) && /退出/.test(String(items)), items)
      await shot('tray-menu', tray.window() ?? undefined)
      const before = service.settings.launchAtLogin
      await inTray(`[...document.querySelectorAll('.tray__item')].find((item) => item.textContent.includes('开机启动'))?.click()`)
      const toggled = await waitFor(async () => service.settings.launchAtLogin !== before
        && await inTray(`document.querySelector('.tray__switch')?.dataset.on`) === String(!before), 3000)
      check('开机启动 toggles in place and the menu stays open', toggled && tray.isOpen())
      page?.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      const closed = await waitFor(() => !tray.isOpen(), 3000)
      check('Escape closes the tray menu', closed)
      tray.hide()
    }

    // Manager window.
    const manager = openManagerWindow(preloadPath())
    const inManager = (script: string) => manager.webContents.executeJavaScript(script, true).catch(() => null)
    const opensOnStats = await waitFor(() => inManager(`Boolean(document.querySelector('.manager .stats'))`), 8000)
    check('the manager opens on the statistics page', opensOnStats)
    manager.webContents.send(IPC.MANAGER_NAVIGATE, 'notes')
    const managerReady = await waitFor(() => inManager(`Boolean(document.querySelector('.manager .card[data-state="active"]'))`), 8000)
    check('便签管理 lists the notes in progress', managerReady)
    await inManager(`[...document.querySelectorAll('.note-filter button')].find((button) => button.textContent.startsWith('已废弃'))?.click()`)
    const abandonedListed = await waitFor(() => inManager(`(() => { const cards = [...document.querySelectorAll('.manager .card')]; return cards.length >= 2 && cards.every((card) => card.dataset.state === 'abandoned') })()`), 4000)
    check('the 已废弃 filter lists only abandoned notes', abandonedListed)
    manager.webContents.send(IPC.MANAGER_NAVIGATE, 'stats')
    const statsReady = await waitFor(() => inManager(`document.querySelectorAll('.stats .tiles .tile').length === 5 && Boolean(document.querySelector('.stats .chart svg'))`), 8000)
    check('the statistics page draws tiles and charts', statsReady)
    const lifelinesDrawn = await waitFor(() => inManager(`document.querySelectorAll('.stats .life-row').length > 0`), 4000)
    check('note lifelines are drawn', lifelinesDrawn)
    const insightShown = await waitFor(() => inManager(`document.querySelector('.insight__headline')?.textContent === '冒烟测试的一周'`), 4000)
    check('the AI reading is shown on the statistics page', insightShown)
    manager.webContents.send(IPC.MANAGER_NAVIGATE, 'ai')
    const aiReady = await waitFor(() => inManager(`Boolean(document.querySelector('.ai-page .status-bar')) && document.querySelectorAll('.ai-page .guide-row').length >= 9`), 8000)
    check('the AI 配置 page lists providers', aiReady)
    // Changing the provider back and forth leaves exactly one key card and one model list.
    for (const provider of ['gemini', 'custom', 'gemini', 'custom'] as const) {
      ai.update({ provider })
      await sleep(250)
    }
    await sleep(600)
    const aiCards = await inManager(`(() => ({
      keys: [...document.querySelectorAll('.ai-page .ai-card__title')].filter((title) => title.textContent === 'API Key').length,
      models: [...document.querySelectorAll('.ai-page .ai-h3')].filter((title) => title.textContent.startsWith('模型')).length,
    }))()`) as { keys: number; models: number } | null
    check('switching providers leaves one key card and one model list', aiCards?.keys === 1 && aiCards.models === 1, aiCards)

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
      manager.webContents.send(IPC.MANAGER_NAVIGATE, 'notes')
      await sleep(400)
      await capture('manager', manager)
      manager.webContents.send(IPC.MANAGER_NAVIGATE, 'stats')
      await sleep(1500)
      await capture('manager-stats', manager)
      for (const [index, offset] of [700, 1400, 2100].entries()) {
        await manager.webContents.executeJavaScript(`document.querySelector('main').scrollTop = ${offset}`, true)
        await sleep(900)
        await capture(`manager-stats-${index + 2}`, manager)
      }
      await manager.webContents.executeJavaScript(`(() => { document.querySelector('main').scrollTop = 0; [...document.querySelectorAll('.stats-filters button')].find((button) => button.textContent === '按月')?.click() })()`, true)
      await sleep(1500)
      await capture('manager-stats-month', manager)
      await manager.webContents.executeJavaScript(`document.querySelector('main').scrollTop = 1500`, true)
      await sleep(900)
      await capture('manager-stats-month-2', manager)
      manager.webContents.send(IPC.MANAGER_NAVIGATE, 'ai')
      await sleep(600)
      await capture('manager-ai', manager)
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
