// The learner state document (P0-1): the slices of a learner's data that
// are ASSETS — the ONE queue above all — gathered into one document for
// cloud sync (stateSync.js) in the same shape the merge logic
// (stateMerge.js) consumes:
//
//   { queue, profile, diagnosis, diagnosisHistory, promise, declaredLevel, encounters, language, modeSpells, plan, session }
//
// Local storage stays the offline source of truth; this module only
// reads/writes the existing keys. Diagnosis history writes go through
// twin.js's pushDiagnosisHistory, which emits on the save-event bus
// itself so the history slice stays honest.

import { QUEUE_KEY, loadQueue } from './queue.js'
import { PROFILE_KEY, DIAGNOSIS_KEY, loadProfile, loadDiagnosis } from './profile.js'
import { PROMISE_KEY, loadPromise } from './promise.js'
import { emitLearnerStateSaved } from './stateEvents.js'
import { ENCOUNTERS_KEY, collectEncounterWords } from './encounters.js'
import { MODE_SPELLS_KEY, loadModeSpells } from './day30.js'
import { VOICE_CAST_KEY, loadVoiceCast } from './voicePreference.js'
import { PLAN_KEY, loadPlanState } from './planner.js'
import { SESSION_KEY, loadSessionState } from './session.js'

export const DIAGNOSIS_HISTORY_KEY = 'jpn:diagnosisHistory:v1'
export const DECLARED_LEVEL_KEY = 'jpn:declaredLevel:v1'
export const LANGUAGE_KEY = 'jpn:language:v1'
export const STATE_SYNCED_EVENT = 'jpn:state-synced'

export function loadDiagnosisHistory() {
  try {
    const raw = localStorage.getItem(DIAGNOSIS_HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

// The declared level — the shared contract with the Telegram Reader
// (levelBasis.js): { band: <raw value, 'N7' included>, at: <ISO> }.
// One declaration, stored once, read by the app and the bot alike;
// precedence (diagnosis > declaration > none) lives in levelBasis.js.
export function loadDeclaredLevel() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DECLARED_LEVEL_KEY) || 'null')
    return parsed && typeof parsed.band === 'string' ? parsed : null
  } catch { return null }
}

/** Record a declaration (raw band, 'N7' included) and notify the
 *  save-event bus so stateSync pushes the new state document. */
export function saveDeclaredLevel(band) {
  const record = { band, at: new Date().toISOString() }
  try {
    localStorage.setItem(DECLARED_LEVEL_KEY, JSON.stringify(record))
    emitLearnerStateSaved()
  } catch { /* storage unavailable — the declaration simply stays unset */ }
  return record
}

// The UI language (Doc 20): { lang: 'en'|'fr'|'ja', at: <ISO> } — the
// same single-document contract as declaredLevel. Per-user and
// account-bound: the choice rides the synced state document, so it
// follows the account to every device; the localStorage key doubles
// as the instant-boot mirror the LanguageProvider reads first.
// No stored choice → null → the UI is English, exactly as before.
export const LANGUAGE_IDS = ['en', 'fr', 'ja']

export function loadLanguage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LANGUAGE_KEY) || 'null')
    return parsed && LANGUAGE_IDS.includes(parsed.lang) ? parsed : null
  } catch { return null }
}

/** Record a language choice (validated) and notify the save-event
 *  bus so stateSync pushes the new state document. */
export function saveLanguage(lang) {
  if (!LANGUAGE_IDS.includes(lang)) return loadLanguage()
  const record = { lang, at: new Date().toISOString() }
  try {
    localStorage.setItem(LANGUAGE_KEY, JSON.stringify(record))
    emitLearnerStateSaved()
  } catch { /* storage unavailable — the choice simply stays unset */ }
  return record
}

export function collectLearnerState() {
  return {
    queue: loadQueue(),
    profile: loadProfile(),
    diagnosis: loadDiagnosis(),
    diagnosisHistory: loadDiagnosisHistory(),
    promise: loadPromise(),
    declaredLevel: loadDeclaredLevel(),
    // Fit v2 (amendment #10): words genuinely met outside the queue
    // (encounters.js) — the server-side fit reads them from this
    // same document and grants them full proven credit.
    encounters: collectEncounterWords(),
    language: loadLanguage(),
    voiceCast: loadVoiceCast(),
    // Cohort readiness (day30.js, Doc 11 §7): Twin mode spells —
    // union-merged by startedAt so the mode history (and the
    // bad-week gate measurement) survives across devices.
    modeSpells: loadModeSpells(),
    // Integration audit #7/#9: Saki's plan state and the in-progress
    // session ride the document too — one guided day, one session,
    // the same on every device (merge rules in stateMerge.js).
    plan: loadPlanState(),
    session: loadSessionState(),
  }
}

const SLICE_KEYS = [
  ['queue', QUEUE_KEY],
  ['profile', PROFILE_KEY],
  ['diagnosis', DIAGNOSIS_KEY],
  ['diagnosisHistory', DIAGNOSIS_HISTORY_KEY],
  ['promise', PROMISE_KEY],
  ['declaredLevel', DECLARED_LEVEL_KEY],
  ['encounters', ENCOUNTERS_KEY],
  ['language', LANGUAGE_KEY],
  ['voiceCast', VOICE_CAST_KEY],
  ['modeSpells', MODE_SPELLS_KEY],
  ['plan', PLAN_KEY],
  ['session', SESSION_KEY],
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
