// Yonde Heard Words — the ambient matcher (Doc 22).
//
// "Ears that can't remember": this module is the whole privacy
// architecture in code. It receives a transcript (which the caller
// discards immediately after this call) and returns ONLY counts of
// dictionary items — words from the deck / JMdict glossaries the bot
// already carries, and the curated business expressions below.
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

let cachedDict: { byFirst: Map<string, string[]>; maxLen: number } | null = null

/**
 * The match dictionary: every surface the matcher may ever return.
 * Built once per process from the three glossaries the bot already
 * ships (deck headwords, deck gloss, JMdict compounds). Entries are
 * bucketed by first character, longest first, so the scan is a
 * longest-match walk over the character stream.
 */
export function buildHeardDict() {
  if (cachedDict) return cachedDict
  const surfaces = new Set<string>()
  for (const src of [DECK_LEVELS, DECK_GLOSS, JMDICT_COMPOUNDS]) {
    for (const key of Object.keys(src as Record<string, unknown>)) {
      const s = normalizeSpeechText(key)
      if (s) surfaces.add(s)
    }
  }
  const byFirst = new Map<string, string[]>()
  let maxLen = 0
  for (const s of surfaces) {
    const chars = [...s]
    if (chars.length > maxLen) maxLen = chars.length
    const first = chars[0]
    const list = byFirst.get(first)
    if (list) list.push(s)
    else byFirst.set(first, [s])
  }
  for (const list of byFirst.values()) {
    list.sort((a, b) => [...b].length - [...a].length)
  }
  cachedDict = { byFirst, maxLen }
  return cachedDict
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

  // Word pass — longest-match walk.
  let matched = 0
  for (let i = 0; i < stream.length; i++) {
    const ch = stream[i]
    if (ch === '\u0000') { matched += 1; continue }
    const candidates = dict.byFirst.get(ch)
    if (!candidates) continue
    let consumed = 0
    for (const cand of candidates) {
      const chars = [...cand]
      if (chars.length === 1 && !HAN.test(ch)) continue
      if (i + chars.length > stream.length) continue
      let hit = true
      for (let j = 0; j < chars.length; j++) {
        if (stream[i + j] !== chars[j]) { hit = false; break }
      }
      if (hit) { consumed = chars.length; bump(cand, 'word'); break }
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
