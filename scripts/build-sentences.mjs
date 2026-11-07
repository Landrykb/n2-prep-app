// Build the dictionary-linked example sentences for WordsDB (docs/19).
//
// Source: EDRDG's examples.utf — the dictionary-linked example file
// (http://ftp.edrdg.org/pub/Nihongo/examples.utf.gz). It is the
// human-readable form of the jpn_indices linking: each sentence pair
// (A: line, Japanese + English) is followed by an index line (B:)
// whose tokens name the JMdict headwords the sentence illustrates,
// with readings, sense numbers, the surface form used, and — for some
// tokens — the JMdict sequence number directly, as (#2028980).
// The sentences themselves are the Tatoeba / Tanaka Corpus set
// (CC BY 2.0 FR; some sentences CC0).
//
// Method label: 'jmdict-linked'. Resolution of a B-line token to one
// of our 22,650 WordsDB entries, in order:
//   1. the printed (#seq) reference, when it names one of our entries;
//   2. headword + reading matched against the entry's written forms
//      and kana readings;
//   3. the headword as a kana word, or as a written form alone.
// A token resolving to more than 4 entries is skipped as ambiguous —
// better a missing sentence than a wrong attachment.
//
// Assignment: at most 2 pairs per word, shortest Japanese first
// (<= 40 chars preferred; longer only when a word has nothing
// shorter, hard cap 60). Breadth before depth: every covered word
// gets its first pair before any word gets a second, under a total
// payload budget of ~3.4 MB. Shards mirror the words shards.
//
// Outputs (public/data/wordsdb/):
//   sentences.json            — manifest (method, counts, licence)
//   sentences/sentences-bb.json — { wordId: [{ jp, en }] }
//
// Run: npm run build:sentences   (cache: ~/workspace/tatoeba-cache/)

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const WORDS_DIR = path.join(ROOT, 'public', 'data', 'wordsdb')
const CACHE_DIR = path.join(ROOT, '..', '..', 'tatoeba-cache')
const SOURCE_URL = 'http://ftp.edrdg.org/pub/Nihongo/examples.utf.gz'

const MAX_PAIRS_PER_WORD = 2
const PREFERRED_MAX_JP = 40
const HARD_MAX_JP = 60
const MAX_RESOLVED_IDS = 4
const BUDGET_BYTES = 3_400_000
const CANDIDATES_PER_WORD = 4

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const shardOf = (id) => String(id).padStart(7, '0').slice(0, 2)

/** Parse one B-line token into { headword, reading, seq }. */
export function parseIndexToken(token) {
  const seqM = token.match(/\(#(\d+)\)/)
  const readM = token.match(/\(([^)#][^)]*)\)/)
  const cut = token.search(/[([{[#~]/)
  return {
    headword: (cut === -1 ? token : token.slice(0, cut)).trim(),
    reading: readM ? readM[1] : null,
    seq: seqM ? seqM[1] : null,
  }
}

/** Parse the A:/B: line stream into [{ jp, en, tokens }]. */
export function parseExamples(text) {
  const pairs = []
  let current = null
  for (const line of text.split('\n')) {
    if (line.startsWith('A: ')) {
      const body = line.slice(3)
      const tab = body.indexOf('\t')
      if (tab === -1) { current = null; continue }
      const jp = body.slice(0, tab).trim()
      const en = body.slice(tab + 1).replace(/#ID=\d+_\d+\s*$/, '').trim()
      current = { jp, en, tokens: [] }
      pairs.push(current)
    } else if (line.startsWith('B: ') && current) {
      current.tokens = line.slice(3).split(/\s+/).filter(Boolean).map(parseIndexToken)
    }
  }
  return pairs
}

async function ensureSource() {
  const gzPath = path.join(CACHE_DIR, 'examples.utf.gz')
  if (!fs.existsSync(gzPath)) {
    const res = await fetch(SOURCE_URL)
    if (!res.ok) throw new Error(`download failed: ${res.status} ${SOURCE_URL}`)
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(gzPath, Buffer.from(await res.arrayBuffer()))
  }
  return gzPath
}

async function main() {
  // ---- our word universe + resolution maps
  const wordIds = new Set()
  const formReading = new Map() // `${form}|${kana}` -> [ids]
  const kanaWords = new Map() // kana -> [ids]
  const formOnly = new Map() // written form -> [ids]
  const push = (map, key, id) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(id)
  }
  for (const f of fs.readdirSync(path.join(WORDS_DIR, 'words'))) {
    const shard = readJson(path.join(WORDS_DIR, 'words', f))
    for (const [id, e] of Object.entries(shard)) {
      wordIds.add(id)
      const kanas = Array.isArray(e.kana) ? e.kana : [e.kana]
      const forms = e.kanji || []
      for (const k of kanas) push(kanaWords, k, id)
      for (const form of forms) {
        push(formOnly, form, id)
        for (const kana of kanas) push(formReading, `${form}|${kana}`, id)
      }
      if (!forms.length) for (const kana of kanas) push(formReading, `${kana}|${kana}`, id)
    }
  }
  // Lens-facing words first (they appear in kanji-words.json).
  const lensWordIds = new Set()
  const kanjiWords = readJson(path.join(WORDS_DIR, 'kanji-words.json'))
  for (const list of Object.values(kanjiWords)) for (const id of list) lensWordIds.add(String(id))

  // ---- parse the linked corpus
  const gzPath = await ensureSource()
  const text = zlib.gunzipSync(fs.readFileSync(gzPath)).toString('utf8')
  const pairs = parseExamples(text)

  const resolve = (tok) => {
    if (tok.seq && wordIds.has(tok.seq)) return [tok.seq]
    if (!tok.headword) return []
    let ids = null
    if (tok.reading) ids = formReading.get(`${tok.headword}|${tok.reading}`)
    if (!ids && kanaWords.has(tok.headword)) ids = kanaWords.get(tok.headword)
    if (!ids) ids = formOnly.get(tok.headword)
    if (!ids || ids.length > MAX_RESOLVED_IDS) return []
    return ids
  }

  const candidates = new Map() // wordId -> [{ jp, en }]
  const candidateKeys = new Map() // wordId -> Set of `${jp}\n${en}`
  let attached = 0
  for (const pair of pairs) {
    if ([...pair.jp].length > HARD_MAX_JP) continue
    const seen = new Set()
    for (const tok of pair.tokens) {
      for (const id of resolve(tok)) {
        if (seen.has(id)) continue
        seen.add(id)
        if (!candidates.has(id)) { candidates.set(id, []); candidateKeys.set(id, new Set()) }
        const key = `${pair.jp}\n${pair.en}`
        if (!candidateKeys.get(id).has(key)) {
          candidateKeys.get(id).add(key)
          candidates.get(id).push({ jp: pair.jp, en: pair.en })
          attached++
        }
      }
    }
  }
  for (const list of candidates.values()) {
    list.sort((a, b) => [...a.jp].length - [...b.jp].length)
    list.splice(CANDIDATES_PER_WORD)
  }

  // ---- assignment under budget: breadth (1 pair) before depth (2nd)
  const wordOrder = [...candidates.keys()].sort((a, b) => {
    const la = lensWordIds.has(a) ? 0 : 1
    const lb = lensWordIds.has(b) ? 0 : 1
    if (la !== lb) return la - lb
    return Number(a) - Number(b)
  })
  const assigned = new Map() // wordId -> [{jp, en}]
  let bytes = 0
  const pairBytes = (id, p) => JSON.stringify(id).length + JSON.stringify(p).length + 8
  for (let round = 0; round < MAX_PAIRS_PER_WORD; round++) {
    for (const id of wordOrder) {
      const list = candidates.get(id)
      // Words whose shortest candidate exceeds the readability
      // preference wait for the final fill — they get one pair, and
      // only if budget remains after preferred pairs are placed.
      if ([...list[0].jp].length > PREFERRED_MAX_JP) continue
      const cand = list[round]
      if (!cand) continue
      const cost = pairBytes(id, cand)
      if (bytes + cost > BUDGET_BYTES) continue
      if (!assigned.has(id)) assigned.set(id, [])
      assigned.get(id).push(cand)
      bytes += cost
    }
  }
  // Final fill: words still empty whose only candidates were > 40 chars.
  for (const id of wordOrder) {
    if (assigned.has(id)) continue
    const cand = candidates.get(id)[0]
    if (!cand) continue
    const cost = pairBytes(id, cand)
    if (bytes + cost > BUDGET_BYTES) continue
    assigned.set(id, [cand])
    bytes += cost
  }

  // ---- write shards
  const outDir = path.join(WORDS_DIR, 'sentences')
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const shards = new Map()
  for (const [id, list] of assigned) {
    const bb = shardOf(id)
    if (!shards.has(bb)) shards.set(bb, {})
    shards.get(bb)[id] = list
  }
  let payloadBytes = 0
  for (const [bb, obj] of [...shards.entries()].sort()) {
    const p = path.join(outDir, `sentences-${bb}.json`)
    fs.writeFileSync(p, JSON.stringify(obj))
    payloadBytes += fs.statSync(p).size
  }
  const pairCount = [...assigned.values()].reduce((s, l) => s + l.length, 0)
  const shortPairs = [...assigned.values()].flat().filter((p) => [...p.jp].length <= PREFERRED_MAX_JP).length

  const manifest = {
    generatedAt: new Date().toISOString(),
    sources: {
      examplesFile: {
        name: 'EDRDG examples.utf — the dictionary-linked example sentences (jpn_indices linking in readable form)',
        url: SOURCE_URL,
        bytes: fs.statSync(gzPath).size,
        pairsInFile: pairs.length,
      },
      sentences: {
        name: 'Tatoeba / Tanaka Corpus',
        licence: 'CC BY 2.0 FR (some sentences CC0)',
        url: 'https://tatoeba.org',
      },
    },
    method: 'jmdict-linked',
    resolution: 'B-line index tokens resolved to WordsDB entries by (1) printed JMdict (#seq) reference, (2) headword + reading against written forms and kana, (3) headword as kana word or written form; tokens resolving to more than 4 entries skipped as ambiguous',
    counts: {
      wordsInDb: wordIds.size,
      wordsWithCandidates: candidates.size,
      wordsWithSentences: assigned.size,
      pairsShipped: pairCount,
      pairsWithinPreferredLength: shortPairs,
      attachmentsConsidered: attached,
      shards: shards.size,
      payloadBytes,
      budgetBytes: BUDGET_BYTES,
      maxPairsPerWord: MAX_PAIRS_PER_WORD,
      preferredMaxJpChars: PREFERRED_MAX_JP,
      hardMaxJpChars: HARD_MAX_JP,
    },
  }
  fs.writeFileSync(path.join(WORDS_DIR, 'sentences.json'), JSON.stringify(manifest, null, 2))
  console.log(`parsed ${pairs.length} linked pairs; candidates for ${candidates.size} words`)
  console.log(`shipped: ${assigned.size} words / ${pairCount} pairs (${shortPairs} within ${PREFERRED_MAX_JP} chars) in ${shards.size} shards, ${(payloadBytes / 1024).toFixed(0)} kB`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) await main()
