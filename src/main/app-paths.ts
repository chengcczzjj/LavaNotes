import { app, net, protocol } from 'electron'
import { is } from './env'
import { join, normalize, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveAssetRequest } from './assets'

export type RendererPage = 'host' | 'note' | 'manager' | 'tray'

const APP_SCHEME = 'app'
const APP_HOST = 'lavanotes'
const ASSET_SCHEME = 'lavanote'

/** Must run before app.ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

function rendererRoot(): string {
  return join(__dirname, '../renderer')
}

export function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

export function resourcePath(...parts: string[]): string {
  const base = app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
  return join(base, ...parts)
}

/**
 * Every page shares one origin (the dev server, or app://lavanotes). Note windows
 * opened by the host page therefore join the host's renderer process.
 */
export function rendererUrl(page: RendererPage, query: Record<string, string> = {}): string {
  const search = new URLSearchParams(query).toString()
  const suffix = `${page}/index.html${search ? `?${search}` : ''}`
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (is.dev && devServer) return `${devServer.replace(/\/$/, '')}/${suffix}`
  return `${APP_SCHEME}://${APP_HOST}/${suffix}`
}

export function isRendererUrl(url: string, page: RendererPage): boolean {
  try {
    const parsed = new URL(url)
    const expected = new URL(rendererUrl(page))
    return parsed.origin === expected.origin && parsed.pathname === expected.pathname
  } catch {
    return false
  }
}

export function registerProtocolHandlers(assetsDir: string): void {
  const root = resolve(rendererRoot())
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.hostname !== APP_HOST) return new Response('not found', { status: 404 })
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '')
    const target = resolve(root, relative)
    if (target !== root && !target.startsWith(root + sep)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(target).toString())
  })
  protocol.handle(ASSET_SCHEME, async (request) => {
    const resolved = resolveAssetRequest(assetsDir, request.url)
    if (!resolved) return new Response('not found', { status: 404 })
    try {
      const response = await net.fetch(pathToFileURL(resolved.path).toString())
      if (!response.ok) return new Response('not found', { status: 404 })
      return new Response(response.body, {
        headers: { 'content-type': resolved.mime, 'cache-control': 'max-age=31536000, immutable' },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
