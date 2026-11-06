// LEVEL BASIS — which level the fleet aims at, and why (pure,
// node-tested in tests/phase2.test.mjs).
//
// The level question used to live only in Telegram (Doc 16 §5
// amendment #3: one tap stores a declaration; a real diagnosis
// overrides it whenever one exists). The TwinView "Your Level" card
// (2026-11-07) gives the same question a home in the app, writing the
// SAME contract the bot reads: the learner-state slice
//   declaredLevel = { band: <raw value>, at: <ISO timestamp> }
// (learnerState.js). Precedence, here and everywhere:
//   diagnosis  >  latest declaration  >  none.
//
// The raw declaration can be 'N7' — Landry's addition (2026-11-07):
// learners joke their level is N7, below N5. The joke is welcome
// here (laugh with them, never shame), and it is also a real signal:
// 'N7' normalizes to the N5 floor wherever a band is consumed, and
// while an N7 declaration is the winning basis the learner is on
// FOUNDATIONS pace — start from the bases, climb slower, more
// comfortable reads before anything steps up. The pace is exposed
// alongside band/source so surfaces can say it out loud instead of
// silently treating N7 like any other tap. A diagnosis, when one
// exists, outranks the tap entirely — pace included: it measured,
// the tap guesses.

export const DECLARABLE_BANDS = ['N5', 'N4', 'N3', 'N2', 'N1']
export const FLOOR_BAND = 'N5'

/** A raw band value → the band the system consumes, or null. */
export function normalizeBand(raw) {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toUpperCase()
  if (v === 'N7') return FLOOR_BAND
  return DECLARABLE_BANDS.includes(v) ? v : null
}

/**
 * Resolve the current level basis.
 *   diagnosisBand — the checkup's band (diagnosis.jlptEstimate), or null
 *   declaredLevel — the stored declaration { band, at }, or null
 * Returns { band, source, rawBand, pace }:
 *   band    — the consumed band (N7 already floored to N5), or null
 *   source  — 'diagnosis' | 'declared' | 'none'
 *   rawBand — the value as declared ('N7' stays 'N7' for display)
 *   pace    — 'foundations' when the winning declaration is N7 and no
 *             diagnosis exists, else 'standard'
 */
export function resolveLevelBasis({ diagnosisBand = null, declaredLevel = null } = {}) {
  const diagnosis = normalizeBand(diagnosisBand)
  if (diagnosis) {
    return { band: diagnosis, source: 'diagnosis', rawBand: diagnosis, pace: 'standard' }
  }
  const rawDeclared = typeof declaredLevel?.band === 'string'
    ? declaredLevel.band.trim().toUpperCase()
    : null
  const declared = normalizeBand(rawDeclared)
  if (declared) {
    return {
      band: declared,
      source: 'declared',
      rawBand: rawDeclared,
      pace: rawDeclared === 'N7' ? 'foundations' : 'standard',
    }
  }
  return { band: null, source: 'none', rawBand: null, pace: 'standard' }
}
