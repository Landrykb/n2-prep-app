// Central Japanese dictionary layer.
//
// The bundled deck (/data/ankiVocab.json, OpenJLPT CC BY-SA 4.0) stores each entry as:
//   front: "お帰り"
//   back:  "お帰り (おかえり) — return, welcome"
// so the reading and the meaning have to be parsed out of `back`. Splitting on
// ' — ' alone (the old approach) returned "お帰り (おかえり)" as the reading.
//
// This module parses the deck once, merges it with the hand-written lessons, and
// exposes indexed lookups so every feature (Speed Cards, selection popup, kanji
// modal, search) can share the same ~8.3k entry dataset instead of the ~200
// items that were previously available outside the Anki tab.

import { kanjiLessons, vocabLessons, grammarLessons, passages, commonWords } from '../data.js'
import { bjtVocab } from '../data/bjt.js'

const DECK_URL = '/data/ankiVocab.json'

// Split "<head> — <meaning>" on the em dash that separates term from gloss.
const DASH = ' — '

// Trailing "(...)" on the head, e.g. "暖かい (あたたか(い))" or "とん (（1000)".
// Greedy so it captures nested parentheses correctly.
const HEAD_RE = /^(.*?)\s*[（(](.*)[）)]\s*$/s

// Kana, plus the separators the deck uses for alternative readings ("なん/なに",
// "じゅう とお"). Anything else (digits, latin, mojibake) is not a reading.
const KANA_ONLY = /^[\u3040-\u309f\u30a0-\u30ff゛゜ーぁ-ん・/、，,\s]+$/
const isReading = (s) => !!s && KANA_ONLY.test(s) && /[\u3040-\u30ff]/.test(s)

// "あたたか(い)" is dictionary shorthand for "あたたかい".
const normaliseReading = (s) => s.replace(/[（()）]/g, '').trim()

export const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1']

const hasKanji = (s) => /[\u4e00-\u9faf\u3400-\u4dbf]/.test(s || '')

/**
 * Parse one raw deck row into a normalised entry.
 *
 * Rows look like "お帰り (おかえり) — return, welcome", but the source data also
 * contains nested parentheses, alternative readings, notes such as
 * "あげる (=やる)", and a few mojibake readings, so everything is validated
 * rather than trusted.
 */
export function parseDeckEntry(row) {
  const back = row.back || ''
  const dashAt = back.indexOf(DASH)
  const head = (dashAt === -1 ? back : back.slice(0, dashAt)).trim()
  const meaning = (dashAt === -1 ? '' : back.slice(dashAt + DASH.length)).trim()

  // Prefer the word from `front`, but drop any parenthetical note on it.
  let word = (row.front || '').trim()
  const wordNote = word.match(HEAD_RE)
  if (wordNote && !isReading(normaliseReading(wordNote[2]))) word = wordNote[1].trim() || word

  let reading = ''
  const parts = head.match(HEAD_RE)
  if (parts) {
    const candidate = normaliseReading(parts[2])
    if (isReading(candidate)) reading = candidate
    if (!word) word = parts[1].trim()
  }
  // Kana-only words are their own reading.
  if (!reading && word && !hasKanji(word)) reading = word

  return {
    word,
    reading,
    meaning: meaning || back,
    level: row.level || '',
    type: row.tag || 'Vocab',
    image: row.image,
  }
}

/** Entries from the hand-written lesson content (always available, no fetch). */
export function localEntries() {
  return [
    ...kanjiLessons.map((k) => ({
      word: k.char,
      reading: [k.on, k.kun].filter(Boolean).join(' · '),
      meaning: k.meaning,
      level: 'N2',
      type: 'Kanji',
      image: k.emoji,
    })),
    ...vocabLessons.map((v) => ({ word: v.word, reading: v.reading, meaning: v.meaning, level: 'N2', type: 'Vocab', image: v.image })),
    ...grammarLessons.map((g) => ({ word: g.pattern, reading: g.form, meaning: g.meaning, level: 'N2', type: 'Grammar', image: g.image })),
    ...passages.flatMap((p) => p.glossary.map((g) => ({ word: g.word, reading: g.reading, meaning: g.meaning, level: 'N2', type: 'Reading', image: g.image }))),
    ...commonWords.map((c) => ({ word: c.word, reading: c.reading, meaning: c.meaning, level: 'N3', type: 'Common', image: '📘' })),
    ...bjtVocab.map((b) => ({ word: b.word, reading: b.reading, meaning: b.meaning, level: b.level, type: 'BJT', image: '💼' })),
  ].filter((e) => e.word)
}

/**
 * Merge entry groups, preferring hand-written content.
 *
 * The deck has ~245 duplicate rows (the same word listed at two JLPT levels),
 * which would otherwise produce repeated quiz prompts and duplicate answer
 * options. Duplicates are collapsed on word+reading, and a word that also has a
 * reading-less variant (from a mojibake row) keeps only the usable one.
 */
function merge(...groups) {
  const byKey = new Map()
  for (const group of groups) {
    for (const entry of group) {
      if (!entry.word) continue
      const key = `${entry.word}|${entry.reading}`
      const existing = byKey.get(key)
      // Keep whichever variant carries more information.
      if (!existing || (entry.meaning || '').length > (existing.meaning || '').length) {
        byKey.set(key, existing ? { ...existing, meaning: entry.meaning || existing.meaning } : entry)
      }
    }
  }

  const entries = [...byKey.values()]
  // Drop reading-less duplicates when a readable variant of the word exists.
  const wordsWithReading = new Set(entries.filter((e) => e.reading).map((e) => e.word))
  return entries.filter((e) => e.reading || !wordsWithReading.has(e.word))
}

function index(entries) {
  const byWord = new Map()
  for (const entry of entries) {
    const existing = byWord.get(entry.word)
    // Prefer an entry that actually has a reading for tap/selection lookups.
    if (!existing || (!existing.reading && entry.reading)) byWord.set(entry.word, entry)
  }
  // Longest-first so greedy matching in running text prefers the longest word.
  const byLength = [...entries].sort((a, b) => b.word.length - a.word.length)
  return { entries, byWord, byLength }
}

/** Dictionary with only the built-in lesson content — no network needed. */
export const localDictionary = index(merge(localEntries()))

let deckPromise = null

/**
 * Load and index the full deck merged with local content.
 * Cached, so concurrent callers share one fetch.
 */
export function loadDictionary() {
  if (!deckPromise) {
    deckPromise = fetch(DECK_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Deck request failed (${r.status})`)
        return r.json()
      })
      .then((rows) => index(merge(localEntries(), rows.map(parseDeckEntry))))
      .catch(() => localDictionary)
  }
  return deckPromise
}

/** Exact then longest-prefix lookup for a selected/tapped string. */
export function lookup(dict, text) {
  if (!text) return null
  const clean = text.trim()
  if (!clean) return null
  return (
    dict.byWord.get(clean) ||
    dict.byLength.find((e) => e.word.length > 1 && clean.startsWith(e.word)) ||
    dict.byLength.find((e) => e.word.length > 1 && clean.includes(e.word)) ||
    null
  )
}

/** Ranked search for the dictionary/search UI. */
export function search(dict, query, { levels, limit = 50 } = {}) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const allowed = levels?.length ? new Set(levels) : null
  const results = []
  for (const e of dict.entries) {
    if (allowed && !allowed.has(e.level)) continue
    const word = e.word.toLowerCase()
    const reading = (e.reading || '').toLowerCase()
    const meaning = (e.meaning || '').toLowerCase()
    let rank = -1
    if (word === q || reading === q) rank = 0
    else if (word.startsWith(q) || reading.startsWith(q)) rank = 1
    else if (word.includes(q) || reading.includes(q)) rank = 2
    else if (meaning.startsWith(q)) rank = 3
    else if (meaning.includes(q)) rank = 4
    if (rank >= 0) results.push({ entry: e, rank })
    if (results.length > limit * 8) break
  }
  results.sort((a, b) => a.rank - b.rank || a.entry.word.length - b.entry.word.length)
  return results.slice(0, limit).map((r) => r.entry)
}

/** Entries usable as quiz material for the given levels. */
export function quizPool(dict, { levels, types } = {}) {
  const allowedLevels = levels?.length ? new Set(levels) : null
  const allowedTypes = types?.length ? new Set(types) : null
  return dict.entries.filter(
    (e) =>
      e.meaning &&
      e.word &&
      (!allowedLevels || allowedLevels.has(e.level)) &&
      (!allowedTypes || allowedTypes.has(e.type))
  )
}
