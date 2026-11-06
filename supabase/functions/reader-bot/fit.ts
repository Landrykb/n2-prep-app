// Yonde Reader fitting core — SERVER PORT (Doc 16 §5).
//
// This is a near-verbatim port of src/lib/readerFit.js. The client-side
// module and this port must agree exactly: a passage the app calls
// fitted is the passage the bot sends. If they ever disagree, learners
// get out-of-band texts — the exact failure the Reader exists to avoid.
//
// TWIN WARNING: change both files together. Parity + behaviour are
// pinned by tests/reader.test.mjs, which imports both implementations
// and runs them over shared fixtures.
//
// Deliberately written in plain-JS syntax (no TS-only constructs) so
// the node test can load this file unmodified — the same trick as
// call-scheduler/slot.ts.
//
// Token contract + known-set definition (headword matching, below-band
// deck credit, grammar-token rule): see src/lib/readerFit.js.

export const BANDS = ['N5', 'N4', 'N3', 'N2', 'N1']
export const RATIO_MIN = 0.93
export const RATIO_MAX = 0.97
export const RATIO_TARGET = 0.95

const KANJI_RE = /[㐀-䶿一-鿿]/

export function bandRank(band) {
  const i = BANDS.indexOf(band)
  return i === -1 ? -1 : i + 1
}

/**
 * Below-band deck credit: the set of deck headwords whose level is
 * strictly below `band`. `deckLevels` maps headword -> level (a Map or
 * a plain object). An unknown/absent band earns NO credit — credit is
 * a diagnosis-backed claim, never a default.
 */
export function deckCreditSet(deckLevels, band) {
  const rank = bandRank(band)
  const credit = new Set()
  if (rank === -1 || !deckLevels) return credit
  const entries = deckLevels instanceof Map ? deckLevels.entries() : Object.entries(deckLevels)
  for (const [word, level] of entries) {
    const r = bandRank(level)
    if (r !== -1 && r < rank && word) credit.add(word)
  }
  return credit
}

/**
 * Known set: queue item fronts + personal-vocab headwords + an
 * optional credit set (from deckCreditSet). All entries are headwords.
 */
export function buildKnownSet(queueItems, personalVocab = [], credit = null) {
  const known = new Set()
  for (const item of queueItems || []) {
    const front = typeof item?.front === 'string' ? item.front.trim() : ''
    if (front) known.add(front)
  }
  for (const word of personalVocab || []) {
    const w = typeof word === 'string' ? word.trim() : ''
    if (w) known.add(w)
  }
  for (const word of credit || []) {
    const w = typeof word === 'string' ? word.trim() : ''
    if (w) known.add(w)
  }
  return known
}

export function tokenIsKnown(token, knownSet) {
  if (!token) return true
  // Legacy string tokens (pre-calibration bank rows) are read as
  // { s: token, h: token, l: null } so a mixed bank can never crash
  // the gate; reseeded rows are always objects.
  const t = typeof token === 'string' ? { s: token, h: token, l: null } : token
  if (knownSet && t.h && knownSet.has(t.h)) return true
  // Grammar/function rule — see src/lib/readerFit.js.
  return t.l == null && t.h === t.s && !KANJI_RE.test(t.s || '') && [...String(t.s || '')].length <= 3
}

/** Share of tokens the learner knows. An empty passage scores 0 — it
 *  can never pass the gate, because there is nothing to read. */
export function passageRatio(tokens, knownSet) {
  if (!Array.isArray(tokens) || tokens.length === 0) return 0
  let known = 0
  for (const token of tokens) if (tokenIsKnown(token, knownSet)) known++
  return known / tokens.length
}

/**
 * Pick the best-fitting passage for a learner.
 *   passages: [{ id, band, tokens }] (any extra fields pass through)
 *   band:     the learner's band (diagnosis estimate)
 *   recentIds: passage ids already sent recently (excluded)
 * Rules: band window ±1 level; ratio inside [RATIO_MIN, RATIO_MAX];
 * closest to RATIO_TARGET wins; ties break on fewer tokens, then id,
 * so the pick is deterministic. Returns { passage, ratio } or null.
 */
/** Max unknown CONTENT headwords a generated draft may carry (R0.5).
 *  A draft inside the ratio gate but stuffed with distinct new words
 *  is a vocabulary list wearing a passage's clothes — the cap keeps
 *  it a passage (Doc 16 §2: ~5–12 new words per passage). */
export const UNKNOWN_CAP = 12

/**
 * Evaluate a generated draft against the SAME gate as a bank passage
 * (R0.5 validate-and-retry, Doc 16 §7). Pure: tokens in, verdict out.
 *   returns { ratio, unknowns, accept }
 *   unknowns: the unknown CONTENT headwords, deduped, in text order —
 *   a token is content when it is not known and not grammar/function
 *   (tokenIsKnown already frees grammar), and it is not bare
 *   punctuation or a newline (segmentation debris, not vocabulary).
 *   accept: ratio inside [RATIO_MIN, RATIO_MAX] AND unknowns ≤ cap.
 */
export function evaluateDraft(tokens, knownSet) {
  const ratio = passageRatio(tokens, knownSet)
  const unknowns = []
  const seen = new Set()
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const t = typeof token === 'string' ? { s: token, h: token, l: null } : token
    if (!t || !t.s) continue
    if (tokenIsKnown(t, knownSet)) continue
    if (/^[\s。！？、・…—「」『』（）]+$/.test(t.s)) continue
    const head = t.h || t.s
    if (seen.has(head)) continue
    seen.add(head)
    unknowns.push(head)
  }
  return { ratio, unknowns, accept: ratio >= RATIO_MIN && ratio <= RATIO_MAX && unknowns.length <= UNKNOWN_CAP }
}

/**
 * The retry feedback list: every unknown headword seen so far, deduped,
 * first-seen order preserved, capped so the generator prompt stays
 * sane. The next draft must avoid ALL of these — not just the latest
 * batch — or the loop can oscillate between two bad drafts forever.
 */
export function nextForbiddenList(prev, unknowns, cap = 40) {
  const out = []
  const seen = new Set()
  for (const w of [...(prev || []), ...(unknowns || [])]) {
    if (typeof w !== 'string' || !w || seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= cap) break
  }
  return out
}

/**
 * Generation is the fallback, never the first resort (R0.5): it runs
 * only when the bank pick failed AND the per-user cooldown allows it.
 */
export function shouldGenerate(bankPick, cooldownOk) {
  return !bankPick && !!cooldownOk
}

export function pickPassage(passages, knownSet, band, recentIds = []) {
  const rank = bandRank(band)
  if (rank === -1) return null
  const recent = new Set(recentIds || [])
  let best = null
  for (const passage of passages || []) {
    if (!passage || recent.has(passage.id)) continue
    const pRank = bandRank(passage.band)
    if (pRank === -1 || Math.abs(pRank - rank) > 1) continue
    const ratio = passageRatio(passage.tokens, knownSet)
    if (ratio < RATIO_MIN || ratio > RATIO_MAX) continue
    const dist = Math.abs(ratio - RATIO_TARGET)
    if (
      !best ||
      dist < best.dist ||
      (dist === best.dist &&
        (passage.tokens.length < best.passage.tokens.length ||
          (passage.tokens.length === best.passage.tokens.length && passage.id < best.passage.id)))
    ) {
      best = { passage, ratio, dist }
    }
  }
  return best ? { passage: best.passage, ratio: best.ratio } : null
}
