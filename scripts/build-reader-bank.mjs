// Build the Yonde Reader passage bank seed (Doc 16 §7 R0).
//
// Run: node scripts/build-reader-bank.mjs
// Emits: supabase/seed/reading_passages.sql (idempotent INSERTs) and
//        supabase/functions/reader-bot/deck.ts (the deck-level map the
//        edge function needs for below-band credit, Doc 16 §5).
//
// Sources — labelled honestly per row, nothing invented:
//   source 'scene' — the Voice Loop scenes (src/data/scenes.js): the
//     partner line + model line as a two-line mini-passage, at the
//     scene's own level band, topic = its domain.
//   source 'bank'  — the app's existing mock-exam reading passages
//     (src/data.js `passages`, all N2), topic = the passage title.
//
// SEGMENTER SIBLINGS: the tokeniser below is one of three copies of
// one matcher — src/lib/readerSegment.js (data-injected core, pinned
// by tests) and supabase/functions/reader-bot/segment.ts (server
// twin, deck data only) are the others. tests/reader.test.mjs pins
// them against the seeded rows this script emits; keep all three in
// step or the parity checks fail, by design.
//
// Tokens (calibrated 2026-11-06, Doc 16 §5 amendment): each text is
// segmented into { s, h, l } objects —
//   s: surface; the surfaces join back into the exact source text
//      (asserted for every row — the fitting core relies on it).
//   h: the dictionary headword the surface belongs to. Inflected
//      surfaces resolve to their dictionary form via a deterministic
//      stem matcher built from the dictionary itself (godan masu/te
//      stems, ichidan stems, i-adjective stems), so 引っ越し in a text
//      carries h = 引っ越す.
//   l: the headword's DECK level (the OpenJLPT deck in
//      public/data/ankiVocab.json), or null when it is not a deck word.
//      A headword listed at two deck levels takes the lower one — the
//      earliest level it is taught at.
//
// Unmatched character runs (particles fragments, auxiliaries,
// punctuation, and any compound no dictionary carries) become tokens
// with h = s and l = null; the fitting core's grammar rule decides
// which of those are free (see src/lib/readerFit.js).
//
// new_word_candidates: dictionary words appearing in the text whose
// level is at or above the passage's band (scene key-phrases are also
// considered, at the scene's level), each with reading + first gloss +
// resolved headword `h`, in text order, capped at 12.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { scenes } from '../src/data/scenes.js'
import { passages } from '../src/data.js'
import { parseDeckEntry, localEntries } from '../src/lib/dictionary.js'
import { segmentFurigana, buildFuriganaIndex, cleanReading } from '../src/lib/furigana.js'
import { bandRank } from '../src/lib/readerFit.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// --- dictionary: mirror dictionary.js merge/index (not exported there).
// Deck rows parsed by the app's own parser; local entries preferred on
// ties by keeping the longer meaning, exactly like dictionary.js.
// Exported for tests/reader.test.mjs (segmenter parity fixtures).
export function buildDictionary() {
  const rows = JSON.parse(readFileSync(join(root, 'public/data/ankiVocab.json'), 'utf8'))
  const deck = rows.map(parseDeckEntry)
  const byKey = new Map()
  for (const group of [deck, localEntries()]) {
    for (const entry of group) {
      if (!entry.word) continue
      const key = `${entry.word}|${entry.reading}`
      const existing = byKey.get(key)
      if (!existing || (entry.meaning || '').length > (existing.meaning || '').length) {
        byKey.set(key, existing ? { ...existing, meaning: entry.meaning || existing.meaning } : entry)
      }
    }
  }
  let entries = [...byKey.values()]
  const wordsWithReading = new Set(entries.filter((e) => e.reading).map((e) => e.word))
  entries = entries.filter((e) => e.reading || !wordsWithReading.has(e.word))
  const byWord = new Map()
  for (const entry of entries) {
    const existing = byWord.get(entry.word)
    if (!existing || (!existing.reading && entry.reading)) byWord.set(entry.word, entry)
  }
  const byLength = [...entries].sort((a, b) => b.word.length - a.word.length)
  return { entries, byWord, byLength }
}

const dict = buildDictionary()
const furiganaIndex = buildFuriganaIndex(dict)

/** Deck levels: headword -> level from the OpenJLPT deck ONLY (dup
 *  rows at two levels take the lower — earliest taught). */
export function buildDeckLevels() {
  const rows = JSON.parse(readFileSync(join(root, 'public/data/ankiVocab.json'), 'utf8'))
  const levels = new Map()
  for (const row of rows) {
    const { word, level } = parseDeckEntry(row)
    if (!word || !level) continue
    const existing = levels.get(word)
    if (!existing || bandRank(level) < bandRank(existing)) levels.set(word, level)
  }
  return levels
}

const deckLevels = buildDeckLevels()

const PUNCT = new Set(['。', '！', '？', '、', '「', '」', '『', '』', '（', '）', '・', '…', '—'])
const HAS_KANJI = /[㐀-䶿一-鿿]/

// A few scene key-phrases are real, minable vocabulary that the deck
// simply doesn't carry. Their glosses below are taken from the scenes'
// own text (promptEn / commonError), not invented: 転入届 "moving-in,
// filed at the new one" (city-address commonError), 在留カード
// "residence card" (bank-account promptEn), 食後 "after eating"
// (hospital-symptom promptEn), 引っ越し "moved" (city-address promptEn).
// Used ONLY when the dictionary has no entry, and only reachable via
// the forced key-phrase path.
export const OVERRIDES = {
  '転入届': { reading: 'てんにゅうとどけ', meaning: 'moving-in notice (filed at your new city office)' },
  '在留カード': { reading: 'ざいりゅうカード', meaning: 'residence card' },
  '食後': { reading: 'しょくご', meaning: 'after a meal / after eating' },
  '引っ越し': { reading: 'ひっこし', meaning: 'moving house' },
}

// --- stem machinery -------------------------------------------------
// Deterministic inflection stems for every dictionary headword, so an
// inflected surface in a text still resolves to its dictionary form.
const U2I = { 'う': 'い', 'く': 'き', 'ぐ': 'ぎ', 'す': 'し', 'つ': 'ち', 'ぬ': 'に', 'ぶ': 'び', 'む': 'み', 'る': 'り' }
const TE_STEM = { 'く': 'い', 'ぐ': 'い', 'す': 'し', 'う': 'っ', 'つ': 'っ', 'る': 'っ', 'ぬ': 'ん', 'ぶ': 'ん', 'む': 'ん' }
const E_ROW = new Set([...'えけげせぜてでねへべめれ'])
const I_ROW = new Set([...'いきぎしちにびみり'])

function stemsFor(w) {
  const stems = new Set()
  if (!w || w.length < 2) return stems
  const last = w[w.length - 1]
  const prev = w[w.length - 2]
  // Ichidan stem: 食べる→食べ, 出る→出 (kana before る is e/i-row, or a kanji).
  if (last === 'る' && (E_ROW.has(prev) || I_ROW.has(prev) || HAS_KANJI.test(prev))) stems.add(w.slice(0, -1))
  // Godan masu stem: 引っ越す→引っ越し, 書く→書き.
  if (U2I[last]) stems.add(w.slice(0, -1) + U2I[last])
  // Godan te/ta stem: 書く→書い, 作る→作っ, 読む→読ん.
  if (TE_STEM[last]) stems.add(w.slice(0, -1) + TE_STEM[last])
  // I-adjective stem: 高い→高, 寒い→寒 (kanji words only, to limit noise).
  if (last === 'い' && HAS_KANJI.test(w)) stems.add(w.slice(0, -1))
  return stems
}

// stem -> winning headword. Winner: deck words first, then the shorter
// headword, then lexicographic — so the choice never depends on the
// dictionary's row order.
const stemWinners = new Map()
{
  const claims = new Map()
  const headwords = new Set([...dict.byWord.keys(), ...Object.keys(OVERRIDES)])
  for (const w of headwords) {
    for (const stem of stemsFor(w)) {
      if (stem === w) continue
      if (!claims.has(stem)) claims.set(stem, [])
      claims.get(stem).push(w)
    }
  }
  for (const [stem, ws] of claims) {
    ws.sort((a, b) =>
      (deckLevels.has(a) ? 0 : 1) - (deckLevels.has(b) ? 0 : 1) ||
      a.length - b.length ||
      (a < b ? -1 : 1))
    stemWinners.set(stem, ws[0])
  }
}

/** Resolve any surface to its dictionary headword (for candidates and
 *  forced extras). Falls back to the surface itself when nothing in
 *  the dictionary claims it. */
function resolveHeadword(surface) {
  if (!surface) return surface
  if (dict.byWord.has(surface) || deckLevels.has(surface)) return surface
  if (stemWinners.has(surface)) return stemWinners.get(surface)
  // Godan dictionary form from a masu stem that no stem claimed
  // (e.g. the headword itself was filtered out of the dictionary).
  const last = surface[surface.length - 1]
  if (I_ROW.has(last)) {
    const uRow = Object.keys(U2I).find((k) => U2I[k] === last)
    const form = surface.slice(0, -1) + uRow
    if (dict.byWord.has(form) || deckLevels.has(form)) return form
  }
  // Prefix: the shortest dictionary word this surface begins
  // (引っ越 → 引っ越す when 引っ越し was already consumed differently).
  if (surface.length >= 2) {
    let best = null
    for (const w of dict.byWord.keys()) {
      if (w.length > surface.length && w.startsWith(surface) && (!best || w.length < best.length)) best = w
    }
    if (best) return best
  }
  return surface
}

// --- tokeniser --------------------------------------------------------
// One positional matcher over: deck words (prio 0), override words and
// grammar forms (prio 1), other dictionary words (prio 2, grammar
// patterns excluded), inflection stems (prio 3). Longest surface wins;
// priority breaks ties.
//
// GRAMMAR FORMS are fixed auxiliary/formulaic sequences (te-form
// auxiliaries, humble ございます family). They are function text, not
// vocabulary: a tokenizer that counts ております or ございます as
// unknown words is punishing grammar, which the fitting ratio must
// never do (Doc 16 §5 grammar rule). They emit function tokens
// (h = s, l = null) like particles do.
const GRAMMAR_FORMS = [
  'ございます', 'ございません',
  'ような', 'ように', 'ようです', 'ようだ',
  'ております', 'ており',
  'ている', 'ていない', 'ています', 'ていて', 'ていた', 'てない', 'てなかった',
  'てある', 'てあります', 'てあって', 'てあった',
  'ておく', 'ておきます', 'ておいて', 'ておいた',
  'てしまう', 'てしまいます', 'てしまって', 'てしまった',
  'ていく', 'ていきます', 'ていって', 'ていった',
  'てくる', 'てきます', 'てきて', 'てきた',
]
const matchIndex = new Map()
function addCandidate(surface, h, prio, fn = false) {
  if (!surface) return
  const c = surface[0]
  if (!matchIndex.has(c)) matchIndex.set(c, [])
  matchIndex.get(c).push({ surface, h, prio, fn })
}
for (const w of deckLevels.keys()) addCandidate(w, w, 0)
for (const w of Object.keys(OVERRIDES)) addCandidate(w, w, 1)
for (const f of GRAMMAR_FORMS) addCandidate(f, f, 1, true)
for (const entry of dict.entries) {
  if (!entry.word || entry.type === 'Grammar') continue
  if (/[～~]/.test(entry.word)) continue
  addCandidate(entry.word, entry.word, 2)
}
for (const [stem, w] of stemWinners) addCandidate(stem, w, 3)
for (const list of matchIndex.values()) {
  list.sort((a, b) => b.surface.length - a.surface.length || a.prio - b.prio)
}

function matchAt(text, i) {
  const list = matchIndex.get(text[i])
  if (!list) return null
  for (const cand of list) {
    if (text.startsWith(cand.surface, i)) return cand
  }
  return null
}

/** Segment into { s, h, l } tokens; surfaces join back to the text. */
function tokenise(text) {
  const tokens = []
  let run = ''
  const flush = () => {
    if (run) { tokens.push({ s: run, h: run, l: null }); run = '' }
  }
  let i = 0
  while (i < text.length) {
    if (text[i] === '\n') {
      flush()
      tokens.push({ s: '\n', h: '\n', l: null })
      i++
      continue
    }
    const match = matchAt(text, i)
    if (match) {
      flush()
      if (match.fn) {
        // Grammar form: function text. Emitted as function tokens
        // chunked to at most 3 characters (ございます → ござい + ます,
        // ております → ており + ます) so each piece satisfies the
        // fitting core's grammar rule (kana-only, ≤3 chars, not a deck
        // word) on its own — a 5-char form emitted whole would fail
        // the length cap and be counted as unknown vocabulary.
        for (let j = 0; j < match.surface.length; j += 3) {
          const chunk = match.surface.slice(j, j + 3)
          tokens.push({ s: chunk, h: chunk, l: null })
        }
        i += match.surface.length
        continue
      }
      let h = match.h
      // Ambiguous surfaces resolve to the MORE BASIC headword: when a
      // surface is both a dictionary word in its own right and the
      // inflection stem of another word, the resolution with the lower
      // deck level wins (a token blocks reading only if NEITHER word
      // is known). 引っ越し (local entry, no deck level) is 引っ越す
      // (N4); 遅れ is listed as an N1 noun but in 遅れて… it is the
      // stem of 遅れる (N4), and it resolves to 遅れる.
      const stemH = stemWinners.get(match.surface)
      if (stemH && stemH !== h) {
        const rankOf = (w) => {
          const l = deckLevels.get(w)
          return l ? bandRank(l) : Infinity
        }
        if (rankOf(stemH) < rankOf(h)) h = stemH
      }
      // A single kana character is always an inflection/particle
      // fragment in this tokenisation, never a standalone content
      // word — even when the deck lists the character on its own
      // (し in でしょうか is not the noun し). Emit it as a function
      // token (h = s, l = null) so the grammar rule can free it.
      if (match.surface.length === 1 && !HAS_KANJI.test(match.surface)) {
        tokens.push({ s: match.surface, h: match.surface, l: null })
      } else {
        tokens.push({ s: match.surface, h, l: deckLevels.get(h) ?? null })
      }
      i += match.surface.length
    } else if (PUNCT.has(text[i])) {
      // Punctuation is always its own token; it never merges into a
      // run (a run ending in 。 would grow past the grammar rule's
      // length cap and get counted as unknown vocabulary).
      flush()
      tokens.push({ s: text[i], h: text[i], l: null })
      i++
    } else {
      run += text[i]
      i++
    }
  }
  flush()
  return tokens
}

function firstGloss(meaning) {
  const g = String(meaning || '').split(/[,;]/)[0].trim()
  return g.length > 80 ? `${g.slice(0, 77)}...` : g
}

/** Dictionary words in the text at/above the band, + forced extras.
 *  Segmentation also matches particles and single kana (で, し…) — those
 *  are grammar, not minable vocabulary, so unforced candidates need at
 *  least two characters, and kana-only words at least three. Forced
 *  extras (scene key-phrases) are teacher-chosen and skip those filters.
 *  Every candidate carries its resolved headword `h`: matching and
 *  mining everywhere use headwords, never surfaces (Doc 16 §5). */
function candidatesFor(text, band, extraWords = []) {
  const out = []
  const seen = new Set()
  const consider = (word, fallbackLevel, force = false) => {
    if (!word || seen.has(word) || !text.includes(word)) return
    seen.add(word)
    if (!force) {
      if (word.length < 2) return
      if (!HAS_KANJI.test(word) && word.length < 3) return
    }
    const entry = dict.byWord.get(word) || (OVERRIDES[word] ? { ...OVERRIDES[word], level: fallbackLevel } : undefined)
    const level = entry?.level || fallbackLevel || ''
    if (!level || bandRank(level) < bandRank(band)) return
    const reading = cleanReading(entry?.reading || '')
    const meaning = firstGloss(entry?.meaning || '')
    if (!reading && !meaning) return
    out.push({ word, reading, meaning, h: resolveHeadword(word) })
  }
  for (const part of segmentFurigana(text, furiganaIndex)) {
    if (part.type === 'w') consider(part.text)
  }
  for (const w of extraWords) consider(w, band, true)
  return out.slice(0, 12)
}

export function buildRows() {
  const rows = []
  for (const scene of scenes) {
    const text = `${scene.partner}\n${scene.model}`
    rows.push({
      id: `scene-${scene.id}`,
      band: scene.level,
      topic: scene.domain,
      text,
      source: 'scene',
      extra: scene.keyPhrases || [],
    })
  }
  passages.forEach((p, i) => {
    rows.push({
      id: `bank-reading-${i + 1}`,
      band: p.level || 'N2',
      topic: p.title,
      text: p.text,
      source: 'bank',
      extra: (p.glossary || []).map((g) => g.word),
    })
  })
  return rows.map((r) => {
    const tokens = tokenise(r.text)
    if (tokens.map((t) => t.s).join('') !== r.text) {
      throw new Error(`token join mismatch for ${r.id}`)
    }
    return { ...r, tokens, candidates: candidatesFor(r.text, r.band, r.extra) }
  })
}

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`
const sqlJson = (v) => `${sqlStr(JSON.stringify(v))}::jsonb`

function main() {
  const rows = buildRows()
  const byBand = {}
  for (const r of rows) byBand[r.band] = (byBand[r.band] || 0) + 1

  const lines = [
    '-- reading_passages seed — GENERATED by scripts/build-reader-bank.mjs.',
    '-- Do not edit by hand; re-run the script. Idempotent: re-running the',
    '-- seed never duplicates or overwrites a row.',
    `-- Coverage: ${rows.length} passages (${Object.entries(byBand).map(([b, n]) => `${b}×${n}`).join(', ')}).`,
    '-- Sources: scene dialogues (src/data/scenes.js) + the mock-exam',
    '-- reading bank (src/data.js). No invented texts.',
    '-- tokens: [{ s, h, l }] — surface, dictionary headword, deck level',
    '-- (Doc 16 §5 amendment, 2026-11-06). Surfaces join back to the text.',
    '',
  ]
  for (const r of rows) {
    lines.push(
      'INSERT INTO public.reading_passages (id, band, topic, text, tokens, new_word_candidates, source) VALUES (' +
        [sqlStr(r.id), sqlStr(r.band), sqlStr(r.topic), sqlStr(r.text), sqlJson(r.tokens), sqlJson(r.candidates), sqlStr(r.source)].join(', ') +
        ') ON CONFLICT (id) DO NOTHING;'
    )
  }
  lines.push('')

  const outPath = join(root, 'supabase/seed/reading_passages.sql')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, lines.join('\n'))
  console.log(`reader bank: ${rows.length} passages`, byBand)
  console.log(`wrote ${outPath}`)

  // The edge function's deck-level map (below-band credit, Doc 16 §5).
  // Plain-object export in JS syntax so node tests can load it too.
  const deckObj = {}
  for (const word of [...deckLevels.keys()].sort()) deckObj[word] = deckLevels.get(word)
  const deckPath = join(root, 'supabase/functions/reader-bot/deck.ts')
  writeFileSync(deckPath, [
    '// GENERATED by scripts/build-reader-bank.mjs — do not edit by hand.',
    '// Deck levels (OpenJLPT deck, public/data/ankiVocab.json): headword',
    '// -> JLPT level. A headword listed at two levels takes the lower',
    '// one. Consumed by reader-bot/index.ts via fit.ts deckCreditSet()',
    '// for below-band deck credit (Doc 16 §5 amendment, 2026-11-06).',
    `export const DECK_LEVELS = ${JSON.stringify(deckObj)}`,
    '',
  ].join('\n'))
  console.log(`deck levels: ${deckLevels.size} headwords`)
  console.log(`wrote ${deckPath}`)

  // The edge function's gloss map (R0.5): deck headword -> { reading,
  // meaning } from the merged dictionary, so a generated passage's new
  // words carry the same reading + first gloss a bank passage's
  // candidates carry. Deck words with no dictionary entry are absent —
  // the bot then bolds the word without a reading (never invents one).
  const glossObj = {}
  for (const word of [...deckLevels.keys()].sort()) {
    const entry = dict.byWord.get(word) || (OVERRIDES[word] ? { ...OVERRIDES[word] } : undefined)
    if (!entry) continue
    const reading = cleanReading(entry.reading || '')
    const meaning = firstGloss(entry.meaning || '')
    if (!reading && !meaning) continue
    glossObj[word] = { reading, meaning }
  }
  const glossPath = join(root, 'supabase/functions/reader-bot/gloss.ts')
  writeFileSync(glossPath, [
    '// GENERATED by scripts/build-reader-bank.mjs — do not edit by hand.',
    '// Deck headword -> { reading, meaning } (merged app dictionary,',
    '// first gloss). Consumed by reader-bot/index.ts to build the',
    '// new_word_candidates of a Foundry-generated passage (Doc 16 R0.5).',
    `export const DECK_GLOSS = ${JSON.stringify(glossObj)}`,
    '',
  ].join('\n'))
  console.log(`deck gloss: ${Object.keys(glossObj).length} headwords`)
  console.log(`wrote ${glossPath}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
