import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

export type JsonReadResult =
  | { status: 'ok'; value: unknown }
  | { status: 'missing' }
  | { status: 'corrupt'; error: Error }

export async function readJsonFile(path: string): Promise<JsonReadResult> {
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }
    return { status: 'corrupt', error: error as Error }
  }
  try {
    return { status: 'ok', value: JSON.parse(text) }
  } catch (error) {
    return { status: 'corrupt', error: error as Error }
  }
}

/** Write next to the target and rename over it, so a crash never leaves half a file. */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`
  const handle = await fs.open(temp, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(temp, path)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
}

export function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  return writeFileAtomic(path, `${JSON.stringify(value, null, 1)}\n`)
}

/**
 * Coalesces writes per key. A pending value is never dropped: a failed write
 * keeps the newest value queued and retries, and flush() waits for everything.
 */
export class KeyedWriter<T> {
  private readonly pending = new Map<string, T>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly running = new Map<string, Promise<void>>()
  private readonly write: (key: string, value: T) => Promise<void>
  private readonly delayMs: number
  private readonly onError: (key: string, error: unknown) => void

  constructor(
    write: (key: string, value: T) => Promise<void>,
    delayMs: number,
    onError: (key: string, error: unknown) => void = () => undefined,
  ) {
    this.write = write
    this.delayMs = delayMs
    this.onError = onError
  }

  schedule(key: string, value: T): void {
    this.pending.set(key, value)
    const timer = this.timers.get(key)
    if (timer) clearTimeout(timer)
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key)
      void this.run(key)
    }, this.delayMs))
  }

  /** Forget a queued value, e.g. when its note was deleted. */
  cancel(key: string): void {
    this.pending.delete(key)
    const timer = this.timers.get(key)
    if (timer) clearTimeout(timer)
    this.timers.delete(key)
  }

  hasPending(): boolean {
    return this.pending.size > 0 || this.running.size > 0
  }

  private async run(key: string): Promise<void> {
    const previous = this.running.get(key)
    if (previous) await previous.catch(() => undefined)
    if (!this.pending.has(key)) return
    const value = this.pending.get(key) as T
    this.pending.delete(key)
    const task = this.write(key, value).catch((error) => {
      // Keep the newest value: requeue only if nothing newer arrived meanwhile.
      if (!this.pending.has(key)) this.pending.set(key, value)
      this.onError(key, error)
      if (!this.timers.has(key)) {
        this.timers.set(key, setTimeout(() => {
          this.timers.delete(key)
          void this.run(key)
        }, Math.max(this.delayMs, 1000)))
      }
    })
    this.running.set(key, task)
    try {
      await task
    } finally {
      if (this.running.get(key) === task) this.running.delete(key)
    }
  }

  async flush(): Promise<void> {
    for (const [key, timer] of this.timers) {
      clearTimeout(timer)
      this.timers.delete(key)
    }
    const keys = new Set([...this.pending.keys(), ...this.running.keys()])
    await Promise.all([...keys].map((key) => this.run(key)))
    await Promise.all([...this.running.values()])
  }
}

export interface DataPaths {
  root: string
  index: string
  indexBackup: string
  settings: string
  notesDir: string
  assetsDir: string
}

export function getDataPaths(root: string): DataPaths {
  return {
    root,
    index: join(root, 'notes-index.json'),
    indexBackup: join(root, 'notes-index.backup.json'),
    settings: join(root, 'settings.json'),
    notesDir: join(root, 'notes'),
    assetsDir: join(root, 'assets'),
  }
}

export function noteContentPath(paths: DataPaths, id: string): string {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) throw new Error('invalid note id')
  return join(paths.notesDir, `${id}.json`)
}

export interface LoadedIndex {
  value: unknown
  source: 'index' | 'backup' | 'empty'
  /** Set when the main file could not be read; it was moved aside, not overwritten. */
  quarantined?: string
}

/**
 * Read the note index. A damaged file is moved aside and the last good backup is
 * used, so a bad write never makes notes disappear for good.
 */
export async function loadIndexFile(paths: DataPaths, now = Date.now()): Promise<LoadedIndex> {
  const main = await readJsonFile(paths.index)
  if (main.status === 'ok') {
    await fs.copyFile(paths.index, paths.indexBackup).catch(() => undefined)
    return { value: main.value, source: 'index' }
  }
  let quarantined: string | undefined
  if (main.status === 'corrupt') {
    quarantined = join(paths.root, `notes-index.corrupt-${now}.json`)
    await fs.rename(paths.index, quarantined).catch(() => { quarantined = undefined })
  }
  const backup = await readJsonFile(paths.indexBackup)
  if (backup.status === 'ok') return { value: backup.value, source: 'backup', quarantined }
  return { value: { version: 1, notes: [] }, source: 'empty', quarantined }
}
