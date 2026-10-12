import test from 'node:test'
import assert from 'node:assert/strict'
import {
  APPEAR_DURATIONS,
  APPEAR_EFFECTS,
  APPEAR_EFFECT_LABELS,
  COMPLETE_EFFECTS,
  COMPLETE_EFFECT_LABELS,
  EffectPicker,
  PAPER_PALETTES,
  STARTUP_STAGGER_LIMIT_MS,
  TASK_EFFECTS,
  TASK_EFFECT_LABELS,
  clampVolume,
  isAppearEffect,
  isCompleteEffect,
  pickEffect,
  startupDelay,
} from '../src/shared/effects.ts'
import { NOTE_COLORS } from '../src/shared/note-model.ts'

test('there are plenty of animations, each with a name', () => {
  assert.ok(COMPLETE_EFFECTS.length >= 12)
  assert.ok(APPEAR_EFFECTS.length >= 12)
  assert.ok(TASK_EFFECTS.length >= 8)
  for (const effect of COMPLETE_EFFECTS) assert.ok(COMPLETE_EFFECT_LABELS[effect], effect)
  for (const effect of APPEAR_EFFECTS) {
    assert.ok(APPEAR_EFFECT_LABELS[effect], effect)
    assert.ok(APPEAR_DURATIONS[effect] > 0 && APPEAR_DURATIONS[effect] <= 1000, effect)
  }
  for (const effect of TASK_EFFECTS) assert.ok(TASK_EFFECT_LABELS[effect], effect)
  for (const list of [COMPLETE_EFFECTS, APPEAR_EFFECTS, TASK_EFFECTS]) assert.equal(new Set(list).size, list.length)
})

test('a pick never repeats what is to be avoided', () => {
  for (let i = 0; i < 200; i += 1) {
    const last = COMPLETE_EFFECTS[i % COMPLETE_EFFECTS.length]
    assert.notEqual(pickEffect(COMPLETE_EFFECTS, [last]), last)
  }
  // Nothing left to choose from: any is fine rather than none.
  assert.equal(pickEffect(['only'], ['only']), 'only')
  // The random number decides, including at its extremes.
  assert.equal(pickEffect(['a', 'b', 'c'], [], () => 0), 'a')
  assert.equal(pickEffect(['a', 'b', 'c'], [], () => 0.9999999), 'c')
})

test('the picker keeps the last few out and still uses every animation', () => {
  const picker = new EffectPicker(COMPLETE_EFFECTS)
  const seen = new Set()
  const recent = []
  for (let i = 0; i < 400; i += 1) {
    const pick = picker.next()
    assert.ok(!recent.includes(pick), `${pick} came back within ${recent.length}`)
    recent.push(pick)
    if (recent.length > 4) recent.shift()
    seen.add(pick)
  }
  assert.equal(seen.size, COMPLETE_EFFECTS.length)
  const small = new EffectPicker(['a', 'b'])
  const picks = Array.from({ length: 20 }, () => small.next())
  for (let i = 1; i < picks.length; i += 1) assert.notEqual(picks[i], picks[i - 1])
})

test('startup notes come in one after another, not too late', () => {
  assert.equal(startupDelay(0), 0)
  assert.ok(startupDelay(1) > 0)
  assert.ok(startupDelay(2) > startupDelay(1))
  assert.equal(startupDelay(500), STARTUP_STAGGER_LIMIT_MS)
})

test('names from other processes are checked; the volume is kept within 0..1', () => {
  assert.ok(isCompleteEffect('confetti'))
  assert.ok(!isCompleteEffect('explode-the-desktop'))
  assert.ok(isAppearEffect('pop'))
  assert.ok(!isAppearEffect(42))
  assert.equal(clampVolume(0.333), 0.33)
  assert.equal(clampVolume(-1), 0)
  assert.equal(clampVolume(7), 1)
  assert.equal(clampVolume(Number.NaN), 0.7)
})

test('every paper colour has a palette for the overlay', () => {
  for (const color of NOTE_COLORS) {
    const palette = PAPER_PALETTES[color]
    for (const value of Object.values(palette)) assert.match(value, /^#[0-9a-f]{6}$/i)
  }
})
