const KEEP_ORIGINAL_BYTES = 3 * 1024 * 1024
const MAX_EDGE = 2000
const ACCEPTED = /^image\/(png|jpeg|gif|webp)$/

export function isSupportedImage(file: File): boolean {
  return ACCEPTED.test(file.type)
}

/**
 * Bytes to store for a pasted or dropped picture. Small files and GIFs keep
 * their original bytes; large photos are scaled down so notes stay light.
 */
export async function prepareImageBytes(file: File): Promise<ArrayBuffer | null> {
  if (!isSupportedImage(file)) return null
  if (file.type === 'image/gif' || file.size <= KEEP_ORIGINAL_BYTES) {
    const bitmapCheck = file.type === 'image/gif' ? null : await createImageBitmap(file).catch(() => null)
    if (!bitmapCheck || Math.max(bitmapCheck.width, bitmapCheck.height) <= MAX_EDGE) {
      bitmapCheck?.close()
      return file.arrayBuffer()
    }
    bitmapCheck.close()
  }
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return null
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    return null
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 })
  return blob.arrayBuffer()
}
