// The Twin's continuous WORKING-LEVEL estimate, v1 (Doc 04 §5 note).
//
// The diagnosis is a snapshot: a 10-minute checkup on one day. Between
// checkups the learner keeps producing evidence — queue cards mastered
// level by level, calls taken and scored, Reader passages read at a
// proven fit — and until now none of it ever added up to "where is my
// Japanese working right now?" This module derives that number, in
// code, from evidence the app already holds. It is Tier 0: pure,
// deterministic, no AI, no new storage — computed on read, shown in
// TwinView, and NEVER written anywhere.
//
// THE HARD RULE: this estimate overwrites NOTHING. The diagnosis, the
// 60-day promise, the Reader's declared band and the fit step are all
// stored facts owned by their own code paths; the estimate is a view
// over them plus the activity record. If it and the diagnosis
// disagree, the diagnosis still governs the promise — the estimate is
// labelled an estimate wherever it appears, for exactly this reason.
//
// THE VOTE. Each evidence source that can name a band casts a weighted
// vote; the working level is the WEIGHTED MEDIAN — bands sorted low to
// high, the first whose cumulative weight reaches half the total. The
// median (not the mean, not the max) is the honest aggregator here: a
// single strong signal cannot drag the estimate past the weight of
// everything else, and an exact tie resolves DOWNWARD (the lower band
// wins) — when the evidence is split, the estimate stays conservative.
//
//   diagnosis  weight 3 — a measured checkup outranks everything, but
//              it is one day; the other votes can still move the
//              median when they agree against it.
//   queue      weight 2 — mastery earned card by card: the highest
//              band with at least QUEUE_MASTERY_MIN graduated items
//              (fsrs reps ≥ 3 — the same "graduated" the Twin's vocab
//              stats use). Unlevelled items cast no vote: a level is
//              only claimed for words whose level is known.
//   reader     weight 2 — the Reader's PROVEN band: the declared band
//              shifted by last_good_step, the step comfortable reads
//              have ratcheted (serveBandFor). The trial step is NOT
//              used: an untried stretch is ambition, not evidence.
//   speaking   weight 1 — calls and scenes are served at the learner's
//              diagnosed (else declared) band, so sustained attempts
//              at a decent average (≥ SPEAKING_VOTE_MIN_ATTEMPTS at
//              ≥ SPEAKING_VOTE_MIN_AVG) corroborate that band. Speaking
//              never names a band of its own: the Twin stores scores,
//              not scene levels, and inventing one would be a guess.
//
// CONFIDENCE is a volume label, not a probability: points for each
// independent evidence family present (diagnosis 2, queue mastery 1 —
// 2 once QUEUE_CONFIDENCE_DEEP graduated levelled items are counted,
// reader 1, speaking 1). ≥5 high, ≥3 medium, else low. With no votes
// at all the band is null and confidence is low: the surface says
// "not enough activity yet" instead of printing a guess.

import { BANDS, bandRank, serveBandFor } from './readerFit.js'

/** Graduated items at one level before the queue calls it proven. */
export const QUEUE_MASTERY_MIN = 10
/** Graduated levelled items at which the queue's confidence deepens. */
export const QUEUE_CONFIDENCE_DEEP = 30
/** Speaking corroborates its served band from this many attempts… */
export const SPEAKING_VOTE_MIN_ATTEMPTS = 5
/** …at or above this average best score (the Twin's avgBest, %). */
export const SPEAKING_VOTE_MIN_AVG = 60

const WEIGHTS = { diagnosis: 3, queue: 2, reader: 2, speaking: 1 }

const validBand = (b) => (BANDS.includes(b) ? b : null)

/** The queue's vote: highest band with ≥ QUEUE_MASTERY_MIN graduated
 *  (reps ≥ 3) levelled items, plus the graduated-levelled census the
 *  confidence label reads. */
function queueEvidence(queueItems) {
  const graduatedByBand = {}
  let graduatedLevelled = 0
  for (const item of Array.isArray(queueItems) ? queueItems : []) {
    const band = validBand(item?.level)
    if (!band) continue
    if ((item?.fsrs?.reps || 0) < 3) continue
    graduatedByBand[band] = (graduatedByBand[band] || 0) + 1
    graduatedLevelled++
  }
  let band = null
  for (const b of BANDS) {
    if ((graduatedByBand[b] || 0) >= QUEUE_MASTERY_MIN) band = b // ascending: ends on the highest proven
  }
  return { band, graduatedLevelled, graduatedByBand }
}

/**
 * Derive the working level from whatever evidence exists.
 *   input (all optional, junk tolerated):
 *     diagnosisBand — latest diagnosis estimate (state.diagnosis)
 *     queueItems    — the ONE queue (items carry level + fsrs.reps)
 *     speaking      — the Twin's speaking slice { attempts, avgBest }
 *     declaredBand  — the Reader's one-tap declared band
 *     lastGoodStep  — the Reader's proven fit step (telegram_links)
 *   returns { band, confidence, signals, counts }
 *     band: a BANDS entry, or null when no source can name one.
 *     signals: the band each source voted for (null = silent).
 */
export function estimateWorkingLevel(input = {}) {
  const { diagnosisBand, queueItems, speaking, declaredBand, lastGoodStep } = input || {}
  const diagnosis = validBand(diagnosisBand)
  const declared = validBand(declaredBand)
  const queue = queueEvidence(queueItems)
  const reader = declared ? serveBandFor(declared, Number(lastGoodStep) || 0) : null

  const attempts = Math.max(0, Math.trunc(Number(speaking?.attempts) || 0))
  const avgBest = Number(speaking?.avgBest)
  const servedBand = diagnosis ?? declared
  const speakingVote = attempts >= SPEAKING_VOTE_MIN_ATTEMPTS && Number.isFinite(avgBest) && avgBest >= SPEAKING_VOTE_MIN_AVG
    ? servedBand
    : null

  const signals = { diagnosis, queue: queue.band, reader, speaking: speakingVote }
  const votes = []
  for (const [source, band] of Object.entries(signals)) {
    if (band) votes.push({ band, rank: bandRank(band), weight: WEIGHTS[source] })
  }

  let band = null
  if (votes.length > 0) {
    votes.sort((a, b) => a.rank - b.rank)
    const total = votes.reduce((s, v) => s + v.weight, 0)
    let cumulative = 0
    for (const v of votes) {
      cumulative += v.weight
      if (cumulative >= total / 2) { band = v.band; break } // ties resolve downward by construction
    }
  }

  let points = 0
  if (diagnosis) points += 2
  if (queue.band) points += queue.graduatedLevelled >= QUEUE_CONFIDENCE_DEEP ? 2 : 1
  if (reader) points += 1
  if (speakingVote) points += 1
  const confidence = !band ? 'low' : points >= 5 ? 'high' : points >= 3 ? 'medium' : 'low'

  return {
    band,
    confidence,
    signals,
    counts: { graduatedLevelled: queue.graduatedLevelled, speakingAttempts: attempts },
  }
}
