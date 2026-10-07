// Draws the LavaNotes icon (a tilted sticky note with tape and a lava-red
// offset shadow) and writes PNG/ICO files. No image libraries: a tiny
// supersampling rasterizer and PNG/ICO encoders built on node:zlib.
//   node scripts/generate-icons.mjs
import { deflateSync, crc32 } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

const hex = (value, alpha = 1) => {
  const n = Number.parseInt(value.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha]
}

function roundedRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false
  const cx = Math.min(Math.max(px, x0 + r), x1 - r)
  const cy = Math.min(Math.max(py, y0 + r), y1 - r)
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
}

function rotate(px, py, cx, cy, degrees) {
  const a = (-degrees * Math.PI) / 180
  const dx = px - cx
  const dy = py - cy
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]
}

function mix(a, b, t) {
  return a.map((value, index) => value + (b[index] - value) * t)
}

/** Colour of one sample point in the 256×256 design space, back to front. */
function sample(x, y) {
  let out = [0, 0, 0, 0]
  const over = (color) => {
    const [r, g, b, a] = color
    const oa = out[3]
    const na = a + oa * (1 - a)
    if (na === 0) return
    out = [
      (r * a + out[0] * oa * (1 - a)) / na,
      (g * a + out[1] * oa * (1 - a)) / na,
      (b * a + out[2] * oa * (1 - a)) / na,
      na,
    ]
  }
  const [px, py] = rotate(x, y, 128, 138, -5)
  // lava offset shadow
  if (roundedRect(px, py, 46, 58, 232, 238, 16)) over(hex('#c2552f'))
  // paper
  if (roundedRect(px, py, 30, 42, 216, 222, 16)) {
    const t = (py - 42) / 180
    let paper = mix(hex('#fff4b0'), hex('#f2d25d'), t)
    // folded corner
    if (px + py > 216 + 222 - 46) paper = mix(hex('#fffbe0'), hex('#d9b84a'), (px + py - (216 + 222 - 46)) / 46)
    over(paper)
    // ink lines
    const lines = [[72, 104, 178], [72, 138, 178], [72, 172, 144]]
    for (const [lx0, ly, lx1] of lines) {
      if (px >= lx0 && px <= lx1 && Math.abs(py - ly) <= 6.5) over(hex('#5b4f37', 0.62))
    }
  }
  // tape
  const [tx, ty] = rotate(x, y, 124, 46, 4)
  if (tx >= 86 && tx <= 162 && ty >= 30 && ty <= 62) {
    const stripe = Math.floor((tx - 86) / 7) % 2 === 0 ? 0.04 : 0
    over(mix(hex('#f6e6bd', 0.88), hex('#ffffff', 0.9), stripe))
  }
  return out
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const grid = size >= 64 ? 4 : 6
  const scale = 256 / size
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < grid; sy += 1) {
        for (let sx = 0; sx < grid; sx += 1) {
          const [cr, cg, cb, ca] = sample((x + (sx + 0.5) / grid) * scale, (y + (sy + 0.5) / grid) * scale)
          r += cr * ca
          g += cg * ca
          b += cb * ca
          a += ca
        }
      }
      const n = grid * grid
      const offset = (y * size + x) * 4
      pixels[offset] = a ? Math.round(r / a) : 0
      pixels[offset + 1] = a ? Math.round(g / a) : 0
      pixels[offset + 2] = a ? Math.round(b / a) : 0
      pixels[offset + 3] = Math.round((a / n) * 255)
    }
  }
  return pixels
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function png(size) {
  const pixels = render(size)
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function ico(sizes) {
  const images = sizes.map((size) => ({ size, data: png(size) }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)])
}

function write(path, data) {
  const target = resolve(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, data)
  console.log(`${path} ${data.length} bytes`)
}

write('build/icon.ico', ico([16, 24, 32, 48, 64, 128, 256]))
write('build/icon.png', png(512))
write('resources/icon.png', png(256))
write('resources/tray.ico', ico([16, 20, 24, 32, 40, 48]))
write('resources/tray.png', png(32))
