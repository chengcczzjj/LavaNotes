// Launch the built app with a throwaway userData and LAVANOTES_SMOKE=1, then
// check the JSON report written by src/main/smoke.ts. On Linux this needs a
// display (CI and the container use xvfb-run).
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = resolve(import.meta.dirname, '../..')
const userData = await mkdtemp(join(tmpdir(), 'lavanotes-smoke-'))
const result = join(userData, 'smoke-result.json')

const args = [root]
if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu')

const child = spawn(electron, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    LAVANOTES_SMOKE: '1',
    LAVANOTES_USER_DATA: userData,
    LAVANOTES_SMOKE_RESULT: result,
    LAVANOTES_DISABLE_UPDATES: '1',
    ELECTRON_RENDERER_URL: '',
  },
})

const timeout = setTimeout(() => {
  console.error('smoke test timed out')
  child.kill('SIGKILL')
}, 90_000)

const code = await new Promise((resolveExit) => child.on('exit', resolveExit))
clearTimeout(timeout)

let report
try {
  report = JSON.parse(await readFile(result, 'utf8'))
} catch {
  console.error(`no smoke report (exit code ${code})`)
  process.exit(1)
}
for (const item of report.checks) {
  console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.ok || item.detail === undefined ? '' : ` — ${JSON.stringify(item.detail)}`}`)
}
await rm(userData, { recursive: true, force: true }).catch(() => undefined)
process.exit(report.ok ? 0 : 1)
