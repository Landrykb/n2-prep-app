// ADAPTATION MODES (Doc 05 §7) — detection is CODE, always. The fleet
// reacts inside each mode's rules; no mascot and no AI ever "decides" a
// mode or a number. Thresholds below are Doc 05's v1 starting points,
// labelled as such, to be tuned with cohort data.
//
//   Surge        — climbing: accuracy up, calls answered, effort light
//   Cruise       — steady default
//   Slump        — sliding: accuracy down / lapses up / effort heavy
//   BadWeek      — life happened: away 5+ days, or the learner says so
//   EventApproach— a real event (exam) within 14 days: narrow to rehearsal
//
// Precedence when several fire: EventApproach (calendar is immovable)
// → BadWeek (wellbeing) → Slump → Surge → Cruise. A comeback flag rides
// alongside: returning after 3+ days away changes the session's material
// (strongest first) whichever mode is active.

import { saveTwin, refreshTwin } from './twin.js'
import { recordModeSpellsForTwin } from './day30.js'
import { daysSinceLastVisit } from './profile.js'
import { getExamSetting } from './examDate.js'
import { resolveExamDate, daysUntil } from './nextJLPT.js'

export const MODES = {
  surge: {
    id: 'surge', label: 'Surge',
    michiLine: 'You’re climbing — this is a stretch week. If you want more today, your session has room to grow. Wanting more is earned, never assumed.',
  },
  cruise: {
    id: 'cruise', label: 'Cruise',
    michiLine: 'Steady week. Same small size, same direction — that steadiness is exactly what compounds.',
  },
  slump: {
    id: 'slump', label: 'Slump',
    michiLine: 'The last few days were heavy going, so Saki made today smaller on purpose. Small and finished beats big and avoided — every time.',
  },
  badweek: {
    id: 'badweek', label: 'Bad Week',
    michiLine: 'We kept your place. Nothing piled up, nothing is owed — the fleet just rested with you. One tiny win is all today asks.',
  },
  event: {
    id: 'event', label: 'Event Approach',
    michiLine: 'Your exam is close now, so everything narrows to rehearsal. General progress pauses without penalty and resumes right after.',
  },
}

function avg(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}

/** Days until the learner's chosen exam (existing exam-date preference). */
export function daysToEvent() {
  try {
    return daysUntil(resolveExamDate(getExamSetting()))
  } catch { return null }
}

/**
 * Detect the current mode from Twin signals. Pure read of stored signals
 * + the writes of twin.mode/modeSince when the mode changes.
 */
export function detectMode(now = new Date()) {
  const twin = refreshTwin()
  const signals = {}

  // Event: exam within 14 days (and still ahead).
  const dte = daysToEvent()
  signals.daysToEvent = dte
  const event = dte !== null && dte >= 0 && dte <= 14

  // BadWeek: no session for 5+ days (with at least one session ever), or
  // the learner returns after a long gap.
  const gap = daysSinceLastVisit(now)
  signals.gapDays = gap
  const lastSessionDays = twin.rhythm.lastSessionAt
    ? Math.floor((now - new Date(twin.rhythm.lastSessionAt)) / 86400000)
    : null
  signals.lastSessionDays = lastSessionDays
  const badweek = (lastSessionDays !== null && lastSessionDays >= 5) || (gap !== null && gap >= 5 && twin.rhythm.sessionLog.length > 0)

  // Comeback: away 3+ days — material choice changes, mode may not.
  const comeback = (gap !== null && gap >= 3) || (lastSessionDays !== null && lastSessionDays >= 3)
  signals.comeback = comeback

  // Accuracy trend: last 5 samples vs the 5 before them (voice/listening).
  const acc = (twin.accuracyRecent || []).map((a) => a.score01)
  const recentAcc = avg(acc.slice(-5))
  const priorAcc = avg(acc.slice(-10, -5))
  signals.recentAcc = recentAcc
  signals.priorAcc = priorAcc
  const trend = recentAcc !== null && priorAcc !== null ? recentAcc - priorAcc : null
  signals.trend = trend

  // Lapse rate over the last 3 logged sessions.
  const last3 = (twin.rhythm.sessionLog || []).slice(-3).filter((s) => typeof s.lapseRate === 'number')
  const lapseRate = last3.length ? avg(last3.map((s) => s.lapseRate)) : null
  signals.lapseRate = lapseRate

  // Felt effort: the honest check at the end of sessions.
  const effort = twin.rhythm.feltEffortRecent || []
  const effortYesTwice = effort.slice(-2).length === 2 && effort.slice(-2).every((a) => a === 'Yes')
  const effortLight = effort.length >= 2 && effort.slice(-3).filter((a) => a === 'Not really').length >= 2
  signals.effortYesTwice = effortYesTwice

  // Call answer rate (kept / all recorded outcomes).
  const kept = twin.rhythm.callsKept || 0
  const missed = twin.rhythm.callsMissed || 0
  const callRate = kept + missed > 0 ? kept / (kept + missed) : null
  signals.callRate = callRate

  const slump = (trend !== null && trend <= -0.05) || (lapseRate !== null && lapseRate > 0.35) || effortYesTwice
  const surge = trend !== null && trend >= 0.05 && (callRate === null || callRate >= 0.8) && effortLight

  let mode = 'cruise'
  if (surge) mode = 'surge'
  if (slump) mode = 'slump'
  if (badweek) mode = 'badweek'
  if (event) mode = 'event'

  // Mode spells (cohort readiness, day30.js, Doc 11 §7): record the
  // spell bookkeeping from the Twin as it was BEFORE this detection —
  // a change closes the previous spell and opens the new one; no
  // change seeds/confirms the open spell. Measurement only: the
  // verdicts this feeds (the Phase 3 gate) are never user-facing.
  try {
    recordModeSpellsForTwin({ mode: twin.mode, modeSince: twin.modeSince }, mode, now)
  } catch { /* spell recording must never break mode detection */ }

  if (twin.mode !== mode) {
    twin.mode = mode
    twin.modeSince = now.toISOString()
    saveTwin(twin)
  }
  return { mode, signals, meta: MODES[mode] }
}
