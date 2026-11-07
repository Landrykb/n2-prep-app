// Diagnosis draft (audit #6) — an in-progress health check survives
// closing the app. The Diagnosis flow keeps its run in component state;
// a full run is ~10 minutes of answers, and losing them to a closed tab
// was pure waste.
//
// The draft is DEVICE-LOCAL only (localStorage, like the session state):
// guests and signed-in learners both get it, nothing is synced, and it
// is not a learner-state slice — it is a resumable worksheet, not a
// record. It is stamped with the item-bank version (the selection
// scheme in lib/diagnosisItems.js): if the bank changes shape, old
// drafts are refused rather than resumed into a different checkup.
//
// Lifecycle: Diagnosis.jsx saves on every answer-driven state change
// while a run is in progress (quiz/listening/reading phases), offers
// resume on the intro screen when a FRESH draft exists (< 7 days old),
// and clears the draft when the run finishes or the learner starts
// over. Pure helpers, node-tested in tests/phase2.test.mjs.

import { DIAGNOSIS_ITEMS_VERSION } from './diagnosisItems.js'

export const DIAGNOSIS_DRAFT_KEY = 'jpn:diagnosisDraft:v1'
export const DRAFT_MAX_AGE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000
const DRAFT_PHASES = ['quiz', 'listening', 'reading']

export function makeDiagnosisDraft(state, now = new Date()) {
  return { v: 1, bankVersion: DIAGNOSIS_ITEMS_VERSION, savedAt: now.toISOString(), state }
}

export function saveDiagnosisDraft(state, now = new Date()) {
  try {
    localStorage.setItem(DIAGNOSIS_DRAFT_KEY, JSON.stringify(makeDiagnosisDraft(state, now)))
    return true
  } catch { return false }
}

/** Fresh = right shape, current bank version, younger than the max age. */
export function isDraftFresh(draft, now = new Date()) {
  if (!draft || typeof draft !== 'object') return false
  if (draft.v !== 1) return false
  if (draft.bankVersion !== DIAGNOSIS_ITEMS_VERSION) return false
  const at = new Date(draft.savedAt || 0).getTime()
  if (!Number.isFinite(at)) return false
  const age = now.getTime() - at
  return age >= 0 && age < DRAFT_MAX_AGE_DAYS * DAY_MS
}

/**
 * Load a resumable draft, or null. Beyond freshness, the saved run state
 * must be minimally sane: an in-progress phase and an answers array —
 * anything else is treated as no draft rather than resumed into a
 * broken screen.
 */
export function loadDiagnosisDraft(now = new Date()) {
  try {
    const raw = localStorage.getItem(DIAGNOSIS_DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw)
    if (!isDraftFresh(draft, now)) return null
    const s = draft.state
    if (!s || typeof s !== 'object') return null
    if (!DRAFT_PHASES.includes(s.phase)) return null
    if (!Array.isArray(s.answers)) return null
    if (s.phase === 'quiz' && !s.current) return null
    return draft
  } catch { return null }
}

export function clearDiagnosisDraft() {
  try { localStorage.removeItem(DIAGNOSIS_DRAFT_KEY) } catch { /* ignore */ }
}
