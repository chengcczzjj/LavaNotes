import test from 'node:test'
import assert from 'node:assert/strict'
import {
  JsonObjectStream,
  applyTranslations,
  docSegments,
  joinTranslatedLines,
  sanitizeTranslateRequest,
  stripTaskTracking,
  textSegments,
  translateUserText,
} from '../src/shared/translate.ts'
import { resolveTargetLanguage } from '../src/shared/ai.ts'

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '本周', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: '第一行' }, { type: 'hardBreak' }, { type: 'text', text: '第二行' }] },
    {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: true, tid: 'x', createdAt: 1, startedAt: 1, checkedAt: 2 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '订机票' }] }] }],
    },
    { type: 'paragraph' },
    { type: 'image', attrs: { src: `lavanote://asset/${'a'.repeat(64)}.png` } },
    { type: 'paragraph', content: [{ type: 'text', text: 'mixed ' }, { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }] },
  ],
}

test('every text block is one segment, in reading order, empty blocks skipped', () => {
  const segments = docSegments(doc)
  assert.deepEqual(segments.map((segment) => segment.text), ['本周', '第一行\n第二行', '订机票', 'mixed bold'])
  assert.deepEqual(segments.map((segment) => segment.index), [1, 2, 3, 4])
  assert.deepEqual(segments[2].path, [2, 0, 0])
})

test('translations go back into the same structure', () => {
  const segments = docSegments(doc)
  const translated = applyTranslations(doc, segments, new Map([[1, 'This week'], [2, 'Line one\nLine two'], [3, 'Book flights'], [4, 'Mixed bold']]))
  assert.equal(translated.content[0].content[0].text, 'This week')
  assert.deepEqual(translated.content[0].content[0].marks, [{ type: 'bold' }], 'formatting over the whole block is kept')
  assert.deepEqual(translated.content[1].content.map((node) => node.type), ['text', 'hardBreak', 'text'])
  const task = translated.content[2].content[0]
  assert.equal(task.attrs.checked, true, 'checkboxes and their timeline stay')
  assert.equal(task.attrs.tid, 'x')
  assert.equal(task.content[0].content[0].text, 'Book flights')
  assert.equal(translated.content[4].type, 'image', 'images stay in place')
  assert.equal(translated.content[5].content[0].marks, undefined, 'mixed inline formatting is dropped')
  assert.equal(doc.content[0].content[0].text, '本周', 'the original is not modified')
})

test('a copied translation does not reuse checklist timelines', () => {
  const [list] = stripTaskTracking([doc.content[2]])
  assert.deepEqual(list.content[0].attrs, { checked: true })
})

test('a selection is translated line by line, blank lines kept', () => {
  const text = 'hello\n\nworld'
  assert.deepEqual(textSegments(text), [{ index: 1, text: 'hello' }, { index: 2, text: 'world' }])
  assert.equal(joinTranslatedLines(text, new Map([[1, '你好'], [2, '世界']])), '你好\n\n世界')
  assert.equal(joinTranslatedLines(text, new Map([[1, '你好']])), '你好\n\nworld', 'missing lines keep the source')
})

test('streamed model output is read object by object, whatever the framing', () => {
  const objects = []
  const stream = new JsonObjectStream((value) => objects.push(value))
  for (const chunk of ['```json\n[{"i":1,"t":"a {b}', '"},\n {"i": 2,\n "t": "say \\"hi\\""}', 'oops {bad json}', '{"i":3,"t":"c"}]']) stream.push(chunk)
  assert.deepEqual(objects, [{ i: 1, t: 'a {b}' }, { i: 2, t: 'say "hi"' }, { i: 3, t: 'c' }])
})

test('requests from a note are checked and bounded before reaching a model', () => {
  assert.equal(sanitizeTranslateRequest(null), null)
  assert.equal(sanitizeTranslateRequest({ segments: [{ index: 0, text: 'x' }] }), null)
  const request = sanitizeTranslateRequest({ segments: [{ index: 1, text: 'hi' }, { index: 2, text: '   ' }, 'junk'], target: 'en' })
  assert.deepEqual(request, { segments: [{ index: 1, text: 'hi' }], target: 'en' })
  const huge = sanitizeTranslateRequest({ segments: [{ index: 1, text: 'x'.repeat(30_000) }, { index: 2, text: 'y' }] })
  assert.equal(huge.segments.length, 1)
  assert.equal(huge.segments[0].text.length, 24_000)
})

test('the prompt numbers each segment as JSON', () => {
  const text = translateUserText([{ index: 1, text: '第一行\n"引号"' }], { native: 'English', code: 'en' })
  assert.match(text, /Target language: English \(en\)/)
  assert.ok(text.includes('{"i":1,"s":"第一行\\n\\"引号\\""}'))
})

test('automatic target: Chinese goes to English, everything else to Chinese', () => {
  assert.equal(resolveTargetLanguage('auto', '明天下午三点开会'), 'en')
  assert.equal(resolveTargetLanguage('auto', 'Meeting tomorrow at 3pm'), 'zh-Hans')
  assert.equal(resolveTargetLanguage('auto', '明日の会議'), 'zh-Hans', 'kana means Japanese')
  assert.equal(resolveTargetLanguage('auto', '和 John 讨论 API design'), 'en')
  assert.equal(resolveTargetLanguage('ja', '任何内容'), 'ja')
  assert.equal(resolveTargetLanguage('xx', 'hello'), 'zh-Hans', 'an unknown code falls back to automatic')
})
