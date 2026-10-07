import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_LOG_BYTES = 1024 * 1024
let queue: Promise<void> = Promise.resolve()

function logPath(): string {
  return join(app.getPath('userData'), 'logs', 'lavanotes.jsonl')
}

/** Small JSON-lines diagnostics log. Never contains note text. */
export function log(event: string, data: Record<string, unknown> = {}): void {
  const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`
  if (!app.isPackaged) console.log(`[lavanotes] ${line.trim()}`)
  queue = queue.then(async () => {
    const path = logPath()
    await mkdir(join(path, '..'), { recursive: true })
    const size = await stat(path).then((info) => info.size).catch(() => 0)
    if (size > MAX_LOG_BYTES) await rename(path, `${path}.1`).catch(() => undefined)
    await appendFile(path, line)
  }).catch(() => undefined)
}
