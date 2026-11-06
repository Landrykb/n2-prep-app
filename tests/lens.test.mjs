// Kanji Lens tests (run: TZ=UTC npm run test:lens)
// Pins the pure helpers of src/lib/kanjiLens.js against the REAL generated
// KanjiDB data under public/data/kanjidb/ (read from disk, never fetched).
// The Lens is evidence-ruled: roles come from data flags only, sound
// families are probabilistic (matches/dimmed split), and missing KanjiVG
// coverage degrades to honest empties — never to invented content.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DB = path.join(root, 'public/data/kanjidb')
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

const db = await import('../src/lib/kanjiDb.js')
const lens = await import('../src/lib/kanjiLens.js')
const wdb = await import('../src/lib/wordsDb.js')

const WDB = path.join(root, 'public/data/wordsdb')
const wordShardCache = new Map()
function wordsForKanjiDisk(char, limit = 10) {
  const kanjiWords = readJson(path.join(WDB, 'kanji-words.json'))
  return (kanjiWords[char] || []).slice(0, limit).map((id) => {
    const rel = wdb.wordShardPath(id).replace('/data/wordsdb/', '')
    if (!wordShardCache.has(rel)) wordShardCache.set(rel, readJson(path.join(WDB, rel)))
    return wordShardCache.get(rel)[String(id)] || null
  }).filter(Boolean)
}

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const index = readJson(path.join(DB, 'index.json')).map(db.expandIndexRow)
const byChar = new Map(index.map((r) => [r.char, r]))
const components = readJson(path.join(DB, 'components.json'))
function metaFor(ch) {
  const shard = readJson(path.join(DB, db.metaShardPath(ch).replace('/data/kanjidb/', '')))
  return shard[ch] || null
}
function strokesFor(ch) {
  const shard = readJson(path.join(DB, db.strokesShardPath(ch).replace('/data/kanjidb/', '')))
  return db.expandStrokesEntry(shard[ch] || null)
}

const goMeta = metaFor('語')
const goStrokes = strokesFor('語')

check('語 flatten: 言 is the radical, 吾 is the sound component', () => {
  const flat = lens.flattenComponents(goStrokes.tree, goMeta)
  const gon = flat.find((n) => n.element === '言')
  assert.ok(gon)
  assert.equal(gon.role, 'radical')
  const go = flat.find((n) => n.element === '吾')
  assert.ok(go)
  assert.equal(go.role, 'sound')
  const go2 = flat.find((n) => n.element === '五')
  assert.equal(go2.role, 'part') // a plain part — no function is invented for it
})

check('語 flatten: top-level components partition the 14 strokes exactly once', () => {
  const flat = lens.flattenComponents(goStrokes.tree, goMeta)
  const tops = flat.filter((n) => n.depth === 1)
  assert.deepEqual(tops.map((n) => n.element), ['言', '吾'])
  const union = tops.flatMap((n) => n.strokes)
  assert.equal(union.length, 14)
  assert.equal(new Set(union).size, 14)
  assert.deepEqual([...union].sort((a, b) => a - b), Array.from({ length: 14 }, (_, i) => i))
  const rootNode = flat.find((n) => n.depth === 0)
  assert.deepEqual(rootNode.strokes, Array.from({ length: 14 }, (_, i) => i))
})

check('strokeAnchor reads the first moveto, in the 0–109 box', () => {
  const a = lens.strokeAnchor(goStrokes.paths[0])
  assert.ok(a)
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y))
  assert.ok(a.x >= 0 && a.x <= 109 && a.y >= 0 && a.y <= 109)
  assert.equal(lens.strokeAnchor(''), null)
  assert.equal(lens.strokeAnchor('not a path'), null)
  assert.equal(lens.strokeAnchor(null), null)
})

check('captions are built from data only', () => {
  const flat = lens.flattenComponents(goStrokes.tree, goMeta)
  const gon = flat.find((n) => n.element === '言')
  const cap = lens.captionFor(gon, { meaning: 'say' })
  assert.ok(cap.startsWith('言'))
  assert.ok(cap.includes('radical'))
  assert.ok(cap.includes('say'))
  const go = flat.find((n) => n.element === '吾')
  const cap2 = lens.captionFor(go, { soundOn: 'ゴ' })
  assert.ok(cap2.includes('sound'))
  assert.ok(cap2.includes('ゴ'))
})

check('語 family: sound family via 吾, honest matches split, self excluded', () => {
  const radicalMembers = index.filter((r) => r.radical === goMeta.radical).map((r) => r.char)
  const fam = lens.familyFor('語', goMeta, goStrokes.tree, {
    components,
    metaOf: (c) => byChar.get(c) || null,
    radicalMembers,
  })
  assert.equal(fam.soundComponent, '吾')
  assert.equal(fam.soundOn, 'ゴ')
  assert.ok(Array.isArray(fam.sound) && fam.sound.length > 0)
  assert.ok(fam.sound.every((m) => typeof m.char === 'string' && typeof m.matches === 'boolean' && 'on' in m))
  assert.ok(!fam.sound.some((m) => m.char === '語'))
  const satoru = fam.sound.find((m) => m.char === '悟')
  assert.ok(satoru, '悟 (also ゴ) belongs to the 吾 family')
  assert.equal(satoru.matches, true)
  // Probabilistic honesty: the family is not uniformly matching.
  assert.ok(fam.sound.some((m) => m.matches))
  assert.ok(fam.parts['言'].count > 50)
  assert.ok(fam.parts['吾'].chars.includes('悟'))
  assert.ok(fam.radical.length > 0 && fam.radical.length <= 12)
  assert.ok(!fam.radical.includes('語'))
})

check('a kanji without KanjiVG coverage degrades honestly', () => {
  assert.equal(strokesFor('丂'), null)
  assert.deepEqual(lens.flattenComponents(null, metaFor('丂')), [])
  const fam = lens.familyFor('丂', metaFor('丂'), null, {
    components,
    metaOf: (c) => byChar.get(c) || null,
    radicalMembers: [],
  })
  assert.deepEqual(fam.sound, [])
  assert.deepEqual(fam.parts, {})
  assert.deepEqual(fam.radical, [])
  assert.equal(lens.captionFor(null), '')
  assert.equal(lens.captionFor({ element: '木', role: 'part', position: 'left' }), '木 · on the left')
})

check('pickQueueWord prefers the first 2-kanji compound containing the char', () => {
  const entries = [
    { id: 1, kanji: ['語る'], kana: 'かたる', gloss: ['to talk'] },
    { id: 2, kanji: ['日本語'], kana: 'にほんご', gloss: ['Japanese language'] },
    { id: 3, kanji: ['英語'], kana: 'えいご', gloss: ['English'] },
    { id: 4, kanji: ['語学'], kana: 'ごがく', gloss: ['linguistics'] },
  ]
  // 日本語 is 3 kanji — skipped; 英語 is the first true 2-kanji compound.
  assert.equal(lens.pickQueueWord('語', entries).front, '英語')
  // Forms are scanned in order inside an entry too.
  const multi = [{ id: 5, kanji: ['御言葉', '言葉'], kana: 'ことば', gloss: ['word'] }]
  assert.equal(lens.pickQueueWord('葉', multi).front, '言葉')
})

check('pickQueueWord falls back to the first entry, honestly null when wordless', () => {
  const entries = [
    { id: 1, kanji: ['語る'], kana: 'かたる', gloss: ['to talk'] },
    { id: 2, kanji: ['日本語'], kana: 'にほんご', gloss: ['Japanese language'] },
  ]
  assert.equal(lens.pickQueueWord('語', entries).front, '語る')
  const kanaOnly = [{ id: 3, kanji: [], kana: 'テスト', gloss: ['test'] }]
  assert.equal(lens.pickQueueWord('語', kanaOnly).front, 'テスト')
  assert.equal(lens.pickQueueWord('語', []), null)
  assert.equal(lens.pickQueueWord('語', null), null)
  assert.equal(lens.pickQueueWord('', entries), null)
})

check('pickQueueWord on real data: 語 picks a real 2-kanji compound', () => {
  const entries = wordsForKanjiDisk('語', 50)
  assert.ok(entries.length > 0)
  const pick = lens.pickQueueWord('語', entries)
  assert.ok(pick)
  assert.ok(pick.front.includes('語'))
  assert.equal(lens.kanjiCountOf(pick.front), 2)
  assert.equal(pick.front, '隠語')
})

check('queueHasFront matches by front under any source', () => {
  const q = [{ front: '英語', source: 'reader' }, { front: '猫', source: 'manual' }]
  assert.equal(lens.queueHasFront(q, '英語'), true)
  assert.equal(lens.queueHasFront(q, '語学'), false)
  assert.equal(lens.queueHasFront([], '英語'), false)
  assert.equal(lens.queueHasFront(null, '英語'), false)
  assert.equal(lens.queueHasFront(q, ''), false)
})

console.log(`\nlens: ${passed} checks passed`)
