import type { NoteColor } from './types.ts'

/**
 * Celebrations: what plays when a note is finished, when a note appears and
 * when a checklist item is checked. Each moment has a set of animations with
 * their own sound; one is picked at random each time, never the same twice in
 * a row. Shared by the main process (which picks for notes) and the pages.
 */

/** Whole note finished (✓): played on the effects overlay over the desktop. */
export const COMPLETE_EFFECTS = [
  'tear',
  'confetti',
  'fireworks',
  'stamp',
  'plane',
  'shatter',
  'bubbles',
  'star',
  'dust',
  'vortex',
  'hearts',
  'balloons',
  'perfect',
  'pixels',
  'burn',
] as const
export type CompleteEffect = (typeof COMPLETE_EFFECTS)[number]

export const COMPLETE_EFFECT_LABELS: Record<CompleteEffect, string> = {
  tear: '撕下飘落',
  confetti: '礼花',
  fireworks: '烟花',
  stamp: '盖章',
  plane: '纸飞机',
  shatter: '碎裂',
  bubbles: '泡泡',
  star: '星光',
  dust: '随风散去',
  vortex: '漩涡',
  hearts: '爱心',
  balloons: '气球',
  perfect: '完美',
  pixels: '像素雨',
  burn: '燃尽',
}

/** A note coming onto the desk: played by the note window itself. */
export const APPEAR_EFFECTS = [
  'pop',
  'drop',
  'flip',
  'unroll',
  'swing',
  'wipe',
  'iris',
  'focus',
  'slap',
  'spin',
  'flap',
  'sticker',
  'jelly',
  'sparkle',
  'rise',
] as const
export type AppearEffect = (typeof APPEAR_EFFECTS)[number]

export const APPEAR_EFFECT_LABELS: Record<AppearEffect, string> = {
  pop: '弹出',
  drop: '落下',
  flip: '翻转',
  unroll: '展开',
  swing: '摆入',
  wipe: '擦出',
  iris: '圆形展开',
  focus: '对焦',
  slap: '拍上',
  spin: '旋入',
  flap: '掀开',
  sticker: '贴纸',
  jelly: '果冻',
  sparkle: '闪现',
  rise: '升起',
}

/** How long each appear animation runs, ms; the page holds the paper still afterwards. */
export const APPEAR_DURATIONS: Record<AppearEffect, number> = {
  pop: 520,
  drop: 640,
  flip: 620,
  unroll: 600,
  swing: 900,
  wipe: 560,
  iris: 560,
  focus: 560,
  slap: 520,
  spin: 640,
  flap: 620,
  sticker: 640,
  jelly: 760,
  sparkle: 760,
  rise: 560,
}

/** One checklist item checked: played inside the note. */
export const TASK_EFFECTS = [
  'tick',
  'strike',
  'confetti',
  'stars',
  'ripple',
  'coin',
  'shine',
  'bubbles',
  'hearts',
  'spark',
] as const
export type TaskEffect = (typeof TASK_EFFECTS)[number]

export const TASK_EFFECT_LABELS: Record<TaskEffect, string> = {
  tick: '弹跳打勾',
  strike: '一笔划掉',
  confetti: '小礼花',
  stars: '星星',
  ripple: '涟漪',
  coin: '金币',
  shine: '闪光',
  bubbles: '泡泡',
  hearts: '爱心',
  spark: '火花',
}

/** Why a note window is opening; decides whether it animates in and makes a sound. */
export type OpenReason = 'new' | 'show' | 'startup' | 'recover'

/** Told to a note window that should animate in once it is on screen. */
export interface AppearPlan {
  effect: AppearEffect
  sound: boolean
  /** Wait this long after the window is shown (several notes at startup come in one after another). */
  delay: number
}

/** What the pages need to know about the user's choice. */
export interface EffectSettings {
  /** Rich animations; off plays the classic tear and nothing else. */
  enabled: boolean
  sound: boolean
  /** 0..1 */
  volume: number
}

export const DEFAULT_EFFECT_SETTINGS: EffectSettings = { enabled: true, sound: true, volume: 0.7 }

/** At startup notes come in one after another, but the last one not much later than this. */
export const STARTUP_STAGGER_MS = 90
export const STARTUP_STAGGER_LIMIT_MS = 1200

/**
 * Pick one at random, never the one played last (or any of `avoid`), so two
 * finishes in a row always look different.
 */
export function pickEffect<T>(list: readonly T[], avoid: readonly (T | null | undefined)[] = [], random: () => number = Math.random): T {
  const pool = list.filter((item) => !avoid.includes(item))
  const from = pool.length > 0 ? pool : list
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))]
}

/**
 * Keeps the recent picks of one kind so the same animation does not come back
 * soon: never the last one, and not one of the last `memory` either.
 */
export class EffectPicker<T> {
  private readonly recent: T[] = []
  private readonly list: readonly T[]
  private readonly memory: number

  constructor(list: readonly T[], memory = Math.min(4, Math.max(1, list.length - 2))) {
    this.list = list
    this.memory = memory
  }

  next(random: () => number = Math.random): T {
    const pick = pickEffect(this.list, this.recent, random)
    this.recent.push(pick)
    if (this.recent.length > this.memory) this.recent.shift()
    return pick
  }
}

export function startupDelay(index: number): number {
  return Math.min(STARTUP_STAGGER_LIMIT_MS, Math.max(0, index) * STARTUP_STAGGER_MS)
}

export function isCompleteEffect(value: unknown): value is CompleteEffect {
  return COMPLETE_EFFECTS.includes(value as CompleteEffect)
}

export function isAppearEffect(value: unknown): value is AppearEffect {
  return APPEAR_EFFECTS.includes(value as AppearEffect)
}

export function clampVolume(value: unknown, fallback = DEFAULT_EFFECT_SETTINGS.volume): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
}

/** Colours of one paper, for drawing it or its pieces on the overlay. */
export interface PaperPalette {
  top: string
  bottom: string
  edge: string
  /** Bright, saturated version of the paper (the in-progress light). */
  glow: string
  /** Deep shade of the paper. */
  deep: string
}

/** Kept in step with the paper colours in note.css. */
export const PAPER_PALETTES: Record<NoteColor, PaperPalette> = {
  butter: { top: '#fff7b7', bottom: '#f5df72', edge: '#cfb951', glow: '#f7c548', deep: '#a8650f' },
  rose: { top: '#ffd7d1', bottom: '#f4aaa4', edge: '#c87570', glow: '#f77f76', deep: '#b2453b' },
  mint: { top: '#dff4c9', bottom: '#a9d58f', edge: '#70975e', glow: '#7fd067', deep: '#3f7f36' },
  sky: { top: '#d9f1f4', bottom: '#9fd4dc', edge: '#6196a0', glow: '#52c2da', deep: '#1f7a8f' },
  lilac: { top: '#eee2f2', bottom: '#cdb4d8', edge: '#8f73a0', glow: '#b385dd', deep: '#774ba0' },
}

/** Where a finished note was, relative to the overlay, in DIP. */
export interface CelebrationGeometry {
  /** The note window (the snapshot covers exactly this). */
  frame: { x: number; y: number; width: number; height: number }
  /** The unrotated paper inside the frame: offset from the frame's corner, size and tilt. */
  paper: { margin: number; width: number; height: number; rotation: number }
}

/** Sent to the effects overlay: play one celebration. */
export interface CelebrationRequest {
  seq: number
  effect: CompleteEffect
  geometry: CelebrationGeometry
  color: NoteColor
  /** PNG of the note window, or null to draw a plain paper (the preview in the settings). */
  snapshot: Uint8Array | null
  /** Pixels of the snapshot per DIP. */
  scale: number
  sound: boolean
  volume: number
  /** Notes finished today including this one; 0 hides the count. */
  todayCount: number
}
