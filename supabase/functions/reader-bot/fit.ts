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
 * a basis-backed claim (diagnosis, or the learner's declared band —
 * resolveBand), never a default.
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
 * Band resolution (Doc 16 §5 amendment #3): which band /read fits to,
 * and on what basis. A declared band is a STARTING BELIEF the learner
 * states in one tap inside Telegram — it exists so the Reader never
 * gates fitting on the in-app checkup — and a real diagnosis in
 * learner_state overrides it whenever one exists:
 *   diagnosis > declared > none.
 * Returns { band, source } with source 'diagnosis' | 'declared' |
 * 'none'; band is null exactly when source is 'none'. Anything that
 * is not a real band string is ignored, never guessed at.
 */
export function resolveBand({ diagnosisBand, declaredBand } = {}) {
  if (BANDS.includes(diagnosisBand)) return { band: diagnosisBand, source: 'diagnosis' }
  if (BANDS.includes(declaredBand)) return { band: declaredBand, source: 'declared' }
  return { band: null, source: 'none' }
}

/**
 * Should /read open with the one-tap level ask instead of serving?
 * Only for a LINKED chat (a link row whose chat_id is bound) whose
 * band basis is 'none' and which carries no declared band. The ask
 * is the /read response in that state, never a standalone nag: once
 * a band is declared — or a diagnosis exists — this stays false
 * forever. (An unlinked chat gets the link explainer, not a quiz.)
 */
export function shouldAskLevel(link, bandSource) {
  if (!link || link.chat_id == null) return false
  if (bandSource !== 'none') return false
  if (link.declared_band) return false
  return true
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
  const unknowns = unknownContentHeadwords(tokens, knownSet)
  return { ratio, unknowns, accept: ratio >= RATIO_MIN && ratio <= RATIO_MAX && unknowns.length <= UNKNOWN_CAP }
}

/**
 * The unknown CONTENT headwords of a token list, deduped, in text
 * order — the one definition of "new vocabulary in this text" shared
 * by draft evaluation (above) and the cold-start starter pick
 * (below). A token counts when it is not known, is not freed by the
 * grammar rule (tokenIsKnown covers that), and is not bare
 * punctuation or a newline (segmentation debris, not vocabulary).
 */
export function unknownContentHeadwords(tokens, knownSet) {
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
  return unknowns
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

// ---------- cold start: the starter track (Doc 16 §5 amendment #2) ----------
//
// Fitting needs a basis: a diagnosis (which certifies the vocabulary
// below a band) or a queue that reflects what the learner knows. A
// brand-new learner has NEITHER — Landry's live test (2026-11-06)
// linked cleanly, sent /read, and got the "no synced words" reply
// because his synced state carried an empty queue and no diagnosis.
// An empty known set fits nothing, and generation cannot validate
// against nothing either, so the fitted paths are a dead end until a
// basis exists. The starter track is the on-ramp, NOT a widening of
// the gate: it sends a low-band bank passage LABELLED as a starter,
// whose few new words — once mined — become the first real known set,
// and the checkup (diagnosis) remains the switch that turns fitting
// itself on. The gate, the calibration, and the generation paths do
// not change at all.

/** A learner with fewer known content words than this — and no
 *  diagnosis — has no fitting basis yet. 40 is roughly a first week
 *  of mined/session words: enough census for the ratio to mean
 *  something, few enough that a true beginner is never left at the
 *  dead end while "almost" qualifying. */
export const COLD_START_KNOWN_LIMIT = 40

/**
 * How many of the known set's headwords are CONTENT words. The
 * content/grammar distinction is the fitting grammar rule's own
 * profile (see src/lib/readerFit.js): a headword is content when it
 * carries kanji, or runs longer than the ≤3-char fragment cap the
 * grammar rule frees. Short kana deck words （これ, なに) therefore
 * undercount — the conservative direction: a learner judged colder
 * than they are gets a labelled starter, never a passage above
 * their level.
 */
export function countKnownContent(knownSet) {
  let n = 0
  for (const word of knownSet || []) {
    if (typeof word !== 'string' || !word) continue
    if (KANJI_RE.test(word) || [...word].length > 3) n++
  }
  return n
}

/**
 * Cold start = no diagnosis AND a known-content census below the
 * limit. Diagnosis ends cold start at any census: the diagnosis
 * itself (plus below-band credit) IS a fitting basis.
 */
export function isColdStart(hasDiagnosis, knownContentCount) {
  return !hasDiagnosis && (knownContentCount ?? 0) < COLD_START_KNOWN_LIMIT
}

/** Starters come only from the bottom of the bank: bands a true
 *  beginner can plausibly read with support. */
export const STARTER_BANDS = ['N5', 'N4', 'N3']

/**
 * Pick a starter passage for a cold-start learner. NO ratio gate —
 * with an (almost) empty known set nothing could pass it, which is
 * the dead end this track exists to end. Instead: candidates are
 * the starter bands only, ordered by band (easiest shelf first),
 * then by fewest unknown content headwords for THIS learner (even
 * a near-empty set usually knows something — greetings, loanwords
 * the queue picked up), then fewest total tokens, then id, so the
 * pick is deterministic.
 *   returns { passage, unknowns } (unknowns: the passage's unknown
 *   content headwords, deduped, text order) or null when the bank
 *   holds nothing in the starter bands.
 * The 14-day exclusion is respected — but if it empties the starter
 * pool, the pick falls back to the full pool: a repeated starter
 * beats a dead end, and a cold learner re-reading an easy passage
 * while their census grows is a feature, not a failure.
 */
export function pickStarter(passages, knownSet, recentIds = []) {
  const maxRank = bandRank(STARTER_BANDS[STARTER_BANDS.length - 1])
  const score = (pool) => {
    const out = []
    for (const p of pool || []) {
      if (!p) continue
      const rank = bandRank(p.band)
      if (rank === -1 || rank > maxRank) continue
      out.push({
        passage: p,
        rank,
        unknowns: unknownContentHeadwords(p.tokens, knownSet),
        size: Array.isArray(p.tokens) ? p.tokens.length : 0,
      })
    }
    return out
  }
  const recent = new Set(recentIds || [])
  let pool = score((passages || []).filter((p) => p && !recent.has(p.id)))
  if (pool.length === 0) pool = score(passages)
  if (pool.length === 0) return null
  pool.sort((a, b) =>
    a.rank - b.rank ||
    a.unknowns.length - b.unknowns.length ||
    a.size - b.size ||
    (a.passage.id < b.passage.id ? -1 : a.passage.id > b.passage.id ? 1 : 0))
  const best = pool[0]
  return { passage: best.passage, unknowns: best.unknowns }
}

/**
 * Cap a passage's new-word candidates for a starter send: order by
 * deck level ascending (N5 first … N1; a candidate whose level is
 * absent or not a band sorts LAST — unknown difficulty is treated
 * as hardest), original text order breaking ties, and keep the
 * first `max`. The candidate's level is read from its `level`
 * field, which the send path resolves from the deck / the passage's
 * own tokens (stored bank candidates carry no level of their own).
 * A starter's Mine must never flood a brand-new queue: the cap is
 * what the learner sees bolded AND what Mine can add.
 */
export function capCandidates(candidates, max = 12) {
  if (!Array.isArray(candidates)) return []
  const key = (c) => {
    const r = c ? bandRank(c.level) : -1
    return r === -1 ? Number.MAX_SAFE_INTEGER : r
  }
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (key(a.c) - key(b.c)) || (a.i - b.i))
    .slice(0, Math.max(0, max))
    .map((d) => d.c)
}
