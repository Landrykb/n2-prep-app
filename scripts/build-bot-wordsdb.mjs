// Build the Heard Words wide wordbook (public/data/wordbook/,
// sharded JSON + manifest).
//
// Why: the Heard Words matcher (Doc 22) began with the bot's
// curated glossaries — the JLPT deck + its gloss + the JMdict
// compound supplement, ≈20k surfaces. Real rooms say more than
// that. JMdict's COMMON subset (the app's WordsDB source) does
// not fix it either: 納期, a basic business word, is not in it
// — the common flag is editorial, not coverage. So this
// wordbook carries EVERY written form of EVERY entry of the
// FULL JMdict — kanji forms and kana forms alike — mapped to
// the entry's headword, plus each kanji headword's reading
// (the card shows word（reading）).
//
// The NAMES dictionary (JMnedict) is deliberately NOT a
// source: people's and companies' names must stay unmatchable
// (verified: 田中・山田・鈴木・佐藤 have zero entries here).
//
// The wordbook is DATA, not code: it ships as a static file
// with the app and the bot fetches it once per process (with
// the curated glossaries as fallback), so widening the
// dictionary never needs a bot redeploy.
//
// Compact encoding: heads[] holds each headword once with its
// reading in the parallel readings[]; forms{} maps only the
// surfaces that are NOT headwords themselves to a head index.
//
// Source: full jmdict-eng (JMdict — EDRDG, CC BY-SA; credited
// on the app's Sources screen), cached in ~/workspace/wordsdb-cache.
// Run: node scripts/build-bot-wordsdb.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const cachePath = resolve(here, '../../../wordsdb-cache/jmdict-eng-3.6.2.json')
const outPath = resolve(repo, 'public/data/wordbook')

const MAX_SURFACE_CHARS = 16 // longer entries are phrases, not words

// A surface or headword that is PURE digits/letters is data, not
// vocabulary: JMdict carries entries like １２０, and letting one
// through would let a figure from someone's sentence persist as a
// count — exactly what Doc 22 law 3 forbids. Mixed entries
// (第3四半期, 24時間) are real word shapes and stay.
const PURE_ALNUM = /^[0-9a-zA-Z]+$/
const isPureAlnum = (text) => PURE_ALNUM.test(text.normalize('NFKC'))

const dict = JSON.parse(readFileSync(cachePath, 'utf8'))
const entries = dict.words ?? dict

const heads = []
const headIndex = new Map()
const readings = []
const forms = {}
let formCount = 0
for (const entry of entries) {
  const kanji = Array.isArray(entry.kanji) ? entry.kanji : []
  const kana = Array.isArray(entry.kana) ? entry.kana : []
  const headword =
    (kanji.find((k) => k.common) ?? kanji[0])?.text ??
    (kana.find((k) => k.common) ?? kana[0])?.text
  if (!headword || Array.from(headword).length > MAX_SURFACE_CHARS || isPureAlnum(headword)) continue
  let idx = headIndex.get(headword)
  if (idx === undefined) {
    idx = heads.length
    headIndex.set(headword, idx)
    heads.push(headword)
    let reading = ''
    if (kanji.length && kana.length) {
      const applied = kana.find(
        (k) => Array.isArray(k.appliesToKanji) && (k.appliesToKanji.includes(headword) || k.appliesToKanji.includes('*')),
      )
      reading = (applied ?? kana[0])?.text ?? ''
      if (reading === headword) reading = ''
    }
    readings.push(reading)
  }
  for (const form of [...kanji, ...kana]) {
    const text = form?.text
    if (!text || text === headword || Array.from(text).length > MAX_SURFACE_CHARS || isPureAlnum(text)) continue
    formCount++
    // First entry wins a shared surface (a kana form shared by
    // several entries counts under the first entry's headword —
    // a counting heuristic, documented in Doc 22).
    if (!(text in forms) && !headIndex.has(text)) forms[text] = idx
  }
}

// Sharded output: the whole book is ~14 MB, and the GitHub
// write route rejects request bodies near that size once the
// content is encoded — so the book ships as N shards plus a
// manifest, the same pattern as the app's WordsDB. Shards are
// contiguous headword ranges; forms keep GLOBAL head indexes,
// so the loader just concatenates heads/readings in shard
// order and merges the forms maps.
const SHARDS = 4
mkdirSync(outPath, { recursive: true })
const per = Math.ceil(heads.length / SHARDS)
const shardNames = []
for (let s = 0; s < SHARDS; s++) {
  const from = s * per
  const sliceHeads = heads.slice(from, from + per)
  if (sliceHeads.length === 0) continue
  const sliceReadings = readings.slice(from, from + per)
  const sliceForms = {}
  for (const [surface, idx] of Object.entries(forms)) {
    if (idx >= from && idx < from + per) sliceForms[surface] = idx
  }
  const name = `wordbook-${s}.json`
  writeFileSync(resolve(outPath, name), JSON.stringify({ heads: sliceHeads, readings: sliceReadings, forms: sliceForms }))
  shardNames.push(name)
}
writeFileSync(resolve(outPath, 'manifest.json'), JSON.stringify({ shards: shardNames }))
console.log(`entries: ${entries.length}, headwords: ${heads.length}, variant forms: ${formCount}, mapped forms: ${Object.keys(forms).length}`)
for (const probe of ['納期', '検収', '稟議', '見積書']) {
  const idx = headIndex.get(probe)
  console.log(`${probe} -> head #${idx}, reading ${idx !== undefined ? readings[idx] || '(none)' : 'MISSING'}`)
}
console.log(`のうき -> form of ${forms['のうき'] !== undefined ? heads[forms['のうき']] : 'MISSING'} (first entry wins a shared kana form)`)
