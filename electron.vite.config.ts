import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

/** The dev server needs React Refresh's inline script and its websocket; production keeps the strict CSP. */
function devCsp(): Plugin {
  return {
    name: 'lavanotes-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("connect-src 'self'", "connect-src 'self' ws: http://localhost:*")
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    // One sandboxed preload for every window; the role comes from the page URL.
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), devCsp()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          host: resolve(__dirname, 'src/renderer/host/index.html'),
          note: resolve(__dirname, 'src/renderer/note/index.html'),
          manager: resolve(__dirname, 'src/renderer/manager/index.html'),
          tray: resolve(__dirname, 'src/renderer/tray/index.html'),
        },
      },
    },
  },
})
