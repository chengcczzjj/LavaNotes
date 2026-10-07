import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { ASSET_FILE_PATTERN, ASSET_URL_PREFIX } from '../shared/note-model.ts'
import { writeFileAtomic } from './storage.ts'

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
/** Unreferenced images are kept this long so undo and quick restores still find them. */
export const ASSET_GRACE_MS = 7 * 24 * 60 * 60 * 1000

export type ImageExtension = 'png' | 'jpg' | 'gif' | 'webp'

/** Identify an image by its bytes; the renderer's MIME type is not trusted. */
export function detectImageExtension(bytes: Uint8Array): ImageExtension | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'gif'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp'
  return null
}

export const IMAGE_MIME: Record<ImageExtension, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Store image bytes content-addressed; the same picture pasted twice is kept once. */
export async function storeImage(assetsDir: string, bytes: Uint8Array): Promise<string> {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('image-size')
  const extension = detectImageExtension(bytes)
  if (!extension) throw new Error('image-type')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const file = `${hash}.${extension}`
  const target = join(assetsDir, file)
  try {
    await fs.access(target)
  } catch {
    await writeFileAtomic(target, bytes)
  }
  return `${ASSET_URL_PREFIX}${file}`
}

/** Map a lavanote://asset/<file> request to a file inside the assets folder, or null. */
export function resolveAssetRequest(assetsDir: string, requestUrl: string): { path: string; mime: string } | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'lavanote:' || url.hostname !== 'asset') return null
  const file = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  if (!ASSET_FILE_PATTERN.test(file)) return null
  const extension = file.slice(file.lastIndexOf('.') + 1) as ImageExtension
  return { path: join(assetsDir, file), mime: IMAGE_MIME[extension] }
}

/** Delete images no note refers to any more, once they are older than the grace period. */
export async function collectUnusedAssets(
  assetsDir: string,
  referenced: ReadonlySet<string>,
  now = Date.now(),
  graceMs = ASSET_GRACE_MS,
): Promise<string[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(assetsDir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const file of entries) {
    if (!ASSET_FILE_PATTERN.test(file) || referenced.has(file)) continue
    const path = join(assetsDir, file)
    try {
      const stat = await fs.stat(path)
      if (now - stat.mtimeMs < graceMs) continue
      await fs.rm(path, { force: true })
      removed.push(file)
    } catch {
      // A file that vanished or is locked is retried on the next start.
    }
  }
  return removed
}
