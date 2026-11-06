// Words Layer tests (run: TZ=UTC npm run test:wordsdb)
// Pins the generated database under public/data/wordsdb/ (built by
// scripts/build-wordsdb.mjs from JMdict via jmdict-simplified + Kanjium
// accents.txt) and the pure helpers of src/lib/wordsDb.js. Data files are
// read from disk, never via fetch.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DB = path.join(root, 'public/data/wordsdb')
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

const wdb = await import('../src/lib/wordsDb.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const manifest = readJson(path.join(DB, 'manifest.json'))
const kanjiWords = readJson(path.join(DB, 'kanji-words.json'))
const accents = readJson(path.join(DB, 'accents.json'))
const searchRows = readJson(path.join(DB, 'search-index.json'))

const shardDiskCache = new Map()
function wordEntry(id) {
  const rel = wdb.wordShardPath(id).replace('/data/wordsdb/', '')
  if (!shardDiskCache.has(rel)) shardDiskCache.set(rel, readJson(path.join(DB, rel)))
  return shardDiskCache.get(rel)[String(id)] || null
}
function wordsForKanjiDisk(char, limit = 10) {
  return (kanjiWords[char] || []).slice(0, limit).map(wordEntry).filter(Boolean)
}

check('manifest counts agree with the generated files', () => {
  assert.equal(manifest.counts.entries, searchRows.length)
  assert.equal(manifest.counts.kanjiCovered, Object.keys(kanjiWords).length)
  let shardEntries = 0
  for (const f of manifest.shards.files) {
    shardEntries += Object.keys(readJson(path.join(DB, f.file))).length
    assert.equal(f.entries, Object.keys(readJson(path.join(DB, f.file))).length)
    assert.ok(f.bytes <= 1.5 * 1024 * 1024, `${f.file} over the shard cap`)
  }
  assert.equal(shardEntries, manifest.counts.entries)
  assert.ok(manifest.sizes.totalBytes <= 7 * 1024 * 1024, 'payload over the 7 MB target')
  assert.equal(manifest.sources.jmdict.holder.includes('EDRDG'), true)
  assert.ok(manifest.sources.kanjium.credit.includes('Uros O.'))
})

check('kanji-words integrity: every referenced id resolves to an entry', () => {
  let refs = 0
  for (const ids of Object.values(kanjiWords)) {
    for (const id of ids) {
      refs++
      assert.ok(wordEntry(id), `id ${id} does not resolve`)
    }
  }
  assert.equal(refs, manifest.counts.kanjiWordRefs)
})

check('wordsForKanji（語） returns real JMdict words with kana and gloss', () => {
  const words = wordsForKanjiDisk('語', 10)
  assert.ok(words.length >= 5, `expected several words, got ${words.length}`)
  assert.ok(words.some((e) => e.kanji.some((f) => f.includes('語'))))
  for (const e of words) {
    assert.ok(e.kana, 'entry kana')
    assert.ok(e.gloss.length >= 1 && e.gloss.length <= 3, 'gloss capped at 3')
  }
  const nihongo = wordsForKanjiDisk('語', 60).find((e) => e.kanji.includes('日本語'))
  assert.ok(nihongo, '日本語 must be reachable from 語')
  assert.equal(nihongo.kana, 'にほんご')
  assert.ok(nihongo.gloss[0].toLowerCase().includes('japanese'))
})

check('accent lookup: 食べる carries its Kanjium pattern, verbatim', () => {
  // Verified against the real accents.txt: 食べる \t たべる \t 2.
  const taberu = wordEntry('1358280')
  assert.ok(taberu.kanji.includes('食べる'))
  assert.equal(wdb.accentForEntry(accents, taberu), '2')
  const nihongo = wordEntry('1464530')
  assert.equal(wdb.accentForEntry(accents, nihongo), '0')
  // Honest null: a fabricated entry gets no pattern.
  assert.equal(wdb.accentForEntry(accents, { kanji: ['龘'], kana: 'とう' }), null)
  assert.ok(manifest.counts.accentCoveragePct > 50, 'accent coverage should cover most common words')
})

check('searchWords index: "language" finds 日本語； kana and kanji queries work', () => {
  const lang = wdb.searchWordIndex(searchRows, 'language', 30)
  assert.ok(lang.some((r) => r[1].split('/').includes('日本語')), '日本語 must match "language" via its gloss')
  const byKanji = wdb.searchWordIndex(searchRows, '日本語', 5)
  assert.equal(byKanji[0][1].split('/')[0], '日本語')
  const byKana = wdb.searchWordIndex(searchRows, 'たべる', 5)
  assert.ok(byKana.some((r) => r[2] === 'たべる'))
  const byRomaji = wdb.searchWordIndex(searchRows, 'taberu', 5)
  assert.ok(byRomaji.some((r) => r[2] === 'たべる'))
  assert.deepEqual(wdb.searchWordIndex(searchRows, ''), [])
  assert.deepEqual(wdb.searchWordIndex(searchRows, 'zzzzqqqq'), [])
})

check('display form prefers the written form containing the kanji', () => {
  const e = { kanji: ['喰べる', '食べる'], kana: 'たべる', gloss: ['to eat'] }
  assert.equal(wdb.wordDisplayForm(e, '食'), '食べる')
  assert.equal(wdb.wordDisplayForm(e), '喰べる')
  assert.equal(wdb.wordDisplayForm({ kanji: [], kana: 'する' }), 'する')
})

console.log(`\nwordsdb: ${passed} checks passed`)
