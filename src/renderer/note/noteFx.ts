import { EffectPicker, PAPER_PALETTES, TASK_EFFECTS, type AppearEffect, type PaperPalette, type TaskEffect } from '@shared/effects'
import type { NoteColor } from '@shared/types'
import { PARTY_COLORS, Particles, Stage, TAU, burst, clamp, ease, particle, phase, pick, rand, withAlpha, type Scene } from '../common/fx'
import { pentatonic, type CueName, type SoundBoard } from '../common/sfx'

/** Consecutive checks within this long climb the scale; a pause starts again from the bottom. */
const STREAK_GAP_MS = 4000

const APPEAR_SOUNDS: Record<AppearEffect, { cue: CueName; at: number }> = {
  pop: { cue: 'appearPop', at: 0 },
  drop: { cue: 'thud', at: 0.33 },
  flip: { cue: 'flick', at: 0 },
  unroll: { cue: 'slide', at: 0 },
  swing: { cue: 'swish', at: 0 },
  wipe: { cue: 'shimmer', at: 0.05 },
  iris: { cue: 'fwip', at: 0 },
  focus: { cue: 'airy', at: 0 },
  slap: { cue: 'slap', at: 0.22 },
  spin: { cue: 'whirl', at: 0 },
  flap: { cue: 'flap', at: 0 },
  sticker: { cue: 'peel', at: 0 },
  jelly: { cue: 'boing', at: 0.05 },
  sparkle: { cue: 'twinkles', at: 0.05 },
  rise: { cue: 'rise', at: 0 },
}

/** Where the first line of an item's text ends, in window coordinates; the highlighter and the streak stop there. */
function textEnd(item: HTMLElement): { x: number; y: number } | null {
  const paragraph = item.querySelector(':scope > div p') ?? item.querySelector(':scope > div')
  if (!paragraph) return null
  // Text nodes only: a range over the block would also report the block's own full-width box.
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
  const first = walker.nextNode() as Text | null
  if (!first) return null
  let last = first
  for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node as Text
  const range = document.createRange()
  range.setStart(first, 0)
  range.setEnd(last, last.length)
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0)
  if (rects.length === 0) return null
  const line = rects.filter((rect) => Math.abs(rect.top - rects[0].top) < rects[0].height / 2)
  const right = Math.max(...line.map((rect) => rect.right))
  return { x: right + 2, y: rects[0].top + rects[0].height / 2 }
}

/** The paper in window coordinates. */
export interface PaperFrame {
  cx: number
  cy: number
  w: number
  h: number
  /** Radians. */
  rot: number
}

/** A short bright glint running along a checked row. */
class Glint implements Scene {
  private t = 0
  private readonly from: { x: number; y: number }
  private readonly to: { x: number; y: number }
  private readonly height: number

  constructor(from: { x: number; y: number }, to: { x: number; y: number }, height: number) {
    this.from = from
    this.to = to
    this.height = height
  }

  update(dt: number): boolean {
    this.t += dt
    return this.t < 0.42
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const p = ease.inOutCubic(phase(this.t, 0, 0.42))
    const x = this.from.x + (this.to.x - this.from.x) * p
    const y = this.from.y + (this.to.y - this.from.y) * p
    const angle = Math.atan2(this.to.y - this.from.y, this.to.x - this.from.x)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    const glow = ctx.createLinearGradient(-30, 0, 30, 0)
    glow.addColorStop(0, 'rgba(255, 255, 255, 0)')
    glow.addColorStop(0.5, 'rgba(255, 255, 255, 0.85)')
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.globalAlpha = Math.sin(Math.PI * p)
    ctx.fillStyle = glow
    ctx.fillRect(-30, -this.height / 2, 60, this.height)
    ctx.restore()
  }
}

/** A line that draws itself across a checked row, like a highlighter. */
class Swipe implements Scene {
  private t = 0
  private readonly from: { x: number; y: number }
  private readonly to: { x: number; y: number }
  private readonly color: string
  private readonly width: number

  constructor(from: { x: number; y: number }, to: { x: number; y: number }, color: string, width: number) {
    this.from = from
    this.to = to
    this.color = color
    this.width = width
  }

  update(dt: number): boolean {
    this.t += dt
    return this.t < 0.75
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const grow = ease.outCubic(phase(this.t, 0, 0.2))
    const fade = 1 - phase(this.t, 0.4, 0.35)
    ctx.globalAlpha = fade
    ctx.strokeStyle = this.color
    ctx.lineWidth = this.width
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(this.from.x, this.from.y)
    ctx.lineTo(this.from.x + (this.to.x - this.from.x) * grow, this.from.y + (this.to.y - this.from.y) * grow)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

/**
 * Small celebrations inside a note window: a checklist item checked (with a
 * streak that climbs a scale), the whole list done, and the particles that go
 * with some appear animations. Everything stays near the paper, within the
 * window's transparent margin.
 */
export class NoteFx {
  private readonly stage: Stage
  private readonly canvas: HTMLCanvasElement
  private readonly sound: SoundBoard
  private readonly picker = new EffectPicker<TaskEffect>(TASK_EFFECTS)
  private streak = 0
  private lastCheck = Number.NEGATIVE_INFINITY
  private palette: PaperPalette = PAPER_PALETTES.butter
  private enabled = true
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  constructor(canvas: HTMLCanvasElement, sound: SoundBoard) {
    this.stage = new Stage(canvas)
    this.canvas = canvas
    this.sound = sound
  }

  setColor(color: NoteColor): void {
    this.palette = PAPER_PALETTES[color] ?? PAPER_PALETTES.butter
  }

  /** Animations off in the settings: sounds only. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  private get still(): boolean {
    return !this.enabled || this.reduceMotion.matches
  }

  private pan(x: number): number {
    return clamp((x / Math.max(1, window.innerWidth)) * 2 - 1, -0.5, 0.5)
  }

  // ---- a note coming in ----

  appear(effect: AppearEffect, paper: PaperFrame, withSound: boolean): void {
    // What played last, readable outside the editor (the smoke test).
    this.canvas.dataset.appear = effect
    if (withSound) {
      const { cue, at } = APPEAR_SOUNDS[effect]
      this.sound.play(cue, { at })
    }
    if (this.still) return
    const local = (u: number, v: number) => ({
      x: paper.cx + u * Math.cos(paper.rot) - v * Math.sin(paper.rot),
      y: paper.cy + u * Math.sin(paper.rot) + v * Math.cos(paper.rot),
    })
    if (effect === 'drop' || effect === 'slap') {
      const at = effect === 'drop' ? 330 : 220
      window.setTimeout(() => {
        const fx = new Particles()
        const edge = effect === 'drop' ? [local(-paper.w / 2, paper.h / 2), local(paper.w / 2, paper.h / 2)] : [local(-paper.w / 2, paper.h / 2), local(paper.w / 2, paper.h / 2), local(-paper.w / 2, -paper.h / 2), local(paper.w / 2, -paper.h / 2)]
        for (const point of edge) {
          burst(fx, 7, () => ({ kind: 'dot', size: rand(2.5, 4.5), color: withAlpha('#d8cbb0', 0.8), drag: 5, life: rand(0.35, 0.55), fadeOut: 0.35 }), {
            x: point.x, y: point.y, speed: [60, 150], angle: point.y > paper.cy ? [Math.PI * 0.85, Math.PI * 2.15] : [0, TAU],
          })
        }
        this.stage.add(fx)
      }, at)
    } else if (effect === 'sparkle' || effect === 'pop' || effect === 'wipe') {
      const fx = new Particles()
      const count = effect === 'sparkle' ? 16 : 9
      for (let i = 0; i < count; i += 1) {
        const side = i % 4
        const f = Math.random()
        const u = side === 0 ? -paper.w / 2 - 6 : side === 1 ? paper.w / 2 + 6 : (f - 0.5) * paper.w
        const v = side === 2 ? -paper.h / 2 - 6 : side === 3 ? paper.h / 2 + 6 : (f - 0.5) * paper.h
        const at = local(u, v)
        fx.add(particle({ kind: 'star', x: at.x, y: at.y, size: rand(3, 6), color: pick(['#ffffff', '#ffe27a', this.palette.glow]), twinkle: 0.7, life: rand(0.5, 0.9), fadeIn: rand(0, 0.25), fadeOut: 0.3, vy: rand(-12, 4) }))
      }
      this.stage.add(fx)
    }
  }

  // ---- a checklist item checked ----

  /**
   * The item's own box and text move with the Web Animations API, which leaves
   * the editor's DOM alone (an attribute set on it would look like an edit to
   * ProseMirror); the particles are drawn on the window's canvas.
   */
  taskChecked(item: HTMLElement, label: HTMLElement, paper: PaperFrame, allDone: boolean): TaskEffect {
    const now = performance.now()
    this.streak = now - this.lastCheck < STREAK_GAP_MS ? Math.min(this.streak + 1, 11) : 0
    this.lastCheck = now
    const effect = this.picker.next()
    this.canvas.dataset.task = effect
    this.canvas.dataset.streak = String(this.streak)
    const pitch = pentatonic(1, this.streak)
    const box = label.getBoundingClientRect()
    const row = item.getBoundingClientRect()
    const rowLength = item.offsetWidth
    const lineOffset = 0
    this.animateItem(item, label, effect)
    const bx = box.left + box.width / 2
    const by = box.top + box.height / 2
    const pan = this.pan(bx)
    const fx = new Particles()
    const { palette } = this
    const green = '#5f9472'
    const cos = Math.cos(paper.rot)
    const sin = Math.sin(paper.rot)
    // Along the row (unrotated), starting at the box.
    const along = (distance: number, offset = 0) => ({ x: bx + distance * cos - offset * sin, y: by + distance * sin + offset * cos })
    const rowEnd = textEnd(item) ?? along(Math.max(40, rowLength - (bx - row.left) - 4), lineOffset)
    const up = -Math.PI / 2 + paper.rot

    switch (effect) {
      case 'tick':
        this.sound.play('tick', { pitch, pan })
        fx.add(particle({ kind: 'ring', x: bx, y: by, size: box.width * 0.8, grow: 115, line: 3.2, color: withAlpha(green, 0.85), life: 0.4, fadeOut: 0.4 }))
        fx.add(particle({ kind: 'glow', x: bx, y: by, size: box.width * 2.4, color: '#ffffff', alpha: 0.8, life: 0.25, fadeOut: 0.25 }))
        burst(fx, 14, () => ({ kind: Math.random() < 0.3 ? 'star' : 'dot', size: rand(3, 5), color: pick([green, palette.glow, '#ffffff', '#ffe27a']), drag: 5.5, life: rand(0.35, 0.6), fadeOut: 0.3 }), { x: bx, y: by, speed: [140, 260] })
        break
      case 'strike': {
        this.sound.play('marker', { pitch, pan })
        const start = along(box.width * 0.9, lineOffset)
        if (!this.still) this.stage.add(new Swipe(start, rowEnd, withAlpha(palette.glow, 0.6), Math.max(8, box.height * 0.85)))
        window.setTimeout(() => {
          if (this.still) return
          const end = new Particles()
          burst(end, 9, () => ({ kind: 'star', size: rand(4, 7), color: pick(['#ffffff', palette.glow, '#ffe27a']), drag: 4, life: rand(0.4, 0.65), twinkle: 0.4 }), { x: rowEnd.x, y: rowEnd.y, speed: [70, 160] })
          this.stage.add(end)
        }, 200)
        break
      }
      case 'confetti':
        this.sound.play('pop', { pitch: 1.6, gain: 0.35, pan })
        this.sound.play('tick', { pitch, pan, gain: 0.7 })
        burst(fx, 30, () => ({
          kind: Math.random() < 0.75 ? 'confetti' : 'dot',
          size: rand(4, 6.5),
          color: pick([...PARTY_COLORS, palette.glow]),
          gravity: 650,
          drag: 2.2,
          flipSpeed: rand(8, 16),
          spin: rand(-8, 8),
          rotation: rand(0, TAU),
          life: rand(0.7, 1.1),
          fadeOut: 0.35,
        }), { x: bx, y: by, speed: [200, 380], angle: [up - 0.9, up + 0.9] })
        break
      case 'stars':
        this.sound.play('tick', { pitch, pan, gain: 0.8 })
        this.sound.play('twinkles', { at: 0.05, gain: 0.7, pitch: pitch * 0.9 })
        burst(fx, 11, () => ({ kind: 'star', size: rand(5, 9), color: pick(['#ffe27a', '#ffffff', palette.glow]), drag: 4.5, life: rand(0.55, 0.85), twinkle: 0.5, fadeOut: 0.35 }), { x: bx, y: by, speed: [150, 270] })
        break
      case 'ripple':
        this.sound.play('plip', { pitch, pan })
        for (let i = 0; i < 3; i += 1) {
          fx.add(particle({ kind: 'ring', x: bx, y: by, size: box.width * 0.5, grow: 120 + i * 35, line: 3.2 - i * 0.7, color: withAlpha(i === 1 ? palette.glow : green, 0.8), life: 0.5 + i * 0.08, fadeIn: i * 0.08, fadeOut: 0.32 }))
        }
        break
      case 'coin':
        this.sound.play('coin', { pitch: Math.min(pitch, 1.6), pan })
        fx.add(particle({ kind: 'coin', x: bx, y: by - 4, vx: rand(-15, 15), vy: -260, gravity: 820, flipSpeed: 20, size: Math.max(8, box.width * 0.72), life: 0.66, fadeOut: 0.2 }))
        fx.add(particle({ kind: 'text', text: '+1', x: bx + 20, y: by - 6, vy: -60, drag: 1.2, size: 16, color: '#c98a0b', life: 0.85, fadeIn: 0.05, fadeOut: 0.35 }))
        burst(fx, 6, () => ({ kind: 'star', size: rand(3, 5), color: '#ffd95a', drag: 5, life: rand(0.3, 0.5), twinkle: 0.4 }), { x: bx, y: by - 4, speed: [80, 160] })
        break
      case 'shine':
        this.sound.play('shimmer', { pitch: pitch * 0.9, pan, gain: 0.8 })
        this.sound.play('tick', { pitch, pan, gain: 0.5 })
        if (!this.still) this.stage.add(new Glint(along(0, lineOffset), rowEnd, Math.max(14, box.height * 1.6)))
        burst(fx, 7, () => ({ kind: 'star', size: rand(4, 7), color: pick(['#ffffff', palette.glow]), drag: 3, life: rand(0.45, 0.75), twinkle: 0.6 }), { x: rowEnd.x, y: rowEnd.y, speed: [40, 110] })
        break
      case 'bubbles':
        this.sound.play('bloop', { pitch: pitch * 1.2, pan, gain: 0.7 })
        for (let i = 0; i < 8; i += 1) {
          fx.add(particle({
            kind: 'bubble',
            x: bx + rand(-4, 40),
            y: by + rand(-3, 3),
            size: rand(4.5, 9),
            color: pick(['#7ad7ff', palette.glow, '#ff9ad5']),
            vy: rand(-40, -80),
            gravity: -60,
            sway: rand(3, 7),
            swaySpeed: rand(3, 6),
            life: rand(0.45, 0.9),
            fadeIn: 0.08,
            fadeOut: 0.04,
            onEnd: (p) => {
              fx.add(particle({ kind: 'ring', x: p.x, y: p.y, size: p.size * 0.8, grow: 50, line: 1.2, color: 'rgba(255,255,255,0.9)', life: 0.14, fadeOut: 0.14 }))
              this.sound.play('bubble', { pitch: rand(1.1, 1.5), gain: 0.4, pan })
            },
          }))
        }
        break
      case 'hearts':
        this.sound.play('cute', { pitch: pitch * 0.9, pan, gain: 0.8 })
        for (let i = 0; i < 8; i += 1) {
          fx.add(particle({ kind: 'heart', x: bx + rand(-6, 6), y: by, vx: rand(-30, 50), vy: rand(-80, -150), gravity: -30, drag: 1, sway: rand(3, 9), swaySpeed: rand(3, 5), size: rand(9, 16), color: pick(['#ff5d8f', '#ff8fab', '#ff4d6d']), life: rand(0.65, 1.05), fadeIn: 0.06, fadeOut: 0.35 }))
        }
        break
      case 'spark':
        this.sound.play('spark', { pitch, pan })
        burst(fx, 20, () => ({ kind: 'spark', size: rand(1.8, 2.8), color: pick(['#ffd166', '#ffffff', palette.glow]), drag: 5, trail: 5, life: rand(0.32, 0.55), fadeOut: 0.25 }), { x: bx, y: by, speed: [180, 330] })
        break
    }
    // A streak says so at the end of the row.
    if (this.streak >= 2) {
      fx.add(particle({ kind: 'text', text: `连勾 ×${this.streak + 1}`, x: rowEnd.x + 34, y: rowEnd.y - 4, vy: -50, drag: 1.4, size: 12 + Math.min(6, this.streak), color: palette.deep, life: 0.9, fadeIn: 0.05, fadeOut: 0.35 }))
    }
    if (!this.still && fx.size > 0) this.stage.add(fx)
    if (allDone) window.setTimeout(() => this.allDone(paper), 260)
    return effect
  }

  private animateItem(item: HTMLElement, label: HTMLElement, effect: TaskEffect): void {
    if (this.still) return
    try {
      label.animate(
        [{ transform: 'scale(0.55)' }, { transform: 'scale(1.32)', offset: 0.45 }, { transform: 'scale(0.94)', offset: 0.75 }, { transform: 'scale(1)' }],
        { duration: 420, easing: 'ease-out' },
      )
      label.animate(
        [{ transform: 'rotate(45deg) scale(0)' }, { transform: 'rotate(45deg) scale(1.35)', offset: 0.6 }, { transform: 'rotate(45deg) scale(1)' }],
        { duration: 360, easing: 'ease-out', pseudoElement: '::after' },
      )
      const content = item.querySelector(':scope > div') as HTMLElement | null
      const strike = effect === 'strike'
      content?.animate(
        [
          { textDecorationColor: 'transparent', opacity: 1 },
          { textDecorationColor: 'transparent', opacity: 1, offset: strike ? 0.55 : 0.3 },
          { textDecorationColor: 'currentcolor', opacity: 0.55 },
        ],
        { duration: strike ? 460 : 320, easing: 'ease-out' },
      )
      if (effect === 'ripple' || effect === 'shine') {
        item.animate(
          [
            { backgroundColor: withAlpha(this.palette.glow, 0.45), borderRadius: '0.4em' },
            { backgroundColor: withAlpha(this.palette.glow, 0), borderRadius: '0.4em' },
          ],
          { duration: 650, easing: 'ease-out' },
        )
      }
      if (effect === 'shine') {
        item.animate(
          [{ boxShadow: `0 0 0 0 ${withAlpha(this.palette.glow, 0.7)}` }, { boxShadow: `0 0 14px 4px ${withAlpha(this.palette.glow, 0)}` }],
          { duration: 600, easing: 'ease-out' },
        )
      }
    } catch {
      // Older engines without pseudo-element animations: the particles still play.
    }
  }

  /** The last open item of the list was checked. */
  private allDone(paper: PaperFrame): void {
    this.sound.play('allDone')
    if (this.still) return
    const fx = new Particles()
    const top = { x: paper.cx + (paper.h / 2) * Math.sin(paper.rot), y: paper.cy - (paper.h / 2) * Math.cos(paper.rot) }
    burst(fx, 60, () => ({
      kind: Math.random() < 0.7 ? 'confetti' : 'ribbon',
      size: rand(4.5, 7.5),
      color: pick([...PARTY_COLORS, this.palette.glow]),
      gravity: 420,
      drag: 2.4,
      flipSpeed: rand(6, 14),
      spin: rand(-6, 6),
      rotation: rand(0, TAU),
      sway: rand(4, 12),
      swaySpeed: rand(3, 5),
      life: rand(1, 1.5),
      fadeOut: 0.5,
    }), { x: top.x, y: top.y + 30, speed: [140, 300], angle: [-Math.PI * 0.95, -Math.PI * 0.05] })
    fx.add(particle({ kind: 'text', text: '全部完成！', x: paper.cx, y: paper.cy, vy: -40, drag: 1, size: 22, color: this.palette.deep, life: 1.3, fadeIn: 0.1, fadeOut: 0.45, rotation: paper.rot }))
    for (let i = 0; i < 24; i += 1) {
      const u = rand(-0.5, 0.5) * paper.w
      const v = rand(-0.5, 0.5) * paper.h
      fx.add(particle({
        kind: 'star',
        x: paper.cx + u * Math.cos(paper.rot) - v * Math.sin(paper.rot),
        y: paper.cy + u * Math.sin(paper.rot) + v * Math.cos(paper.rot),
        size: rand(3, 6),
        color: pick(['#ffffff', '#ffe27a', this.palette.glow]),
        twinkle: 0.7,
        life: rand(0.6, 1.1),
        fadeIn: rand(0, 0.3),
        fadeOut: 0.3,
      }))
    }
    this.stage.add(fx)
  }

  // ---- leaving in the window itself (no effects overlay) ----

  leaveSound(kind: 'tear' | 'crumple'): void {
    if (kind === 'tear') this.sound.play('rip', { duration: 0.42 })
    else this.sound.play('crumple', { duration: 0.5 })
  }
}
