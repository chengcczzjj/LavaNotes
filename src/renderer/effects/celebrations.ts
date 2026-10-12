import type { CompleteEffect } from '@shared/effects'
import type { CueName, CueOptions, SoundBoard } from '../common/sfx'
import { pentatonic } from '../common/sfx'
import {
  PARTY_COLORS,
  Particles,
  TAU,
  burst,
  clamp,
  drawHeart,
  drawSparkle,
  ease,
  lerp,
  particle,
  phase,
  pick,
  rand,
  withAlpha,
  type Particle,
  type Scene,
} from '../common/fx'
import {
  LOCAL_PAD,
  drawImageInPaper,
  drawLocalPaper,
  drawPaper,
  enterPaper,
  eraseCell,
  localPaper,
  sampleCell,
  toWorld,
  type LocalPaper,
  type PaperPose,
  type PaperView,
} from './paper'

type Point = [number, number]

/** A bump 0 → 1 → 0 over [start, start + length]. */
function bump(t: number, start: number, length: number): number {
  const p = phase(t, start, length)
  return p > 0 && p < 1 ? Math.sin(Math.PI * p) : 0
}

/** Smooth noise in 0..1, good enough for organic edges. */
function wobble(u: number, v: number, seed: number): number {
  return (Math.sin(u * 0.045 + seed) + Math.sin(v * 0.06 + seed * 1.7) + Math.sin((u + v) * 0.027 + seed * 0.3) + Math.sin((u - v) * 0.09 + seed * 2.3) * 0.5) / 7 + 0.5
}

const COUNT_LIFE = 1.7

/**
 * One finished note leaving: the picture of the note, moved, cut up or turned
 * into particles, with sound cues scheduled at the moments they belong to.
 */
abstract class Celebration implements Scene {
  t = 0
  protected readonly fx = new Particles()
  protected abstract readonly length: number
  /** When the "finished today" count rises from the paper. */
  protected countAt = 0.45
  private readonly cues: Array<{ at: number; run: () => void; done: boolean }> = []
  protected readonly view: PaperView
  protected readonly sound: SoundBoard
  private readonly todayCount: number

  constructor(view: PaperView, sound: SoundBoard, todayCount: number) {
    this.view = view
    this.sound = sound
    this.todayCount = todayCount
  }

  /** Run something at a moment of the animation. */
  protected at(time: number, run: () => void): void {
    this.cues.push({ at: time, run, done: false })
  }

  /** Schedule a sound; Web Audio keeps the timing exact. */
  protected play(name: CueName, options: CueOptions = {}): void {
    this.sound.play(name, { pan: this.pan, ...options })
  }

  protected get pan(): number {
    return clamp(((this.view.cx / Math.max(1, this.view.stageWidth)) * 2 - 1) * 0.6, -0.6, 0.6)
  }

  protected world(u: number, v: number): { x: number; y: number } {
    return toWorld(this.view, u, v)
  }

  update(dt: number): boolean {
    this.t += dt
    for (const cue of this.cues) {
      if (!cue.done && cue.at <= this.t) {
        cue.done = true
        cue.run()
      }
    }
    this.step(dt)
    const alive = this.fx.update(dt)
    return this.t < this.length || alive || (this.todayCount > 0 && this.t < this.countAt + COUNT_LIFE)
  }

  protected step(_dt: number): void {}

  protected abstract paint(ctx: CanvasRenderingContext2D): void

  draw(ctx: CanvasRenderingContext2D): void {
    this.paint(ctx)
    this.drawCount(ctx)
  }

  /** "✓ 今天完成第 N 件", rising from where the note was. */
  private drawCount(ctx: CanvasRenderingContext2D): void {
    if (this.todayCount <= 0) return
    const p = phase(this.t, this.countAt, COUNT_LIFE)
    if (p <= 0 || p >= 1) return
    const alpha = p < 0.12 ? p / 0.12 : p > 0.72 ? (1 - p) / 0.28 : 1
    const scale = p < 0.12 ? 0.6 + 0.4 * ease.outBack(p / 0.12) : 1
    const text = `✓ 今天完成第 ${this.todayCount} 件`
    ctx.save()
    ctx.globalAlpha = clamp(alpha)
    ctx.translate(this.view.cx, this.view.cy + 8 - ease.outCubic(p) * 52)
    ctx.scale(scale, scale)
    ctx.font = '650 13px system-ui, "Segoe UI", "Microsoft YaHei UI", sans-serif'
    const width = ctx.measureText(text).width + 26
    ctx.fillStyle = 'rgba(42, 38, 30, 0.86)'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)'
    ctx.shadowBlur = 10
    ctx.shadowOffsetY = 3
    ctx.beginPath()
    ctx.roundRect(-width / 2, -15, width, 30, 15)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = '#fffaf0'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 0, 1)
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// 撕下飘落: ripped from the tape along a jagged line, then it flutters down.

class Tear extends Celebration {
  protected readonly length = 1.75
  private readonly jag: Point[]
  private readonly lineY: number
  private readonly dir = Math.random() < 0.5 ? -1 : 1

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    const { w, h } = view
    this.lineY = -h / 2 + Math.min(17, h * 0.12)
    const n = 18
    this.jag = Array.from({ length: n + 1 }, (_, i): Point => [-w / 2 - 3 + (i / n) * (w + 6), this.lineY + (i % 2 === 0 ? -1 : 1) * rand(1, 3.6)])
    if (this.dir < 0) this.jag.reverse()
    this.play('rip', { duration: 0.34 })
    this.play('flutter', { at: 0.38, duration: 0.9 })
  }

  protected step(): void {
    if (this.t > 0.36) return
    const { w } = this.view
    const front = -this.dir * w / 2 + this.dir * clamp(this.t / 0.34) * w
    for (let i = 0; i < 2; i += 1) {
      const at = this.world(front + rand(-6, 6), this.lineY)
      this.fx.add(particle({
        kind: 'square',
        x: at.x,
        y: at.y,
        vx: rand(-70, 70),
        vy: rand(-170, -40),
        gravity: 950,
        drag: 0.8,
        size: rand(1.4, 3.6),
        color: pick([this.view.palette.top, this.view.palette.bottom, '#ffffff']),
        spin: rand(-12, 12),
        life: rand(0.5, 0.95),
        fadeOut: 0.3,
      }))
    }
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this.view
    const t = this.t
    const tear = ease.inQuad(phase(t, 0, 0.34))
    const free = Math.max(0, t - 0.34)
    const d = this.dir

    // The strip with the tape stays on the desk a moment, then fades.
    const stripFade = phase(t, 0.28, 0.4)
    const strip: Point[] = [[-w / 2 - 40, -h / 2 - 50], [w / 2 + 40, -h / 2 - 50], ...[...this.jag].sort((a, b) => b[0] - a[0])]
    drawPaper(ctx, this.view, { clip: strip, alpha: 1 - stripFade, dy: -stripFade * 5 })

    // The body hangs from the end not yet torn, then falls with a flutter.
    const hinge = -d * 0.09 * tear
    const pose: PaperPose = {
      px: d * w / 2,
      py: this.lineY,
      rot: hinge + Math.sin(free * 4.6) * 0.2 * Math.min(1, free * 2.2) + d * 0.32 * free,
      dx: d * (36 * free + Math.sin(free * 5.4) * 20 * Math.min(1, free * 3)),
      dy: 0.5 * 1450 * free * free + 20 * free,
      sx: 1 - 0.12 * Math.min(1, free),
      sy: 1 - 0.12 * Math.min(1, free),
      alpha: 1 - phase(free, 0.75, 0.6),
    }
    const body: Point[] = [...[...this.jag].sort((a, b) => a[0] - b[0]), [w / 2 + 40, h / 2 + 50], [-w / 2 - 40, h / 2 + 50]]
    drawPaper(ctx, this.view, { ...pose, clip: body })

    // White fibres along the fresh edge.
    if (tear > 0 && (pose.alpha ?? 1) > 0) {
      ctx.save()
      ctx.globalAlpha = (pose.alpha ?? 1) * Math.min(1, tear * 3)
      enterPaper(ctx, this.view, pose)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.lineWidth = 1.8
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const shown = Math.ceil(this.jag.length * tear)
      this.jag.slice(0, Math.max(2, shown)).forEach(([u, v], i) => (i === 0 ? ctx.moveTo(u, v + 0.8) : ctx.lineTo(u, v + 0.8)))
      ctx.stroke()
      ctx.restore()
    }
    this.fx.draw(ctx)
  }
}

// ---------------------------------------------------------------------------
// 礼花: the paper pops and two party cannons fire confetti from its corners.

class Confetti extends Celebration {
  protected readonly length = 0.4

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    this.play('pop', { at: 0.1, pan: this.pan - 0.35 })
    this.play('pop', { at: 0.135, pan: this.pan + 0.35, pitch: 1.07 })
    this.play('chord', { at: 0.2 })
    this.play('rustle', { at: 0.28, duration: 1.8 })
    this.at(0.1, () => this.fire())
  }

  private fire(): void {
    const { w, h, palette } = this.view
    const colors = [...PARTY_COLORS, palette.glow, palette.glow, palette.top]
    for (const side of [-1, 1]) {
      const corner = this.world(side * (w / 2 - 12), h / 2 - 10)
      const aim = -Math.PI / 2 - side * 0.36
      burst(this.fx, 80, () => {
        const roll = Math.random()
        return {
          kind: roll < 0.66 ? 'confetti' : roll < 0.84 ? 'ribbon' : 'dot',
          size: roll < 0.66 ? rand(5, 8.5) : roll < 0.84 ? rand(6, 9) : rand(4, 6.5),
          color: pick(colors),
          gravity: 1100,
          drag: 1.9,
          flipSpeed: rand(6, 15),
          spin: rand(-8, 8),
          rotation: rand(0, TAU),
          sway: rand(6, 26),
          swaySpeed: rand(3, 6),
          life: rand(2.1, 3.2),
          fadeOut: 0.7,
        }
      }, { x: corner.x, y: corner.y, speed: [560, 1180], angle: [aim - 0.3, aim + 0.3] })
    }
    burst(this.fx, 16, () => ({
      kind: 'star',
      size: rand(4, 7),
      color: pick(['#ffffff', '#ffe27a']),
      drag: 3,
      life: rand(0.5, 0.85),
      twinkle: 0.4,
    }), { x: this.view.cx, y: this.view.cy, speed: [120, 320] })
    this.fx.add(particle({ kind: 'glow', x: this.view.cx, y: this.view.cy, size: Math.max(w, h) * 0.6, color: '#ffffff', life: 0.26, fadeOut: 0.26, alpha: 0.85 }))
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    const squash = ease.outQuad(phase(t, 0, 0.1))
    const pop = ease.outCubic(phase(t, 0.1, 0.14))
    const sx = (1 + 0.05 * squash) * (1 + 0.16 * pop)
    const sy = (1 - 0.06 * squash) * (1 + 0.2 * pop)
    drawPaper(ctx, this.view, { sx, sy, alpha: 1 - pop })
    this.fx.draw(ctx)
  }
}

// ---------------------------------------------------------------------------
// 烟花: the paper shrinks into a spark that shoots up and bursts; two more follow.

interface Rocket {
  x0: number
  y0: number
  x1: number
  y1: number
  launch: number
  flight: number
  colors: string[]
  sparks: number
  fired: boolean
}

class Fireworks extends Celebration {
  protected readonly length = 1.45
  private readonly rockets: Rocket[]

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    const { cx, cy, palette } = view
    const top = (rise: number) => Math.max(70, cy - rise)
    this.rockets = [
      { x0: cx, y0: cy, x1: cx + rand(-30, 30), y1: top(rand(230, 300)), launch: 0.3, flight: 0.55, colors: [palette.glow, '#ffd166', '#ffffff'], sparks: 95, fired: false },
      { x0: cx, y0: cy, x1: cx - rand(140, 200), y1: top(rand(150, 220)), launch: 0.5, flight: 0.5, colors: ['#ff6f91', '#ffc2d1', '#ffffff'], sparks: 60, fired: false },
      { x0: cx, y0: cy, x1: cx + rand(140, 200), y1: top(rand(160, 230)), launch: 0.64, flight: 0.5, colors: ['#4fd1ff', '#b388ff', '#ffffff'], sparks: 60, fired: false },
    ]
    this.rockets.forEach((rocket, i) => {
      const side = clamp(((rocket.x1 / Math.max(1, view.stageWidth)) * 2 - 1) * 0.7, -0.8, 0.8)
      this.play('whistle', { at: rocket.launch, duration: rocket.flight, gain: i === 0 ? 1 : 0.55, pitch: 1 + i * 0.12, pan: side })
      this.play('boom', { at: rocket.launch + rocket.flight, gain: i === 0 ? 1 : 0.6, pitch: 1 + i * 0.22, pan: side })
    })
    this.play('crackle', { at: 1.05, duration: 1.3 })
    this.countAt = 0.7
  }

  private position(rocket: Rocket): { x: number; y: number } {
    const p = ease.outQuad(phase(this.t, rocket.launch, rocket.flight))
    return { x: lerp(rocket.x0, rocket.x1, p), y: lerp(rocket.y0, rocket.y1, p) }
  }

  protected step(): void {
    for (const rocket of this.rockets) {
      if (this.t < rocket.launch) continue
      if (this.t < rocket.launch + rocket.flight) {
        const at = this.position(rocket)
        for (let i = 0; i < 2; i += 1) {
          this.fx.add(particle({ kind: 'dot', x: at.x + rand(-1.5, 1.5), y: at.y, vx: rand(-15, 15), vy: rand(30, 90), size: rand(2, 3.2), color: pick(['#ffd27a', '#fff3c4']), life: 0.38, fadeOut: 0.32, shrink: true }))
        }
      } else if (!rocket.fired) {
        rocket.fired = true
        this.explode(rocket)
      }
    }
  }

  private explode(rocket: Rocket): void {
    const { x1: x, y1: y } = rocket
    this.fx.add(particle({ kind: 'glow', x, y, size: 80, color: '#ffffff', life: 0.3, fadeOut: 0.3, alpha: 0.9 }))
    this.fx.add(particle({ kind: 'ring', x, y, size: 4, grow: 300, line: 4, color: withAlpha(rocket.colors[0], 0.8), life: 0.35, fadeOut: 0.35 }))
    const reach = rocket.sparks > 80 ? 430 : 330
    burst(this.fx, rocket.sparks, () => ({
      kind: 'spark',
      size: rand(2, 3),
      color: pick(rocket.colors),
      drag: 1.7,
      gravity: 240,
      trail: 7,
      life: rand(1, 1.7),
      fadeOut: 0.6,
    }), { x, y, speed: [reach * 0.55, reach] })
    burst(this.fx, Math.round(rocket.sparks / 3), () => ({
      kind: 'star',
      size: rand(2.5, 4.5),
      color: pick(rocket.colors),
      drag: 1.3,
      gravity: 110,
      twinkle: 0.7,
      life: rand(1.2, 1.9),
      fadeOut: 0.7,
    }), { x, y, speed: [50, 200] })
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    const shrink = ease.inCubic(phase(t, 0, 0.3))
    drawPaper(ctx, this.view, { sx: 1 - shrink * 0.96, sy: 1 - shrink * 0.96, alpha: 1 - phase(t, 0.18, 0.12) })
    // The orb the paper turns into.
    const orb = bump(t, 0.1, 0.32) * 34
    if (orb > 0.5) this.glow(ctx, this.view.cx, this.view.cy, orb, this.view.palette.glow)
    this.fx.draw(ctx)
    for (const rocket of this.rockets) {
      if (t >= rocket.launch && t < rocket.launch + rocket.flight) {
        const at = this.position(rocket)
        this.glow(ctx, at.x, at.y, 12, '#fff3c4')
      }
    }
  }

  private glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, '#ffffff')
    gradient.addColorStop(0.35, withAlpha(color, 0.9))
    gradient.addColorStop(1, withAlpha(color, 0))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, TAU)
    ctx.fill()
  }
}

// ---------------------------------------------------------------------------
// 盖章: a red rubber stamp slams onto the paper, which is then filed away.

class Stamp extends Celebration {
  protected readonly length = 1.4
  private readonly word = pick(['完成', '已完成', '搞定', 'DONE'])
  private readonly angle = -0.24 + rand(-0.1, 0.1)
  private readonly sw: number
  private readonly sh: number
  private readonly u: number
  private readonly v: number
  private readonly specks: Array<{ x: number; y: number; r: number }>
  private readonly splats: Array<{ x: number; y: number; r: number }>
  private readonly dir: number

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    const { w, h } = view
    this.sw = clamp(w * 0.6, 110, 200)
    this.sh = this.sw * 0.42
    this.u = rand(-w * 0.08, w * 0.08)
    this.v = rand(-h * 0.04, h * 0.1)
    this.dir = view.cx < view.stageWidth / 2 ? 1 : -1
    this.specks = Array.from({ length: 16 }, () => ({ x: rand(-0.5, 0.5) * this.sw, y: rand(-0.5, 0.5) * this.sh, r: rand(0.6, 1.8) }))
    this.splats = Array.from({ length: 12 }, () => {
      const a = rand(0, TAU)
      return { x: Math.cos(a) * this.sw * rand(0.55, 0.75), y: Math.sin(a) * this.sh * rand(0.6, 0.95), r: rand(0.8, 2.4) }
    })
    this.play('fwip', { pitch: 0.75, gain: 0.6 })
    this.play('thunk', { at: 0.22 })
    this.play('kaching', { at: 0.3 })
    this.play('whoosh', { at: 0.82, duration: 0.5, gain: 0.45 })
    this.at(0.22, () => this.impact())
    this.countAt = 0.5
  }

  private impact(): void {
    const center = this.world(this.u, this.v)
    for (const size of [0.5, 0.75]) {
      this.fx.add(particle({ kind: 'ring', x: center.x, y: center.y, size: this.sw * size, grow: 240, line: 3, color: 'rgba(214, 200, 176, 0.7)', life: 0.35, fadeOut: 0.35 }))
    }
    burst(this.fx, 12, () => ({ kind: 'dot', size: rand(2, 4), color: '#e8dcc8', drag: 4, life: rand(0.3, 0.5), fadeOut: 0.3 }), { x: center.x, y: center.y, speed: [140, 260] })
    burst(this.fx, 8, () => ({ kind: 'star', size: rand(4, 6), color: '#ffd86b', drag: 3, life: rand(0.4, 0.7), twinkle: 0.4 }), { x: center.x, y: center.y, speed: [160, 320] })
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    const drop = phase(t, 0, 0.22)
    const landed = t >= 0.22
    const shakeAmount = landed ? 5 * (1 - phase(t, 0.22, 0.24)) : 0
    const exit = ease.inCubic(phase(t, 0.8, 0.5))
    const pose: PaperPose = {
      dx: Math.sin(t * 90) * shakeAmount + exit * 160 * this.dir,
      dy: Math.cos(t * 77) * shakeAmount * 0.6 - exit * 200,
      sx: (1 - exit * 0.55) * (1 + 0.02 * bump(t, 0.22, 0.14)),
      sy: (1 - exit * 0.55) * (1 - 0.035 * bump(t, 0.22, 0.14)),
      rot: exit * 0.25 * this.dir,
      alpha: 1 - phase(t, 1.02, 0.3),
    }
    drawPaper(ctx, this.view, pose)

    ctx.save()
    ctx.globalAlpha = pose.alpha ?? 1
    enterPaper(ctx, this.view, pose)
    ctx.translate(this.u, this.v)
    ctx.rotate(this.angle)
    const scale = landed ? 1 - 0.04 * bump(t, 0.22, 0.08) : 2.6 - 1.6 * ease.inQuad(drop)
    if (!landed) {
      // The stamp's shadow, tightening as it comes down.
      ctx.fillStyle = `rgba(30, 10, 10, ${0.16 * drop})`
      ctx.beginPath()
      ctx.roundRect((-this.sw / 2) * scale * 0.9 + 8 * (1 - drop), (-this.sh / 2) * scale * 0.9 + 14 * (1 - drop), this.sw * scale * 0.9, this.sh * scale * 0.9, 10)
      ctx.fill()
    }
    ctx.scale(scale, scale)
    ctx.globalAlpha *= landed ? 0.9 : 0.2 + 0.65 * drop
    const red = '#d8343f'
    ctx.strokeStyle = red
    ctx.fillStyle = red
    ctx.lineWidth = 4.5
    ctx.beginPath()
    ctx.roundRect(-this.sw / 2, -this.sh / 2, this.sw, this.sh, 9)
    ctx.stroke()
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.roundRect(-this.sw / 2 + 6, -this.sh / 2 + 6, this.sw - 12, this.sh - 12, 6)
    ctx.stroke()
    ctx.font = `900 ${Math.round(this.sh * (this.word.length > 2 ? 0.46 : 0.56))}px "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this.word, 0, 2)
    if (landed) {
      // Gaps in the ink and a few splashes round the edge.
      ctx.fillStyle = withAlpha(this.view.palette.top, 0.55)
      for (const speck of this.specks) {
        ctx.beginPath()
        ctx.arc(speck.x, speck.y, speck.r, 0, TAU)
        ctx.fill()
      }
      ctx.fillStyle = red
      for (const splat of this.splats) {
        ctx.beginPath()
        ctx.arc(splat.x, splat.y, splat.r, 0, TAU)
        ctx.fill()
      }
    }
    ctx.restore()
    this.fx.draw(ctx)
  }
}

// ---------------------------------------------------------------------------
// 纸飞机: folded twice into a paper plane that takes off across the screen.

class Plane extends Celebration {
  protected readonly length = 2.05
  private readonly dir: number
  private readonly path: Point[]
  private readonly flyStart = 0.5
  private readonly flyLength = 1.3

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    const { cx, cy, stageWidth } = view
    this.dir = cx < stageWidth / 2 ? 1 : -1
    const d = this.dir
    this.path = [[cx, cy], [cx + d * 150, cy + 80], [cx + d * 430, cy - 210], [cx + d * Math.max(700, stageWidth * 0.75), cy - 640]]
    this.play('fold', { at: 0.02 })
    this.play('fold', { at: 0.21, pitch: 1.2 })
    this.play('whoosh', { at: this.flyStart - 0.04, duration: 1.15, gain: 0.95 })
    this.at(this.flyStart, () => {
      burst(this.fx, 9, () => ({ kind: 'dot', size: rand(3, 6), color: pick(['#ffffff', this.view.palette.top]), drag: 3.5, life: rand(0.35, 0.55), fadeOut: 0.35 }), {
        x: cx, y: cy, speed: [60, 160], angle: d > 0 ? [Math.PI * 0.6, Math.PI * 1.4] : [-Math.PI * 0.4, Math.PI * 0.4],
      })
    })
    this.countAt = 0.35
  }

  private where(u: number): { x: number; y: number; angle: number } {
    const [p0, p1, p2, p3] = this.path
    const a = 1 - u
    const x = a * a * a * p0[0] + 3 * a * a * u * p1[0] + 3 * a * u * u * p2[0] + u * u * u * p3[0]
    const y = a * a * a * p0[1] + 3 * a * a * u * p1[1] + 3 * a * u * u * p2[1] + u * u * u * p3[1]
    const dx = 3 * a * a * (p1[0] - p0[0]) + 6 * a * u * (p2[0] - p1[0]) + 3 * u * u * (p3[0] - p2[0])
    const dy = 3 * a * a * (p1[1] - p0[1]) + 6 * a * u * (p2[1] - p1[1]) + 3 * u * u * (p3[1] - p2[1])
    return { x, y, angle: Math.atan2(dy, dx) }
  }

  protected step(): void {
    if (this.t < this.flyStart || this.t > this.flyStart + this.flyLength) return
    const at = this.where(ease.inQuad(phase(this.t, this.flyStart, this.flyLength)))
    this.fx.add(particle({ kind: 'dot', x: at.x, y: at.y, size: 4, color: '#ffffff', alpha: 0.7, life: 0.7, fadeOut: 0.7, shrink: true }))
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    const fold1 = ease.inOutCubic(phase(t, 0, 0.2))
    const fold2 = ease.inOutCubic(phase(t, 0.2, 0.18))
    const morph = phase(t, 0.34, 0.14)
    const pose: PaperPose = { sx: 1 - 0.45 * fold1 - 0.22 * fold2, sy: 1 - 0.58 * fold2, alpha: 1 - morph }
    drawPaper(ctx, this.view, pose)
    if (fold1 > 0 && morph < 1) {
      ctx.save()
      ctx.globalAlpha = (1 - morph) * 0.25 * Math.sin(Math.PI * Math.min(1, fold1 + fold2 * 0.5))
      enterPaper(ctx, this.view, pose)
      ctx.fillStyle = '#3a2a10'
      ctx.fillRect(-1.5, -this.view.h / 2, 3, this.view.h)
      ctx.restore()
    }
    this.fx.draw(ctx)
    if (morph <= 0) return
    const flying = phase(t, this.flyStart, this.flyLength)
    const at = t < this.flyStart ? { x: this.view.cx, y: this.view.cy, angle: this.dir > 0 ? -0.15 : Math.PI + 0.15 } : this.where(ease.inQuad(flying))
    const alpha = morph * (1 - phase(t, this.flyStart + this.flyLength - 0.25, 0.25))
    this.drawPlane(ctx, at.x, at.y, at.angle, (0.7 + 0.3 * morph + 0.3 * flying) * 1.45, alpha)
  }

  private drawPlane(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, scale: number, alpha: number): void {
    const { palette } = this.view
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.scale(scale, scale * (Math.cos(angle) < 0 ? -1 : 1))
    ctx.shadowColor = 'rgba(30, 20, 10, 0.25)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 5
    ctx.lineJoin = 'round'
    ctx.strokeStyle = palette.edge
    ctx.lineWidth = 1
    ctx.fillStyle = palette.top
    ctx.beginPath()
    ctx.moveTo(32, 0)
    ctx.lineTo(-26, -20)
    ctx.lineTo(-14, 0)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = palette.bottom
    ctx.beginPath()
    ctx.moveTo(32, 0)
    ctx.lineTo(-26, 16)
    ctx.lineTo(-14, 0)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = withAlpha(palette.edge, 0.85)
    ctx.beginPath()
    ctx.moveTo(32, 0)
    ctx.lineTo(-18, 7)
    ctx.lineTo(-14, 0)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// 碎裂: cracks run out from one point and the paper breaks into falling shards.

interface Shard {
  poly: Point[]
  cu: number
  cv: number
  vx: number
  vy: number
  spin: number
  ox: number
  oy: number
  rot: number
  fade: number
}

/** Cut a polygon to a rectangle (Sutherland–Hodgman). */
function clipToRect(poly: Point[], x0: number, y0: number, x1: number, y1: number): Point[] {
  const edges: Array<[(p: Point) => boolean, (a: Point, b: Point) => Point]> = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ]
  let out = poly
  for (const [inside, cross] of edges) {
    const input = out
    out = []
    for (let i = 0; i < input.length; i += 1) {
      const current = input[i]
      const previous = input[(i + input.length - 1) % input.length]
      if (inside(current)) {
        if (!inside(previous)) out.push(cross(previous, current))
        out.push(current)
      } else if (inside(previous)) {
        out.push(cross(previous, current))
      }
    }
    if (out.length === 0) break
  }
  return out
}

function polygonArea(poly: Point[]): number {
  let area = 0
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % poly.length]
    area += x0 * y1 - x1 * y0
  }
  return Math.abs(area) / 2
}

class Shatter extends Celebration {
  protected readonly length = 1.95
  private readonly shards: Shard[] = []
  private readonly cracks: Point[][] = []
  private readonly iu: number
  private readonly iv: number
  private broken = false

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    const { w, h } = view
    this.iu = rand(-0.2, 0.2) * w
    this.iv = rand(-0.15, 0.1) * h
    const diagonal = Math.hypot(w, h)
    const rays = 11
    const angles = Array.from({ length: rays }, (_, i) => ((i + rand(-0.3, 0.3)) / rays) * TAU)
    const radii = [0, diagonal * rand(0.12, 0.18), diagonal * rand(0.3, 0.38), diagonal * 1.3]
    // Each ray's points are shared by the shards on both sides of it, so the jitter depends on the ray only.
    const point = (i: number, k: number): Point => {
      const ray = i % rays
      const a = angles[ray]
      const r = k === 0 ? 0 : radii[k] * (k === 3 ? 1 : 0.85 + ((ray * 7 + k * 13) % 10) / 33)
      return [this.iu + Math.cos(a) * r, this.iv + Math.sin(a) * r]
    }
    const x0 = -w / 2 - 1
    const y0 = -h / 2 - 13
    const x1 = w / 2 + 1
    const y1 = h / 2 + 1
    for (let i = 0; i < rays; i += 1) {
      this.cracks.push([point(i, 0), point(i, 1), point(i, 2)])
      this.cracks.push([point(i, 1), point(i + 1, 1)])
      for (let k = 0; k < 3; k += 1) {
        const raw: Point[] = k === 0 ? [point(i, 0), point(i, 1), point(i + 1, 1)] : [point(i, k), point(i, k + 1), point(i + 1, k + 1), point(i + 1, k)]
        const poly = clipToRect(raw, x0, y0, x1, y1)
        if (poly.length < 3 || polygonArea(poly) < 4) continue
        const cu = poly.reduce((sum, p) => sum + p[0], 0) / poly.length
        const cv = poly.reduce((sum, p) => sum + p[1], 0) / poly.length
        const away = Math.atan2(cv - this.iv, cu - this.iu) + view.rot
        const near = 1 - clamp(Math.hypot(cu - this.iu, cv - this.iv) / diagonal)
        const speed = rand(50, 170) + 230 * near
        this.shards.push({ poly, cu, cv, vx: Math.cos(away) * speed, vy: Math.sin(away) * speed - rand(40, 170), spin: rand(-5, 5), ox: 0, oy: 0, rot: 0, fade: rand(0.7, 1.1) })
      }
    }
    this.play('crack')
    this.play('crack', { at: 0.16, pitch: 0.8, gain: 0.7 })
    this.play('tinkle', { at: 0.2, duration: 1.1 })
    this.at(0.16, () => {
      this.broken = true
      const at = this.world(this.iu, this.iv)
      burst(this.fx, 12, () => ({ kind: 'star', size: rand(3, 6), color: '#ffffff', drag: 3, life: rand(0.35, 0.6), twinkle: 0.4 }), { x: at.x, y: at.y, speed: [80, 260] })
    })
    this.countAt = 0.5
  }

  protected step(dt: number): void {
    if (!this.broken) return
    for (const shard of this.shards) {
      shard.vy += 1700 * dt
      shard.ox += shard.vx * dt
      shard.oy += shard.vy * dt
      shard.rot += shard.spin * dt
    }
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    if (!this.broken) {
      const shake = 2.2 * (1 - phase(t, 0, 0.16))
      const pose: PaperPose = { dx: Math.sin(t * 120) * shake, dy: Math.cos(t * 97) * shake * 0.5 }
      drawPaper(ctx, this.view, pose)
      const grow = ease.outCubic(phase(t, 0, 0.12))
      ctx.save()
      enterPaper(ctx, this.view, pose)
      ctx.beginPath()
      ctx.rect(-this.view.w / 2, -this.view.h / 2 - 12, this.view.w, this.view.h + 12)
      ctx.clip()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const [width, color] of [[2.8, 'rgba(40, 30, 15, 0.28)'], [1.3, 'rgba(255, 255, 255, 0.95)']] as const) {
        ctx.lineWidth = width
        ctx.strokeStyle = color
        for (const crack of this.cracks) {
          ctx.beginPath()
          crack.forEach(([u, v], i) => {
            const x = lerp(crack[0][0], u, grow)
            const y = lerp(crack[0][1], v, grow)
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.stroke()
        }
      }
      ctx.restore()
      return
    }
    for (const shard of this.shards) {
      const alpha = 1 - phase(t, 0.7 * shard.fade, 0.9 * shard.fade)
      if (alpha <= 0) continue
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(shard.ox, shard.oy)
      enterPaper(ctx, this.view)
      ctx.translate(shard.cu, shard.cv)
      ctx.rotate(shard.rot)
      ctx.translate(-shard.cu, -shard.cv)
      ctx.beginPath()
      shard.poly.forEach(([u, v], i) => (i === 0 ? ctx.moveTo(u, v) : ctx.lineTo(u, v)))
      ctx.closePath()
      ctx.save()
      ctx.clip()
      drawImageInPaper(ctx, this.view)
      ctx.restore()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }
    this.fx.draw(ctx)
  }
}

// ---------------------------------------------------------------------------
// 泡泡: the paper wobbles like jelly and turns into bubbles that float up and pop.

class Bubbles extends Celebration {
  protected readonly length = 0.6
  private lastPop = 0

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    this.play('boing', { gain: 0.6, pitch: 1.2 })
    this.play('bloop', { at: 0.3 })
    this.at(0.3, () => this.foam())
    this.countAt = 0.6
  }

  private foam(): void {
    const { w, h, palette } = this.view
    const colors = [palette.glow, '#7ad7ff', '#ff9ad5', '#b8f2a0', '#ffe27a']
    const step = 34
    const cols = Math.max(2, Math.round(w / step))
    const rows = Math.max(2, Math.round(h / step))
    const reach = Math.hypot(w, h) / 2
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const u = -w / 2 + ((col + 0.5) / cols) * w + rand(-8, 8)
        const v = -h / 2 + ((row + 0.5) / rows) * h + rand(-8, 8)
        const at = this.world(u, v)
        const center = 1 - Math.hypot(u, v) / reach
        this.fx.add(particle({
          kind: 'bubble',
          x: at.x,
          y: at.y,
          size: rand(7, 16) * (1 + 0.45 * center),
          color: pick(colors),
          vx: rand(-25, 25),
          vy: rand(-50, -130),
          gravity: -rand(30, 90),
          drag: 0.3,
          sway: rand(6, 18),
          swaySpeed: rand(2, 4.5),
          life: rand(0.45, 2.2),
          fadeIn: 0.12,
          fadeOut: 0.04,
          onEnd: (p) => this.burstBubble(p),
        }))
      }
    }
  }

  private burstBubble(p: Particle): void {
    const x = p.x + Math.sin(p.age * p.swaySpeed + p.seed) * p.sway
    this.fx.add(particle({ kind: 'ring', x, y: p.y, size: p.size * 0.8, grow: 90, line: 1.6, color: 'rgba(255, 255, 255, 0.9)', life: 0.16, fadeOut: 0.16 }))
    burst(this.fx, 5, () => ({ kind: 'dot', size: rand(1.6, 2.6), color: 'rgba(255, 255, 255, 0.9)', gravity: 500, life: 0.28, fadeOut: 0.2 }), { x, y: p.y, speed: [50, 120] })
    const now = performance.now()
    if (now - this.lastPop > 35) {
      this.lastPop = now
      this.sound.play('bubble', { pitch: clamp(1.35 - p.size / 40, 0.7, 1.4), pan: clamp((x / Math.max(1, this.view.stageWidth)) * 2 - 1, -0.8, 0.8), gain: 0.65 })
    }
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    const settle = 1 - phase(t, 0, 0.3)
    const wobble = Math.sin(t * 34) * 0.07 * settle
    const dissolve = phase(t, 0.28, 0.14)
    drawPaper(ctx, this.view, { sx: (1 + wobble) * (1 + 0.05 * dissolve), sy: (1 - wobble) * (1 + 0.05 * dissolve), alpha: 1 - dissolve })
    this.fx.draw(ctx)
  }
}

// ---------------------------------------------------------------------------
// 星光: the paper spins into a point of light that flashes into a star burst.

class StarBurst extends Celebration {
  protected readonly length = 1.15

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    this.play('magic', { at: 0.02 })
    this.play('ding', { at: 0.5, pitch: 1.2, gain: 0.55 })
    for (const at of [0.62, 0.74, 0.88, 1.02]) this.play('twinkle', { at, pan: rand(-0.6, 0.6) })
    this.at(0.5, () => this.flash())
    this.countAt = 0.62
  }

  private flash(): void {
    const { cx: x, cy: y, palette } = this.view
    this.fx.add(particle({ kind: 'glow', x, y, size: 130, color: palette.glow, life: 0.5, fadeOut: 0.5, alpha: 0.9 }))
    this.fx.add(particle({ kind: 'ring', x, y, size: 8, grow: 660, line: 7, color: withAlpha(palette.glow, 0.85), life: 0.5, fadeOut: 0.5 }))
    this.fx.add(particle({ kind: 'ring', x, y, size: 6, grow: 430, line: 4, color: 'rgba(255, 255, 255, 0.9)', life: 0.45, fadeOut: 0.45 }))
    burst(this.fx, 44, () => ({ kind: 'star', size: rand(3, 7.5), color: pick(['#ffffff', '#ffe27a', palette.glow]), drag: 2.4, gravity: 50, twinkle: 0.5, life: rand(0.9, 1.6), fadeOut: 0.5 }), { x, y, speed: [140, 470] })
    for (let i = 0; i < 36; i += 1) {
      const a = rand(0, TAU)
      const r = rand(10, 140)
      this.fx.add(particle({ kind: 'dot', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.7, vy: rand(-30, 20), gravity: 60, sway: rand(4, 12), swaySpeed: rand(2, 5), size: rand(1.5, 3), color: pick(['#ffffff', '#ffe27a', palette.glow]), twinkle: 0.8, life: rand(1.2, 2), fadeOut: 0.6 }))
    }
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    const { cx, cy, palette } = this.view
    const spin = ease.inCubic(phase(t, 0, 0.55))
    if (spin > 0 && t < 0.6) {
      const radius = 40 + spin * 90
      const aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
      aura.addColorStop(0, withAlpha(palette.glow, 0.7 * spin))
      aura.addColorStop(1, withAlpha(palette.glow, 0))
      ctx.fillStyle = aura
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, TAU)
      ctx.fill()
    }
    drawPaper(ctx, this.view, { rot: spin * Math.PI * 3, sx: 1 - spin, sy: 1 - spin, alpha: 1 - phase(t, 0.42, 0.14) })
    this.fx.draw(ctx)
    const f = phase(t, 0.45, 0.6)
    if (f > 0 && f < 1) {
      const s = f < 0.28 ? ease.outBack(f / 0.28) : 1 - ease.inQuad((f - 0.28) / 0.72)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(f * 1.3)
      ctx.shadowColor = palette.glow
      ctx.shadowBlur = 34
      ctx.fillStyle = '#ffffff'
      drawSparkle(ctx, 78 * s)
      ctx.fill()
      ctx.rotate(Math.PI / 4)
      ctx.globalAlpha = 0.7
      ctx.fillStyle = '#fff4c2'
      drawSparkle(ctx, 42 * s)
      ctx.fill()
      ctx.restore()
    }
  }
}

// ---------------------------------------------------------------------------
// 随风散去: the paper breaks into specks of its own colour and blows away.

interface Cell {
  u: number
  v: number
  at: number
  color: string | null
  alpha: number
}

class Dust extends Celebration {
  protected readonly length = 1.25
  private readonly paper: LocalPaper
  private readonly cells: Cell[] = []
  private next = 0
  private readonly size = 5
  private readonly dir = Math.random() < 0.5 ? -1 : 1

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    this.paper = localPaper(view)
    const { left, top, width, height } = this.paper
    const seed = rand(0, 100)
    for (let v = top; v < top + height; v += this.size) {
      for (let u = left; u < left + width; u += this.size) {
        const sample = sampleCell(this.paper, u, v, this.size, 0.06)
        const across = this.dir > 0 ? (u - left) / width : (left + width - u) / width
        this.cells.push({ u, v, at: 0.06 + across * 0.78 + wobble(u, v, seed) * 0.22, color: sample && sample.alpha > 0.4 ? sample.color : null, alpha: sample?.alpha ?? 0 })
      }
    }
    this.cells.sort((a, b) => a.at - b.at)
    this.play('sand', { at: 0.04, duration: 1.3 })
    this.countAt = 0.55
  }

  protected step(): void {
    const crowded = this.cells.length > 4200
    while (this.next < this.cells.length && this.cells[this.next].at <= this.t) {
      const cell = this.cells[this.next]
      this.next += 1
      eraseCell(this.paper, cell.u, cell.v, this.size)
      if (!cell.color || (crowded && this.next % 2 === 0)) continue
      const at = this.world(cell.u + this.size / 2, cell.v + this.size / 2)
      this.fx.add(particle({
        kind: 'square',
        x: at.x,
        y: at.y,
        size: this.size * rand(0.7, 1.05),
        color: cell.color,
        alpha: cell.alpha,
        rotation: this.view.rot,
        vx: this.dir * rand(50, 180),
        vy: rand(-120, -20),
        gravity: -rand(10, 60),
        drag: 0.6,
        sway: rand(4, 14),
        swaySpeed: rand(2, 5),
        spin: rand(-2, 2),
        life: rand(0.8, 1.5),
        shrink: true,
        fadeOut: 0.5,
      }))
    }
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    drawLocalPaper(ctx, this.view, this.paper)
    this.fx.draw(ctx)
  }
}

// ---------------------------------------------------------------------------
// 漩涡: the paper is pulled into a whirlpool and vanishes with a pop.

interface Tile {
  sx: number
  sy: number
  sw: number
  sh: number
  w: number
  h: number
  r0: number
  a0: number
  delay: number
}

class Vortex extends Celebration {
  protected readonly length = 1.3
  private readonly tiles: Tile[] = []
  private readonly spinDir = Math.random() < 0.5 ? -1 : 1
  private readonly reach: number

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    const { frame } = view
    const size = 20
    const image = view.image as { width: number; height: number }
    const k = image.width / frame.width
    // Which tiles have anything in them: a small copy of the picture, one pixel per tile.
    const cols = Math.ceil(frame.width / size)
    const rows = Math.ceil(frame.height / size)
    const probe = document.createElement('canvas')
    probe.width = cols
    probe.height = rows
    const pctx = probe.getContext('2d', { willReadFrequently: true })!
    pctx.drawImage(view.image, 0, 0, cols, rows)
    const alpha = pctx.getImageData(0, 0, cols, rows).data
    let reach = 1
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (alpha[(row * cols + col) * 4 + 3] < 8) continue
        const w = Math.min(size, frame.width - col * size)
        const h = Math.min(size, frame.height - row * size)
        const x = frame.x + col * size + w / 2 - view.cx
        const y = frame.y + row * size + h / 2 - view.cy
        const r0 = Math.hypot(x, y)
        reach = Math.max(reach, r0)
        this.tiles.push({ sx: col * size * k, sy: row * size * k, sw: w * k, sh: h * k, w, h, r0, a0: Math.atan2(y, x), delay: 0 })
      }
    }
    this.reach = reach
    for (const tile of this.tiles) tile.delay = 0.05 + 0.28 * (tile.r0 / reach) * rand(0.8, 1.2)
    this.play('swirl', { duration: 1.05 })
    this.play('bloop', { at: 1.05, pitch: 0.6 })
    this.play('twinkle', { at: 1.1 })
    this.at(1.05, () => {
      const { cx: x, cy: y, palette } = this.view
      this.fx.add(particle({ kind: 'glow', x, y, size: 60, color: '#ffffff', life: 0.3, fadeOut: 0.3 }))
      this.fx.add(particle({ kind: 'ring', x, y, size: 4, grow: 320, line: 4, color: withAlpha(palette.glow, 0.85), life: 0.35, fadeOut: 0.35 }))
      burst(this.fx, 14, () => ({ kind: 'star', size: rand(3, 6), color: pick(['#ffffff', palette.glow]), drag: 3, life: rand(0.4, 0.7), twinkle: 0.4 }), { x, y, speed: [100, 280] })
    })
    this.countAt = 0.8
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    const { cx, cy, palette } = this.view
    if (t < 0.05) {
      drawPaper(ctx, this.view)
      return
    }
    // Spiral arms behind the pieces.
    const pull = phase(t, 0.05, 1)
    if (pull < 1) {
      ctx.save()
      ctx.lineCap = 'round'
      for (let arm = 0; arm < 4; arm += 1) {
        ctx.beginPath()
        for (let s = 0; s <= 1.001; s += 0.05) {
          const radius = this.reach * 1.05 * (1 - s) * (1 - pull * 0.7)
          const angle = this.spinDir * (t * 5 + s * 4.2) + (arm * TAU) / 4
          const x = cx + Math.cos(angle) * radius
          const y = cy + Math.sin(angle) * radius
          if (s === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = withAlpha(palette.glow, 0.32 * Math.sin(Math.PI * pull))
        ctx.lineWidth = 3
        ctx.stroke()
      }
      ctx.restore()
    }
    for (const tile of this.tiles) {
      const p = ease.inCubic(phase(t, tile.delay, 0.8))
      if (p >= 1) continue
      const r = tile.r0 * (1 - p)
      const a = tile.a0 + this.spinDir * p ** 1.4 * TAU * 1.6
      const s = 1 - 0.9 * p
      ctx.save()
      ctx.globalAlpha = 1 - phase(p, 0.85, 0.15)
      ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      ctx.rotate(a - tile.a0)
      ctx.scale(s, s)
      // A pixel of overlap hides the seams between neighbouring pieces.
      ctx.drawImage(this.view.image, tile.sx, tile.sy, tile.sw, tile.sh, -tile.w / 2 - 0.5, -tile.h / 2 - 0.5, tile.w + 1, tile.h + 1)
      ctx.restore()
    }
    this.fx.draw(ctx)
  }
}

// ---------------------------------------------------------------------------
// 爱心: two heartbeats, then the paper bursts into floating hearts.

class Hearts extends Celebration {
  protected readonly length = 1.4

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    this.play('heartbeat', { at: 0.03 })
    this.play('cute', { at: 0.5 })
    for (const at of [0.58, 0.66, 0.76]) this.play('bubble', { at, pitch: rand(1.1, 1.4), gain: 0.45, pan: rand(-0.5, 0.5) })
    this.at(0.5, () => this.release())
    this.countAt = 0.75
  }

  private release(): void {
    const { w, h } = this.view
    const colors = ['#ff5d8f', '#ff8fab', '#ff4d6d', '#ffb3c6', '#ff7aa2']
    for (let i = 0; i < 28; i += 1) {
      const at = this.world(rand(-w / 2 + 10, w / 2 - 10), rand(-h / 2 + 10, h / 2 - 10))
      this.fx.add(particle({
        kind: 'heart',
        x: at.x,
        y: at.y,
        size: rand(10, 25),
        color: pick(colors),
        vx: rand(-45, 45),
        vy: rand(-140, -270),
        gravity: -50,
        drag: 0.7,
        sway: rand(10, 26),
        swaySpeed: rand(2, 4),
        rotation: rand(-0.3, 0.3),
        spin: rand(-1, 1),
        life: rand(1.3, 2.1),
        fadeIn: 0.08,
        fadeOut: 0.6,
      }))
    }
    burst(this.fx, 16, () => ({ kind: 'dot', size: rand(2.5, 4), color: pick(colors), drag: 3, life: rand(0.4, 0.7), fadeOut: 0.3 }), { x: this.view.cx, y: this.view.cy, speed: [180, 360] })
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    const beat = 1 + 0.07 * bump(t, 0.03, 0.13) + 0.1 * bump(t, 0.2, 0.15)
    const out = phase(t, 0.5, 0.15)
    drawPaper(ctx, this.view, { sx: beat * (1 + 0.12 * out), sy: beat * (1 + 0.12 * out), alpha: 1 - out })
    this.fx.draw(ctx)
    const f = phase(t, 0.5, 0.85)
    if (f > 0 && f < 1) {
      const size = 116 * (f < 0.35 ? ease.outBack(f / 0.35) : 1 + 0.15 * (f - 0.35))
      ctx.save()
      ctx.globalAlpha = 1 - phase(f, 0.55, 0.45)
      ctx.translate(this.view.cx, this.view.cy - 10 * f)
      ctx.shadowColor = 'rgba(255, 77, 109, 0.6)'
      ctx.shadowBlur = 24
      const fill = ctx.createLinearGradient(0, -size / 2, 0, size / 2)
      fill.addColorStop(0, '#ff8fab')
      fill.addColorStop(1, '#ff4d6d')
      ctx.fillStyle = fill
      drawHeart(ctx, size)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
      ctx.beginPath()
      ctx.ellipse(-size * 0.2, -size * 0.14, size * 0.11, size * 0.06, -0.6, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
  }
}

// ---------------------------------------------------------------------------
// 气球: balloons blow up above the paper and carry it away.

interface Balloon {
  au: number
  bx: number
  length: number
  r: number
  color: string
  delay: number
  seed: number
}

class Balloons extends Celebration {
  protected readonly length = 2.75
  private readonly balloons: Balloon[]

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    const { w, palette } = view
    const pool = [palette.glow, '#ff6f91', '#4fb3ff', '#ffcf3f', '#5ad1a4', '#b388ff'].sort(() => Math.random() - 0.5)
    const n = w > 250 ? 3 : 2
    this.balloons = Array.from({ length: n }, (_, i) => {
      const au = n === 3 ? (i - 1) * w * 0.3 : (i - 0.5) * w * 0.42
      return { au, bx: (au / (w / 2)) * rand(16, 34) + rand(-6, 6), length: rand(70, 100), r: rand(21, 27), color: pool[i], delay: i * 0.11, seed: rand(0, 10) }
    })
    this.balloons.forEach((balloon) => this.play('inflate', { at: balloon.delay, pitch: rand(0.9, 1.15) }))
    this.play('float', { at: 0.55, duration: 1.9 })
    this.play('chord', { at: 0.62, pitch: 0.75, gain: 0.5 })
    this.countAt = 0.4
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    const { h } = this.view
    const lift = Math.max(0, t - 0.55)
    const pose: PaperPose = {
      dx: Math.sin(lift * 2.1) * 16 * Math.min(1, lift * 2),
      dy: -0.5 * 560 * lift * lift - 30 * lift,
      rot: Math.sin(lift * 2.6) * 0.07 * Math.min(1, lift * 2),
      px: 0,
      py: -h / 2,
      alpha: 1 - phase(t, 2.3, 0.45),
    }
    drawPaper(ctx, this.view, pose)
    const cos = Math.cos(pose.rot ?? 0)
    const sin = Math.sin(pose.rot ?? 0)
    ctx.save()
    ctx.globalAlpha = pose.alpha ?? 1
    for (const balloon of this.balloons) {
      const s = ease.outBack(phase(t, balloon.delay, 0.32))
      if (s <= 0) continue
      // The string's end on the paper follows the paper's sway about its top edge.
      const lu = balloon.au * cos
      const lv = -h / 2 + 5 + balloon.au * sin
      const anchor = this.world(lu, lv)
      const ax = anchor.x + (pose.dx ?? 0)
      const ay = anchor.y + (pose.dy ?? 0)
      const bob = Math.sin(t * 3 + balloon.seed) * 3
      const bx = ax + balloon.bx * s + Math.sin(t * 1.7 + balloon.seed) * 4
      const by = ay - balloon.length * s + bob
      const r = balloon.r * s
      ctx.strokeStyle = 'rgba(70, 60, 40, 0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.quadraticCurveTo(lerp(ax, bx, 0.5) + Math.sin(t * 4 + balloon.seed) * 6, lerp(ay, by, 0.5), bx, by + r * 1.15)
      ctx.stroke()
      const fill = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.45, r * 0.1, bx, by, r * 1.25)
      fill.addColorStop(0, '#ffffff')
      fill.addColorStop(0.25, balloon.color)
      fill.addColorStop(1, withAlpha(balloon.color, 0.92))
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.ellipse(bx, by, Math.max(0.5, r), Math.max(0.5, r * 1.18), 0, 0, TAU)
      ctx.fill()
      ctx.fillStyle = balloon.color
      ctx.beginPath()
      ctx.moveTo(bx, by + r * 1.12)
      ctx.lineTo(bx - r * 0.16, by + r * 1.3)
      ctx.lineTo(bx + r * 0.16, by + r * 1.3)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
      ctx.beginPath()
      ctx.ellipse(bx - r * 0.38, by - r * 0.42, r * 0.16, r * 0.28, -0.5, 0, TAU)
      ctx.fill()
    }
    ctx.restore()
    this.fx.draw(ctx)
  }
}

// ---------------------------------------------------------------------------
// 完美: press, release with a shockwave and a sunburst, a big tick and a word of praise.

class Perfect extends Celebration {
  protected readonly length = 1.4
  private readonly word = pick(['完美！', '漂亮！', '搞定！', '太棒了！', '真棒！', 'Nice!'])

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    this.play('whoomp', { at: 0.11 })
    this.play('ding', { at: 0.34 })
    this.play('twinkles', { at: 0.42, gain: 0.8 })
    this.at(0.12, () => this.wave())
    this.countAt = 0.6
  }

  private wave(): void {
    const { cx: x, cy: y, w, h, palette } = this.view
    this.fx.add(particle({ kind: 'ring', x, y, size: Math.max(w, h) * 0.35, grow: 760, line: 8, color: 'rgba(255, 255, 255, 0.9)', life: 0.5, fadeOut: 0.5 }))
    this.fx.add(particle({ kind: 'ring', x, y, size: Math.max(w, h) * 0.3, grow: 520, line: 5, color: withAlpha(palette.glow, 0.9), life: 0.55, fadeOut: 0.55 }))
    for (let i = 0; i < 24; i += 1) {
      const side = i % 4
      const f = Math.random()
      const u = side === 0 ? -w / 2 : side === 1 ? w / 2 : lerp(-w / 2, w / 2, f)
      const v = side === 2 ? -h / 2 : side === 3 ? h / 2 : lerp(-h / 2, h / 2, f)
      const at = this.world(u, v)
      const away = Math.atan2(at.y - y, at.x - x)
      const speed = rand(60, 200)
      this.fx.add(particle({ kind: 'star', x: at.x, y: at.y, vx: Math.cos(away) * speed, vy: Math.sin(away) * speed, drag: 2, size: rand(3.5, 6.5), color: pick(['#ffffff', '#ffe27a', palette.glow]), twinkle: 0.5, life: rand(0.6, 1), fadeOut: 0.4 }))
    }
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    const { cx, cy, w, h, palette } = this.view
    const press = ease.outQuad(phase(t, 0, 0.12))
    const release = ease.outBack(phase(t, 0.12, 0.2))
    const exit = ease.inBack(phase(t, 0.9, 0.36))
    const s = (t < 0.12 ? 1 - 0.06 * press : 0.94 + 0.08 * release) * (1 - exit)
    const alpha = 1 - phase(t, 1.14, 0.12)

    // Sunburst behind the paper.
    const grow = ease.outCubic(phase(t, 0.12, 0.3))
    const fade = 1 - phase(t, 0.85, 0.45)
    if (grow > 0 && fade > 0) {
      const radius = Math.max(w, h) * 1.05 * grow
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(t * 0.6)
      for (let i = 0; i < 14; i += 1) {
        const a = (i / 14) * TAU
        const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
        const color = i % 2 === 0 ? palette.glow : '#ffffff'
        fill.addColorStop(0, withAlpha(color, 0.42 * fade))
        fill.addColorStop(1, withAlpha(color, 0))
        ctx.fillStyle = fill
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, radius, a, a + TAU / 28)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
    }

    const pose: PaperPose = { sx: s, sy: s, alpha }
    drawPaper(ctx, this.view, pose)

    // The big tick, drawn in one stroke.
    const stroke = ease.outCubic(phase(t, 0.16, 0.24))
    if (stroke > 0 && s > 0.02) {
      const points: Point[] = [[-0.26 * w, 0.0 * h], [-0.07 * w, 0.2 * h], [0.3 * w, -0.22 * h]]
      const first = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1])
      const second = Math.hypot(points[2][0] - points[1][0], points[2][1] - points[1][1])
      const drawn = stroke * (first + second)
      const path = (c: CanvasRenderingContext2D) => {
        c.beginPath()
        c.moveTo(points[0][0], points[0][1])
        if (drawn <= first) {
          const f = drawn / first
          c.lineTo(lerp(points[0][0], points[1][0], f), lerp(points[0][1], points[1][1], f))
        } else {
          const f = (drawn - first) / second
          c.lineTo(points[1][0], points[1][1])
          c.lineTo(lerp(points[1][0], points[2][0], f), lerp(points[1][1], points[2][1], f))
        }
      }
      const width = clamp(w * 0.075, 12, 26)
      ctx.save()
      ctx.globalAlpha = alpha
      enterPaper(ctx, this.view, pose)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.shadowColor = palette.glow
      ctx.shadowBlur = 14
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.lineWidth = width + 8
      path(ctx)
      ctx.stroke()
      ctx.shadowColor = 'transparent'
      ctx.strokeStyle = '#2fa36b'
      ctx.lineWidth = width
      path(ctx)
      ctx.stroke()
      ctx.restore()
    }

    this.fx.draw(ctx)

    const f = phase(t, 0.3, 1.05)
    if (f > 0 && f < 1) {
      const scale = f < 0.2 ? ease.outBack(f / 0.2) : 1
      ctx.save()
      ctx.globalAlpha = 1 - phase(f, 0.7, 0.3)
      ctx.translate(cx, cy - h * 0.5 - 22 - ease.outCubic(f) * 30)
      ctx.scale(scale, scale)
      ctx.font = '800 30px system-ui, "Segoe UI", "Microsoft YaHei UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 7
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.strokeText(this.word, 0, 0)
      ctx.fillStyle = palette.deep
      ctx.fillText(this.word, 0, 0)
      ctx.restore()
    }
  }
}

// ---------------------------------------------------------------------------
// 像素雨: the paper turns into big pixels that rain down and bounce on the floor.

interface Block {
  u: number
  v: number
  color: string
  alpha: number
}

class Pixels extends Celebration {
  protected readonly length = 0.6
  private readonly paper: LocalPaper
  private readonly blocks: Block[] = []
  private readonly size = 10
  private released = 0
  private readonly mosaic = document.createElement('canvas')

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    this.paper = localPaper(view, 1)
    const { left, top, width, height } = this.paper
    for (let v = top; v < top + height; v += this.size) {
      for (let u = left; u < left + width; u += this.size) {
        const sample = sampleCell(this.paper, u, v, this.size, 0.4)
        if (sample) this.blocks.push({ u, v, color: sample.color, alpha: sample.alpha })
      }
    }
    // Bottom rows fall first, each row in a random order.
    const order = new Map(this.blocks.map((block) => [block, Math.random()]))
    this.blocks.sort((a, b) => b.v - a.v || order.get(a)! - order.get(b)!)
    this.play('arpeggio8')
    const notes = [7, 6, 5, 4, 3, 2, 1, 0]
    notes.forEach((note, i) => this.play('blip', { at: 0.58 + i * 0.085 + rand(0, 0.03), pitch: pentatonic(1, note) * 0.75, gain: 0.8, pan: rand(-0.5, 0.5) }))
    this.play('coin', { at: 1.32 })
    this.countAt = 0.5
  }

  protected step(): void {
    if (this.t < 0.32) return
    const target = Math.round(this.blocks.length * phase(this.t, 0.32, 0.26))
    const floor = this.view.stageHeight - 3 - this.size / 2
    while (this.released < target) {
      const block = this.blocks[this.released]
      this.released += 1
      const at = this.world(block.u + this.size / 2, block.v + this.size / 2)
      this.fx.add(particle({
        kind: 'square',
        x: at.x,
        y: at.y,
        size: this.size * 0.9,
        color: block.color,
        alpha: block.alpha,
        rotation: this.view.rot,
        vx: rand(-45, 45),
        vy: rand(-130, 10),
        gravity: 1700,
        drag: 0.3,
        floor,
        bounce: rand(0.25, 0.45),
        life: rand(1.5, 2.2),
        fadeOut: 0.5,
      }))
    }
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    const t = this.t
    const level = t < 0.06 ? 1 : t < 0.12 ? 2 : t < 0.18 ? 4 : t < 0.25 ? 6 : this.size
    const unreleased = this.blocks.length - this.released
    if (unreleased > 0) {
      ctx.save()
      if (this.released > 0) {
        // Only the rows that have not fallen yet.
        const lowest = this.blocks[this.released]?.v ?? this.paper.top
        enterPaper(ctx, this.view)
        ctx.beginPath()
        ctx.rect(this.paper.left - 4, this.paper.top - 4, this.paper.width + 8, lowest + this.size - this.paper.top + 4)
        ctx.clip()
        ctx.rotate(-this.view.rot)
        ctx.translate(-this.view.cx, -this.view.cy)
      }
      if (level <= 1) {
        drawLocalPaper(ctx, this.view, this.paper)
      } else {
        const cols = Math.max(1, Math.round(this.paper.width / level))
        const rows = Math.max(1, Math.round(this.paper.height / level))
        if (this.mosaic.width !== cols || this.mosaic.height !== rows) {
          this.mosaic.width = cols
          this.mosaic.height = rows
        }
        const mctx = this.mosaic.getContext('2d')!
        mctx.clearRect(0, 0, cols, rows)
        mctx.imageSmoothingEnabled = true
        mctx.drawImage(this.paper.canvas, 0, 0, cols, rows)
        ctx.imageSmoothingEnabled = false
        drawLocalPaper(ctx, this.view, this.paper, {}, this.mosaic)
        ctx.imageSmoothingEnabled = true
      }
      ctx.restore()
    }
    this.fx.draw(ctx)
  }
}

// ---------------------------------------------------------------------------
// 燃尽: lit at the bottom edge, the paper burns away with glowing edges and embers.

class Burn extends Celebration {
  protected readonly length = 1.8
  private readonly paper: LocalPaper
  private readonly cells: Cell[] = []
  private readonly size = 4
  private erased = 0
  private charred = 0
  private lit = 0
  private smokeClock = 0

  constructor(view: PaperView, sound: SoundBoard, count: number) {
    super(view, sound, count)
    this.paper = localPaper(view)
    const { left, top, width, height } = this.paper
    const iu = rand(-0.3, 0.3) * view.w
    const iv = view.h / 2 + LOCAL_PAD
    const far = Math.max(...[[left, top], [left + width, top], [left, top + height], [left + width, top + height]].map(([u, v]) => Math.hypot(u - iu, v - iv)))
    const seed = rand(0, 100)
    for (let v = top; v < top + height; v += this.size) {
      for (let u = left; u < left + width; u += this.size) {
        const sample = sampleCell(this.paper, u, v, this.size, 0.05)
        if (!sample) continue
        const d = Math.hypot(u - iu, v - iv) / far
        this.cells.push({ u, v, at: 0.1 + d * 1.15 + wobble(u, v, seed) * 0.24, color: sample.alpha > 0.4 ? sample.color : null, alpha: sample.alpha })
      }
    }
    this.cells.sort((a, b) => a.at - b.at)
    this.play('ignite')
    this.play('fire', { at: 0.1, duration: 1.55 })
    this.countAt = 0.9
  }

  protected step(dt: number): void {
    const t = this.t
    while (this.lit < this.cells.length && this.cells[this.lit].at <= t) this.lit += 1
    while (this.charred < this.cells.length && this.cells[this.charred].at <= t - 0.07) this.charred += 1
    while (this.erased < this.cells.length && this.cells[this.erased].at <= t - 0.16) {
      const cell = this.cells[this.erased]
      this.erased += 1
      eraseCell(this.paper, cell.u, cell.v, this.size)
      if (cell.color && Math.random() < 0.05) {
        const at = this.world(cell.u, cell.v)
        this.fx.add(particle({ kind: 'dot', x: at.x, y: at.y, size: rand(1.2, 2.8), color: pick(['#ffb347', '#ff7a2f', '#ffe08a']), vx: rand(-25, 25), vy: rand(-60, -160), gravity: -40, drag: 0.8, sway: rand(3, 10), swaySpeed: rand(2, 5), twinkle: 0.5, life: rand(0.5, 1.1), fadeOut: 0.4 }))
      }
    }
    this.smokeClock += dt
    if (this.smokeClock > 0.06 && this.lit > this.erased) {
      this.smokeClock = 0
      const cell = this.cells[Math.floor(rand(this.erased, this.lit))]
      const at = this.world(cell.u, cell.v)
      this.fx.add(particle({ kind: 'glow', x: at.x, y: at.y, size: rand(14, 26), color: '#6b6157', alpha: 0.2, vx: rand(-10, 10), vy: rand(-40, -70), life: rand(0.9, 1.3), fadeIn: 0.2, fadeOut: 0.6 }))
    }
  }

  protected paint(ctx: CanvasRenderingContext2D): void {
    drawLocalPaper(ctx, this.view, this.paper)
    ctx.save()
    enterPaper(ctx, this.view)
    const s = this.size
    // Charred paper just behind the flames.
    ctx.fillStyle = 'rgba(70, 36, 14, 0.55)'
    for (let i = this.erased; i < this.charred; i += 1) ctx.fillRect(this.cells[i].u - 1, this.cells[i].v - 1, s + 2, s + 2)
    // The flames: a wide soft halo, then hot cores.
    ctx.fillStyle = 'rgba(255, 110, 30, 0.22)'
    for (let i = this.charred; i < this.lit; i += 1) ctx.fillRect(this.cells[i].u - 4, this.cells[i].v - 4, s + 8, s + 8)
    for (let i = this.charred; i < this.lit; i += 1) {
      const cell = this.cells[i]
      const heat = clamp((this.t - cell.at) / 0.07)
      ctx.fillStyle = heat < 0.4 ? '#ffe28a' : heat < 0.75 ? '#ffae42' : '#ff6a1f'
      ctx.fillRect(cell.u, cell.v, s, s)
    }
    ctx.restore()
    this.fx.draw(ctx)
  }
}

export function createCelebration(effect: CompleteEffect, view: PaperView, sound: SoundBoard, todayCount: number): Scene {
  switch (effect) {
    case 'confetti': return new Confetti(view, sound, todayCount)
    case 'fireworks': return new Fireworks(view, sound, todayCount)
    case 'stamp': return new Stamp(view, sound, todayCount)
    case 'plane': return new Plane(view, sound, todayCount)
    case 'shatter': return new Shatter(view, sound, todayCount)
    case 'bubbles': return new Bubbles(view, sound, todayCount)
    case 'star': return new StarBurst(view, sound, todayCount)
    case 'dust': return new Dust(view, sound, todayCount)
    case 'vortex': return new Vortex(view, sound, todayCount)
    case 'hearts': return new Hearts(view, sound, todayCount)
    case 'balloons': return new Balloons(view, sound, todayCount)
    case 'perfect': return new Perfect(view, sound, todayCount)
    case 'pixels': return new Pixels(view, sound, todayCount)
    case 'burn': return new Burn(view, sound, todayCount)
    default: return new Tear(view, sound, todayCount)
  }
}
