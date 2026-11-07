// The learner's model voice (voiceCast.js): the cast that
// speaks the lines the learner imitates — scene model lines,
// dictionary examples, mined words. { cast, at } on the same
// single-document contract as the language choice (Doc 20's
// pattern): per-user, account-bound, rides the synced state
// document; the localStorage key is the device mirror.
// No stored choice → null → the default cast (female).
import { emitLearnerStateSaved } from './stateEvents.js'
import { CAST_IDS, DEFAULT_CAST } from './voiceCast.js'

export const VOICE_CAST_KEY = 'jpn:voiceCast:v1'

export function loadVoiceCast() {
  try {
    const parsed = JSON.parse(localStorage.getItem(VOICE_CAST_KEY) || 'null')
    return parsed && CAST_IDS.includes(parsed.cast) ? parsed : null
  } catch { return null }
}

/** The effective cast id for model lines right now. */
export function modelCast() {
  return loadVoiceCast()?.cast || DEFAULT_CAST
}

/** Record a cast choice (validated) and notify the save-event bus. */
export function saveVoiceCast(cast) {
  if (!CAST_IDS.includes(cast)) return loadVoiceCast()
  const record = { cast, at: new Date().toISOString() }
  try {
    localStorage.setItem(VOICE_CAST_KEY, JSON.stringify(record))
    emitLearnerStateSaved()
  } catch { /* storage unavailable — the choice simply stays unset */ }
  return record
}
