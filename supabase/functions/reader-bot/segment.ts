// Yonde Reader segmenter — SERVER TWIN (Doc 16 §5, R0.5).
//
// A near-verbatim port of src/lib/readerSegment.js, fed by deck.ts.
// The two must agree exactly on the data they share: a draft the
// segmenter tokenises here is fitted by fit.ts, whose client twin is
// pinned against readerFit.js — a segmentation drift would silently
// move the gate. tests/reader.test.mjs imports BOTH segmenters and
// runs them over shared fixtures.
//
// TWIN WARNING: change src/lib/readerSegment.js and this file
// together. (Third sibling: scripts/build-reader-bank.mjs carries the
// original seed-time tokeniser; the test suite pins this matcher
// against the seeded rows it produced.)
//
// Deliberately written in plain-JS syntax (no TS-only constructs) so
// the node test can load this file unmodified — the same trick as
// fit.ts / call-scheduler/slot.ts.
//
// DATA DIFFERENCE from the bank builder, stated plainly: the builder
// matches the deck PLUS the app's full local dictionary; this server
// segmenter matches the deck (deck.ts) only. A non-deck dictionary
// word in a generated draft therefore stays an unmatched run and
// counts as unknown content — the conservative direction (it can make
// the gate stricter, never laxer), and exactly the set the deck
// credit and ratios are defined over.

import { DECK_LEVELS } from './deck.ts'

export const GRAMMAR_FORMS = [
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

const PUNCT = new Set(['。', '！', '？', '、', '「', '」', '『', '』', '（', '）', '・', '…', '—'])
const HAS_KANJI = /[㐀-䶿一-鿿]/

const U2I = { 'う': 'い', 'く': 'き', 'ぐ': 'ぎ', 'す': 'し', 'つ': 'ち', 'ぬ': 'に', 'ぶ': 'び', 'む': 'み', 'る': 'り' }
const TE_STEM = { 'く': 'い', 'ぐ': 'い', 'す': 'し', 'う': 'っ', 'つ': 'っ', 'る': 'っ', 'ぬ': 'ん', 'ぶ': 'ん', 'む': 'ん' }
const E_ROW = new Set([...'えけげせぜてでねへべめれ'])
const I_ROW = new Set([...'いきぎしちにびみり'])

function stemsFor(w) {
  const stems = new Set()
  if (!w || w.length < 2) return stems
  const last = w[w.length - 1]
  const prev = w[w.length - 2]
  if (last === 'る' && (E_ROW.has(prev) || I_ROW.has(prev) || HAS_KANJI.test(prev))) stems.add(w.slice(0, -1))
  if (U2I[last]) stems.add(w.slice(0, -1) + U2I[last])
  if (TE_STEM[last]) stems.add(w.slice(0, -1) + TE_STEM[last])
  if (last === 'い' && HAS_KANJI.test(w)) stems.add(w.slice(0, -1))
  return stems
}

const bandRankLocal = (level) => ['N5', 'N4', 'N3', 'N2', 'N1'].indexOf(level) + 1 // 0 when absent

function buildMatcher() {
  const deck = new Map(Object.entries(DECK_LEVELS || {}))

  const stemWinners = new Map()
  {
    const claims = new Map()
    for (const w of deck.keys()) {
      for (const stem of stemsFor(w)) {
        if (stem === w) continue
        if (!claims.has(stem)) claims.set(stem, [])
        claims.get(stem).push(w)
      }
    }
    for (const [stem, ws] of claims) {
      ws.sort((a, b) =>
        (deck.has(a) ? 0 : 1) - (deck.has(b) ? 0 : 1) ||
        a.length - b.length ||
        (a < b ? -1 : 1))
      stemWinners.set(stem, ws[0])
    }
  }

  const matchIndex = new Map()
  function addCandidate(surface, h, prio, fn = false) {
    if (!surface) return
    const c = surface[0]
    if (!matchIndex.has(c)) matchIndex.set(c, [])
    matchIndex.get(c).push({ surface, h, prio, fn })
  }
  for (const w of deck.keys()) addCandidate(w, w, 0)
  for (const f of GRAMMAR_FORMS) addCandidate(f, f, 1, true)
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

  return { deck, stemWinners, matchAt }
}

const MATCHER = buildMatcher()

/** Segment into { s, h, l } tokens; surfaces join back to the text. */
export function segmentText(text) {
  const { deck, stemWinners, matchAt } = MATCHER
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
        for (let j = 0; j < match.surface.length; j += 3) {
          const chunk = match.surface.slice(j, j + 3)
          tokens.push({ s: chunk, h: chunk, l: null })
        }
        i += match.surface.length
        continue
      }
      let h = match.h
      const stemH = stemWinners.get(match.surface)
      if (stemH && stemH !== h) {
        const rankOf = (w) => {
          const l = deck.get(w)
          return l ? bandRankLocal(l) : Infinity
        }
        if (rankOf(stemH) < rankOf(h)) h = stemH
      }
      if (match.surface.length === 1 && !HAS_KANJI.test(match.surface)) {
        tokens.push({ s: match.surface, h: match.surface, l: null })
      } else {
        tokens.push({ s: match.surface, h, l: deck.get(h) ?? null })
      }
      i += match.surface.length
    } else if (PUNCT.has(text[i])) {
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
