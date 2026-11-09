// Yonde Heard Words — the ambient matcher (Doc 22).
//
// "Ears that can't remember": this module is the whole privacy
// architecture in code. It receives a transcript (which the caller
// discards immediately after this call) and returns ONLY counts of
// dictionary items — the curated business expressions below, the
// deck / JMdict glossaries the bot ships, and the WIDE wordbook:
// every written form of every entry of the full JMdict, shipped
// as data (public/data/wordbook.json, built by
// scripts/build-bot-wordsdb.mjs) and fetched once per process.
// The names dictionary (JMnedict) is deliberately NOT a source.
// Text that matches nothing is unrepresentable in the output: there
// is no field that could hold a name, a company, a figure, or a
// sentence. That is deliberate — storage bounded by the dictionary
// is what makes the feature safe to run in a shared workspace.
//
// Deliberately written in plain-JS syntax (no TS-only constructs)
// so the node test can load this file unmodified — the same trick
// as fit.ts / segment.ts / score.ts. Behaviour is pinned by
// tests/ambient.test.mjs, including an adversarial fixture: a
// meeting transcript full of names and figures must yield nothing
// but dictionary counts.

import { DECK_LEVELS } from './deck.ts'
import { DECK_GLOSS } from './gloss.ts'
import { JMDICT_COMPOUNDS } from './jmdict-gloss.ts'
import { normalizeSpeechText } from './score.ts'

/**
 * Business expressions, matched as units BEFORE word tokenization
 * (Doc 22 §Expressions). Each carries a register note — the BJT
 * listening discrimination is register, so an expression is learned
 * with its politeness weight attached. This is the seed list; the
 * ≈60-expression v1 (Doc 22 build step A4) grows it from published
 * exam patterns only — never from captured audio, by design.
 */
export const EXPRESSIONS = [
  { surface: 'お世話になっております', note: 'standard business greeting to an outside party' },
  { surface: 'よろしくお願いいたします', note: 'formal closing request (humble)' },
  { surface: '申し訳ございません', note: 'formal apology, stronger than すみません' },
  { surface: 'お手数をおかけしますが', note: 'softener before imposing a task' },
  { surface: 'ご査収ください', note: 'please check the attached (documents)' },
  { surface: 'ご確認ください', note: 'please confirm / review' },
  { surface: 'ご連絡いたします', note: 'I will be in touch (humble)' },
  { surface: 'ご検討ください', note: 'please consider it' },
  { surface: '恐れ入りますが', note: 'softener: I am sorry to ask, but…' },
  { surface: '承知いたしました', note: 'understood (humble)' },
  { surface: 'かしこまりました', note: 'understood (service register)' },
  { surface: 'お待たせしました', note: 'sorry to have kept you waiting' },
  { surface: 'お疲れ様です', note: 'acknowledging a colleague’s work' },
  { surface: '失礼いたします', note: 'excuse me (entering / leaving / hanging up)' },
  { surface: '取り急ぎ', note: 'just quickly, for now (email opener)' },
  { surface: 'ご認識のとおり', note: 'as you are aware (formal)' },
]

/** A word surfaces on Heard Today only at this many hearings in a day (Doc 22 law 4). */
export const HEARD_FLOOR = 2

const HAN = /\p{Script=Han}/u

/**
 * The match dictionary: every surface the matcher may ever return,
 * mapped to the dictionary item a hearing counts under.
 *
 * Sources, first-wins:
 *   1. the curated glossaries the bot ships (deck headwords, deck
 *      gloss, JMdict compounds) — a surface they know counts as
 *      itself, with their curated reading;
 *   2. the wide wordbook (optional): every headword of the full
 *      JMdict counts as itself, and every other written form
 *      (kanji variants, kana forms) counts under its headword —
 *      so a word heard as のうき lands on 納期, with its reading.
 *
 * Buckets are grouped by first character, then by length, so the
 * scan tries a handful of Set lookups per position instead of
 * walking a candidate list — that is what keeps a 465k-surface
 * dictionary cheap to scan.
 */
export function buildHeardDict(wordbook?: { heads?: string[]; readings?: string[]; forms?: Record<string, number> } | null) {
  const itemOf = new Map<string, string>()
  const readingsOf = new Map<string, string>()
  const add = (surface: string, item: string) => {
    const s = normalizeSpeechText(surface)
    if (!s || itemOf.has(s)) return
    // Defence in depth for Doc 22 law 3: a pure digit/letter
    // string is data, not vocabulary — it can never become a
    // surface or an item, whatever the data source carries.
    if (/^[0-9a-zA-Z]+$/.test(s)) return
    const it = normalizeSpeechText(item) || s
    if (/^[0-9a-zA-Z]+$/.test(it)) return
    itemOf.set(s, it)
  }
  for (const key of Object.keys(DECK_LEVELS)) add(key, key)
  for (const key of Object.keys(DECK_GLOSS)) add(key, key)
  for (const key of Object.keys(JMDICT_COMPOUNDS)) add(key, key)

  const heads = Array.isArray(wordbook?.heads) ? wordbook.heads : []
  const wbReadings = Array.isArray(wordbook?.readings) ? wordbook.readings : []
  const wbForms = wordbook?.forms && typeof wordbook.forms === 'object' ? wordbook.forms : {}
  for (let i = 0; i < heads.length; i++) {
    add(heads[i], heads[i])
    const item = normalizeSpeechText(heads[i])
    const reading = wbReadings[i] ? normalizeSpeechText(wbReadings[i]) : ''
    if (item && reading && reading !== item && !readingsOf.has(item)) readingsOf.set(item, reading)
  }
  for (const [surface, idx] of Object.entries(wbForms)) {
    const head = heads[Number(idx)]
    if (head) add(surface, head)
  }
  // Curated readings win over the wordbook's for the same item.
  for (const [key, gloss] of Object.entries(DECK_GLOSS)) {
    const item = normalizeSpeechText(key)
    const reading = (gloss as { reading?: string })?.reading
    if (item && reading && reading !== item) readingsOf.set(item, normalizeSpeechText(reading))
  }
  for (const [key, pair] of Object.entries(JMDICT_COMPOUNDS)) {
    const item = normalizeSpeechText(key)
    const reading = Array.isArray(pair) ? pair[0] : undefined
    if (item && reading && reading !== item && !readingsOf.has(item)) {
      readingsOf.set(item, normalizeSpeechText(reading))
    }
  }

  const byFirst = new Map<string, Map<number, Set<string>>>()
  let maxLen = 0
  for (const s of itemOf.keys()) {
    const chars = [...s]
    if (!chars.length) continue
    if (chars.length > maxLen) maxLen = chars.length
    let byLen = byFirst.get(chars[0])
    if (!byLen) { byLen = new Map(); byFirst.set(chars[0], byLen) }
    let set = byLen.get(chars.length)
    if (!set) { set = new Set(); byLen.set(chars.length, set) }
    set.add(s)
  }
  return {
    byFirst,
    itemOf,
    readingsOf,
    maxLen,
    surfaces: new Set(itemOf.keys()),
    items: new Set(itemOf.values()),
  }
}

/** The wordbook ships as data with the app (sharded + manifest); the bot fetches it once per process. */
export const WORDBOOK_URL = 'https://jpn2easy.vercel.app/data/wordbook/manifest.json'

let dictCache: { at: number; dict: ReturnType<typeof buildHeardDict>; wide: boolean } | null = null

/**
 * The production dictionary: the wide wordbook when it can be
 * fetched, the curated glossaries alone when it cannot (a fetch
 * failure narrows recognition for a few minutes — it never
 * breaks a session). Cached per process; a narrow result is
 * retried after five minutes.
 */
export async function loadHeardDict(fetchFn: typeof fetch = fetch) {
  const now = Date.now()
  if (dictCache && (dictCache.wide || now - dictCache.at < 5 * 60 * 1000)) return dictCache.dict
  let wordbook: { heads: string[]; readings: string[]; forms: Record<string, number> } | null = null
  let wide = false
  try {
    const base = WORDBOOK_URL.slice(0, WORDBOOK_URL.lastIndexOf('/') + 1)
    const manifestRes = await fetchFn(WORDBOOK_URL)
    const manifest = manifestRes.ok ? await manifestRes.json() as { shards?: string[] } : null
    const shardNames = Array.isArray(manifest?.shards) ? manifest.shards : []
    if (shardNames.length > 0) {
      const merged = { heads: [] as string[], readings: [] as string[], forms: {} as Record<string, number> }
      let ok = true
      for (const name of shardNames) {
        const res = await fetchFn(base + name)
        if (!res.ok) { ok = false; break }
        const shard = await res.json() as { heads?: string[]; readings?: string[]; forms?: Record<string, number> }
        if (!Array.isArray(shard?.heads)) { ok = false; break }
        merged.heads.push(...shard.heads)
        merged.readings.push(...(shard.readings ?? []))
        Object.assign(merged.forms, shard.forms ?? {})
      }
      if (ok && merged.heads.length > 0) { wordbook = merged; wide = true }
    }
  } catch { wordbook = null }
  const dict = buildHeardDict(wordbook)
  dictCache = { at: now, dict, wide }
  return dict
}

/** An item's reading for display (word（reading）), or null when none is known. */
export function heardReading(dict: ReturnType<typeof buildHeardDict>, item: string) {
  return dict.readingsOf.get(normalizeSpeechText(item)) ?? null
}

/**
 * Heard Words → Foundry seeding (Doc 22, the loop between
 * Hori's two jobs): choose which of the learner's heard words
 * the next generated passage should be written around.
 * Words only (expressions are register units, not passage
 * vocabulary), never a word the learner already knows (it
 * needs no introduction), most-heard first, capped at the
 * draft's unknown-word budget. The chosen words ride the
 * passage's NEW-word dose — hearing becomes reading.
 */
export function selectHeardTargets(
  rows: { item: string; kind: string; count: number }[],
  known: Set<string>,
  cap = 8,
) {
  return rows
    .filter((r) => r.kind === 'word' && r.item && !known.has(r.item))
    .sort((a, b) => b.count - a.count || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0))
    .slice(0, Math.max(0, cap))
    .map((r) => r.item)
}

/**
 * Match a transcript against the dictionary.
 *   returns { counts, matched, total }
 * counts is a Map keyed by the dictionary surface itself, with
 * { count, kind: 'word' | 'expr' }. matched/total are character
 * counts (how much of the stream the dictionary covered) — the
 * caller logs ratios, never text.
 *
 * Expressions are consumed first and their spans are masked, so an
 * expression's inner words are not double-counted as loose words.
 * One-character entries match only when the character is a kanji —
 * single kana (あ, は…) are noise, never vocabulary.
 */
export function matchHeardWords(text: string, dict = buildHeardDict()) {
  const stream = [...normalizeSpeechText(text ?? '')]
  const counts = new Map<string, { count: number; kind: string }>()
  const bump = (item: string, kind: string) => {
    const cur = counts.get(item)
    if (cur) cur.count += 1
    else counts.set(item, { count: 1, kind })
  }

  // Expression pass — longest surfaces first, spans masked out.
  const exprs = [...EXPRESSIONS]
    .map((e) => ({ ...e, norm: normalizeSpeechText(e.surface) }))
    .filter((e) => e.norm)
    .sort((a, b) => [...b.norm].length - [...a.norm].length)
  for (const e of exprs) {
    const needle = [...e.norm]
    for (let i = 0; i + needle.length <= stream.length; i++) {
      let hit = true
      for (let j = 0; j < needle.length; j++) {
        if (stream[i + j] !== needle[j]) { hit = false; break }
      }
      if (hit) {
        bump(e.surface, 'expr')
        for (let j = 0; j < needle.length; j++) stream[i + j] = '\u0000'
        i += needle.length - 1
      }
    }
  }

  // Word pass — longest-match walk over the length-grouped
  // buckets; a hit counts under its dictionary item (a kana form
  // counts under its kanji headword).
  let matched = 0
  for (let i = 0; i < stream.length; i++) {
    const ch = stream[i]
    if (ch === '\u0000') { matched += 1; continue }
    const byLen = dict.byFirst.get(ch)
    if (!byLen) continue
    let consumed = 0
    const maxTry = Math.min(dict.maxLen, stream.length - i)
    for (let len = maxTry; len >= 1; len--) {
      if (len === 1 && !HAN.test(ch)) break
      const set = byLen.get(len)
      if (!set) continue
      const cand = stream.slice(i, i + len).join('')
      if (set.has(cand)) {
        consumed = len
        bump(dict.itemOf.get(cand) ?? cand, 'word')
        break
      }
    }
    if (consumed > 0) { matched += consumed; i += consumed - 1 }
  }

  return { counts, matched, total: stream.length }
}

/**
 * The Heard Today summary (Doc 22 law 4): items at/above the floor
 * are "sticking" and may be listed; items below it contribute ONLY
 * their count of distinct words — never their identity — to the
 * "heard once so far" line. Sorting: count desc, then expressions
 * before words, then surface, so the card is stable between edits.
 */
export function summariseHeard(
  rows: { item: string; kind: string; count: number }[],
  floor = HEARD_FLOOR,
) {
  const sticking = rows
    .filter((r) => r.count >= floor)
    .sort((a, b) =>
      b.count - a.count ||
      (a.kind === b.kind ? 0 : a.kind === 'expr' ? -1 : 1) ||
      (a.item < b.item ? -1 : a.item > b.item ? 1 : 0))
  const below = rows.filter((r) => r.count < floor)
  return {
    sticking,
    onceWords: below.length,
    totalHearings: rows.reduce((n, r) => n + r.count, 0),
    distinct: rows.length,
  }
}
