import type { NoteBounds } from './types.ts'
import { NOTE_MAX_HEIGHT, NOTE_MAX_WIDTH, ROTATION_LIMIT, clampNoteSize } from './note-model.ts'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Room around the paper for the tape, the drop shadow and the light of a note in progress. */
export const DECORATION_PAD = 40
/** Part of a note that must stay on some screen so it can be grabbed again. */
export const MIN_VISIBLE_EDGE = 56

/**
 * Transparent space between the window edge and the unrotated paper.
 *
 * It depends only on the tilt, sized for the largest allowed paper, so it does
 * not change while the paper is resized. A changing margin would shift the paper
 * inside its window for a frame every time a resize ends.
 */
export function getWindowMargin(rotation: number): number {
  const radians = (Math.min(Math.abs(rotation), ROTATION_LIMIT) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const growX = (NOTE_MAX_WIDTH * cos + NOTE_MAX_HEIGHT * sin - NOTE_MAX_WIDTH) / 2
  const growY = (NOTE_MAX_WIDTH * sin + NOTE_MAX_HEIGHT * cos - NOTE_MAX_HEIGHT) / 2
  return Math.ceil(Math.max(growX, growY, 0)) + DECORATION_PAD
}

export function windowBoundsForPaper(paper: NoteBounds, rotation: number): Rect {
  const margin = getWindowMargin(rotation)
  return {
    x: Math.round(paper.x - margin),
    y: Math.round(paper.y - margin),
    width: Math.round(paper.width + margin * 2),
    height: Math.round(paper.height + margin * 2),
  }
}

export function paperOriginForWindow(windowX: number, windowY: number, rotation: number): { x: number; y: number } {
  const margin = getWindowMargin(rotation)
  return { x: Math.round(windowX + margin), y: Math.round(windowY + margin) }
}

function overlapLength(aStart: number, aLength: number, bStart: number, bLength: number): number {
  return Math.max(0, Math.min(aStart + aLength, bStart + bLength) - Math.max(aStart, bStart))
}

/** True when enough of the paper is on one of the work areas to grab it. */
export function isPaperReachable(paper: NoteBounds, workAreas: readonly Rect[]): boolean {
  const needX = Math.min(MIN_VISIBLE_EDGE, paper.width)
  const needY = Math.min(MIN_VISIBLE_EDGE, paper.height)
  return workAreas.some((area) => (
    overlapLength(paper.x, paper.width, area.x, area.width) >= needX
    && overlapLength(paper.y, paper.height, area.y, area.height) >= needY
  ))
}

/** Keep the paper on screen after a monitor was unplugged or a work area shrank. */
export function ensurePaperReachable(paper: NoteBounds, workAreas: readonly Rect[], fallbackArea: Rect): NoteBounds {
  const size = clampNoteSize(paper.width, paper.height)
  const sized = { ...paper, ...size }
  if (workAreas.length === 0 || isPaperReachable(sized, workAreas)) return sized
  return {
    ...sized,
    x: Math.round(fallbackArea.x + Math.max(16, fallbackArea.width - sized.width - 96)),
    y: Math.round(fallbackArea.y + 96),
  }
}

/** A new note never starts this close (on both axes) to where another note starts. */
export const NEW_NOTE_CLEARANCE = 48

function clampTo(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(value, max)))
}

/**
 * Spots for new notes, in the order they are used. Runs of up to five go
 * leftwards from near the top right, each note a bit under half a paper width
 * from the last and alternately higher and lower; each later run starts lower
 * and half a step further left. Neighbours overlap by about a third, so every
 * note stays readable while the stack still looks scattered.
 */
export function newNoteSlots(size: { width: number; height: number }, workArea: Rect): Array<{ x: number; y: number }> {
  const pad = 16
  const stepX = Math.round(size.width * 0.45)
  const zigzag = Math.round(size.height * 0.35)
  const runDrop = Math.round(size.height * 0.8)
  const minX = workArea.x + pad
  const maxX = Math.max(minX, workArea.x + workArea.width - size.width - pad)
  const minY = workArea.y + pad
  const maxY = Math.max(minY, workArea.y + workArea.height - size.height - pad)
  const startX = Math.max(minX, workArea.x + workArea.width - size.width - 72)
  const startY = workArea.y + Math.min(120, Math.round(workArea.height * 0.12))
  const perRun = Math.max(1, Math.min(5, Math.floor((startX - minX) / stepX) + 1))
  const slots: Array<{ x: number; y: number }> = []
  for (let run = 0; run < 3; run += 1) {
    for (let index = 0; index < perRun; index += 1) {
      slots.push({
        x: clampTo(startX - index * stepX - run * Math.round(stepX / 2), minX, maxX),
        y: clampTo(startY + (index % 2) * zigzag + run * runDrop, minY, maxY),
      })
    }
  }
  return slots
}

/** Default spot for a new note: the first slot no other note on that screen already starts at. */
export function placeNewNote(
  size: { width: number; height: number },
  workArea: Rect,
  existing: readonly NoteBounds[],
): NoteBounds {
  const slots = newNoteSlots(size, workArea)
  const taken = (spot: { x: number; y: number }) => existing.some((note) => (
    Math.abs(note.x - spot.x) < NEW_NOTE_CLEARANCE && Math.abs(note.y - spot.y) < NEW_NOTE_CLEARANCE
  ))
  let spot = slots.find((slot) => !taken(slot))
  if (!spot) {
    // Every slot is in use: go round again, shifted so the new note is not exactly on an old one.
    const lap = Math.floor(existing.length / slots.length) + 1
    const base = slots[existing.length % slots.length]
    spot = {
      x: clampTo(base.x - lap * 24, workArea.x + 16, Math.max(workArea.x + 16, workArea.x + workArea.width - size.width - 16)),
      y: clampTo(base.y + lap * 24, workArea.y + 16, Math.max(workArea.y + 16, workArea.y + workArea.height - size.height - 16)),
    }
  }
  return { ...spot, width: size.width, height: size.height }
}
