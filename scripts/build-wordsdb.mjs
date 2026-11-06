// Builds the Words Layer — JMdict common words + Kanjium pitch accents —
// into public/data/wordsdb/. See docs/19-Words-Database.md.
//
// Sources (nothing is invented; every field traces to one of these):
//   Word entries : JMdict, via the jmdict-simplified JSON build
//     (github.com/scriptin/jmdict-simplified releases, file
//     jmdict-eng-common-*.json.tgz — the COMMON-words English build only).
//     JMdict is the property of the EDRDG, used under its licence
//     (CC BY-SA 4.0; http://www.edrdg.org/edrdg/licence.html). Commercial
//     bundling is permitted; attribution lives in the manifest, Doc 19 and
//     the app's Lens attribution line.
//   Pitch accents : Kanjium accents.txt (124,137 words) from
//     github.com/mifunetoshiro/kanjium (data/source_files/raw/accents.txt),
//     CC BY-SA 4.0. Required credit (from the Kanjium README): "The pitch
//     accent notation, verb particle data, phonetics, homonyms and other
//     additions or modifications to EDICT, KANJIDIC or KRADFILE were
//     provided by Uros O. through his free database."
//   Both downloads are cached outside the repo in ~/workspace/wordsdb-cache/
//   (mirroring the KanjiVG cache pattern of build-kanjidb.mjs).
//
// Schema facts found in the actual jmdict-simplified JSON (verified at
// build time, release 3.6.2): the original JMdict priority tags (news1,
// ichi1, spec1, gai1, nfXX) do NOT survive the simplified conversion — the
// only frequency signal left is the boolean `common` flag on each kanji /
// kana form, and the common-only build itself (entries with at least one
// common form). The kanji->words ordering below therefore uses that real
// `common` flag first and falls back to a documented heuristic after it.
//
// Derived data (labelled as derived wherever it appears):
//   - kanji-words.json: kanji -> word ids, ordered by (1) the kanji form
//     containing the kanji is marked common in JMdict, (2) shorter written
//     form first (2-kanji compounds before long strings), (3) kana A–Z.
//     This ordering is a heuristic built on the source's common flag, not
//     a frequency ranking — JMdict-simplified carries no frequency bands.
//   - accents.json: subset of Kanjium covering only this build's words,
//     keyed "writtenForm|kana". Kanjium patterns are kept verbatim
//     ("0", "2", "3,1"); multiple lines for one key are merged as a
//     de-duplicated comma list, the same notation Kanjium itself uses.
//
// Run: npm run build:wordsdb

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const OUT_DIR = path.join(root, 'public/data/wordsdb')
const CACHE_DIR = path.join(root, '..', '..', 'wordsdb-cache')
const SHARD_CAP = 1.5 * 1024 * 1024

const KANJIUM_CREDIT =
  'The pitch accent notation, verb particle data, phonetics, homonyms and other additions or modifications to EDICT, KANJIDIC or KRADFILE were provided by Uros O. through his free database.'
const ACCENTS_URL = 'https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt'

// ---------------------------------------------------------------- downloads
async function loadJmdict() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const cached = fs.readdirSync(CACHE_DIR).find((f) => /^jmdict-eng-common-.*\.json$/.test(f))
  if (cached) {
    return {
      data: JSON.parse(fs.readFileSync(path.join(CACHE_DIR, cached), 'utf8')),
      file: cached,
      release: cached.replace(/^jmdict-eng-common-/, '').replace(/\.json$/, ''),
    }
  }
  const rel = await (await fetch('https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest')).json()
  const asset = (rel.assets || []).find((a) => /^jmdict-eng-common-.*\.json\.tgz$/.test(a.name))
  if (!asset) throw new Error('jmdict-simplified release has no eng-common tgz asset')
  const buf = Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer())
  const tar = zlib.gunzipSync(buf)
  // Minimal ustar walk: the archive holds exactly one .json file.
  let off = 0
  let jsonText = null
  while (off + 512 <= tar.length) {
    const name = tar.subarray(off, off + 100).toString('utf8').replace(/\0.*$/s, '')
    if (!name) break
    const size = parseInt(tar.subarray(off + 124, off + 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8)
    if (name.endsWith('.json')) {
      jsonText = tar.subarray(off + 512, off + 512 + size).toString('utf8')
      break
    }
    off += 512 + Math.ceil(size / 512) * 512
  }
  if (!jsonText) throw new Error('no .json entry found in the eng-common tgz')
  const jsonName = asset.name.replace(/\.tgz$/, '')
  fs.writeFileSync(path.join(CACHE_DIR, jsonName), jsonText)
  return { data: JSON.parse(jsonText), file: jsonName, release: rel.tag_name }
}

async function loadAccents() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const cachePath = path.join(CACHE_DIR, 'accents.txt')
  if (!fs.existsSync(cachePath)) {
    const text = await (await fetch(ACCENTS_URL)).text()
    fs.writeFileSync(cachePath, text)
  }
  return fs.readFileSync(cachePath, 'utf8')
}

// ------------------------------------------------------------------- helpers
const isKanjiChar = (ch) => {
  const cp = ch.codePointAt(0)
  return (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x2a6df) || cp === 0x3005 /* 々 */
}
export const shardFor = (id) => String(id).padStart(7, '0').slice(0, 2)

// --------------------------------------------------------------- JMdict in
const { data: jm, release: jmRelease } = await loadJmdict()
console.log(`JMdict (jmdict-simplified ${jmRelease}, dictDate ${jm.dictDate}): ${jm.words.length} common entries`)

const entries = [] // normalised entries
const formCommon = new Map() // id -> Map(formText -> bool) for ordering
for (const w of jm.words) {
  const kanjiForms = (w.kanji || []).map((k) => k.text)
  const primaryForm = (w.kanji || []).find((k) => k.common)?.text || kanjiForms[0] || null
  // Primary kana: first common kana that applies to the primary form
  // (appliesToKanji '*' or the form itself), else the first kana.
  const kanaOk = (k) => !k.appliesToKanji || k.appliesToKanji.includes('*') || (primaryForm && k.appliesToKanji.includes(primaryForm))
  const primaryKana = (w.kana || []).find((k) => k.common && kanaOk(k))?.text
    || (w.kana || []).find(kanaOk)?.text
    || w.kana?.[0]?.text || ''
  const gloss = []
  for (const sense of w.sense || []) {
    for (const g of sense.gloss || []) {
      if (g.lang === 'eng' && g.text && !gloss.includes(g.text)) gloss.push(g.text)
      if (gloss.length >= 3) break
    }
    if (gloss.length >= 3) break
  }
  entries.push({ id: String(w.id), kanji: kanjiForms, kana: primaryKana, gloss, common: true })
  formCommon.set(String(w.id), new Map((w.kanji || []).map((k) => [k.text, Boolean(k.common)])))
}

// ------------------------------------------------------------- kanji -> words
const kanjiWords = new Map() // char -> [{id, formLen, formCommon, kana}]
for (const e of entries) {
  const seen = new Set()
  for (const form of e.kanji) {
    for (const ch of form) {
      if (!isKanjiChar(ch) || seen.has(ch)) continue
      seen.add(ch)
      if (!kanjiWords.has(ch)) kanjiWords.set(ch, [])
      kanjiWords.get(ch).push({
        id: e.id,
        formLen: [...form].length,
        formCommon: formCommon.get(e.id)?.get(form) ? 0 : 1,
        kana: e.kana,
      })
    }
  }
}
const kanjiWordsOut = {}
for (const ch of [...kanjiWords.keys()].sort((a, b) => a.codePointAt(0) - b.codePointAt(0))) {
  const list = kanjiWords.get(ch)
  list.sort((a, b) => a.formCommon - b.formCommon || a.formLen - b.formLen || (a.kana < b.kana ? -1 : a.kana > b.kana ? 1 : 0) || Number(a.id) - Number(b.id))
  kanjiWordsOut[ch] = list.map((x) => Number(x.id))
}

// ------------------------------------------------------------------ accents
const accentsText = await loadAccents()
const kanjium = new Map() // "form|reading" -> Set of pattern numbers
let kanjiumLines = 0
for (const line of accentsText.split('\n')) {
  const [form, reading, pattern] = line.split('\t')
  if (!form || !reading || pattern == null || pattern === '') continue
  kanjiumLines++
  const key = `${form}|${reading}`
  if (!kanjium.has(key)) kanjium.set(key, new Set())
  for (const p of pattern.split(',')) kanjium.get(key).add(p.trim())
}
const accentsOut = {}
let entriesWithAccent = 0
for (const e of entries) {
  let found = false
  const forms = e.kanji.length ? e.kanji : [e.kana]
  for (const form of forms) {
    const set = kanjium.get(`${form}|${e.kana}`)
    if (set) {
      accentsOut[`${form}|${e.kana}`] = [...set].sort((a, b) => Number(a) - Number(b)).join(',')
      found = true
    }
  }
  if (found) entriesWithAccent++
}

// -------------------------------------------------------------------- write
fs.rmSync(OUT_DIR, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT_DIR, 'words'), { recursive: true })

const shards = new Map()
for (const e of entries) {
  const bucket = shardFor(e.id)
  if (!shards.has(bucket)) shards.set(bucket, {})
  shards.get(bucket)[e.id] = e
}
let wordsBytes = 0
const wordFiles = []
for (const [bucket, shard] of [...shards.entries()].sort()) {
  const file = `words/words-${bucket}.json`
  const json = JSON.stringify(shard)
  if (json.length > SHARD_CAP) throw new Error(`${file} exceeds the 1.5 MB shard cap (${json.length} bytes)`)
  fs.writeFileSync(path.join(OUT_DIR, file), json)
  wordsBytes += json.length
  wordFiles.push({ file, entries: Object.keys(shard).length, bytes: json.length })
}

const kanjiWordsJson = JSON.stringify(kanjiWordsOut)
fs.writeFileSync(path.join(OUT_DIR, 'kanji-words.json'), kanjiWordsJson)
const accentsJson = JSON.stringify(accentsOut)
fs.writeFileSync(path.join(OUT_DIR, 'accents.json'), accentsJson)

// Compact search index rows: [id, kanjiForms joined '/', kana, firstGloss].
const searchRows = entries.map((e) => [Number(e.id), e.kanji.join('/'), e.kana, e.gloss[0] || ''])
const searchJson = JSON.stringify(searchRows)
fs.writeFileSync(path.join(OUT_DIR, 'search-index.json'), searchJson)

// -------------------------------------------------------------- validation
const byId = new Map(entries.map((e) => [e.id, e]))
let kanjiWordsRefs = 0
for (const ids of Object.values(kanjiWordsOut)) {
  for (const id of ids) {
    kanjiWordsRefs++
    if (!byId.has(String(id))) throw new Error(`kanji-words references unknown id ${id}`)
  }
}

const totalBytes = wordsBytes + kanjiWordsJson.length + accentsJson.length + searchJson.length
const manifest = {
  generatedAt: new Date().toISOString(),
  sources: {
    jmdict: {
      via: 'jmdict-simplified (github.com/scriptin/jmdict-simplified)',
      release: jmRelease,
      formatVersion: jm.version,
      dictDate: jm.dictDate,
      build: 'jmdict-eng-common (English, common words only)',
      commonOnly: jm.commonOnly,
      licence: 'CC BY-SA 4.0',
      holder: 'EDRDG (Electronic Dictionary Research and Development Group)',
      licenceUrl: 'http://www.edrdg.org/edrdg/licence.html',
    },
    kanjium: {
      file: 'data/source_files/raw/accents.txt',
      lines: kanjiumLines,
      licence: 'CC BY-SA 4.0',
      credit: KANJIUM_CREDIT,
    },
  },
  counts: {
    entries: entries.length,
    kanaOnlyEntries: entries.filter((e) => !e.kanji.length).length,
    kanjiCovered: Object.keys(kanjiWordsOut).length,
    kanjiWordRefs: kanjiWordsRefs,
    entriesWithAccent,
    accentCoveragePct: Math.round((entriesWithAccent / entries.length) * 1000) / 10,
    accentKeys: Object.keys(accentsOut).length,
  },
  ordering:
    'kanji-words.json lists per kanji are ordered by: (1) the written form containing the kanji is flagged common in JMdict, ' +
    '(2) shorter written form first, (3) kana reading A-Z, (4) entry id. This is a heuristic built on the source common flag — ' +
    'jmdict-simplified drops the original JMdict priority tags (news1/ichi1/nfXX), so no true frequency ranking exists in this build.',
  shards: { pattern: 'words/words-{first two digits of the zero-padded JMdict id}.json', files: wordFiles },
  sizes: {
    wordsBytes, kanjiWordsBytes: kanjiWordsJson.length, accentsBytes: accentsJson.length,
    searchIndexBytes: searchJson.length, totalBytes,
  },
  validation: { kanjiWordsRefsResolve: true, searchRowsMatchEntries: searchRows.length === entries.length },
  attribution:
    'Word entries: JMdict (EDRDG, CC BY-SA 4.0, http://www.edrdg.org/edrdg/licence.html), via jmdict-simplified. ' +
    `Pitch accents: Kanjium (CC BY-SA 4.0). ${KANJIUM_CREDIT}`,
}
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1))

console.log(`words: ${entries.length} entries in ${wordFiles.length} shards, ${(wordsBytes / 1024 / 1024).toFixed(2)} MB, largest ${(Math.max(...wordFiles.map((f) => f.bytes)) / 1024).toFixed(0)} kB`)
console.log(`kanji-words: ${Object.keys(kanjiWordsOut).length} kanji covered, ${kanjiWordsRefs} refs, ${(kanjiWordsJson.length / 1024).toFixed(0)} kB`)
console.log(`accents: ${entriesWithAccent}/${entries.length} entries covered (${manifest.counts.accentCoveragePct}%), ${(accentsJson.length / 1024).toFixed(0)} kB`)
console.log(`search index: ${searchRows.length} rows, ${(searchJson.length / 1024).toFixed(0)} kB`)
console.log(`TOTAL payload: ${((totalBytes + JSON.stringify(manifest).length) / 1024 / 1024).toFixed(2)} MB`)
