/**
 * A small canvas particle engine shared by the effects overlay and the note
 * windows: a stage that runs only while something is moving, scenes that
 * update and draw themselves, and particles (confetti, sparks, stars, hearts,
 * bubbles, rings) with gravity, drag, sway and fading.
 */

export const TAU = Math.PI * 2

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 0..1 progress of `t` through [start, start + length]. */
export function phase(t: number, start: number, length: number): number {
  return clamp((t - start) / length)
}

export const ease = {
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
  inBack: (t: number, s = 1.70158) => (s + 1) * t * t * t - s * t * t,
  outElastic: (t: number) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
  outBounce: (t: number) => {
    const n = 7.5625
    const d = 2.75
    if (t < 1 / d) return n * t * t
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
    return n * (t -= 2.625 / d) * t + 0.984375
  },
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const n = Number.parseInt(full.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha)})`
}

/** Mix two hex colours (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  const c = ca.map((v, i) => Math.round(lerp(v, cb[i], t)))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Bright colours for confetti and sparks; the paper's own colour is added by callers. */
export const PARTY_COLORS = ['#ffcf3f', '#ff6f91', '#5ad1a4', '#4fb3ff', '#b388ff', '#ff9a3c', '#ffffff']

export interface Scene {
  /** Advance by dt seconds; false when finished. */
  update(dt: number): boolean
  draw(ctx: CanvasRenderingContext2D): void
}

export type ParticleKind = 'confetti' | 'ribbon' | 'dot' | 'spark' | 'star' | 'heart' | 'bubble' | 'ring' | 'glow' | 'text' | 'square' | 'coin'

export interface Particle {
  kind: ParticleKind
  x: number
  y: number
  vx: number
  vy: number
  /** Gravity, px/s². */
  gravity: number
  /** Fraction of velocity lost per second. */
  drag: number
  life: number
  age: number
  size: number
  rotation: number
  spin: number
  color: string
  alpha: number
  /** Confetti turning over: the visible width follows cos(flip). */
  flip: number
  flipSpeed: number
  /** Side to side drift (px) and its speed. */
  sway: number
  swaySpeed: number
  /** Shrink to nothing by the end of life. */
  shrink: boolean
  /** Seconds of fading at the end. */
  fadeOut: number
  /** Seconds of fading in. */
  fadeIn: number
  /** Brightness flicker (sparkles). */
  twinkle: number
  /** Leave a streak behind (sparks). */
  trail: number
  /** Expanding rings: radius growth px/s and line width. */
  grow: number
  line: number
  text: string
  /** Called once when the particle ends (a bubble popping). */
  onEnd?: (p: Particle) => void
  /** Last positions for trails. */
  history?: Array<{ x: number; y: number }>
  /** Where it would be without sway (sway is drawn, not integrated). */
  seed: number
  /** Optional floor: bounce off this y. */
  floor?: number
  bounce?: number
}

export function particle(init: Partial<Particle> & Pick<Particle, 'kind' | 'x' | 'y'>): Particle {
  return {
    vx: 0,
    vy: 0,
    gravity: 0,
    drag: 0,
    life: 1,
    age: 0,
    size: 6,
    rotation: 0,
    spin: 0,
    color: '#ffffff',
    alpha: 1,
    flip: Math.random() * TAU,
    flipSpeed: 0,
    sway: 0,
    swaySpeed: 0,
    shrink: false,
    fadeOut: 0.3,
    fadeIn: 0,
    twinkle: 0,
    trail: 0,
    grow: 0,
    line: 2,
    text: '',
    seed: Math.random() * 1000,
    ...init,
  }
}

export function drawStar(ctx: CanvasRenderingContext2D, radius: number, points = 5, inner = 0.45): void {
  ctx.beginPath()
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? radius : radius * inner
    const a = (i / (points * 2)) * TAU - Math.PI / 2
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
}

/** A four-pointed sparkle with thin, curved arms. */
export function drawSparkle(ctx: CanvasRenderingContext2D, radius: number): void {
  const r = radius
  const w = radius * 0.18
  ctx.beginPath()
  ctx.moveTo(0, -r)
  ctx.quadraticCurveTo(w, -w, r, 0)
  ctx.quadraticCurveTo(w, w, 0, r)
  ctx.quadraticCurveTo(-w, w, -r, 0)
  ctx.quadraticCurveTo(-w, -w, 0, -r)
  ctx.closePath()
}

export function drawHeart(ctx: CanvasRenderingContext2D, size: number): void {
  const s = size / 2
  ctx.beginPath()
  ctx.moveTo(0, s * 0.85)
  ctx.bezierCurveTo(-s * 1.25, -s * 0.05, -s * 0.85, -s * 1.05, 0, -s * 0.45)
  ctx.bezierCurveTo(s * 0.85, -s * 1.05, s * 1.25, -s * 0.05, 0, s * 0.85)
  ctx.closePath()
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  const lifeLeft = p.life - p.age
  let alpha = p.alpha
  if (p.fadeOut > 0 && lifeLeft < p.fadeOut) alpha *= clamp(lifeLeft / p.fadeOut)
  if (p.fadeIn > 0 && p.age < p.fadeIn) alpha *= clamp(p.age / p.fadeIn)
  if (p.twinkle > 0) alpha *= 1 - p.twinkle * (0.5 + 0.5 * Math.sin(p.age * 22 + p.seed))
  if (alpha <= 0.003) return
  const scale = p.shrink ? clamp(1 - p.age / p.life) : 1
  const size = p.size * scale
  const sway = p.sway ? Math.sin(p.age * p.swaySpeed + p.seed) * p.sway : 0
  const x = p.x + sway
  const y = p.y

  ctx.globalAlpha = alpha
  if (p.kind === 'spark') {
    // A bright head with a fading streak behind it.
    const history = p.history
    if (history && history.length > 1) {
      ctx.lineCap = 'round'
      for (let i = 1; i < history.length; i += 1) {
        const t = i / history.length
        ctx.globalAlpha = alpha * t * 0.8
        ctx.strokeStyle = p.color
        ctx.lineWidth = Math.max(0.5, size * t)
        ctx.beginPath()
        ctx.moveTo(history[i - 1].x, history[i - 1].y)
        ctx.lineTo(history[i].x, history[i].y)
        ctx.stroke()
      }
      ctx.globalAlpha = alpha
    }
    ctx.fillStyle = '#fffbe8'
    ctx.beginPath()
    ctx.arc(x, y, Math.max(0.6, size * 0.6), 0, TAU)
    ctx.fill()
    return
  }
  if (p.kind === 'ring') {
    ctx.strokeStyle = p.color
    ctx.lineWidth = Math.max(0.5, p.line * (1 - p.age / p.life))
    ctx.beginPath()
    ctx.arc(x, y, Math.max(0.1, p.size + p.grow * p.age), 0, TAU)
    ctx.stroke()
    return
  }
  if (p.kind === 'glow') {
    const radius = Math.max(0.5, size)
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, p.color)
    gradient.addColorStop(1, withAlpha(p.color.startsWith('#') ? p.color : '#ffffff', 0))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, TAU)
    ctx.fill()
    return
  }

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(p.rotation)
  switch (p.kind) {
    case 'confetti': {
      ctx.scale(Math.cos(p.flip), 1)
      ctx.fillStyle = p.color
      ctx.fillRect(-size / 2, -size * 0.75, size, size * 1.5)
      // A lighter face when it turns towards the light.
      if (Math.cos(p.flip) > 0.6) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)'
        ctx.fillRect(-size / 2, -size * 0.75, size / 2, size * 1.5)
      }
      break
    }
    case 'ribbon': {
      ctx.scale(1, Math.cos(p.flip))
      ctx.strokeStyle = p.color
      ctx.lineWidth = size * 0.45
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-size * 1.4, 0)
      ctx.bezierCurveTo(-size * 0.5, -size, size * 0.5, size, size * 1.4, 0)
      ctx.stroke()
      break
    }
    case 'square': {
      ctx.fillStyle = p.color
      ctx.fillRect(-size / 2, -size / 2, size, size)
      break
    }
    case 'dot': {
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(0, 0, Math.max(0.3, size / 2), 0, TAU)
      ctx.fill()
      break
    }
    case 'star': {
      ctx.fillStyle = p.color
      ctx.shadowColor = p.color
      ctx.shadowBlur = size * 0.8
      drawSparkle(ctx, size)
      ctx.fill()
      break
    }
    case 'heart': {
      ctx.fillStyle = p.color
      drawHeart(ctx, size)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.beginPath()
      ctx.ellipse(-size * 0.18, -size * 0.12, size * 0.1, size * 0.06, -0.6, 0, TAU)
      ctx.fill()
      break
    }
    case 'bubble': {
      const r = Math.max(0.5, size)
      const fill = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r)
      fill.addColorStop(0, 'rgba(255,255,255,0.55)')
      fill.addColorStop(0.55, withAlpha(p.color, 0.12))
      fill.addColorStop(0.92, withAlpha(p.color, 0.35))
      fill.addColorStop(1, 'rgba(255,255,255,0.6)')
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, TAU)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.lineWidth = Math.max(0.6, r * 0.06)
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.98, 0, TAU)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath()
      ctx.ellipse(-r * 0.38, -r * 0.42, r * 0.22, r * 0.12, -0.7, 0, TAU)
      ctx.fill()
      break
    }
    case 'coin': {
      const w = Math.cos(p.flip)
      ctx.scale(Math.abs(w) < 0.08 ? 0.08 : w, 1)
      ctx.fillStyle = '#f2b51d'
      ctx.beginPath()
      ctx.arc(0, 0, size, 0, TAU)
      ctx.fill()
      ctx.fillStyle = '#ffd95a'
      ctx.beginPath()
      ctx.arc(0, 0, size * 0.78, 0, TAU)
      ctx.fill()
      ctx.fillStyle = '#e09a0b'
      ctx.fillRect(-size * 0.12, -size * 0.45, size * 0.24, size * 0.9)
      break
    }
    case 'text': {
      ctx.fillStyle = p.color
      ctx.font = `800 ${Math.round(size)}px system-ui, "Segoe UI", "Microsoft YaHei UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = Math.max(2, size * 0.16)
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.strokeText(p.text, 0, 0)
      ctx.fillText(p.text, 0, 0)
      break
    }
  }
  ctx.restore()
}

/** A bag of particles that ends when the last one has. */
export class Particles implements Scene {
  readonly list: Particle[] = []

  add(p: Particle): Particle {
    this.list.push(p)
    return p
  }

  get size(): number {
    return this.list.length
  }

  update(dt: number): boolean {
    for (let i = this.list.length - 1; i >= 0; i -= 1) {
      const p = this.list[i]
      p.age += dt
      if (p.age >= p.life) {
        this.list.splice(i, 1)
        p.onEnd?.(p)
        continue
      }
      const damping = Math.max(0, 1 - p.drag * dt)
      p.vx *= damping
      p.vy = p.vy * damping + p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.floor !== undefined && p.y > p.floor) {
        p.y = p.floor
        p.vy = -Math.abs(p.vy) * (p.bounce ?? 0.4)
        p.vx *= 0.8
        p.spin *= 0.6
      }
      p.rotation += p.spin * dt
      p.flip += p.flipSpeed * dt
      if (p.trail > 0) {
        const history = (p.history ??= [])
        history.push({ x: p.x, y: p.y })
        if (history.length > p.trail) history.shift()
      }
    }
    return this.list.length > 0
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.list) drawParticle(ctx, p)
    ctx.globalAlpha = 1
  }
}

/** Throw particles out from a point. */
export function burst(into: Particles, count: number, make: (i: number, angle: number, speed: number) => Partial<Particle> & Pick<Particle, 'kind'>, options: {
  x: number
  y: number
  speed: [number, number]
  /** Radians; default all round. */
  angle?: [number, number]
}): void {
  const [a0, a1] = options.angle ?? [0, TAU]
  for (let i = 0; i < count; i += 1) {
    const angle = rand(a0, a1)
    const speed = rand(options.speed[0], options.speed[1])
    const init = make(i, angle, speed)
    into.add(particle({ x: options.x, y: options.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, ...init }))
  }
}

/**
 * The canvas and its animation loop. It runs only while a scene is alive, then
 * clears the canvas and reports that it is idle.
 */
export class Stage {
  readonly ctx: CanvasRenderingContext2D
  private readonly scenes: Scene[] = []
  private frame: number | null = null
  private last = 0
  private cssWidth = 0
  private cssHeight = 0
  private dpr = 1
  private readonly canvas: HTMLCanvasElement
  private readonly onIdle?: () => void

  constructor(canvas: HTMLCanvasElement, onIdle?: () => void) {
    this.canvas = canvas
    this.onIdle = onIdle
    this.ctx = canvas.getContext('2d')!
  }

  /** Match the canvas to its CSS size and the device pixel ratio. */
  fit(): void {
    const dpr = window.devicePixelRatio || 1
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    if (width === this.cssWidth && height === this.cssHeight && dpr === this.dpr) return
    this.cssWidth = width
    this.cssHeight = height
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.round(width * dpr))
    this.canvas.height = Math.max(1, Math.round(height * dpr))
  }

  get width(): number {
    return this.cssWidth || window.innerWidth
  }

  get height(): number {
    return this.cssHeight || window.innerHeight
  }

  get busy(): boolean {
    return this.scenes.length > 0
  }

  add(scene: Scene): void {
    this.scenes.push(scene)
    if (this.frame === null) {
      this.fit()
      this.last = performance.now()
      this.frame = window.requestAnimationFrame(this.tick)
    }
  }

  /** Draw the current state now (e.g. the first frame before taking over from a note). */
  render(): void {
    this.fit()
    const { ctx } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    for (const scene of this.scenes) {
      ctx.save()
      scene.draw(ctx)
      ctx.restore()
    }
  }

  private readonly tick = (now: number) => {
    // A long gap (the window was hidden) must not throw particles across the screen.
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    for (let i = this.scenes.length - 1; i >= 0; i -= 1) {
      if (!this.scenes[i].update(dt)) this.scenes.splice(i, 1)
    }
    this.render()
    if (this.scenes.length > 0) {
      this.frame = window.requestAnimationFrame(this.tick)
    } else {
      this.frame = null
      this.onIdle?.()
    }
  }
}
