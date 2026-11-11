// Yonde Reader fitting core (Doc 16 §5 — the deterministic spine).
//
// A passage is only ever sent to a learner when the share of its tokens
// they already know sits inside the comprehensible-input band
// (RATIO_MIN–RATIO_MAX, target RATIO_TARGET). That decision is CODE,
// never AI: this module computes it, and the reader-bot edge function
// carries a near-verbatim port (supabase/functions/reader-bot/fit.ts).
//
// TWIN WARNING: src/lib/readerFit.js and
// supabase/functions/reader-bot/fit.ts are twins and must change
// together — the same discipline as calls.js / slot.ts. The parity is
// pinned by tests/reader.test.mjs, which runs both over shared fixtures.
//
// Token contract (calibrated 2026-11-06, Doc 16 §5 amendment): a
// passage's `tokens` are objects { s, h, l } —
//   s: surface string; the surfaces join back into the exact text.
//   h: dictionary headword the surface belongs to (引っ越 → 引っ越す).
//      Matching is ALWAYS by headword, never by surface, so an
//      inflected token is known when its dictionary form is known.
//   l: the headword's deck level ('N5'..'N1'), or null when the
//      headword is not a deck word.
//
// Known set (calibrated): queue fronts (already dictionary-form words,
// used as-is) + Twin personal vocab + BELOW-BAND DECK CREDIT — every
// deck headword whose level is strictly below the learner's band. The
// credit is the standard graded-reader assumption: a band certifies
// the vocabulary below it. It exists only with a band basis — a
// diagnosis, or (amendment #3) the learner's own one-tap declared
// band; the basis is resolved by resolveBand below, labelled in every
// footer, and a diagnosis overrides a declaration whenever one exists.
// No basis, no credit (queue-only, conservative).
//
// A token counts as KNOWN when either:
//   - its headword is in the learner's known set, or
//   - it is a GRAMMAR/FUNCTION token: h === s, l === null (not a deck
//     word), no kanji, and at most 3 characters — particles, auxiliaries
//     and punctuation fragments. Content words (anything with kanji, or
//     any deck word) must earn known status; they are never free.

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
 *   diagnosis > latest declaration > none.
 * A declaration lives in TWO stores that share one shape:
 * telegram_links.declared_band (with declared_at) and
 * learner_state.state.declaredLevel = { band, at } (the app writes
 * the same shape). The later timestamp wins; the Telegram row is
 * the incumbent on a tie. The raw joke band 'N7' (below N5, the
 * learners' own joke) is stored AS-IS in both stores and normalized
 * HERE, the one choke point: it resolves to N5 with joke: true so
 * copy can laugh WITH the learner — downstream code only ever sees
 * real bands. A diagnosis overrides band AND the joke (pace too).
 * Returns { band, source } with source 'diagnosis' | 'declared' |
 * 'none'; band is null exactly when source is 'none'; joke is
 * present (true) only when the winning declaration is raw 'N7'.
 * Anything that is not a real band string (or 'N7') is ignored,
 * never guessed at.
 */
export function resolveBand({ diagnosisBand, declaredBand, declaredAt, stateDeclaredBand, stateDeclaredAt } = {}) {
  if (BANDS.includes(diagnosisBand)) return { band: diagnosisBand, source: 'diagnosis' }
  // The two declaration stores, freshest first. Timestamps compare
  // as instants; a missing/unparseable one counts as the epoch, and
  // the Telegram row is the incumbent — the app-side declaration
  // must be STRICTLY fresher to take over.
  const at = (v) => {
    const t = Date.parse(v ?? '')
    return Number.isFinite(t) ? t : 0
  }
  const usable = (raw) => BANDS.includes(raw) || raw === 'N7'
  let winner = usable(declaredBand) ? declaredBand : null
  if (usable(stateDeclaredBand) && at(stateDeclaredAt) > at(declaredAt)) {
    winner = stateDeclaredBand
  } else if (!winner && usable(stateDeclaredBand)) {
    winner = stateDeclaredBand
  }
  if (winner === 'N7') return { band: 'N5', source: 'declared', joke: true }
  if (winner) return { band: winner, source: 'declared' }
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
  // Grammar/function rule — see the header comment.
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
/**
 * Gentlest-first pick over the SAME window + gate as pickPassage —
 * foundations pace (the N7+ declaration) serves fitted passages in
 * starter order (band ascending, then fewest unknowns) until the
 * first ratchet completes, so the earliest reads are the kindest
 * ones that honestly fit. The gate never moves: this only reorders
 * CANDIDATES THAT PASS. Returns null under exactly the conditions
 * pickPassage does. Same { passage, ratio } shape.
 */
export function pickGentle(passages, knownSet, band, recentIds = [], fitOpts = {}) {
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
    // Fit v2 keys (amendment #10): batch recycle first, then the
    // new-kanji dose band — both constant (0) when the caller passes
    // no fitOpts, which preserves the pre-v2 order exactly.
    const { recycle, dose } = fitRankKeys(passage.tokens, fitOpts)
    // Starter order: easiest band first, then fewest new words,
    // then shortest, then id — the pick stays deterministic.
    const unknowns = unknownContentHeadwords(passage.tokens, knownSet).length
    if (
      !best ||
      recycle < best.recycle ||
      (recycle === best.recycle &&
        (dose < best.dose ||
          (dose === best.dose &&
            (pRank < best.pRank ||
              (pRank === best.pRank &&
                (unknowns < best.unknowns ||
                  (unknowns === best.unknowns &&
                    (passage.tokens.length < best.passage.tokens.length ||
                      (passage.tokens.length === best.passage.tokens.length && passage.id < best.passage.id)))))))))
    ) {
      best = { passage, ratio, pRank, unknowns, recycle, dose }
    }
  }
  return best ? { passage: best.passage, ratio: best.ratio } : null
}

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

export function pickPassage(passages, knownSet, band, recentIds = [], fitOpts = {}) {
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
    // Fit v2 keys (amendment #10): batch recycle first, then the
    // new-kanji dose band — both constant (0) when the caller passes
    // no fitOpts, which preserves the pre-v2 order exactly.
    const { recycle, dose } = fitRankKeys(passage.tokens, fitOpts)
    const dist = Math.abs(ratio - RATIO_TARGET)
    if (
      !best ||
      recycle < best.recycle ||
      (recycle === best.recycle &&
        (dose < best.dose ||
          (dose === best.dose &&
            (dist < best.dist ||
              (dist === best.dist &&
                (passage.tokens.length < best.passage.tokens.length ||
                  (passage.tokens.length === best.passage.tokens.length && passage.id < best.passage.id)))))))
    ) {
      best = { passage, ratio, dist, recycle, dose }
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
 * profile (see the header): a headword is content when it carries
 * kanji, or runs longer than the ≤3-char fragment cap the grammar
 * rule frees. Short kana deck words （これ, なに) therefore
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

// ---------- adaptive fit: the step state (Doc 16 §5 amendment #4) ----------
//
// Landry, live-designing after the declared level shipped: a static
// level is wrong even as a starting belief — the fit must ADAPT
// ITSELF. The mechanism is deterministic spine logic (this section,
// never AI; the 0.93–0.97 gate does not move):
//
//   state (on telegram_links, migration 00012):
//     fit_step       — where /read aims relative to the basis band,
//                      in [-1, 1]. The pick/generation band is
//                      serveBandFor(basis, fit_step). Below-band deck
//                      credit follows the BASIS band, not the serve
//                      band: credit certifies what the learner
//                      knows; the step only chooses where in the
//                      window to aim.
//     last_good_step — the PREVIOUS KNOWN level: the highest step
//                      proven comfortable. Too Hard returns fit_step
//                      to exactly this — back to proven ground,
//                      never a crash below it.
//     comfy_streak   — consecutive comfortable reads at the current
//                      step.
//
//   feedback (one tap per passage counts; the bot dedupes):
//     'read' (Read It ✓): streak + 1. At COMFY_STREAK_TARGET the
//            step is PROVEN — last_good_step ratchets to it — and,
//            unless already at full stretch, fit_step trials up one
//            ('trial_up'): progression hardens from time to time,
//            earned by comfort, never by calendar. The streak
//            resets either way once it hits the target.
//     'up'   (Push Me 🔥): the fun button — fit_step + 1 right now,
//            clamped at +1 ('max' when already there), streak reset.
//     'hard' (Too Hard): fit_step = last_good_step ('step_back');
//            streak reset. The handler pairs this with the
//            overshoot protocol: apologize, explain what was sent,
//            step back — the copy carries it, this only moves state.
//
// 'read' is SELF-REPORT, honestly labelled (Doc 16 §5 amendment #4):
// chat cannot know the learner actually read. The rich proof is the
// voice-note read-aloud, which converges with R2 shadowing and stays
// gated — v1 never pretends a tap is a measurement.

export const FIT_STEP_MIN = -1
export const FIT_STEP_MAX = 1
/** Comfortable reads at one step that prove it (and earn a stretch). */
export const COMFY_STREAK_TARGET = 3
/**
 * Foundations pace (the N7+ declaration): double the proof before
 * the ratchet dares a trial step up. Everything else about the
 * state machine is identical — Push Me still trials +1 on demand,
 * Too Hard still steps back to last_good_step.
 */
export const FOUNDATIONS_COMFY_TARGET = 6

const clampStep = (n) => {
  const v = Math.trunc(Number(n) || 0)
  return Math.max(FIT_STEP_MIN, Math.min(FIT_STEP_MAX, v))
}

/**
 * The band /read actually aims at: the basis band shifted by the
 * fit step, clamped to the N5..N1 ladder. No basis → null (the
 * caller falls back to its display default; a step never invents
 * a basis).
 */
export function serveBandFor(basisBand, fitStep) {
  if (!BANDS.includes(basisBand)) return null
  const idx = BANDS.indexOf(basisBand) + clampStep(fitStep)
  return BANDS[Math.max(0, Math.min(BANDS.length - 1, idx))]
}

/**
 * One feedback tap applied to the step state. Pure: state in,
 * { ...newState, effect } out, where effect is one of:
 *   'logged'    — a comfortable read, streak growing
 *   'trial_up'  — target-th comfortable read: step proven AND stepped up
 *   'proven'    — target-th comfortable read at full stretch: ratcheted
 *   'pushed'    — Push Me stepped the fit up
 *   'max'       — Push Me at full stretch already: nothing moved
 *   'step_back' — Too Hard: back to the previous known level
 *   'ignored'   — an unknown kind: state returned untouched
 * A 'hard' tap at fit_step == last_good_step (e.g. both 0) leaves
 * the step where it is — the overshoot explanation still sends;
 * the step-back is a floor, not a penalty.
 */
export function applyFeedback(state, kind, comfyTarget = COMFY_STREAK_TARGET) {
  const target = Math.max(1, Math.trunc(Number(comfyTarget)) || COMFY_STREAK_TARGET)
  let fit_step = clampStep(state?.fit_step)
  let last_good_step = clampStep(state?.last_good_step)
  let comfy_streak = Math.max(0, Math.trunc(Number(state?.comfy_streak) || 0))
  let effect = 'ignored'
  if (kind === 'read') {
    comfy_streak += 1
    if (comfy_streak >= target) {
      last_good_step = fit_step // proven — the ratchet
      comfy_streak = 0
      if (fit_step < FIT_STEP_MAX) {
        fit_step += 1
        effect = 'trial_up'
      } else {
        effect = 'proven'
      }
    } else {
      effect = 'logged'
    }
  } else if (kind === 'up') {
    comfy_streak = 0
    if (fit_step < FIT_STEP_MAX) {
      fit_step += 1
      effect = 'pushed'
    } else {
      effect = 'max'
    }
  } else if (kind === 'hard') {
    fit_step = last_good_step // the previous known level — never below
    comfy_streak = 0
    effect = 'step_back'
  }
  return { fit_step, last_good_step, comfy_streak, effect }
}

/** The feedback kinds the passage-send row carries, in row order. */
export const FEEDBACK_KINDS = ['read', 'up', 'hard']

/**
 * Feedback callback payload: `fit:<kind>:<passageId>`. The passage
 * id rides along so the handler can dedupe (one tap per passage
 * counts) and so Too Hard can explain THAT passage. Passage ids are
 * uuids or slugs (≤36 chars here), so the whole payload stays
 * ≤46 bytes — far under Telegram's 64-byte callback limit, which
 * rejects oversize silently.
 */
export function fitCallback(kind, passageId) {
  return `fit:${kind}:${passageId}`
}

/** Inverse of fitCallback; anything malformed parses to null. */
export function parseFitCallback(data) {
  if (typeof data !== 'string' || !data.startsWith('fit:')) return null
  const rest = data.slice('fit:'.length)
  const sep = rest.indexOf(':')
  if (sep === -1) return null
  const kind = rest.slice(0, sep)
  const passageId = rest.slice(sep + 1)
  if (!FEEDBACK_KINDS.includes(kind) || !passageId) return null
  return { kind, passageId }
}

/**
 * Dedupe decision, pure: has this passage already had its one
 * feedback tap? `payloads` are the reading_feedback payloads on
 * file for the learner ({ kind, passageId, fitStepAfter }).
 */
export function hasFeedbackFor(payloads, passageId) {
  return (payloads || []).some((p) => p && p.passageId === passageId)
}

/**
 * The one-tap level question's keyboard (Doc 16 §5 amendment #7):
 * every band, the learners' own joke "N7+ 😂" (below N5 — stored
 * RAW as 'N7' and normalized at resolveBand, the one choke point),
 * and Not sure (the starter track). Shared by both twins so the bot
 * and its tests can never drift apart. Every callback stays far
 * under Telegram's 64-byte limit ('level:N7' is 8 bytes).
 */
export function levelKeyboard(notSureLabel = 'Not sure') {
  return {
    inline_keyboard: [
      BANDS.map((b) => ({ text: b, callback_data: `level:${b}` })),
      [
        { text: 'N7+ 😂', callback_data: 'level:N7' },
        { text: notSureLabel, callback_data: 'level:none' },
      ],
    ],
  }
}

// ---------- voice proof + morning dispatch (Doc 16, 2026-11-06 late) ----------
//
// Two more deterministic predicates join the spine; neither is AI.
//
// VOICE-IN (R2 pulled forward, v1): a learner proves a read by
// reading the passage ALOUD as a Telegram voice note. v1 does NOT
// transcribe (no STT key yet — the bot says so plainly); the only
// measurement is DURATION, which Telegram puts in the update
// payload. A passage read aloud at natural pace takes roughly
// chars / CHARS_PER_SECOND seconds; a note inside the plausible
// window counts as the comfy 'read' for that passage (through
// applyFeedback, deduped by hasFeedbackFor exactly like the tap).
// The window is wide on purpose — reading speeds vary, and a false
// "too fast" accuses an honest learner; duration is a receipt, not
// a measurement of quality, and the copy never claims otherwise.
//   0.35× catches a genuine skim-or-partial read being passed off;
//   2.75× still admits a slow, careful, twice-through read.
//
// MORNING DISPATCH (R1 pulled forward): the bot's ONE sanctioned
// proactive message (Doc 16 §9) — a fitted passage at the learner's
// own morning_time, in their own tz. isDispatchDue is the whole
// decision, pure over plain numbers so pg_cron timing, timezone
// maths and the dedupe rule stay testable off the wire.

/** Expected seconds for a passage read aloud ≈ chars / this. */
export const VOICE_READ_CHARS_PER_SEC = 6.5
export const VOICE_READ_MIN_FACTOR = 0.35
export const VOICE_READ_MAX_FACTOR = 2.75

/**
 * The voice-read window for a passage of `chars` characters.
 * Returns { expectedSec, minSec, maxSec, plausible(durationSec) }.
 * A non-positive char count or a non-positive/non-finite duration
 * is never plausible — a receipt with no numbers on it proves
 * nothing.
 */
export function voiceReadWindow(chars, durationSec) {
  const n = Number(chars)
  const expectedSec = Number.isFinite(n) && n > 0 ? n / VOICE_READ_CHARS_PER_SEC : 0
  const minSec = expectedSec * VOICE_READ_MIN_FACTOR
  const maxSec = expectedSec * VOICE_READ_MAX_FACTOR
  const d = Number(durationSec)
  const plausible = expectedSec > 0 && Number.isFinite(d) && d > 0 && d >= minSec && d <= maxSec
  return { expectedSec, minSec, maxSec, plausible }
}

/** The morning send window: [morning_time, morning_time + 90min).
 *  Widened 30 → 90 on 2026-11-10 after the silent-mornings
 *  diagnosis: the cron ticks every 30 minutes, so a 30-minute
 *  window gave each morning exactly ONE tick — and when that
 *  serve ran past pg_net's timeout or the free models failed,
 *  the morning was silently lost. Ninety minutes gives the
 *  07:30 / 08:00 / 08:30 ticks three chances; the
 *  sentMorningToday dedupe still guarantees one passage. */
export const DISPATCH_WINDOW_MIN = 90

/**
 * Is this linked learner due their morning passage?
 *   morningMinutes — their morning_time as minutes since midnight
 *   nowMinutes     — the current time IN THEIR tz, minutes since
 *                    midnight (the caller computes it from `tz`;
 *                    fractional minutes are fine)
 *   sentMorningToday — a passage_sent event with payload.kind =
 *                    'morning' already exists for their tz date
 *                    (the caller looks it up; one morning passage
 *                    per day, ever — Doc 16 §9)
 * Both clocks wrap at midnight by construction of the caller; the
 * window itself never wraps (07:30 + 30min stays inside the day).
 */
export function isDispatchDue({ morningMinutes, nowMinutes, sentMorningToday } = {}) {
  const m = Number(morningMinutes)
  const n = Number(nowMinutes)
  if (!Number.isFinite(m) || !Number.isFinite(n)) return false
  if (sentMorningToday) return false
  return n >= m && n < m + DISPATCH_WINDOW_MIN
}

// ---------- kanji readings breakdown (Doc 16 §5 amendment #9) ----------
//
// The passage arrives CLEAN — the learner reads unaided first. But a
// word can sit in the "known" set by below-band deck credit while
// its KANJI was never actually learned: the credit certifies the
// word, not the glyphs, and the learner ends up staring at a kanji
// they cannot read inside a passage that supposedly fits them. So
// the breakdown covers EVERY kanji-bearing word in the passage, not
// just the new-word candidates — collapsed inside the message (the
// formatter wraps it in an expandable blockquote), one tap away,
// never in the way of the clean read. Readings ONLY: meanings live
// in the Mine / new-word sections; this block answers exactly one
// question — "how do I read this?".

/** Cap on the breakdown: passages are short, so this only ever
 *  bites on a degenerate bank row; the first entries by appearance
 *  win — the ones the learner meets first while reading. */
export const KANJI_READINGS_CAP = 40

/**
 * The readings breakdown for a passage's tokens: [{ word, reading }]
 * in order of first appearance, deduped by the word shown. A token
 * qualifies when its SURFACE carries at least one kanji character
 * and a resolution yields a reading that differs from the word
 * shown (a "reading" identical to the word itself is no aid).
 * Resolution law (2026-11-11, Landry's accuracy flag on the
 * shopping-street card — the list offered 通り as とおる "to go
 * through" where the text means the street, and chopped stems
 * like 並ん・買っ as if they were words):
 *   1. a surface that is itself a dictionary word resolves as
 *      THAT word （通り → とおり, the street);
 *   2. anything else resolves by headword and is DISPLAYED in
 *      its dictionary form （並ん → 並ぶ, 買っ → 買う).
 * String tokens (legacy bank rows) read as { s: token,
 * h: token } — the same normalisation as tokenIsKnown. readingOf is
 * INJECTED: the bot passes the DECK_GLOSS lookup, the app passes its
 * own gloss source, and the rule stays identical either way. Junk
 * (non-array tokens, empty surfaces, a missing or throwing
 * readingOf) yields fewer entries, never a crash.
 */
export function kanjiReadings(tokens, readingOf, meaningOf, compoundOf) {
  if (!Array.isArray(tokens) || typeof readingOf !== 'function') return []
  const toks = tokens.map((token) =>
    typeof token === 'string' ? { s: token, h: token } : token,
  )
  // Character stream over the surfaces, in order — the compound
  // pass (amendment #14) reads words as the LEARNER meets them,
  // across the segmenter's token cuts: its stream chopped 面談
  // into 面 + 談のお…, and a block built token-by-token can only
  // ever show fragments of such a word.
  const chars = []
  const tokenStart = []
  toks.forEach((t, ti) => {
    tokenStart[ti] = chars.length
    const surface = typeof t?.s === 'string' ? t.s : ''
    for (const ch of surface) chars.push({ ch, tok: ti })
  })
  const entries = []
  const seen = new Set()
  const consumed = new Set()
  // Compound pass: at each kanji, the LONGEST known compound
  // (2–4 kanji) starting there wins, and the tokens it spans are
  // consumed — their fragments never list separately for this
  // occurrence. compoundOf is injected like the other sources
  // and stays optional: without it the block is exactly the
  // per-token one.
  if (typeof compoundOf === 'function') {
    let i = 0
    while (i < chars.length) {
      if (consumed.has(chars[i].tok) || !KANJI_RE.test(chars[i].ch)) {
        i++
        continue
      }
      let runEnd = i
      while (runEnd < chars.length && KANJI_RE.test(chars[runEnd].ch)) runEnd++
      let matched = 0
      for (let len = Math.min(4, runEnd - i); len >= 2; len--) {
        const cand = chars.slice(i, i + len).map((c) => c.ch).join('')
        if (seen.has(cand)) continue
        // Phrase-token guard (2026-11-11): a compound lying
        // entirely inside ONE token whose surface is a set
        // phrase longer than the candidate （今日は the greeting)
        // must not eat the phrase and list its first half as a
        // different word （今日 きょう, against the text's own
        // こんにちは ruby).
        const startTok = chars[i].tok
        if (startTok === chars[i + len - 1].tok) {
          const tokSurface = typeof toks[startTok]?.s === 'string' ? toks[startTok].s : ''
          const tokHead = typeof toks[startTok]?.h === 'string' ? toks[startTok].h : ''
          if (tokSurface.length > len && tokHead === tokSurface) continue
        }
        let hit = null
        try {
          hit = compoundOf(cand)
        } catch {
          hit = null
        }
        if (hit && typeof hit.reading === 'string' && hit.reading && hit.reading !== cand) {
          seen.add(cand)
          entries.push({
            pos: i,
            entry: typeof hit.meaning === 'string' && hit.meaning
              ? { word: cand, reading: hit.reading, meaning: hit.meaning }
              : { word: cand, reading: hit.reading },
          })
          for (let k = i; k < i + len; k++) consumed.add(chars[k].tok)
          matched = len
          break
        }
      }
      i += matched || 1
    }
  }
  // Per-token pass, skipping consumed tokens: surface-first
  // resolution, dictionary-form display (the law in the header).
  toks.forEach((t, ti) => {
    if (consumed.has(ti)) return
    const surface = typeof t?.s === 'string' ? t.s : ''
    if (!surface || !KANJI_RE.test(surface)) return
    const headword = typeof t?.h === 'string' && t.h ? t.h : surface
    const lookup = (w) => {
      let reading = null
      try {
        reading = readingOf(w)
      } catch {
        reading = null
      }
      if (typeof reading !== 'string' || !reading || reading === w) return null
      // Meanings ride along only when a meaning source is injected
      // (amendment #13): the entry gains the gloss for the word it
      // resolved as; without one it is exactly { word, reading }.
      let meaning = null
      if (typeof meaningOf === 'function') {
        try {
          meaning = meaningOf(w)
        } catch {
          meaning = null
        }
      }
      return typeof meaning === 'string' && meaning
        ? { word: w, reading, meaning }
        : { word: w, reading }
    }
    // Inflection refinement: a surface followed by a verb-chain
    // auxiliary （覚え+て, 行き+ます) is mid-inflection — the
    // headword's entry is the word being used, even when the
    // stem alone is also a dictionary word （覚え the noun).
    // A surface standing complete （通り+が) resolves as itself.
    const nextSurface = typeof toks[ti + 1]?.s === 'string' ? toks[ti + 1].s : ''
    const midInflection = /^(て|で|た|ます|ました|ません|ない|なかった|たい|たかった|れる|られる|せる|させる|ちゃ|じゃ)/.test(nextSurface)
    const entry = midInflection
      ? (lookup(headword) || lookup(surface))
      : (lookup(surface) || (headword !== surface ? lookup(headword) : null))
    if (!entry || seen.has(entry.word)) return
    seen.add(entry.word)
    entries.push({ pos: tokenStart[ti], entry })
  })
  entries.sort((a, b) => a.pos - b.pos)
  return entries.slice(0, KANJI_READINGS_CAP).map((e) => e.entry)
}

// ---------- Fit v2: encounters, seen kanji, dose, batch (amendment #10) ----------
//
// Landry's method, in his words: "Master what you've seen… new
// learn, read it many times. Then add other. Go go and bring it
// back after few days." — and his correction, which outranks the
// first framing: "do not limit to the ones you know… The goal is
// to know more." So the known set is NEVER a whitelist: it is the
// readable BASE, and every passage must still carry a deliberate
// dose of the new. This section is the ranking layer that sits
// UNDER the unchanged 0.93–0.97 word gate (the gate filters first,
// exactly as before; nothing here can admit a failing passage):
//
//   PROVEN words — queue fronts plus ENCOUNTERS (words the learner
//   genuinely met outside the queue: Anki cards they rated, Speed
//   Cards they answered — synced into learner_state.encounters).
//   Proven words earn FULL credit in the known set (buildKnownSet's
//   personal-vocab slot), unlike below-band deck credit, which is
//   an assumption. SEEN KANJI derives from proven words only, for
//   the same reason: a credited word's glyphs may never have been
//   met; a proven word's glyphs were on the screen in front of them.
//
//   DOSE — for an in-gate candidate, newKanji = the distinct kanji
//   in its surfaces that are not seen kanji. The productive band is
//   1..NEW_KANJI_DOSE_MAX: enough new to grow, few enough to carry.
//   Ranking: dosed first, ZERO-new below it (a passage with nothing
//   new teaches nothing), over-dosed last — but over-dosed is a
//   RANK, never an exclusion: alone in the gate, it still serves,
//   with the readings block as its support. The unseen count is a
//   ceiling on overload, never a minimisation target.
//
//   BATCH RECYCLE — the current batch is the learner's ungraduated
//   Reader-sourced queue words (graduated = fsrs reps ≥ 3, the
//   Twin's rule in twin.js). While a batch exists, a candidate
//   whose text re-uses batch words outranks dose ordering entirely:
//   repetition of the current learn set, in new contexts, comes
//   first — "read it many times" — and the new-dose preference only
//   leads once the batch is graduated or empty.

/** The productive new-kanji dose ceiling per passage. */
export const NEW_KANJI_DOSE_MAX = 8
/** fsrs reps at which a queue word counts as graduated (twin.js). */
export const GRADUATED_REPS = 3

/** Every kanji character of a string, in order (duplicates kept). */
export function kanjiCharsOf(str) {
  const out = []
  for (const ch of String(str || '')) if (KANJI_RE.test(ch)) out.push(ch)
  return out
}

/**
 * The seen-kanji set: every kanji appearing inside a PROVEN word
 * (queue fronts ∪ encounters — graduated queue words are queue
 * fronts already, so the union needs no third term). Deck credit
 * deliberately contributes NOTHING: its glyphs were assumed, not met.
 */
export function seenKanjiSet(provenWords) {
  const seen = new Set()
  for (const word of provenWords || []) {
    if (typeof word !== 'string' || !word) continue
    for (const ch of word) if (KANJI_RE.test(ch)) seen.add(ch)
  }
  return seen
}

/**
 * The distinct kanji of a passage that the learner has NOT seen —
 * token SURFACES (what is actually on the page), deduped, in order
 * of first appearance. String tokens normalise as elsewhere. A
 * missing/invalid seen set reads as "nothing seen" (everything is
 * new) rather than crashing the pick.
 */
export function passageNewKanji(tokens, seenKanji) {
  const seen = seenKanji && typeof seenKanji.has === 'function' ? seenKanji : new Set()
  const out = []
  const found = new Set()
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const t = typeof token === 'string' ? { s: token } : token
    const surface = typeof t?.s === 'string' ? t.s : ''
    if (!surface) continue
    for (const ch of surface) {
      if (!KANJI_RE.test(ch) || seen.has(ch) || found.has(ch)) continue
      found.add(ch)
      out.push(ch)
    }
  }
  return out
}

/**
 * Dose rank for a new-kanji count (lower ranks first):
 *   0 — productive dose (1..NEW_KANJI_DOSE_MAX new kanji)
 *   1 — zero new kanji (nothing to learn from it)
 *   2 — over-dosed (above the ceiling; support, don't prefer)
 */
export function doseRankOf(newKanjiCount) {
  const n = Math.max(0, Math.trunc(Number(newKanjiCount) || 0))
  if (n === 0) return 1
  return n <= NEW_KANJI_DOSE_MAX ? 0 : 2
}

/**
 * The current batch: fronts of the learner's UNGRADUATED queue
 * words sourced from the Reader — the learn set currently in
 * rotation. Deduped, queue order. Graduated words (fsrs reps ≥
 * GRADUATED_REPS, the Twin's rule) have left the batch: they come
 * back through FSRS timing and later recycling, not through the
 * batch bonus.
 */
export function currentBatchWords(queueItems) {
  const out = []
  const seen = new Set()
  for (const item of queueItems || []) {
    if (!item || item.source !== 'reader') continue
    if ((item.fsrs?.reps || 0) >= GRADUATED_REPS) continue
    const front = typeof item.front === 'string' ? item.front.trim() : ''
    if (!front || seen.has(front)) continue
    seen.add(front)
    out.push(front)
  }
  return out
}

/**
 * Does this passage's text re-use any batch word? Matching is by
 * HEADWORD (the batch holds dictionary forms; the passage may
 * inflect them) — the same matching the known set uses.
 */
export function passageRecyclesBatch(tokens, batchWords) {
  const batch = batchWords instanceof Set ? batchWords : new Set(batchWords || [])
  if (batch.size === 0) return false
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const t = typeof token === 'string' ? { s: token, h: token } : token
    if (!t) continue
    if (batch.has(t.h || t.s) || batch.has(t.s)) return true
  }
  return false
}

/**
 * The Fit v2 rank keys for one candidate: { recycle, dose }, both
 * lower-is-better, recycle outranking dose. Each key is a constant
 * 0 when its input is absent (no batch → no recycle key; no seen
 * set → no dose key), so callers that pass no fitOpts get exactly
 * the pre-v2 ordering.
 */
export function fitRankKeys(tokens, fitOpts = {}) {
  const batch = fitOpts?.batchWords
  const recycle = batch && (batch instanceof Set ? batch.size > 0 : batch.length > 0)
    ? (passageRecyclesBatch(tokens, batch) ? 0 : 1)
    : 0
  const dose = fitOpts?.seenKanji
    ? doseRankOf(passageNewKanji(tokens, fitOpts.seenKanji).length)
    : 0
  return { recycle, dose }
}
