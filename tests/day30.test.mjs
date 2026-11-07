// Cohort readiness tests (run: TZ=UTC npm run test:day30)
// Pins for Phase 3 step 4 (Doc 11 §7, Doc 12):
//  1. Day-30 eligibility windows: the checkup card waits until day 30;
//     a second diagnosis only qualifies from day 25 on.
//  2. Delta computation: total + per-section, UNCLAMPED (a negative
//     delta is data), missing sections yield null, never 0.
//  3. History capping: the first diagnosis is pinned forever.
//  4. Mode spells: transitions close/open exactly one spell each, no
//     duplicates on a repeated detection; the stateMerge twin of the
//     merge rule agrees with day30's.
//  5. The churn evaluator: bad week + 7 silent days = churn; activity
//     inside the window clears it; a slump is never churn.
//  6. First-week feedback stamp logic: shows days 7–10 only, hides
//     after an answer or two dismissals.

import assert from 'node:assert'

const day30 = await import('../src/lib/day30.js')
const stateMerge = await import('../src/lib/stateMerge.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-10-01T00:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()
const diag = (atMs, total, sections = { language: 30, reading: 30, listening: 30 }) => ({
  at: iso(atMs), jlptEstimate: 'N3', total, sections, weakest: 'listening', bjtScore: null, bjtBand: null,
})

// ------------------------------------------------------------ eligibility
console.log('day-30 eligibility windows:')
check('constants are the documented windows', () => {
  assert.equal(day30.FIRST_WINDOW_DAYS, 30)
  assert.equal(day30.SECOND_EARLIEST_DAY, 25)
})
check('no diagnosis → state none', () => {
  assert.equal(day30.day30Status([], new Date(T0)).state, 'none')
  assert.equal(day30.day30Status(null, new Date(T0)).state, 'none')
})
check('day 24 after the first diagnosis: still waiting, no card', () => {
  const s = day30.day30Status([diag(T0, 90)], new Date(T0 + 24 * DAY))
  assert.equal(s.state, 'waiting')
  assert.equal(s.daysSinceFirst, 24)
})
check('day 29: still waiting; day 30: checkup due', () => {
  assert.equal(day30.day30Status([diag(T0, 90)], new Date(T0 + 29 * DAY)).state, 'waiting')
  const due = day30.day30Status([diag(T0, 90)], new Date(T0 + 30 * DAY))
  assert.equal(due.state, 'checkup-due')
  assert.equal(due.daysSinceFirst, 30)
})
check('a second diagnosis at day 24 does NOT qualify (before day 25)', () => {
  const h = [diag(T0, 90), diag(T0 + 24 * DAY, 95)]
  assert.equal(day30.qualifyingSecondDiagnosis(h), null)
  assert.equal(day30.day30Status(h, new Date(T0 + 40 * DAY)).state, 'checkup-due')
})
check('a second diagnosis at day 26 counts — delta state from then on', () => {
  const h = [diag(T0, 90), diag(T0 + 26 * DAY, 99)]
  const s = day30.day30Status(h, new Date(T0 + 26 * DAY))
  assert.equal(s.state, 'delta')
  assert.equal(s.second.at, iso(T0 + 26 * DAY))
  assert.equal(s.delta.total, 9)
})
check('an early re-check does not consume the slot: first qualifying second wins', () => {
  const h = [diag(T0, 90), diag(T0 + 10 * DAY, 92), diag(T0 + 31 * DAY, 101)]
  const s = day30.day30Status(h, new Date(T0 + 31 * DAY))
  assert.equal(s.state, 'delta')
  assert.equal(s.second.at, iso(T0 + 31 * DAY))
  assert.equal(s.delta.days, 31)
})
check('history order does not matter — records are sorted by timestamp', () => {
  const h = [diag(T0 + 26 * DAY, 99), diag(T0, 90)]
  assert.equal(day30.day30Status(h, new Date(T0 + 26 * DAY)).state, 'delta')
})

// ------------------------------------------------------------ delta maths
console.log('delta computation:')
check('total + per-section deltas from the two stored records', () => {
  const d = day30.computeDiagnosisDelta(
    diag(T0, 90, { language: 30, reading: 35, listening: 25 }),
    diag(T0 + 30 * DAY, 104, { language: 38, reading: 33, listening: 33 }),
  )
  assert.equal(d.total, 14)
  assert.deepEqual(d.sections, { language: 8, reading: -2, listening: 8 })
  assert.equal(d.days, 30)
})
check('a NEGATIVE delta is returned as-is — never clamped to zero', () => {
  const d = day30.computeDiagnosisDelta(diag(T0, 100), diag(T0 + 30 * DAY, 88))
  assert.equal(d.total, -12)
  const s = day30.day30Status([diag(T0, 100), diag(T0 + 30 * DAY, 88)], new Date(T0 + 30 * DAY))
  assert.equal(s.delta.total, -12)
})
check('a section missing on either side yields null, not an invented 0', () => {
  const d = day30.computeDiagnosisDelta(
    diag(T0, 90, { language: 30, reading: 30 }),
    diag(T0 + 30 * DAY, 95, { language: 33, reading: 31, listening: 20 }),
  )
  assert.equal(d.sections.listening, null)
  assert.equal(d.sections.language, 3)
})
check('garbage records produce no delta', () => {
  assert.equal(day30.computeDiagnosisDelta(null, diag(T0, 90)), null)
  assert.equal(day30.computeDiagnosisDelta(diag(T0, 90), { at: 'junk' }), null)
})

// ------------------------------------------------------------ history cap
console.log('diagnosis history cap (first diagnosis pinned):')
check('appending beyond the cap keeps the FIRST diagnosis and the newest', () => {
  let h = []
  for (let i = 0; i < day30.DIAGNOSIS_HISTORY_CAP + 6; i++) h = day30.appendDiagnosisHistory(h, diag(T0 + i * DAY, 90 + i))
  assert.equal(h.length, day30.DIAGNOSIS_HISTORY_CAP)
  assert.equal(h[0].at, iso(T0)) // the anchor survives
  assert.equal(h[h.length - 1].at, iso(T0 + (day30.DIAGNOSIS_HISTORY_CAP + 5) * DAY))
  // …and the Day-30 delta stays computable against the true first record.
  assert.equal(day30.firstDiagnosis(h).total, 90)
})
check('the merge-side cap (stateMerge) pins the first diagnosis too', () => {
  const many = Array.from({ length: 30 }, (_, i) => diag(T0 + i * DAY, 90 + i))
  const merged = stateMerge.mergeDiagnosisHistory(many.slice(0, 15), many.slice(15))
  assert.equal(merged.length, 24)
  assert.equal(merged[0].at, iso(T0))
})
check('a same-instant append replaces rather than duplicates', () => {
  const h = day30.appendDiagnosisHistory([diag(T0, 90)], diag(T0, 93))
  assert.equal(h.length, 1)
  assert.equal(h[0].total, 93)
})

// ------------------------------------------------------------ mode spells
console.log('mode spells:')
const spell = (mode, startMs, endMs = null) => ({ mode, startedAt: iso(startMs), endedAt: endMs ? iso(endMs) : null })
check('a transition closes the previous spell and opens the next', () => {
  const out = day30.transitionModeSpells([], { previousMode: 'cruise', previousSince: iso(T0), nextMode: 'slump', at: iso(T0 + 5 * DAY) })
  assert.equal(out.length, 2)
  assert.deepEqual(out[0], spell('cruise', T0, T0 + 5 * DAY))
  assert.deepEqual(out[1], spell('slump', T0 + 5 * DAY))
})
check('recording the SAME mode again adds no duplicate spell', () => {
  const once = day30.transitionModeSpells([], { previousMode: 'cruise', previousSince: iso(T0), nextMode: 'cruise', at: iso(T0 + 2 * DAY) })
  const twice = day30.transitionModeSpells(once, { previousMode: 'cruise', previousSince: iso(T0), nextMode: 'cruise', at: iso(T0 + 3 * DAY) })
  assert.equal(twice.length, 1)
  assert.equal(twice[0].endedAt, null)
})
check('a chain of transitions yields one closed spell per mode run', () => {
  let s = day30.transitionModeSpells([], { previousMode: 'cruise', previousSince: iso(T0), nextMode: 'slump', at: iso(T0 + 5 * DAY) })
  s = day30.transitionModeSpells(s, { previousMode: 'slump', previousSince: iso(T0 + 5 * DAY), nextMode: 'badweek', at: iso(T0 + 9 * DAY) })
  assert.equal(s.length, 3)
  assert.equal(s[1].endedAt, iso(T0 + 9 * DAY))
  assert.equal(s[2].mode, 'badweek')
  assert.equal(s[2].endedAt, null)
})
check('merge: union by startedAt, the closed copy wins a shared start', () => {
  const a = [spell('cruise', T0)]
  const b = [spell('cruise', T0, T0 + 5 * DAY), spell('slump', T0 + 5 * DAY)]
  const merged = day30.mergeModeSpells(a, b)
  assert.equal(merged.length, 2)
  assert.equal(merged[0].endedAt, iso(T0 + 5 * DAY))
})
check('stateMerge.mergeModeSpells agrees with day30.mergeModeSpells', () => {
  const a = [spell('cruise', T0), spell('badweek', T0 + 9 * DAY)]
  const b = [spell('cruise', T0, T0 + 9 * DAY), spell('slump', T0 + 20 * DAY)]
  assert.deepEqual(stateMerge.mergeModeSpells(a, b), day30.mergeModeSpells(a, b))
  const mergedState = stateMerge.mergeLearnerState({ modeSpells: a }, { modeSpells: b })
  assert.deepEqual(mergedState.modeSpells, day30.mergeModeSpells(a, b))
})
check('spells are capped at the last MODE_SPELLS_CAP', () => {
  let s = []
  for (let i = 0; i < day30.MODE_SPELLS_CAP + 4; i++) {
    s = day30.transitionModeSpells(s, {
      previousMode: i % 2 ? 'slump' : 'cruise', previousSince: iso(T0 + i * DAY),
      nextMode: i % 2 ? 'cruise' : 'slump', at: iso(T0 + (i + 1) * DAY),
    })
  }
  assert.ok(s.length <= day30.MODE_SPELLS_CAP)
})
check('summary: durations inside the 30-day window, open spell counts to today', () => {
  const now = new Date(T0 + 30 * DAY)
  const s = [
    spell('cruise', T0 - 40 * DAY, T0 + 12 * DAY), // only 12 of its days are in-window… from window start (T0) to T0+12
    spell('slump', T0 + 12 * DAY, T0 + 18 * DAY),
    spell('badweek', T0 + 18 * DAY), // open: counts to today = 12 days
  ]
  const summary = day30.modeSpellsSummary(s, now)
  const byMode = Object.fromEntries(summary.map((r) => [r.mode, r.days]))
  assert.equal(byMode.slump, 6)
  assert.equal(byMode.badweek, 12)
  assert.equal(byMode.cruise, 12)
})
check('recordModeSpellsForTwin: seeds on first sight, transitions on change, silent on repeat', () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  try {
    day30.recordModeSpellsForTwin({ mode: 'cruise', modeSince: iso(T0) }, 'cruise', new Date(T0))
    let spells = day30.loadModeSpells()
    assert.equal(spells.length, 1)
    assert.equal(spells[0].mode, 'cruise')
    day30.recordModeSpellsForTwin({ mode: 'cruise', modeSince: iso(T0) }, 'cruise', new Date(T0 + DAY))
    assert.equal(day30.loadModeSpells().length, 1) // no duplicate
    day30.recordModeSpellsForTwin({ mode: 'cruise', modeSince: iso(T0) }, 'badweek', new Date(T0 + 6 * DAY))
    spells = day30.loadModeSpells()
    assert.equal(spells.length, 2)
    assert.equal(spells[0].endedAt, iso(T0 + 6 * DAY))
    assert.equal(spells[1].mode, 'badweek')
  } finally {
    delete globalThis.localStorage
  }
})

// ------------------------------------------------------------ churn evaluator
console.log('churn evaluator (Doc 11 definition):')
const dayStr = (ms) => iso(ms).slice(0, 10)
check('bad week followed by 7+ silent days = churn', () => {
  const spells = [spell('badweek', T0, T0 + 3 * DAY)]
  const r = day30.evaluateBadWeekChurn(spells, [], new Date(T0 + 20 * DAY))
  assert.equal(r.churned, true)
  assert.ok(r.silentDays >= 7)
})
check('bad week + activity inside the 7 days = no churn', () => {
  const spells = [spell('badweek', T0, T0 + 3 * DAY)]
  const r = day30.evaluateBadWeekChurn(spells, [dayStr(T0 + 5 * DAY)], new Date(T0 + 20 * DAY))
  assert.equal(r.churned, false)
})
check('bad week + silence of only 6 days so far = no churn yet', () => {
  const spells = [spell('badweek', T0, T0 + 3 * DAY)]
  const r = day30.evaluateBadWeekChurn(spells, [], new Date(T0 + 9 * DAY))
  assert.equal(r.churned, false)
})
check('a SLUMP followed by silence is not churn — only bad-week spells count', () => {
  const spells = [spell('slump', T0, T0 + 3 * DAY)]
  const r = day30.evaluateBadWeekChurn(spells, [], new Date(T0 + 40 * DAY))
  assert.equal(r.churned, false)
  assert.equal(r.badWeekSpells, 0)
})
check('activity days derive from the metrics record', () => {
  const days = day30.activityDaysFromMetrics([
    { type: 'session_completed', at: iso(T0) },
    { type: 'session_completed', at: iso(T0 + 2 * 3600000) }, // same day
    { type: 'call_outcome', at: iso(T0 + DAY) },
    { type: 'bogus', at: 'not-a-date' },
  ])
  assert.deepEqual(days, [dayStr(T0), dayStr(T0 + DAY)])
})
check('the gate: positive delta + no churn passes; either failure fails it', () => {
  const good = day30.cohortGateForUser({
    diagnosisHistory: [diag(T0, 90), diag(T0 + 30 * DAY, 101)],
    modeSpells: [spell('cruise', T0)],
    activityDays: [dayStr(T0 + 10 * DAY)],
    now: new Date(T0 + 30 * DAY),
  })
  assert.equal(good.passes, true)
  const flat = day30.cohortGateForUser({
    diagnosisHistory: [diag(T0, 90), diag(T0 + 30 * DAY, 88)],
    modeSpells: [], activityDays: [], now: new Date(T0 + 30 * DAY),
  })
  assert.equal(flat.deltaPositive, false)
  assert.equal(flat.passes, false)
  const churned = day30.cohortGateForUser({
    diagnosisHistory: [diag(T0, 90), diag(T0 + 30 * DAY, 101)],
    modeSpells: [spell('badweek', T0 + 5 * DAY, T0 + 8 * DAY)],
    activityDays: [], now: new Date(T0 + 30 * DAY),
  })
  assert.equal(churned.churned, true)
  assert.equal(churned.passes, false)
})

// ------------------------------------------------------------ first-week stamp
console.log('first-week feedback stamp:')
const stamp = (over = {}) => ({ dismissals: 0, ...over })
check('before day 7: too early; days 7 and 10: shows; day 11: window passed', () => {
  const h = [diag(T0, 90)]
  assert.equal(day30.firstWeekFeedbackStatus({ diagnosisHistory: h, stamp: stamp(), now: new Date(T0 + 6 * DAY) }).reason, 'too-early')
  assert.equal(day30.firstWeekFeedbackStatus({ diagnosisHistory: h, stamp: stamp(), now: new Date(T0 + 7 * DAY) }).show, true)
  assert.equal(day30.firstWeekFeedbackStatus({ diagnosisHistory: h, stamp: stamp(), now: new Date(T0 + 10 * DAY) }).show, true)
  assert.equal(day30.firstWeekFeedbackStatus({ diagnosisHistory: h, stamp: stamp(), now: new Date(T0 + 11 * DAY) }).reason, 'window-passed')
})
check('no diagnosis yet: never shows', () => {
  assert.equal(day30.firstWeekFeedbackStatus({ diagnosisHistory: [], stamp: stamp(), now: new Date(T0 + 8 * DAY) }).show, false)
})
check('after an answer: never shows again', () => {
  const answered = day30.recordFirstWeekAnswer(stamp(), 'no-time', new Date(T0 + 7 * DAY))
  assert.equal(answered.chip, 'no-time')
  assert.equal(day30.firstWeekFeedbackStatus({ diagnosisHistory: [diag(T0, 90)], stamp: answered, now: new Date(T0 + 8 * DAY) }).reason, 'answered')
})
check('one dismissal still shows; the second dismissal hides it for good', () => {
  const h = [diag(T0, 90)]
  const once = day30.recordFirstWeekDismissal(stamp(), new Date(T0 + 7 * DAY))
  assert.equal(day30.firstWeekFeedbackStatus({ diagnosisHistory: h, stamp: once, now: new Date(T0 + 8 * DAY) }).show, true)
  const twice = day30.recordFirstWeekDismissal(once, new Date(T0 + 8 * DAY))
  assert.equal(twice.dismissals, 2)
  assert.equal(day30.firstWeekFeedbackStatus({ diagnosisHistory: h, stamp: twice, now: new Date(T0 + 9 * DAY) }).reason, 'dismissed')
})

console.log(`\n${passed} checks passed`)
