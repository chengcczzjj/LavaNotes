import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROVIDERS,
  normalizeAiSettings,
  providerByKeyFormat,
  providerForUrl,
  providerInfo,
} from '../src/shared/ai.ts'
import { buildInsightUserText, insightKey, parseInsight, pickInsightNotes } from '../src/shared/insights.ts'

test('the provider catalogue matches LavaTranslate: ChatGPT sign-in first, custom last', () => {
  assert.equal(PROVIDERS[0].id, 'chatgpt')
  assert.equal(PROVIDERS.at(-1).id, 'custom')
  assert.equal(providerInfo('nope').id, 'custom')
  assert.equal(providerByKeyFormat(`AIza${'x'.repeat(35)}`), 'gemini')
  assert.equal(providerByKeyFormat('sk-ant-api03-abc'), 'claude')
  assert.equal(providerByKeyFormat('sk-or-v1-abc'), 'openrouter')
  assert.equal(providerByKeyFormat('sk-plain'), null, 'plain sk- keys need a probe')
  assert.equal(providerForUrl('https://api.deepseek.com/v1'), 'deepseek')
  assert.equal(providerForUrl('http://localhost:11434/v1'), 'custom')
})

test('stored model settings are validated field by field', () => {
  const settings = normalizeAiSettings({
    provider: 'deepseek',
    providers: {
      deepseek: { key: 'enc:abc', baseUrl: ' https://x/v1 ', model: 'deepseek-flash', expired: 'yes' },
      bogus: { key: 'k' },
      chatgpt: { key: 'enc:session', label: 'me@example.com', expired: true },
    },
    translateTarget: 'klingon',
    installId: 'bad id!',
  })
  assert.equal(settings.provider, 'deepseek')
  assert.deepEqual(settings.providers.deepseek, { key: 'enc:abc', baseUrl: 'https://x/v1', model: 'deepseek-flash' })
  assert.equal(settings.providers.bogus, undefined)
  assert.equal(settings.providers.chatgpt.expired, true)
  assert.equal(settings.translateTarget, 'auto')
  assert.equal(settings.installId, '')
  assert.equal(normalizeAiSettings(null).provider, 'gemini')
})

const note = (id, overrides = {}) => ({
  id,
  title: id,
  color: 'butter',
  createdAt: 1000,
  updatedAt: 1000,
  state: 'active',
  endedAt: null,
  visible: true,
  tasks: [],
  chars: 3,
  ...overrides,
})

test('the model sees notes with activity in the period first, under short codes', () => {
  const picked = pickInsightNotes([
    { note: note('n-quiet01', { createdAt: 10, updatedAt: 9_000 }), preview: 'quiet' },
    { note: note('n-busy001', { createdAt: 5_000 }), preview: 'busy' },
  ], 4_000, 6_000)
  assert.deepEqual(picked.map((input) => input.note.id), ['n-busy001', 'n-quiet01'])
  const summary = { start: 4_000, end: 6_000, created: 1, completed: 0, abandoned: 0, tasksCreated: 0, tasksDone: 0, open: 2, medianDoneMs: null, medianTaskMs: null }
  const { text, aliases } = buildInsightUserText({ granularity: 'week', start: new Date(2026, 9, 5).getTime(), summary, notes: picked, now: new Date(2026, 9, 8).getTime() })
  assert.equal(aliases.get('N1'), 'n-busy001')
  assert.match(text, /N1 \| 还在桌面/)
  assert.ok(!text.includes('n-busy001'), 'note ids stay on this machine')
})

test('the model answer is parsed leniently and mapped back to notes', () => {
  const aliases = new Map([['N1', 'n-one0001'], ['N2', 'n-two0002']])
  const answer = '好的：\n```json\n' + JSON.stringify({
    headline: '忙碌但有收获',
    summary: '写了很多。',
    topics: [{ name: '工作', notes: ['N1', 'n9', 'N1'], desc: '项目' }, { name: '生活', notes: ['n2'] }],
    rhythm: '多在上午写。',
    insights: ['a', 'b', 'c', 'd', 'e'],
    suggestions: ['先做 A'],
    stale: [{ note: 'N2', reason: '一周没动' }, { note: 'N7', reason: '?' }],
  }) + '\n```'
  const insight = parseInsight(answer, aliases)
  assert.equal(insight.headline, '忙碌但有收获')
  assert.deepEqual(insight.topics.map((topic) => topic.noteIds), [['n-one0001'], ['n-two0002']], 'unknown and repeated codes are dropped')
  assert.equal(insight.insights.length, 4)
  assert.deepEqual(insight.stale, [{ noteId: 'n-two0002', reason: '一周没动' }])
  assert.equal(parseInsight('no json here', aliases), null)
  assert.equal(parseInsight('{"headline":""}', aliases), null)
  assert.equal(insightKey('month', 123), 'month:123')
})
