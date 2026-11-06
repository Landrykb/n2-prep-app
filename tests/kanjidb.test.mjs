// KanjiDB v2 tests (run: TZ=UTC npm run test:kanjidb)
// Pins the generated database under public/data/kanjidb/ (built by
// scripts/build-kanjidb.mjs from KANJIDIC2 + KanjiVG) and the pure helpers
// of src/lib/kanjiDb.js. Data files are read from disk, never via fetch.
//
// Count note: node_modules/kanji/dist/data/kanjidic/ holds 13,109 entries,
// one of which is _notice.txt — so the KANJIDIC2 JSON files, and therefore
// the index, number 13,108.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DB = path.join(root, 'public/data/kanjidb')
const DIC = path.join(root, 'node_modules/kanji/dist/data/kanjidic')
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

const db = await import('../src/lib/kanjiDb.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const indexRaw = readJson(path.join(DB, 'index.json'))
const index = indexRaw.map(db.expandIndexRow)
const manifest = readJson(path.join(DB, 'manifest.json'))

check('index holds one row per KANJIDIC2 JSON file (13,108)', () => {
  const dicJsonCount = fs.readdirSync(DIC).filter((f) => f.endsWith('.json')).length
  assert.equal(dicJsonCount, 13108)
  assert.equal(indexRaw.length, dicJsonCount)
  assert.equal(manifest.counts.kanjidicKanji, dicJsonCount)
})

check('meta shards together hold every kanji in the index', () => {
  let total = 0
  for (const f of fs.readdirSync(path.join(DB, 'meta'))) {
    total += Object.keys(readJson(path.join(DB, 'meta', f))).length
  }
  assert.equal(total, indexRaw.length)
})

check('loader shard maths points at real files', () => {
  const astral = index.find((r) => r.char.codePointAt(0) > 0x1f000).char
  for (const ch of ['語', '一', '龠', astral]) {
    const metaRel = db.metaShardPath(ch).replace('/data/kanjidb/', '')
    assert.ok(fs.existsSync(path.join(DB, metaRel)), metaRel)
  }
  for (const ch of ['語', '一', '龠']) {
    const strokesRel = db.strokesShardPath(ch).replace('/data/kanjidb/', '')
    assert.ok(fs.existsSync(path.join(DB, strokesRel)), strokesRel)
  }
})

function strokesEntryFor(ch) {
  const shard = readJson(path.join(DB, db.strokesShardPath(ch).replace('/data/kanjidb/', '')))
  return shard[ch] || null
}
function metaFor(ch) {
  const shard = readJson(path.join(DB, db.metaShardPath(ch).replace('/data/kanjidb/', '')))
  return shard[ch] || null
}

check('語 has exactly 14 stroke paths and KANJIDIC2 agrees', () => {
  const entry = strokesEntryFor('語')
  assert.ok(entry)
  assert.equal(entry.paths.length, 14)
  assert.equal(metaFor('語').strokes, 14)
})

check('語 tree: 言 carries the radical flag and nests 口; 吾 nests 五 and 口', () => {
  const { tree } = db.expandStrokesEntry(strokesEntryFor('語'))
  assert.equal(tree.element, '語')
  const gon = tree.children.find((c) => c.element === '言')
  assert.ok(gon)
  assert.ok(gon.radical, '言 must carry a KanjiVG radical flag')
  assert.ok(gon.children.some((c) => c.element === '口'))
  const go = tree.children.find((c) => c.element === '吾')
  assert.ok(go)
  assert.deepEqual(go.children.map((c) => c.element), ['五', '口'])
  // Every stroke belongs to exactly one subtree leaf path: 14 unique indices.
  const all = db.subtreeStrokeIndices(tree)
  assert.equal(all.length, 14)
  assert.equal(new Set(all).size, 14)
})

check('meta for 語 carries sourced readings, meanings and refs', () => {
  const meta = metaFor('語')
  assert.ok(meta.on.includes('ゴ'))
  assert.ok(meta.kun.some((k) => k.startsWith('かた')))
  assert.ok(meta.meanings.includes('language'))
  assert.ok(meta.meaningsFr.includes('langage'))
  assert.equal(meta.radical, 149)
  assert.equal(meta.refs.heisig, '347')
  assert.equal(meta.level, 'N5') // old JLPT 4 -> the app's N5 list
})

check('components index: 言 is contained in 語 and 誠, with its on-reading', () => {
  const components = readJson(path.join(DB, 'components.json'))
  const [chars, on] = components['言']
  assert.ok(chars.includes('語'))
  assert.ok(chars.includes('誠'))
  assert.equal(on, 'ゲン')
  // Integrity: every kanji referenced exists in the index.
  const indexChars = new Set(index.map((r) => r.char))
  for (const [list] of Object.values(components)) {
    for (const ch of [...list]) assert.ok(indexChars.has(ch), ch)
  }
})

check('a kanji KanjiVG does not cover returns an honest null', () => {
  // 丂 is in KANJIDIC2 but has no KanjiVG entry in the current release:
  // the shard simply has no key for it, and the loader maps that to null.
  assert.ok(index.some((r) => r.char === '丂'))
  assert.equal(strokesEntryFor('丂'), null)
  assert.equal(db.expandStrokesEntry(null), null)
  assert.equal(manifest.counts.kanjidicKanji - manifest.counts.kanjivgCovered, 6691)
})

check('search: character, kana, romaji and meaning all find 語', () => {
  assert.equal(db.searchIndex(index, '語')[0].char, '語')
  assert.ok(db.searchIndex(index, 'ゴ').some((r) => r.char === '語'))
  assert.ok(db.searchIndex(index, 'かた').some((r) => r.char === '語'))
  assert.ok(db.searchIndex(index, 'go').some((r) => r.char === '語'))
  // Meaning search sees the index's compact first-meaning field ('word').
  assert.ok(db.searchIndex(index, 'word', 500).some((r) => r.char === '語'))
  assert.equal(db.kanaToRomaji('ゴ'), 'go')
  assert.equal(db.kanaToRomaji('カタル'), 'kataru')
})

check('radicals: 214 entries, all with a character, provenance kept', () => {
  const radicals = readJson(path.join(DB, 'radicals.json'))
  assert.equal(radicals.length, 214)
  assert.ok(radicals.every((r) => r.char && r.charSource))
  const r149 = radicals.find((r) => r.n === 149)
  assert.equal(r149.char, '言')
  const r1 = radicals.find((r) => r.n === 1)
  assert.equal(r1.char, '一')
  assert.equal(r1.nameEn, 'one')
  assert.equal(manifest.validation.goTreeOk, true)
  assert.equal(manifest.validation.componentsIntegrity, true)
})

check('intersectComponents: 日 + 月 finds 明； empty or unknown parts give []', () => {
  const components = readJson(path.join(DB, 'components.json'))
  const both = db.intersectComponents(['日', '月'], components)
  assert.ok(both.includes('明'), '明 must be built from both 日 and 月')
  assert.ok(both.every((c) => components['日'][0].includes(c) && components['月'][0].includes(c)))
  const gon = db.intersectComponents(['言'], components)
  assert.ok(gon.includes('語'))
  assert.deepEqual(db.intersectComponents([], components), [])
  assert.deepEqual(db.intersectComponents(['龘龘'], components), [])
  assert.deepEqual(db.intersectComponents(['日', '龘龘'], components), [])
})

console.log(`\nkanjidb: ${passed} checks passed`)
