// Automatic Heard Words — client matcher tests (run: node tests/heardauto.test.mjs)
// Pins for Doc 22 (automatic mode): the app's matcher must stay in
// step with the bot's — same normalisation, same expressions, same
// longest-match walk, same defences. The fixtures below are the
// client mirror of the bot's ambient.test.mjs; the privacy contract
// is identical (only dictionary counts leave the device), and the
// adversarial fixture pins it from the app side too.
//
// The dictionary under test is the production one the app fetches:
// deck entries + the wide wordbook (public/data/wordbook/, sharded
// + manifest), loaded here through an injected fetchImpl reading
// the same files from disk.

import assert from 'node:assert'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHeardDict, loadHeardDict, matchHeardWords, heardReading, normalizeSpeechText, EXPRESSIONS, HEARD_FLOOR } from '../src/lib/heardMatch.js'

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const fetchImpl = async (url) => {
  try {
    const body = await readFile(path.join(root, 'public', url), 'utf8')
    return { ok: true, json: async () => JSON.parse(body) }
  } catch { return { ok: false, json: async () => null } }
}

const deckEntries = [
  { word: '納期', reading: 'のうき' },
  { word: '確認', reading: 'かくにん' },
]

const dict = await loadHeardDict({ fetchImpl, deckEntries })
const get = (counts, item) => counts.get(item)?.count ?? 0

check('normalisation folds punctuation and spaces', () => {
  assert.equal(normalizeSpeechText('納期は、明日です！'), '納期は明日です')
})

check('kana hearings count under the kanji headword, with the reading', () => {
  assert.equal(dict.itemOf.get('のうき'), '納期')
  assert.equal(heardReading(dict, '納期'), 'のうき')
})

check('expressions match as units and mask their inner words', () => {
  const counts = matchHeardWords('お疲れ様です。ご確認ください', dict)
  assert.equal(get(counts, 'お疲れ様です'), 1)
  assert.equal(counts.get('お疲れ様です').kind, 'expr')
  assert.equal(get(counts, 'ご確認ください'), 1)
  assert.equal(counts.get('ご確認ください').kind, 'expr')
  assert.equal(get(counts, '確認'), 0)
})

check('a word heard twice counts twice', () => {
  const counts = matchHeardWords('納期は明日、納期を確認します', dict)
  assert.equal(get(counts, '納期'), 2)
  assert.equal(counts.get('納期').kind, 'word')
})

check('one-character kana is never vocabulary; one kanji is', () => {
  const counts = matchHeardWords('あ、日', dict)
  assert.equal(get(counts, 'あ'), 0)
  assert.equal(get(counts, '日'), 1)
})

check('adversarial: names, a company and figures yield only dictionary words', () => {
  const counts = matchHeardWords('山田部長、売上は1200万円、コード名フェニックス作戦会議', dict)
  assert.equal(get(counts, '1200'), 0)
  assert.equal(get(counts, '1200万円'), 0)
  for (const item of counts.keys()) {
    assert.doesNotMatch(item, /^[0-9a-zA-Z]+$/, `${item} is data, not vocabulary`)
  }
  assert.ok(counts.size > 0, 'dictionary words in the fixture still count')
})

check('the floor law holds (a word is named only at 2+ hearings)', () => {
  const counts = matchHeardWords('納期は明日', dict)
  assert.ok(get(counts, '納期') < HEARD_FLOOR, 'one hearing stays below the floor')
})

check('a narrow dictionary (wordbook unavailable) still matches deck words', () => {
  const narrow = buildHeardDict({ deckEntries })
  const counts = matchHeardWords('納期を確認します', narrow)
  assert.equal(get(counts, '納期'), 1)
  assert.equal(get(counts, '確認'), 1)
})

console.log(`heardauto: ${passed} checks passed`)
