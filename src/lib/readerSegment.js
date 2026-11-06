// Yonde Reader segmenter — the positional matcher core (Doc 16 §5).
//
// Turns raw Japanese text into the { s, h, l } tokens the fitting core
// (src/lib/readerFit.js) consumes: surface, dictionary headword, deck
// level. R0.5 needs this at READ time, not just at seed time: a Foundry
// draft must be segmented in code before its ratio can be computed —
// the gate never trusts the generator's own word list.
//
// SIBLINGS (three copies of one matcher — keep them in step):
//   1. scripts/build-reader-bank.mjs — the original; segments the bank
//      at seed time with the full app dictionary.
//   2. THIS module — the matcher core with data INJECTED as parameters,
//      so node tests can pin its behaviour (tests/reader.test.mjs).
//   3. supabase/functions/reader-bot/segment.ts — the server twin,
//      fed by deck.ts. Written in plain-JS syntax like fit.ts so the
//      test suite can load it unmodified.
// Parity between (2)/(3) and the bank builder's output is pinned by
// tests/reader.test.mjs over the seeded rows themselves.
//
// Data injected (createSegmenter options):
//   deckLevels: Map/object headword -> level (the deck; prio 0)
//   extraWords: additional dictionary words (prio 2) — the bank
//     builder passes its merged dictionary entries (Grammar entries
//     and ～-forms excluded, exactly as there); the server passes
//     nothing, so non-deck dictionary words in a draft stay unmatched
//     runs there and count as unknown — the conservative direction.
//   headwords:  the set inflection stems are built from (dictionary
//     headwords ∪ override words); defaults to deck ∪ extraWords.
//   overrides:  extra words matched at prio 1 (scene key-phrases the
//     deck doesn't carry); defaults to none.
//   grammarForms: function sequences emitted as grammar tokens;
//     defaults to GRAMMAR_FORMS below (the bank builder's list — if
//     the lists ever drift, the parity test fails, by design).

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

// Deterministic inflection stems for a headword (godan masu/te stems,
// ichidan stems, i-adjective stems) — ported from the bank builder.
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

export function createSegmenter({ deckLevels, extraWords = [], headwords = null, overrides = [], grammarForms = GRAMMAR_FORMS } = {}) {
  const deck = deckLevels instanceof Map ? deckLevels : new Map(Object.entries(deckLevels || {}))
  const overrideWords = [...overrides]
  const stemSource = headwords ? [...headwords] : [...new Set([...deck.keys(), ...extraWords, ...overrideWords])]

  // stem -> winning headword (deck words first, then shorter, then
  // lexicographic — order-independent, as in the bank builder).
  const stemWinners = new Map()
  {
    const claims = new Map()
    for (const w of stemSource) {
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

  // One positional matcher: deck words (prio 0), overrides + grammar
  // forms (prio 1), other dictionary words (prio 2), stems (prio 3).
  // Longest surface wins; priority breaks ties.
  const matchIndex = new Map()
  function addCandidate(surface, h, prio, fn = false) {
    if (!surface) return
    const c = surface[0]
    if (!matchIndex.has(c)) matchIndex.set(c, [])
    matchIndex.get(c).push({ surface, h, prio, fn })
  }
  for (const w of deck.keys()) addCandidate(w, w, 0)
  for (const w of overrideWords) addCandidate(w, w, 1)
  for (const f of grammarForms) addCandidate(f, f, 1, true)
  for (const w of extraWords) addCandidate(w, w, 2)
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
  function segment(text) {
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
          // Grammar form: function text, chunked to at most 3
          // characters so each piece satisfies the fitting core's
          // grammar rule on its own (bank builder, same reasoning).
          for (let j = 0; j < match.surface.length; j += 3) {
            const chunk = match.surface.slice(j, j + 3)
            tokens.push({ s: chunk, h: chunk, l: null })
          }
          i += match.surface.length
          continue
        }
        let h = match.h
        // Ambiguous surfaces resolve to the MORE BASIC headword (the
        // resolution with the lower deck level wins) — bank builder.
        const stemH = stemWinners.get(match.surface)
        if (stemH && stemH !== h) {
          const rankOf = (w) => {
            const l = deck.get(w)
            return l ? bandRankLocal(l) : Infinity
          }
          if (rankOf(stemH) < rankOf(h)) h = stemH
        }
        // A single kana character is always an inflection/particle
        // fragment here, never a standalone content word.
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

  return { segment, stemWinners }
}
