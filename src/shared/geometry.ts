import type { NoteBounds } from './types.ts'
import { NOTE_MAX_HEIGHT, NOTE_MAX_WIDTH, ROTATION_LIMIT, clampNoteSize } from './note-model.ts'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Room around the paper for tape/pin overhang and the drop shadow. */
export const DECORATION_PAD = 30
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

/**
 * Default spot for a new note, the cascade LavaDesk used for its sticky notes:
 * from about two thirds across the top of the work area, each note 28px right
 * and 22px down from the last, six to a run, each run 36px left and 34px down.
 * The notes overlap on purpose so their alternating tilts show.
 */
export function placeNewNote(
  size: { width: number; height: number },
  workArea: Rect,
  existingCount: number,
): NoteBounds {
  const column = existingCount % 6
  const row = Math.floor(existingCount / 6) % 3
  const x = workArea.x + workArea.width * 0.66 - size.width / 2 + column * 28 - row * 36
  const y = workArea.y + Math.min(150, workArea.height * 0.17) + column * 22 + row * 34
  const minX = workArea.x + 16
  const minY = workArea.y + 16
  return {
    x: Math.round(Math.max(minX, Math.min(x, workArea.x + workArea.width - size.width - 16))),
    y: Math.round(Math.max(minY, Math.min(y, workArea.y + workArea.height - size.height - 16))),
    width: size.width,
    height: size.height,
  }
}
