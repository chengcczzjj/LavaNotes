import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DECORATION_PAD,
  ensurePaperReachable,
  getWindowMargin,
  isPaperReachable,
  paperOriginForWindow,
  placeBeside,
  placeNewNote,
  windowBoundsForPaper,
} from '../src/shared/geometry.ts'

function rotatedExtent(width, height, degrees) {
  const r = (Math.abs(degrees) * Math.PI) / 180
  return {
    width: width * Math.cos(r) + height * Math.sin(r),
    height: width * Math.sin(r) + height * Math.cos(r),
  }
}

test('the window margin holds the largest tilted paper plus tape and shadow', () => {
  assert.equal(getWindowMargin(0), DECORATION_PAD)
  for (const degrees of [-4.5, -2, 1.3, 4.5]) {
    const margin = getWindowMargin(degrees)
    const extent = rotatedExtent(900, 900, degrees)
    assert.ok(margin - DECORATION_PAD >= (extent.width - 900) / 2 - 0.01)
    assert.ok(margin - DECORATION_PAD >= (extent.height - 900) / 2 - 0.01)
  }
  // Tilt beyond the limit does not grow the window further.
  assert.equal(getWindowMargin(30), getWindowMargin(4.5))
})

test('the margin does not depend on paper size, so resizing never shifts the paper', () => {
  const small = windowBoundsForPaper({ x: 300, y: 200, width: 160, height: 130 }, -1.6)
  const large = windowBoundsForPaper({ x: 300, y: 200, width: 700, height: 600 }, -1.6)
  assert.equal(small.x, large.x)
  assert.equal(small.y, large.y)
  assert.deepEqual(paperOriginForWindow(small.x, small.y, -1.6), { x: 300, y: 200 })
})

test('a note left on an unplugged monitor comes back to a visible work area', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }
  const lost = { x: 2500, y: 300, width: 240, height: 220 }
  assert.equal(isPaperReachable(lost, [primary]), false)
  const restored = ensurePaperReachable(lost, [primary], primary)
  assert.equal(isPaperReachable(restored, [primary]), true)
  const partly = { x: -180, y: 40, width: 240, height: 220 }
  assert.deepEqual(ensurePaperReachable(partly, [primary], primary), partly)
})

test('new notes stack loosely near the top right and stay inside the work area', () => {
  const area = { x: 0, y: 0, width: 1280, height: 720 }
  const first = placeNewNote({ width: 240, height: 220 }, area, 0)
  const second = placeNewNote({ width: 240, height: 220 }, area, 1)
  assert.ok(first.x + first.width <= area.width)
  assert.ok(second.x < first.x && second.y > first.y)
  const beside = placeBeside(first, { width: 240, height: 220 }, area)
  assert.ok(beside.x + beside.width <= area.width && beside.x >= area.x)
})
