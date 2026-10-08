import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DECORATION_PAD,
  ensurePaperReachable,
  getWindowMargin,
  isPaperReachable,
  paperOriginForWindow,
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

test('new notes cascade like LavaDesk sticky notes and stay inside the work area', () => {
  const area = { x: 100, y: 40, width: 1600, height: 900 }
  const size = { width: 300, height: 290 }
  const spots = Array.from({ length: 8 }, (_, count) => placeNewNote(size, area, count))
  assert.deepEqual(spots[0], { x: 100 + 1056 - 150, y: 40 + 150, ...size })
  // Six to a run, each one 28px right and 22px down.
  assert.deepEqual([spots[1].x - spots[0].x, spots[1].y - spots[0].y], [28, 22])
  assert.deepEqual([spots[5].x - spots[0].x, spots[5].y - spots[0].y], [140, 110])
  // The next run starts 36px left and 34px below the first.
  assert.deepEqual([spots[6].x - spots[0].x, spots[6].y - spots[0].y], [-36, 34])
  assert.deepEqual([spots[7].x - spots[6].x, spots[7].y - spots[6].y], [28, 22])

  const laptop = { x: 0, y: 0, width: 800, height: 600 }
  for (let count = 0; count < 20; count += 1) {
    const spot = placeNewNote(size, laptop, count)
    assert.ok(spot.x >= 16 && spot.x + spot.width <= 800 - 16, `x for ${count}`)
    assert.ok(spot.y >= 16 && spot.y + spot.height <= 600 - 16, `y for ${count}`)
  }
  // A work area smaller than the note keeps its top-left corner reachable.
  assert.deepEqual(placeNewNote(size, { x: 0, y: 0, width: 250, height: 250 }, 3), { x: 16, y: 16, ...size })
})
