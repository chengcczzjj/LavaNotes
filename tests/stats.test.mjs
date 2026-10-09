import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStatsNote,
  dayCounts,
  extractTasks,
  formatDuration,
  hourGrid,
  lifelines,
  openTasks,
  periodDays,
  periodEnd,
  periodEvents,
  periodRelative,
  periodStart,
  periodTitle,
  shiftPeriod,
  summarizePeriod,
  trendWindow,
} from '../src/shared/stats.ts'
import { createNoteRecord } from '../src/shared/note-model.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (month, day, hour = 12) => new Date(2026, month - 1, day, hour).getTime()
const bounds = { x: 0, y: 0, width: 300, height: 290 }

function stats(overrides) {
  return {
    id: overrides.id ?? 'n-stats-01',
    title: 'note',
    color: 'butter',
    createdAt: at(10, 6),
    updatedAt: at(10, 6),
    state: 'active',
    endedAt: null,
    visible: true,
    tasks: [],
    chars: 10,
    ...overrides,
  }
}

test('weeks start on Monday and months on the 1st, in local time', () => {
  // Thursday 8 October 2026
  const thursday = at(10, 8, 15)
  assert.equal(periodStart(thursday, 'week'), new Date(2026, 9, 5).getTime())
  assert.equal(periodStart(at(10, 11, 23), 'week'), new Date(2026, 9, 5).getTime(), 'Sunday belongs to the week before')
  assert.equal(periodStart(thursday, 'month'), new Date(2026, 9, 1).getTime())
  assert.equal(shiftPeriod(new Date(2026, 9, 1).getTime(), 'month', 3), new Date(2027, 0, 1).getTime())
  assert.equal(periodEnd(new Date(2026, 9, 5).getTime(), 'week'), new Date(2026, 9, 12).getTime())
  assert.equal(periodDays(new Date(2026, 1, 1).getTime(), 'month').length, 28)
  assert.equal(periodDays(new Date(2026, 9, 5).getTime(), 'week').length, 7)
})

test('period titles read naturally', () => {
  assert.equal(periodTitle(new Date(2026, 9, 5).getTime(), 'week'), '10月5日 – 11日')
  assert.equal(periodTitle(new Date(2026, 8, 28).getTime(), 'week'), '9月28日 – 10月4日')
  assert.equal(periodTitle(new Date(2026, 9, 1).getTime(), 'month'), '2026年10月')
  const now = at(10, 8)
  assert.equal(periodRelative(periodStart(now, 'week'), 'week', now), '本周')
  assert.equal(periodRelative(shiftPeriod(periodStart(now, 'month'), 'month', -1), 'month', now), '上月')
})

test('checklist items keep their own times, with the note times as a fallback', () => {
  const doc = {
    type: 'doc',
    content: [{
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true, tid: 'a', createdAt: at(10, 6, 9), startedAt: at(10, 7, 8), checkedAt: at(10, 7, 9) }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '订机票' }] }] },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '写报告' }] },
            { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '列提纲' }] }] }] },
          ],
        },
      ],
    }],
  }
  const tasks = extractTasks(doc, { createdAt: at(10, 5), updatedAt: at(10, 8) })
  assert.deepEqual(tasks.map((task) => task.text), ['订机票', '写报告', '列提纲'], 'nested items are separate, their text is not repeated')
  assert.equal(tasks[0].checkedAt, at(10, 7, 9))
  assert.equal(tasks[0].startedAt, at(10, 7, 8), 'the start of work is kept after checking')
  assert.equal(tasks[1].startedAt, null)
  assert.equal(tasks[1].createdAt, at(10, 5))
  assert.equal(tasks[1].checkedAt, null)
  assert.equal(tasks[2].checkedAt, at(10, 8), 'an old checked item is dated by the last edit')
})

test('stats notes carry the outcome: done, abandoned or still on the desk', () => {
  const base = createNoteRecord({ id: 'n-outcome1', bounds, now: at(10, 6) })
  assert.equal(buildStatsNote(base, { type: 'doc', content: [] }).state, 'active')
  assert.equal(buildStatsNote(base, { type: 'doc', content: [] }).startedAt, null)
  assert.equal(buildStatsNote({ ...base, startedAt: at(10, 6, 10) }, { type: 'doc', content: [] }).startedAt, at(10, 6, 10))
  const done = buildStatsNote({ ...base, archivedAt: at(10, 7), visible: false }, { type: 'doc', content: [] })
  assert.equal(done.state, 'completed')
  assert.equal(done.endedAt, at(10, 7))
  const dropped = buildStatsNote({ ...base, abandonedAt: at(10, 8), visible: false }, { type: 'doc', content: [] })
  assert.equal(dropped.state, 'abandoned')
  assert.equal(dropped.endedAt, at(10, 8))
})

test('a period counts what was written, torn off, abandoned and checked inside it', () => {
  const week = new Date(2026, 9, 5).getTime()
  const now = at(10, 20)
  const notes = [
    stats({ id: 'n-a00001', createdAt: at(10, 6), state: 'completed', endedAt: at(10, 7) }),
    stats({ id: 'n-a00002', createdAt: at(10, 7), state: 'abandoned', endedAt: at(10, 9) }),
    stats({ id: 'n-a00003', createdAt: at(9, 20), tasks: [{ id: 't', text: 'x', createdAt: at(10, 6), checkedAt: at(10, 6, 18) }] }),
    stats({ id: 'n-a00004', createdAt: at(10, 13) }),
  ]
  const summary = summarizePeriod(notes, week, 'week', now)
  assert.equal(summary.created, 2)
  assert.equal(summary.completed, 1)
  assert.equal(summary.abandoned, 1)
  assert.equal(summary.tasksCreated, 1)
  assert.equal(summary.tasksDone, 1)
  assert.equal(summary.open, 1, 'only the older note is still on the desk at the end of the week')
  assert.equal(summary.medianDoneMs, DAY)
  assert.equal(summary.medianTaskMs, 6 * HOUR)
})

test('lifelines clip each note to the period and mark how it ended', () => {
  const week = new Date(2026, 9, 5).getTime()
  const end = periodEnd(week, 'week')
  const now = at(10, 8)
  const rows = lifelines([
    stats({ id: 'n-l00001', createdAt: at(9, 30), state: 'completed', endedAt: at(10, 6) }),
    stats({ id: 'n-l00002', createdAt: at(10, 7) }),
    stats({ id: 'n-l00003', createdAt: at(9, 1), state: 'completed', endedAt: at(9, 2) }),
    stats({ id: 'n-l00004', createdAt: at(10, 9) }),
  ], week, end, now)
  assert.deepEqual(rows.map((row) => row.note.id), ['n-l00001', 'n-l00002'], 'notes ended before or written after now are left out')
  assert.equal(rows[0].from, week)
  assert.equal(rows[0].carriedIn, true)
  assert.equal(rows[0].outcome, 'completed')
  assert.equal(rows[1].to, now, 'an open note runs up to now in the current week')
  assert.equal(rows[1].carriedOut, true)
})

test('rhythm grids bin events by weekday and hour, or by day', () => {
  const week = new Date(2026, 9, 5).getTime()
  const notes = [stats({ id: 'n-r00001', createdAt: at(10, 7, 9), state: 'completed', endedAt: at(10, 7, 17) })]
  const events = periodEvents(notes, week, periodEnd(week, 'week'))
  const grid = hourGrid(events)
  assert.equal(grid[2][9].created, 1, 'Wednesday 9:00')
  assert.equal(grid[2][17].completed, 1)
  const days = periodDays(week, 'week')
  const counts = dayCounts(events, days)
  assert.equal(counts[2].created + counts[2].completed, 2)
  assert.equal(counts[0].created, 0)
})

test('the overview window ends at the current period unless the selection is older', () => {
  const now = at(10, 8)
  const current = periodStart(now, 'week')
  const recent = trendWindow(current, 'week', now)
  assert.equal(recent.length, 12)
  assert.equal(recent.at(-1), current)
  const old = shiftPeriod(current, 'week', -30)
  const window = trendWindow(old, 'week', now)
  assert.ok(window.includes(old))
  assert.ok(window.at(-1) < current)
})

test('open checklist items are listed oldest first, only from notes on the desk', () => {
  const now = at(10, 20)
  const items = openTasks([
    stats({ id: 'n-o00001', tasks: [{ id: 'a', text: 'new', createdAt: at(10, 19), checkedAt: null }, { id: 'b', text: 'old', createdAt: at(10, 1), checkedAt: null }] }),
    stats({ id: 'n-o00002', state: 'abandoned', endedAt: at(10, 2), tasks: [{ id: 'c', text: 'gone', createdAt: at(9, 1), checkedAt: null }] }),
  ], now)
  assert.deepEqual(items.map((item) => item.task.text), ['old', 'new'])
})

test('durations are written in the largest sensible unit', () => {
  assert.equal(formatDuration(null), '—')
  assert.equal(formatDuration(5 * 60_000), '5 分钟')
  assert.equal(formatDuration(3 * HOUR), '3 小时')
  assert.equal(formatDuration(1.5 * DAY), '1.5 天')
  assert.equal(formatDuration(21 * DAY), '3 周')
})
