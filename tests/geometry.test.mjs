import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DECORATION_PAD,
  ensurePaperReachable,
  getWindowMargin,
  NEW_NOTE_CLEARANCE,
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

test('new notes are spread out, never start on another note and stay inside the work area', () => {
  const area = { x: 100, y: 40, width: 1920, height: 1040 }
  const size = { width: 300, height: 290 }
  const inside = (spot, work) => spot.x >= work.x + 16 && spot.x + spot.width <= work.x + work.width - 16
    && spot.y >= work.y + 16 && spot.y + spot.height <= work.y + work.height - 16
  const placed = []
  for (let count = 0; count < 12; count += 1) placed.push(placeNewNote(size, area, placed))

  // Neighbours sit a bit under half a note apart, alternately higher and lower.
  const [first, second, third] = placed
  assert.deepEqual(first, { x: 100 + 1920 - 300 - 72, y: 40 + 120, ...size })
  assert.equal(first.x - second.x, 135)
  assert.equal(second.y - first.y, 102)
  assert.equal(third.y, first.y)
  for (const [index, a] of placed.entries()) {
    assert.ok(inside(a, area), `note ${index} inside`)
    for (const b of placed.slice(index + 1)) {
      assert.ok(Math.abs(a.x - b.x) >= NEW_NOTE_CLEARANCE || Math.abs(a.y - b.y) >= NEW_NOTE_CLEARANCE, 'no two notes start together')
    }
  }
  // A spot freed by moving a note away is used again first.
  const moved = placed.map((note, index) => (index === 1 ? { ...note, x: note.x - 400, y: note.y + 500 } : note))
  assert.deepEqual(placeNewNote(size, area, moved), second)

  const laptop = { x: 0, y: 0, width: 1366, height: 728 }
  const onLaptop = []
  for (let count = 0; count < 20; count += 1) onLaptop.push(placeNewNote(size, laptop, onLaptop))
  onLaptop.forEach((spot, index) => assert.ok(inside(spot, laptop), `laptop note ${index} inside`))
  // A work area smaller than the note keeps its top-left corner reachable.
  assert.deepEqual(placeNewNote(size, { x: 0, y: 0, width: 250, height: 250 }, []), { x: 16, y: 16, ...size })
})
