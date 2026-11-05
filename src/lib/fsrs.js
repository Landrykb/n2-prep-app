// FSRS-style spaced repetition scheduler.
//
// A compact implementation of the FSRS-5 model (Free Spaced Repetition
// Scheduler): every card carries a memory *stability* (days until recall
// probability falls to 90%) and a *difficulty* (1–10). Retrievability follows
// a power-law forgetting curve. This replaces the app's old fixed interval
// ladders ([1, 3, 7, 14, 30, 90, 180] for everyone) with per-card scheduling
// modelled on the learner's own ratings — the same family of algorithm Anki
// made its default in 2025, which benchmarks ~20–30% fewer reviews than SM-2
// at the same retention.
//
// Ratings: Again (1) · Hard (2) · Good (3) · Easy (4)

export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 }
export const RATING_LABELS = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }

// FSRS-5 default weights (w0…w18), as published for the open benchmark.
export const DEFAULT_WEIGHTS = [
  0.40255, 1.18385, 3.173, 15.69105, // initial stability for Again/Hard/Good/Easy
  7.1949, 0.5345, // initial difficulty: D0 = w4 - exp(w5*(G-1)) + 1
  1.4604, 0.0046, // difficulty update / mean reversion
  1.54575, 0.1192, 1.01925, // recall stability
  1.9395, 0.11, 0.29605, 2.2698, // forget stability
  0.2315, 2.9898, // hard / easy bonuses
  0.51655, 0.6621, // short-term (same-day) stability
]

export const DEFAULT_RETENTION = 0.9

const DECAY = -0.5
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1 // so R(S, S) = 0.9

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const DAY_MS = 86400000

/** Create a fresh (unseen) card state. */
export function createCardState(now = new Date()) {
  return {
    stability: 0,
    difficulty: 0,
    due: now.toISOString(),
    lastReview: null,
    reps: 0,
    lapses: 0,
    state: 'new', // new | learning | review | relearning
  }
}

/** Probability of recall after `elapsedDays` for a card with `stability`. */
export function retrievability(elapsedDays, stability) {
  if (!stability || stability <= 0) return 0
  if (elapsedDays <= 0) return 1
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY)
}

/** Days from now until retrievability falls to `retention`. */
export function nextIntervalDays(stability, retention = DEFAULT_RETENTION) {
  if (!stability || stability <= 0) return 1
  const days = (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1)
  return clamp(Math.round(days), 1, 365)
}

function initialStability(rating, w) {
  return Math.max(0.1, w[rating - 1])
}

function initialDifficulty(rating, w) {
  return clamp(w[4] - Math.exp(w[5] * (rating - 1)) + 1, 1, 10)
}

function nextDifficulty(difficulty, rating, w) {
  const delta = -w[6] * (rating - 3)
  const damped = difficulty + (delta * (10 - difficulty)) / 9
  // Mean-revert toward the difficulty of a first "Easy" rating.
  const target = initialDifficulty(Rating.Easy, w)
  return clamp(w[7] * target + (1 - w[7]) * damped, 1, 10)
}

function recallStability(card, rating, r, w) {
  const hardBonus = rating === Rating.Hard ? w[15] : 1
  const easyBonus = rating === Rating.Easy ? w[16] : 1
  const s = card.stability
  const d = card.difficulty
  const growth =
    Math.exp(w[8]) *
    (11 - d) *
    Math.pow(s, -w[9]) *
    (Math.exp(w[10] * (1 - r)) - 1) *
    hardBonus *
    easyBonus
  return Math.max(0.1, s * (1 + growth))
}

function forgetStability(card, r, w) {
  const s = card.stability
  const d = card.difficulty
  const post =
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - r))
  return clamp(post, 0.1, s) // forgetting can never raise stability
}

function shortTermStability(card, rating, w) {
  // FSRS-5 same-day rule: S' = S · e^{w17·(G−3+w18)}, never rising on Again.
  const s = Math.max(0.1, card.stability)
  const adjusted = s * Math.exp(w[17] * (rating - 3 + w[18]))
  return Math.max(0.1, rating === Rating.Again ? Math.min(adjusted, s) : adjusted)
}

/**
 * Review a card. Returns a NEW card state (input is not mutated) with updated
 * stability/difficulty, a due ISO string, and `intervalDays` for display.
 * Same-day reviews (< 1 day elapsed) use the short-term stability rule and a
 * minute-scale due time for Again, so a lapsed card comes back in-session.
 */
export function reviewCard(card, rating, now = new Date(), { weights = DEFAULT_WEIGHTS, retention = DEFAULT_RETENTION } = {}) {
  const w = weights
  const g = clamp(Math.round(rating) || Rating.Good, 1, 4)
  const last = card.lastReview ? new Date(card.lastReview) : null
  const elapsed = last ? Math.max(0, (now - last) / DAY_MS) : 0
  const isNew = !card.reps || card.state === 'new' || !last

  let stability
  let difficulty
  let state
  let dueMs

  if (isNew) {
    stability = initialStability(g, w)
    difficulty = initialDifficulty(g, w)
    state = g === Rating.Again ? 'learning' : 'review'
  } else {
    const r = retrievability(elapsed, card.stability)
    difficulty = nextDifficulty(card.difficulty || initialDifficulty(Rating.Good, w), g, w)
    if (elapsed < 1) {
      stability = shortTermStability({ ...card, difficulty }, g, w)
      state = g === Rating.Again ? 'relearning' : 'review'
    } else if (g === Rating.Again) {
      stability = forgetStability({ ...card, difficulty }, r, w)
      state = 'relearning'
    } else {
      stability = recallStability({ ...card, difficulty }, g, r, w)
      state = 'review'
    }
  }

  if (g === Rating.Again && (isNew || elapsed < 1)) {
    dueMs = now.getTime() + 10 * 60 * 1000 // 10 minutes — back in this session
  } else if (g === Rating.Again) {
    dueMs = now.getTime() + DAY_MS // relearn tomorrow, not a week away
  } else {
    dueMs = now.getTime() + nextIntervalDays(stability, retention) * DAY_MS
  }

  return {
    stability,
    difficulty,
    due: new Date(dueMs).toISOString(),
    lastReview: now.toISOString(),
    reps: (card.reps || 0) + 1,
    lapses: (card.lapses || 0) + (g === Rating.Again && !isNew ? 1 : 0),
    state,
    intervalDays: Math.max(0, Math.round((dueMs - now.getTime()) / DAY_MS)),
  }
}

/** Preview the interval each rating would give, for the 4 rating buttons. */
export function previewIntervals(card, now = new Date(), opts = {}) {
  const out = {}
  for (const g of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    const next = reviewCard(card || createCardState(now), g, now, opts)
    out[g] = { days: next.intervalDays, label: formatInterval(next, now), due: next.due }
  }
  return out
}

/** Human label for a scheduled due date: "10m", "1d", "2.4mo", "1.2y". */
export function formatInterval(nextCard, now = new Date()) {
  const ms = new Date(nextCard.due) - now
  if (ms < DAY_MS) return `${Math.max(1, Math.round(ms / 60000))}m`
  const days = ms / DAY_MS
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${(days / 30.4).toFixed(1).replace(/\.0$/, '')}mo`
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`
}

/** Is this card due at `now`? New cards (no reps) are always available. */
export function isDue(card, now = new Date()) {
  if (!card || !card.reps) return true
  return new Date(card.due) <= now
}
