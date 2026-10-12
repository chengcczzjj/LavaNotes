import type { CelebrationRequest, PaperPalette } from '@shared/effects'
import { PAPER_PALETTES } from '@shared/effects'

/**
 * A finished note as the overlay sees it: the picture of its window and where
 * the paper sits in it. Effects move the paper about its centre, cut it into
 * pieces or turn it into particles.
 */
export interface PaperView {
  image: CanvasImageSource
  /** The note window, in overlay CSS pixels; the image covers exactly this. */
  frame: { x: number; y: number; width: number; height: number }
  /** Paper centre. */
  cx: number
  cy: number
  w: number
  h: number
  /** Tilt, radians. */
  rot: number
  palette: PaperPalette
  /** Overlay size, for things that fly off or fall to the floor. */
  stageWidth: number
  stageHeight: number
}

export interface PaperPose {
  dx?: number
  dy?: number
  /** Extra rotation, radians, about the pivot. */
  rot?: number
  sx?: number
  sy?: number
  alpha?: number
  /** Paper-local point to turn and scale about (default the centre). */
  px?: number
  py?: number
  /** Paper-local polygon to cut the paper to. */
  clip?: Array<[number, number]>
}

export function makeView(request: CelebrationRequest, image: CanvasImageSource, stageWidth: number, stageHeight: number): PaperView {
  const { frame, paper } = request.geometry
  return {
    image,
    frame,
    cx: frame.x + paper.margin + paper.width / 2,
    cy: frame.y + paper.margin + paper.height / 2,
    w: paper.width,
    h: paper.height,
    rot: (paper.rotation * Math.PI) / 180,
    palette: PAPER_PALETTES[request.color] ?? PAPER_PALETTES.butter,
    stageWidth,
    stageHeight,
  }
}

/** Paper-local point to overlay coordinates. */
export function toWorld(view: PaperView, u: number, v: number): { x: number; y: number } {
  const cos = Math.cos(view.rot)
  const sin = Math.sin(view.rot)
  return { x: view.cx + u * cos - v * sin, y: view.cy + u * sin + v * cos }
}

/** Enter the paper's own coordinates (origin at its centre, axes along its edges), posed. */
export function enterPaper(ctx: CanvasRenderingContext2D, view: PaperView, pose: PaperPose = {}): void {
  const { dx = 0, dy = 0, rot = 0, sx = 1, sy = 1, px = 0, py = 0 } = pose
  ctx.translate(view.cx + dx, view.cy + dy)
  ctx.rotate(view.rot)
  ctx.translate(px, py)
  ctx.rotate(rot)
  ctx.scale(sx, sy)
  ctx.translate(-px, -py)
}

/** Draw the window picture while inside the paper's coordinates. */
export function drawImageInPaper(ctx: CanvasRenderingContext2D, view: PaperView): void {
  ctx.rotate(-view.rot)
  ctx.drawImage(view.image, view.frame.x - view.cx, view.frame.y - view.cy, view.frame.width, view.frame.height)
}

export function drawPaper(ctx: CanvasRenderingContext2D, view: PaperView, pose: PaperPose = {}): void {
  const alpha = pose.alpha ?? 1
  if (alpha <= 0.002) return
  ctx.save()
  ctx.globalAlpha = alpha
  enterPaper(ctx, view, pose)
  if (pose.clip) {
    ctx.beginPath()
    pose.clip.forEach(([u, v], i) => (i === 0 ? ctx.moveTo(u, v) : ctx.lineTo(u, v)))
    ctx.closePath()
    ctx.clip()
  }
  drawImageInPaper(ctx, view)
  ctx.restore()
}

/** Room kept around the paper when it is copied out unrotated: the tape and most of the shadow. */
export const LOCAL_PAD = 18

/**
 * The paper alone, unrotated, with LOCAL_PAD around it: for effects that
 * erase it bit by bit or read its colours.
 */
export interface LocalPaper {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  /** Canvas pixels per CSS pixel. */
  k: number
  /** Paper-local coordinates of the canvas's top-left corner. */
  left: number
  top: number
  width: number
  height: number
  data: Uint8ClampedArray
}

export function localPaper(view: PaperView, k = Math.min(1.5, window.devicePixelRatio || 1)): LocalPaper {
  const width = view.w + LOCAL_PAD * 2
  const height = view.h + LOCAL_PAD * 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * k)
  canvas.height = Math.ceil(height * k)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.scale(k, k)
  ctx.translate(width / 2, height / 2)
  ctx.rotate(-view.rot)
  ctx.drawImage(view.image, view.frame.x - view.cx, view.frame.y - view.cy, view.frame.width, view.frame.height)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  return { canvas, ctx, k, left: -width / 2, top: -height / 2, width, height, data }
}

/** Average colour of a square of the local paper, or null where it is (almost) empty. */
export function sampleCell(paper: LocalPaper, u: number, v: number, size: number, minAlpha = 0.35): { color: string; alpha: number } | null {
  const x0 = Math.floor((u - paper.left) * paper.k)
  const y0 = Math.floor((v - paper.top) * paper.k)
  const span = Math.max(1, Math.floor(size * paper.k))
  const step = Math.max(1, Math.floor(span / 3))
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  let n = 0
  for (let y = y0; y < y0 + span; y += step) {
    for (let x = x0; x < x0 + span; x += step) {
      if (x < 0 || y < 0 || x >= paper.canvas.width || y >= paper.canvas.height) continue
      const i = (y * paper.canvas.width + x) * 4
      const alpha = paper.data[i + 3]
      if (alpha === 0) {
        n += 1
        continue
      }
      // getImageData gives unpremultiplied RGBA; weight by alpha.
      r += paper.data[i] * alpha
      g += paper.data[i + 1] * alpha
      b += paper.data[i + 2] * alpha
      a += alpha
      n += 1
    }
  }
  if (n === 0 || a === 0) return null
  const alpha = a / n / 255
  if (alpha < minAlpha) return null
  return { color: `rgb(${Math.round(r / a)}, ${Math.round(g / a)}, ${Math.round(b / a)})`, alpha }
}

/** Erase a square of the local paper (it has turned into a particle). */
export function eraseCell(paper: LocalPaper, u: number, v: number, size: number): void {
  paper.ctx.clearRect(
    Math.floor((u - paper.left) * paper.k),
    Math.floor((v - paper.top) * paper.k),
    Math.ceil(size * paper.k) + 1,
    Math.ceil(size * paper.k) + 1,
  )
}

export function drawLocalPaper(ctx: CanvasRenderingContext2D, view: PaperView, paper: LocalPaper, pose: PaperPose = {}, canvas: CanvasImageSource = paper.canvas): void {
  ctx.save()
  ctx.globalAlpha = pose.alpha ?? 1
  enterPaper(ctx, view, pose)
  ctx.drawImage(canvas, paper.left, paper.top, paper.width, paper.height)
  ctx.restore()
}

/**
 * A plain paper for the preview in the settings, drawn like a note: gradient,
 * tape, a few lines of writing.
 */
export function paintPaper(request: CelebrationRequest): HTMLCanvasElement {
  const { frame, paper } = request.geometry
  const palette = PAPER_PALETTES[request.color] ?? PAPER_PALETTES.butter
  const dpr = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(frame.width * dpr)
  canvas.height = Math.ceil(frame.height * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.translate(paper.margin + paper.width / 2, paper.margin + paper.height / 2)
  ctx.rotate((paper.rotation * Math.PI) / 180)
  const w = paper.width
  const h = paper.height
  ctx.save()
  ctx.shadowColor = 'rgba(36, 29, 16, 0.24)'
  ctx.shadowBlur = 16
  ctx.shadowOffsetX = 4
  ctx.shadowOffsetY = 9
  const fill = ctx.createLinearGradient(0, -h / 2, 0, h / 2)
  fill.addColorStop(0, palette.top)
  fill.addColorStop(1, palette.bottom)
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.roundRect(-w / 2, -h / 2, w, h, [4, 4, 7, 4])
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = `${palette.edge}88`
  ctx.lineWidth = 1
  ctx.stroke()
  // Bar
  ctx.fillStyle = 'rgba(255,255,255,0.28)'
  ctx.fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, 33)
  ctx.fillStyle = 'rgba(48, 47, 42, 0.55)'
  ctx.font = '600 15px system-ui, "Segoe UI", "Microsoft YaHei UI", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText('＋', -w / 2 + 10, -h / 2 + 18)
  ctx.fillText('✓', w / 2 - 50, -h / 2 + 18)
  ctx.fillText('⋯', w / 2 - 24, -h / 2 + 18)
  // Writing
  ctx.fillStyle = 'rgba(59, 56, 47, 0.85)'
  ctx.font = '700 16px system-ui, "Segoe UI", "Microsoft YaHei UI", sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('完成动画预览', -w / 2 + 16, -h / 2 + 64)
  ctx.font = '14px system-ui, "Segoe UI", "Microsoft YaHei UI", sans-serif'
  const lines = ['☑ 写完周报', '☑ 回复邮件', '☑ 整理桌面']
  lines.forEach((line, i) => {
    if (-h / 2 + 92 + i * 24 < h / 2 - 20) ctx.fillText(line, -w / 2 + 16, -h / 2 + 92 + i * 24)
  })
  // Tape
  ctx.save()
  ctx.translate(0, -h / 2)
  ctx.rotate((-1.2 * Math.PI) / 180)
  ctx.fillStyle = 'rgba(245, 225, 178, 0.82)'
  ctx.fillRect(-39, -11, 78, 25)
  ctx.restore()
  return canvas
}
