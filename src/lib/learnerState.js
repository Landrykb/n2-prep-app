// The learner state document (P0-1): the slices of a learner's data that
// are ASSETS — the ONE queue above all — gathered into one document for
// cloud sync (stateSync.js) in the same shape the merge logic
// (stateMerge.js) consumes:
//
//   { queue, profile, diagnosis, diagnosisHistory, promise }
//
// Local storage stays the offline source of truth; this module only
// reads/writes the existing keys. Diagnosis history writes go through
// profile.js's saveDiagnosisHistory so the save-event bus stays honest.

import { QUEUE_KEY, loadQueue } from './queue.js'
import { PROFILE_KEY, DIAGNOSIS_KEY, loadProfile, loadDiagnosis } from './profile.js'
import { PROMISE_KEY, loadPromise } from './promise.js'

export const DIAGNOSIS_HISTORY_KEY = 'jpn:diagnosisHistory:v1'
export const STATE_SYNCED_EVENT = 'jpn:state-synced'

export function loadDiagnosisHistory() {
  try {
    const raw = localStorage.getItem(DIAGNOSIS_HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function collectLearnerState() {
  return {
    queue: loadQueue(),
    profile: loadProfile(),
    diagnosis: loadDiagnosis(),
    diagnosisHistory: loadDiagnosisHistory(),
    promise: loadPromise(),
  }
}

const SLICE_KEYS = [
  ['queue', QUEUE_KEY],
  ['profile', PROFILE_KEY],
  ['diagnosis', DIAGNOSIS_KEY],
  ['diagnosisHistory', DIAGNOSIS_HISTORY_KEY],
  ['promise', PROMISE_KEY],
]

/** Write a (merged) state document back to the local keys, verbatim —
 *  slices are stored exactly as collected so timestamps survive the
 *  round trip and the merge guards keep meaning what they mean. */
export function applyLearnerState(state) {
  if (!state) return
  try {
    for (const [slice, key] of SLICE_KEYS) {
      if (state[slice] !== undefined && state[slice] !== null) {
        localStorage.setItem(key, JSON.stringify(state[slice]))
      }
    }
    window.dispatchEvent(new CustomEvent(STATE_SYNCED_EVENT))
  } catch { /* storage unavailable — local state simply stays as it was */ }
}
