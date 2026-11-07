// Cohort readiness measurement (Phase 3 step 4, Doc 11 §7, Doc 12) —
// the pure machinery that makes the Phase 3 gate computable per user:
//
//   GATE: a cohort member passes when (1) their Day-30 diagnosis delta
//   is POSITIVE and (2) they did NOT churn after a bad week.
//
// Everything here is deterministic code over records the app already
// keeps — no AI, no new tracking. Three record families:
//
//   1. Diagnosis history (jpn:diagnosisHistory:v1, written by twin.js
//      on every completed checkup, synced as a learner-state slice).
//      The Day-30 delta compares the FIRST completed diagnosis with
//      the first later one at least SECOND_EARLIEST_DAY days after it;
//      the checkup prompt appears at FIRST_WINDOW_DAYS when no such
//      second record exists yet. Deltas are shown UNCLAMPED — a
//      negative delta is data, not an error to hide.
//   2. Mode spells (jpn:modeSpells:v1, a learner-state slice): every
//      Twin mode change closes the open spell and opens the next.
//      Union-merged by startedAt across devices, capped at the last
//      MODE_SPELLS_CAP spells.
//   3. The first-week feedback stamp (jpn:firstWeekFeedback:v1, LOCAL
//      only by design): whether the day 7–10 question was answered or
//      dismissed, so it is asked at most once per learner.
//
// The churn evaluator lives here and ONLY here (plus Doc 11): no
// user-facing surface ever shows the word or the verdict.

import { emitLearnerStateSaved } from './stateEvents.js'

export const DAY_MS = 24 * 60 * 60 * 1000

// Day-30 windows (Doc 11 §7).
export const FIRST_WINDOW_DAYS = 30
export const SECOND_EARLIEST_DAY = 25

// The diagnosis history already existed (twin.js, cap 24) before this
// module; the cap is preserved, with one change: the FIRST diagnosis
// is pinned — capping keeps the first record plus the newest
// CAP-1, because the Day-30 delta is anchored on the first record
// and must stay computable forever.
export const DIAGNOSIS_HISTORY_CAP = 24

export const MODE_SPELLS_KEY = 'jpn:modeSpells:v1'
export const MODE_SPELLS_CAP = 26
export const MODE_SUMMARY_WINDOW_DAYS = 30

export const FIRST_WEEK_KEY = 'jpn:firstWeekFeedback:v1'
export const FIRST_WEEK_START_DAY = 7
export const FIRST_WEEK_END_DAY = 10
export const FIRST_WEEK_MAX_DISMISSALS = 2

const BAD_WEEK_MODE = 'badweek'
export const CHURN_SILENCE_DAYS = 7

const ts = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : NaN }
const isValidDiagnosis = (d) => d && Number.isFinite(ts(d.at)) && Number.isFinite(Number(d.total))
const dayFloor = (ms) => Math.floor(ms / DAY_MS)

// ------------------------------------------------------------ diagnoses

/** Sorted (oldest first), de-duplicated by timestamp, valid records only. */
export function sortedDiagnosisHistory(history) {
  if (!Array.isArray(history)) return []
  const byAt = new Map()
  for (const d of history) {
    if (!isValidDiagnosis(d)) continue
    byAt.set(d.at, d) // a later write of the same instant wins
  }
  return [...byAt.values()].sort((a, b) => ts(a.at) - ts(b.at))
}

/** Cap the history at DIAGNOSIS_HISTORY_CAP, ALWAYS keeping the first
 *  diagnosis (the Day-30 anchor) plus the newest records. */
export function capDiagnosisHistory(history) {
  const sorted = sortedDiagnosisHistory(history)
  if (sorted.length <= DIAGNOSIS_HISTORY_CAP) return sorted
  return [sorted[0], ...sorted.slice(-(DIAGNOSIS_HISTORY_CAP - 1))]
}

/** Append one completed diagnosis (same-instant records replace). */
export function appendDiagnosisHistory(history, record) {
  if (!isValidDiagnosis(record)) return capDiagnosisHistory(history)
  const rest = sortedDiagnosisHistory(history).filter((d) => d.at !== record.at)
  return capDiagnosisHistory([...rest, record])
}

export function firstDiagnosis(history) {
  return sortedDiagnosisHistory(history)[0] || null
}

/** The first diagnosis at least SECOND_EARLIEST_DAY days after the
 *  first one — the Day-30 comparison partner. Earlier re-checks are
 *  real records but do not qualify as the second point. */
export function qualifyingSecondDiagnosis(history) {
  const sorted = sortedDiagnosisHistory(history)
  if (sorted.length < 2) return null
  const first = sorted[0]
  return sorted.slice(1).find((d) => dayFloor(ts(d.at) - ts(first.at)) >= SECOND_EARLIEST_DAY) || null
}

/** Total + per-section differences between two diagnosis records.
 *  Never clamped: a negative delta is returned as-is. A section
 *  missing on either side yields null for that section, never 0. */
export function computeDiagnosisDelta(first, second) {
  if (!isValidDiagnosis(first) || !isValidDiagnosis(second)) return null
  const sectionDelta = (id) => {
    const a = Number(first.sections?.[id])
    const b = Number(second.sections?.[id])
    return Number.isFinite(a) && Number.isFinite(b) ? b - a : null
  }
  return {
    total: Number(second.total) - Number(first.total),
    sections: {
      language: sectionDelta('language'),
      reading: sectionDelta('reading'),
      listening: sectionDelta('listening'),
    },
    days: dayFloor(ts(second.at) - ts(first.at)),
    firstAt: first.at,
    secondAt: second.at,
  }
}

/**
 * The Day-30 state for one learner:
 *   none        — no completed diagnosis yet
 *   waiting     — first diagnosis younger than FIRST_WINDOW_DAYS and
 *                 no qualifying second yet
 *   checkup-due — first diagnosis ≥ FIRST_WINDOW_DAYS old, still no
 *                 qualifying second: surface the checkup card
 *   delta       — a qualifying second exists: surface the delta card
 */
export function day30Status(history, now = new Date()) {
  const first = firstDiagnosis(history)
  if (!first) return { state: 'none', first: null, second: null, daysSinceFirst: null, delta: null }
  const daysSinceFirst = dayFloor(ts(now) - ts(first.at))
  const second = qualifyingSecondDiagnosis(history)
  if (second) {
    return { state: 'delta', first, second, daysSinceFirst, delta: computeDiagnosisDelta(first, second) }
  }
  return {
    state: daysSinceFirst >= FIRST_WINDOW_DAYS ? 'checkup-due' : 'waiting',
    first, second: null, daysSinceFirst, delta: null,
  }
}

// ------------------------------------------------------------ mode spells

const isValidSpell = (s) => s && typeof s.mode === 'string' && s.mode !== '' && Number.isFinite(ts(s.startedAt))

/** Union-merge two spell lists by startedAt. On a shared startedAt the
 *  CLOSED copy wins (it carries the endedAt); between two closed
 *  copies the later endedAt wins. Sorted, capped at the last
 *  MODE_SPELLS_CAP spells. */
export function mergeModeSpells(a, b) {
  const byStart = new Map()
  const put = (s) => {
    if (!isValidSpell(s)) return
    const clean = { mode: s.mode, startedAt: s.startedAt, endedAt: Number.isFinite(ts(s.endedAt)) ? s.endedAt : null }
    const prev = byStart.get(clean.startedAt)
    if (!prev) { byStart.set(clean.startedAt, clean); return }
    if (prev.mode !== clean.mode) return // same start, different mode: keep the first seen (a's)
    const prevEnd = prev.endedAt ? ts(prev.endedAt) : -Infinity
    const cleanEnd = clean.endedAt ? ts(clean.endedAt) : -Infinity
    if (cleanEnd > prevEnd) byStart.set(clean.startedAt, clean)
  }
  for (const s of Array.isArray(a) ? a : []) put(s)
  for (const s of Array.isArray(b) ? b : []) put(s)
  const sorted = [...byStart.values()].sort((x, y) => ts(x.startedAt) - ts(y.startedAt))
  return sorted.slice(-MODE_SPELLS_CAP)
}

export const normalizeModeSpells = (spells) => mergeModeSpells([], spells)

/** Ensure an open spell exists for `mode` starting at `startedAt`
 *  (seeds the history the first time a mode is observed). */
export function ensureOpenModeSpell(spells, mode, startedAt) {
  const list = normalizeModeSpells(spells)
  if (!mode || !Number.isFinite(ts(startedAt))) return list
  const open = list[list.length - 1]
  if (open && !open.endedAt && open.mode === mode) return list
  if (open && !open.endedAt) open.endedAt = startedAt
  list.push({ mode, startedAt, endedAt: null })
  return list.slice(-MODE_SPELLS_CAP)
}

/** Close the previous mode's spell at `at` and open the next one.
 *  Same mode in → the list comes back unchanged (no duplicate spells). */
export function transitionModeSpells(spells, { previousMode, previousSince, nextMode, at } = {}) {
  if (!nextMode || !Number.isFinite(ts(at))) return normalizeModeSpells(spells)
  if (previousMode === nextMode) return ensureOpenModeSpell(spells, nextMode, previousSince || at)
  let list = normalizeModeSpells(spells)
  const prevStart = Number.isFinite(ts(previousSince)) ? previousSince : at
  list = ensureOpenModeSpell(list, previousMode || nextMode, prevStart)
  const open = list[list.length - 1]
  if (open && !open.endedAt) open.endedAt = at
  list.push({ mode: nextMode, startedAt: at, endedAt: null })
  return list.slice(-MODE_SPELLS_CAP)
}

export function loadModeSpells() {
  try {
    const raw = localStorage.getItem(MODE_SPELLS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? normalizeModeSpells(parsed) : []
  } catch { return [] }
}

export function saveModeSpells(spells) {
  const clean = normalizeModeSpells(spells)
  try {
    const prev = localStorage.getItem(MODE_SPELLS_KEY)
    const next = JSON.stringify(clean)
    if (prev !== next) {
      localStorage.setItem(MODE_SPELLS_KEY, next)
      emitLearnerStateSaved()
    }
  } catch { /* storage unavailable — spells are measurement, never a blocker */ }
  return clean
}

/** The modes.js hook: given the Twin as it was BEFORE this detection
 *  (its stored mode + modeSince) and the mode just computed, record
 *  the spell bookkeeping. Called on every detectMode() run; writes
 *  only when something actually changed. */
export function recordModeSpellsForTwin(prevTwin, nextMode, now = new Date()) {
  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const spells = loadModeSpells()
  const next = (!prevTwin || !prevTwin.mode)
    ? ensureOpenModeSpell(spells, nextMode, at)
    : transitionModeSpells(spells, {
      previousMode: prevTwin.mode,
      previousSince: prevTwin.modeSince,
      nextMode,
      at,
    })
  return saveModeSpells(next)
}

/** Whole days spent in each mode over the last `windowDays`, oldest
 *  spell first in time but returned biggest-first for display. An
 *  open spell counts up to `now`. A positive-duration mode always
 *  reports at least 1 day — a mode entered today is real time in
 *  that mode, and reporting 0d would read as "never happened". */
export function modeSpellsSummary(spells, now = new Date(), windowDays = MODE_SUMMARY_WINDOW_DAYS) {
  const nowMs = ts(now instanceof Date ? now.toISOString() : now)
  if (!Number.isFinite(nowMs)) return []
  const windowStart = nowMs - windowDays * DAY_MS
  const totals = new Map()
  for (const s of normalizeModeSpells(spells)) {
    const start = Math.max(ts(s.startedAt), windowStart)
    const end = Math.min(s.endedAt ? ts(s.endedAt) : nowMs, nowMs)
    if (!(end > start)) continue
    totals.set(s.mode, (totals.get(s.mode) || 0) + (end - start))
  }
  return [...totals.entries()]
    .map(([mode, ms]) => ({ mode, days: Math.max(1, Math.round(ms / DAY_MS)) }))
    .sort((a, b) => b.days - a.days || a.mode.localeCompare(b.mode))
}

// ------------------------------------------------------------ churn evaluator

/** Activity days (YYYY-MM-DD strings) from the metrics record — the
 *  only activity evidence the product honestly keeps. */
export function activityDaysFromMetrics(metrics) {
  const days = new Set()
  for (const e of Array.isArray(metrics) ? metrics : []) {
    const at = typeof e?.at === 'string' ? e.at : ''
    if (/^\d{4}-\d{2}-\d{2}/.test(at)) days.add(at.slice(0, 10))
  }
  return [...days].sort()
}

const dayStartMs = (dayStr) => ts(`${dayStr}T00:00:00.000Z`)

/**
 * The Doc 11 churn definition, as a pure evaluator: a learner churns
 * when a BAD-WEEK spell is followed by CHURN_SILENCE_DAYS or more
 * days with zero recorded activity before the next recorded activity
 * (or before `now`, when no later activity exists). Only bad-week
 * spells count — a slump followed by silence is not churn. Activity
 * within the silence window clears that spell. Evaluator + docs
 * only: the result is never shown to the learner.
 */
export function evaluateBadWeekChurn(spells, activityDays, now = new Date()) {
  const nowMs = ts(now instanceof Date ? now.toISOString() : now)
  const activityMs = (Array.isArray(activityDays) ? activityDays : [])
    .map((d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? dayStartMs(d) : ts(d)))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
  const badWeekSpells = normalizeModeSpells(spells).filter((s) => s.mode === BAD_WEEK_MODE)
  for (const spell of badWeekSpells) {
    // The silence is measured from the spell's end; for a spell still
    // open, from its start (the learner entered bad week and the
    // record has shown nothing since).
    const from = spell.endedAt ? ts(spell.endedAt) : ts(spell.startedAt)
    if (!Number.isFinite(from)) continue
    const nextActivity = activityMs.find((t) => t > from)
    const silenceEnd = nextActivity !== undefined ? nextActivity : nowMs
    const silentDays = dayFloor(silenceEnd - from)
    if (silentDays >= CHURN_SILENCE_DAYS) {
      return { churned: true, spell, silentDays, badWeekSpells: badWeekSpells.length }
    }
  }
  return { churned: false, spell: null, silentDays: 0, badWeekSpells: badWeekSpells.length }
}

/** The Phase 3 gate for ONE learner, computable end to end:
 *  passes = a Day-30 delta exists AND its total is positive AND the
 *  churn evaluator says no churn. */
export function cohortGateForUser({ diagnosisHistory, modeSpells, activityDays, now = new Date() } = {}) {
  const status = day30Status(diagnosisHistory, now)
  const churn = evaluateBadWeekChurn(modeSpells, activityDays, now)
  const delta = status.state === 'delta' ? status.delta : null
  return {
    delta,
    deltaPositive: !!delta && delta.total > 0,
    churned: churn.churned,
    passes: !!delta && delta.total > 0 && !churn.churned,
  }
}

// ------------------------------------------------------------ first-week feedback stamp

export function loadFirstWeekFeedbackStamp() {
  try {
    const raw = localStorage.getItem(FIRST_WEEK_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return { dismissals: 0 }
    return {
      dismissals: Number.isFinite(Number(parsed.dismissals)) ? Math.max(0, Number(parsed.dismissals)) : 0,
      answeredAt: parsed.answeredAt || null,
      chip: parsed.chip || null,
      lastDismissedAt: parsed.lastDismissedAt || null,
    }
  } catch { return { dismissals: 0 } }
}

export function saveFirstWeekFeedbackStamp(stamp) {
  try { localStorage.setItem(FIRST_WEEK_KEY, JSON.stringify(stamp)) } catch { /* ignore */ }
  return stamp
}

/**
 * Should the first-week question show? Only inside the day
 * FIRST_WEEK_START_DAY..FIRST_WEEK_END_DAY window after the FIRST
 * diagnosis, only until it is answered, and only until it has been
 * dismissed FIRST_WEEK_MAX_DISMISSALS times. The wording is fixed in
 * the i18n catalogs (today.firstWeek.*) so cohort answers compare.
 */
export function firstWeekFeedbackStatus({ diagnosisHistory, stamp, now = new Date() } = {}) {
  const s = stamp && typeof stamp === 'object' ? stamp : { dismissals: 0 }
  if (s.answeredAt) return { show: false, reason: 'answered', daysSinceFirst: null }
  if ((s.dismissals || 0) >= FIRST_WEEK_MAX_DISMISSALS) return { show: false, reason: 'dismissed', daysSinceFirst: null }
  const first = firstDiagnosis(diagnosisHistory)
  if (!first) return { show: false, reason: 'no-diagnosis', daysSinceFirst: null }
  const days = dayFloor(ts(now) - ts(first.at))
  if (days < FIRST_WEEK_START_DAY) return { show: false, reason: 'too-early', daysSinceFirst: days }
  if (days > FIRST_WEEK_END_DAY) return { show: false, reason: 'window-passed', daysSinceFirst: days }
  return { show: true, reason: 'in-window', daysSinceFirst: days }
}

export function recordFirstWeekDismissal(stamp, now = new Date()) {
  const s = stamp && typeof stamp === 'object' ? stamp : { dismissals: 0 }
  return {
    ...s,
    dismissals: (s.dismissals || 0) + 1,
    lastDismissedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  }
}

export function recordFirstWeekAnswer(stamp, chip, now = new Date()) {
  const s = stamp && typeof stamp === 'object' ? stamp : { dismissals: 0 }
  return {
    ...s,
    answeredAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    chip: chip || null,
  }
}
