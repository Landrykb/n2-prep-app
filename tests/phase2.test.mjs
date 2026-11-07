// Phase 2 node tests (run: TZ=UTC npm run test:phase2, or TZ=UTC node tests/phase2.test.mjs)
//
// 1. Slot determinism: the server port (supabase/functions/call-scheduler/
//    slot.ts) must agree with the client (src/lib/calls.js) on the exact
//    slot minute for every date/window — a one-minute disagreement means
//    the push rings for a slot the app doesn't have.
// 2. Timezone conversion: the UTC instant the scheduler computes must be
//    the same wall-clock minute in the user's timezone, incl. DST days.
// 3. Twin merge guard: an older/equal cloud Twin never overwrites local.

import assert from 'node:assert'

const client = await import('../src/lib/calls.js')
const port = await import('../supabase/functions/call-scheduler/slot.ts')
const { pickNewerTwin } = await import('../src/lib/twinMerge.js')
const { todayStr } = await import('../src/lib/session.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const WINDOWS = [
  { start: '08:00', end: '09:30' },
  { start: '12:30', end: '14:00' },
  { start: '19:00', end: '21:00' },
  { start: '07:15', end: '07:45' },
  { start: '22:00', end: '22:00' }, // degenerate: end <= start → 30 min rule
  { start: '06:00', end: '06:10' }, // tiny span (end-start-5 = 5)
]
const DATES = ['2026-11-05', '2026-01-01', '2026-03-08', '2026-11-01', '2027-06-30', '2026-02-28']

console.log('slot determinism (client vs server port, TZ=UTC):')
for (const date of DATES) {
  for (let w = 0; w < WINDOWS.length; w++) {
    check(`${date} window ${w}`, () => {
      const clientDate = client.slotDateFor(date, WINDOWS[w], w)
      const minute = port.slotMinuteOfDay(date, WINDOWS[w], w)
      assert.equal(clientDate.getUTCHours() * 60 + clientDate.getUTCMinutes(), minute)
      assert.equal(port.zonedSlotToUtc(date, minute, 'UTC').getTime(), clientDate.getTime())
      assert.equal(port.dateHash(`${date}|call|${w}`), client.dateHash(`${date}|call|${w}`))
    })
  }
}

console.log('timezone conversion (same wall-clock minute in the user tz):')
const wallMinute = (instant, tz) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(instant)
  const p = {}
  for (const part of parts) p[part.type] = part.value
  return (+p.hour) * 60 + (+p.minute)
}
for (const tz of ['Asia/Tokyo', 'America/New_York', 'Europe/Paris', 'Pacific/Auckland']) {
  for (const date of DATES) {
    check(`${tz} ${date}`, () => {
      const minute = port.slotMinuteOfDay(date, WINDOWS[0], 0)
      const instant = port.zonedSlotToUtc(date, minute, tz)
      assert.equal(wallMinute(instant, tz), minute)
      assert.equal(port.localDateStr(instant, tz), date)
    })
  }
}

console.log('todaysSlots mirrors ensureToday (count + instants):')
check('2 calls/day over 3 windows', () => {
  const now = new Date('2026-11-05T12:00:00Z')
  const state = { settings: { enabled: true, callsPerDay: 2, windows: WINDOWS.slice(0, 3), persistence: 'standard', senseiName: 'Sensei' }, days: {}, history: [] }
  const withDay = client.ensureToday(state, now)
  const day = withDay.days[todayStr(now)]
  const serverSlots = port.todaysSlots({ windows: WINDOWS.slice(0, 3), callsPerDay: 2 }, todayStr(now), 'UTC')
  assert.equal(day.slots.length, 2)
  assert.equal(serverSlots.length, 2)
  day.slots.forEach((slot, i) => {
    assert.equal(new Date(slot.at).getTime(), serverSlots[i].atUtc.getTime())
    assert.equal(slot.windowIndex, serverSlots[i].windowIndex)
  })
})
check('a slot born more than an hour stale starts skipped; a fresh one stays pending', () => {
  // Day created at 12:00Z. Window A (07:00-08:00) slots before
  // 11:00 are born-expired; window B (11:30-13:00) is fresh.
  const now = new Date('2026-11-05T12:00:00Z')
  const state = { settings: { enabled: true, callsPerDay: 2, windows: [{ start: '07:00', end: '08:00' }, { start: '11:30', end: '13:00' }], persistence: 'standard', senseiName: 'Sensei' }, days: {}, history: [] }
  const day = client.ensureToday(state, now).days[todayStr(now)]
  assert.equal(day.slots.length, 2)
  assert.equal(day.slots[0].status, 'skipped', 'morning slot created at noon never rings')
  assert.equal(day.slots[1].status, 'pending', 'the fresh slot can still catch up')
})
check('slot id is stable and namespaced', () => {
  assert.equal(port.slotIdFor('u1', '2026-11-05', 2), 'u1|2026-11-05|2')
})

console.log('twin merge guard (pickNewerTwin):')
const T = (iso) => (iso ? { updatedAt: iso } : {})
check('strictly newer cloud wins', () => assert.equal(pickNewerTwin(T('2026-11-05T10:00:00Z'), T('2026-11-05T11:00:00Z')), 'cloud'))
check('older cloud never overwrites local', () => assert.equal(pickNewerTwin(T('2026-11-05T11:00:00Z'), T('2026-11-05T10:00:00Z')), 'local'))
check('equal timestamps keep local', () => assert.equal(pickNewerTwin(T('2026-11-05T11:00:00Z'), T('2026-11-05T11:00:00Z')), 'local'))
check('no cloud row keeps local', () => assert.equal(pickNewerTwin(T('2026-11-05T11:00:00Z'), null), 'local'))
check('no local twin adopts cloud', () => assert.equal(pickNewerTwin(null, T('2026-11-05T11:00:00Z')), 'cloud'))
check('undated cloud never overwrites dated local', () => assert.equal(pickNewerTwin(T('2026-11-05T11:00:00Z'), T(null)), 'local'))
check('undated local yields to dated cloud', () => assert.equal(pickNewerTwin(T(null), T('2026-11-05T11:00:00Z')), 'cloud'))

console.log(`\n${passed} checks passed`)

// 4. Scheduler auth helper: legacy service_role JWT recognition.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (payload) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(payload)}.sig`
check('service_role JWT for this project is recognised', () =>
  assert.equal(port.isServiceRoleJwtForProject(jwt({ role: 'service_role', ref: 'rcckuxwvqgtyvovwpxaw' }), 'rcckuxwvqgtyvovwpxaw'), true))
check('anon JWT is not recognised as service_role', () =>
  assert.equal(port.isServiceRoleJwtForProject(jwt({ role: 'anon', ref: 'rcckuxwvqgtyvovwpxaw' }), 'rcckuxwvqgtyvovwpxaw'), false))
check('service_role JWT for ANOTHER project is rejected', () =>
  assert.equal(port.isServiceRoleJwtForProject(jwt({ role: 'service_role', ref: 'otherproject' }), 'rcckuxwvqgtyvovwpxaw'), false))
check('non-JWT values are rejected', () => {
  assert.equal(port.isServiceRoleJwtForProject('sb_secret_abc', 'rcckuxwvqgtyvovwpxaw'), false)
  assert.equal(port.isServiceRoleJwtForProject('', 'rcckuxwvqgtyvovwpxaw'), false)
  assert.equal(port.isServiceRoleJwtForProject('a.b.c', 'rcckuxwvqgtyvovwpxaw'), false)
})
// 5. Twin working-level estimate (src/lib/twinEstimate.js, Doc 04 §5
// note): a weighted-median vote over the evidence the Twin already
// holds. Pure and deterministic; it must NEVER be able to outvote the
// diagnosis into the promise — these checks pin the vote maths, the
// conservative tie-break, and the confidence volume labels.
const est = await import('../src/lib/twinEstimate.js')
const gradItems = (band, n) => Array.from({ length: n }, (_, i) => ({ front: `${band}-${i}`, level: band, fsrs: { reps: 3 } }))

console.log('twin working-level estimate (weighted median over evidence):')
check('no evidence at all: no band, low confidence — never a guess', () => {
  const r = est.estimateWorkingLevel({})
  assert.equal(r.band, null)
  assert.equal(r.confidence, 'low')
  assert.deepEqual(r.signals, { diagnosis: null, queue: null, reader: null, speaking: null })
  assert.equal(est.estimateWorkingLevel().band, null)
  assert.equal(est.estimateWorkingLevel(null).band, null)
})
check('diagnosis alone: its band, but low confidence (a snapshot is not volume)', () => {
  const r = est.estimateWorkingLevel({ diagnosisBand: 'N2' })
  assert.equal(r.band, 'N2')
  assert.equal(r.confidence, 'low') // 2 points: a snapshot alone is not volume
  assert.equal(r.signals.diagnosis, 'N2')
})
check('junk bands are ignored everywhere — not-a-level never votes', () => {
  const r = est.estimateWorkingLevel({ diagnosisBand: 'N9', declaredBand: 'beginner', queueItems: gradItems('N7', 30) })
  assert.equal(r.band, null)
  assert.equal(r.confidence, 'low')
})
check('queue mastery: the highest band with >=10 graduated items votes', () => {
  const queue = [...gradItems('N5', 40), ...gradItems('N4', 12), ...gradItems('N3', 9)]
  const r = est.estimateWorkingLevel({ queueItems: queue })
  assert.equal(r.signals.queue, 'N4') // N3 has only 9 graduated — not proven
  assert.equal(r.band, 'N4')
  assert.equal(r.counts.graduatedLevelled, 61)
})
check('queue mastery: fresh or unlevelled items cast no vote', () => {
  const fresh = Array.from({ length: 20 }, (_, i) => ({ front: `f${i}`, level: 'N2', fsrs: { reps: 0 } }))
  const unlevelled = Array.from({ length: 20 }, (_, i) => ({ front: `u${i}`, level: '', fsrs: { reps: 5 } }))
  const r = est.estimateWorkingLevel({ queueItems: [...fresh, ...unlevelled] })
  assert.equal(r.signals.queue, null)
  assert.equal(r.band, null)
})
check('weighted median: a lone strong signal cannot outvote the rest', () => {
  // Diagnosis N1 (w3) vs queue N4 (w2) + reader N4 (w2): total 7, half
  // 3.5 — cumulative reaches it only AT N1 (2+2=4 ≥ 3.5 after N4…
  // sorted ascending: N4 cum 4 ≥ 3.5 → N4 wins). The median holds.
  const r = est.estimateWorkingLevel({
    diagnosisBand: 'N1',
    declaredBand: 'N4', lastGoodStep: 0,
    queueItems: gradItems('N4', 15),
  })
  assert.equal(r.band, 'N4')
})
check('weighted median: an exact tie resolves DOWNWARD (conservative)', () => {
  // Queue N4 (w2) vs reader N2 (w2): total 4, half 2 — N4's cumulative
  // reaches half first in ascending order, so the lower band wins.
  const r = est.estimateWorkingLevel({ declaredBand: 'N2', lastGoodStep: 0, queueItems: gradItems('N4', 12) })
  assert.equal(r.signals.reader, 'N2')
  assert.equal(r.band, 'N4')
})
check('reader vote: the PROVEN step (last_good_step), never the trial step', () => {
  const proven = est.estimateWorkingLevel({ declaredBand: 'N3', lastGoodStep: 1 })
  assert.equal(proven.signals.reader, 'N2') // declared N3, proven one notch up
  const settled = est.estimateWorkingLevel({ declaredBand: 'N3', lastGoodStep: -1 })
  assert.equal(settled.signals.reader, 'N4')
  const clamped = est.estimateWorkingLevel({ declaredBand: 'N1', lastGoodStep: 1 })
  assert.equal(clamped.signals.reader, 'N1') // the ladder clamps
  const junkStep = est.estimateWorkingLevel({ declaredBand: 'N3', lastGoodStep: 'soon' })
  assert.equal(junkStep.signals.reader, 'N3') // a junk step shifts nothing
})
check('speaking vote: sustained decent attempts corroborate the served band', () => {
  const r = est.estimateWorkingLevel({ diagnosisBand: 'N3', speaking: { attempts: 6, avgBest: 72 } })
  assert.equal(r.signals.speaking, 'N3')
  assert.equal(r.band, 'N3')
  // Too few attempts, too low an average, or no served band: silent.
  assert.equal(est.estimateWorkingLevel({ diagnosisBand: 'N3', speaking: { attempts: 4, avgBest: 90 } }).signals.speaking, null)
  assert.equal(est.estimateWorkingLevel({ diagnosisBand: 'N3', speaking: { attempts: 9, avgBest: 40 } }).signals.speaking, null)
  assert.equal(est.estimateWorkingLevel({ speaking: { attempts: 9, avgBest: 90 } }).signals.speaking, null)
})
check('confidence grows with independent evidence volume', () => {
  const rich = est.estimateWorkingLevel({
    diagnosisBand: 'N3',
    declaredBand: 'N3', lastGoodStep: 0,
    queueItems: gradItems('N3', 35),
    speaking: { attempts: 12, avgBest: 80 },
  })
  assert.equal(rich.confidence, 'high') // 2 + 2 (deep queue) + 1 + 1 = 6 points
  assert.equal(rich.band, 'N3')
  const mid = est.estimateWorkingLevel({ diagnosisBand: 'N3', declaredBand: 'N3', lastGoodStep: 0 })
  assert.equal(mid.confidence, 'medium') // diagnosis 2 + reader 1 = 3 points
})
// ---------------------------------------------------------------
// The Loop stats (src/lib/loopStats.js): every number the fleet
// loop surface shows must trace to a real Twin field or a real
// metrics event. Empty in → nulls out (never a flattering zero);
// Tsuku has no local source and must stay null forever.
const loop = await import('../src/lib/loopStats.js')

const emptyTwin = {
  sections: {}, speaking: { attempts: 0, masteredScenes: 0 },
  fingerprint: {}, vocab: { queueTotal: 0, graduated: 0, fresh: 0, bySource: {} },
  rhythm: { callsKept: 0, callsMissed: 0, sessionLog: [] }, mode: 'cruise',
}
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-07T12:00:00Z')

check('loop: a fresh twin yields no stats, only the mode line', () => {
  const s = loop.agentLoopStats({ twin: emptyTwin })
  assert.equal(s.michi.stat, null)
  assert.equal(s.michi.detail, 'Mode: Cruise')
  assert.equal(s.saki.stat, null)
  assert.equal(s.koe.stat, null)
  assert.equal(s.nao.stat, null)
  assert.equal(s.hori.stat, null)
  assert.equal(s.tsuku.stat, null)
  assert.deepEqual(loop.loopCentre(emptyTwin), { queueTotal: 0, graduated: 0, fresh: 0 })
  assert.equal(loop.weekStrip([], NOW).hasData, false)
})
check('loop: koe prefers kept calls, falls back to speaking attempts', () => {
  const withCalls = loop.agentLoopStats({ twin: { ...emptyTwin, rhythm: { callsKept: 3 }, speaking: { attempts: 9, masteredScenes: 2 } } })
  assert.equal(withCalls.koe.stat, '3 calls taken')
  assert.equal(withCalls.koe.detail, '2 scenes mastered in Voice Loop')
  const attemptsOnly = loop.agentLoopStats({ twin: { ...emptyTwin, speaking: { attempts: 1 } } })
  assert.equal(attemptsOnly.koe.stat, '1 speaking attempt')
})
check('loop: nao sums the fingerprint and names the top pattern', () => {
  const twin = { ...emptyTwin, fingerprint: { a: { count: 2 }, b: { count: 5 }, c: {} } }
  const s = loop.agentLoopStats({ twin, topPattern: { label: 'を vs に' } })
  assert.equal(s.nao.stat, '7 slips spotted')
  assert.equal(s.nao.detail, 'Your current one fix: を vs に')
})
check('loop: hori counts reader + mining queue items, with the split', () => {
  const twin = { ...emptyTwin, vocab: { queueTotal: 12, graduated: 3, fresh: 4, bySource: { reader: 4, mining: 6, manual: 2 } } }
  const s = loop.agentLoopStats({ twin })
  assert.equal(s.hori.stat, '10 words mined into your queue')
  assert.equal(s.hori.detail, '4 from the Reader · 6 from your documents')
  assert.deepEqual(loop.loopCentre(twin), { queueTotal: 12, graduated: 3, fresh: 4 })
})
check('loop: saki reads only a SAVED tomorrow plan', () => {
  const s = loop.agentLoopStats({ twin: emptyTwin, tomorrowPlan: { minutes: 12, note: 'Hospital scene — 8 cards.' } })
  assert.equal(s.saki.stat, '~12 min planned for tomorrow')
  assert.equal(s.saki.detail, 'Hospital scene — 8 cards.')
})
check('loop: michi counts real checkups and carries mode + estimate', () => {
  const metrics = [
    { type: 'diagnosis_completed', at: NOW.toISOString() },
    { type: 'diagnosis_completed', at: NOW.toISOString() },
    { type: 'session_completed', at: NOW.toISOString(), minutes: 9, proof: 1 },
  ]
  const s = loop.agentLoopStats({ twin: { ...emptyTwin, mode: 'badweek' }, metrics, workingLevel: { band: 'N3' } })
  assert.equal(s.michi.stat, '2 checkups read')
  assert.equal(s.michi.detail, 'Mode: Bad Week · working level N3 (an estimate, from your activity)')
})
check('loop: week strip counts only the last 7 days, tiles capped at 3', () => {
  const metrics = [
    { type: 'session_completed', at: new Date(NOW - 1 * DAY).toISOString(), minutes: 20, proof: 2 },
    { type: 'session_completed', at: new Date(NOW - 8 * DAY).toISOString(), minutes: 99, proof: 9 }, // too old — excluded
    { type: 'word_mined', at: new Date(NOW - 2 * DAY).toISOString(), count: 5 },
    { type: 'word_mined', at: new Date(NOW - 2 * DAY).toISOString() }, // no count → 1
    { type: 'call_outcome', at: new Date(NOW - 3 * DAY).toISOString(), outcome: 'kept' },
    { type: 'call_outcome', at: new Date(NOW - 3 * DAY).toISOString(), outcome: 'missed' },
  ]
  const w = loop.weekStrip(metrics, NOW)
  assert.equal(w.hasData, true)
  assert.deepEqual(w.sums, { proof: 2, minutes: 20, mined: 6, calls: 1 })
  assert.deepEqual(w.tiles.map((t) => t.id), ['proof', 'minutes', 'mined']) // priority order, cap 3
})
check('loop: week strip ignores events with no usable timestamp', () => {
  const w = loop.weekStrip([{ type: 'session_completed', minutes: 5, proof: 1 }], NOW)
  assert.equal(w.hasData, false)
})

// ---------------------------------------------------------------
// Level basis (src/lib/levelBasis.js): the shared contract behind
// the TwinView "Your Level" card and the Telegram one-tap question.
// Precedence: diagnosis > declaration > none. 'N7' floors to N5 and,
// while it is the winning basis, puts the learner on foundations
// pace; a diagnosis outranks the tap entirely, pace included.
const basis = await import('../src/lib/levelBasis.js')

check('basis: nothing anywhere → none, standard pace', () => {
  assert.deepEqual(basis.resolveLevelBasis({}), { band: null, source: 'none', rawBand: null, pace: 'standard' })
  assert.deepEqual(basis.resolveLevelBasis({ declaredLevel: { band: 'N9', at: '2026-11-07T00:00:00Z' } }).source, 'none')
})
check('basis: a plain declaration wins when there is no diagnosis', () => {
  const r = basis.resolveLevelBasis({ declaredLevel: { band: 'N2', at: '2026-11-07T00:00:00Z' } })
  assert.deepEqual(r, { band: 'N2', source: 'declared', rawBand: 'N2', pace: 'standard' })
})
check('basis: N7 floors to N5 and switches pace to foundations', () => {
  const r = basis.resolveLevelBasis({ declaredLevel: { band: 'N7', at: '2026-11-07T00:00:00Z' } })
  assert.equal(r.band, 'N5') // consumed at the floor…
  assert.equal(r.rawBand, 'N7') // …but displayed as declared
  assert.equal(r.source, 'declared')
  assert.equal(r.pace, 'foundations')
  assert.equal(basis.normalizeBand('N7'), 'N5')
  assert.equal(basis.normalizeBand('n3'), 'N3')
  assert.equal(basis.normalizeBand('N0'), null)
})
check('basis: a diagnosis outranks any tap — even an N7 one', () => {
  const r = basis.resolveLevelBasis({
    diagnosisBand: 'N3',
    declaredLevel: { band: 'N7', at: '2026-11-07T00:00:00Z' },
  })
  assert.deepEqual(r, { band: 'N3', source: 'diagnosis', rawBand: 'N3', pace: 'standard' })
})
check('basis: a junk diagnosis falls through to the declaration', () => {
  const r = basis.resolveLevelBasis({ diagnosisBand: 'expert', declaredLevel: { band: 'N4', at: '2026-11-07T00:00:00Z' } })
  assert.equal(r.source, 'declared')
  assert.equal(r.band, 'N4')
})

// ---------------------------------------------------------------
// Telegram Mini App bridge decision (src/lib/telegramAuth.js):
// signed Telegram identity is a door key, never a second account
// system. The exchange happens only when the function's linked
// account differs from the webview's current session.
const telegramAuth = await import('../src/lib/telegramAuth.js')

check('telegram bridge: no signed Telegram launch → ordinary web behaviour', () => {
  assert.equal(
    telegramAuth.telegramBridgeDecision({ hasInitData: false, functionUserId: 'user-1', sessionUserId: null }),
    'not-telegram',
  )
  assert.equal(telegramAuth.getTelegramInitData({ Telegram: { WebApp: {} } }), '')
})
check('telegram bridge: signed launch with no linked account → not-linked', () => {
  assert.equal(
    telegramAuth.telegramBridgeDecision({ hasInitData: true, functionUserId: null, sessionUserId: null }),
    'not-linked',
  )
})
check('telegram bridge: the linked account is already signed in → no exchange', () => {
  assert.equal(
    telegramAuth.telegramBridgeDecision({ hasInitData: true, functionUserId: 'user-1', sessionUserId: 'user-1' }),
    'already',
  )
})
check('telegram bridge: an empty webview session → bridge', () => {
  assert.equal(
    telegramAuth.telegramBridgeDecision({ hasInitData: true, functionUserId: 'user-1', sessionUserId: null }),
    'bridge',
  )
})
check('telegram bridge: a different webview account → bridge to the linked account', () => {
  assert.equal(
    telegramAuth.telegramBridgeDecision({ hasInitData: true, functionUserId: 'user-1', sessionUserId: 'user-2' }),
    'bridge',
  )
})
check('telegram bridge: the URL-hash copy of initData parses (script-independent launch identity)', () => {
  const raw = 'query_id=AAE1&user=%7B%22id%22%3A522466354%7D&auth_date=1794000000&hash=abc123'
  const hash = `#tgWebAppData=${encodeURIComponent(raw)}&tgWebAppVersion=7.0&tgWebAppPlatform=ios`
  assert.equal(telegramAuth.initDataFromUrlHash(hash), raw)
  assert.equal(telegramAuth.initDataFromUrlHash('#/reader'), '')
  assert.equal(telegramAuth.initDataFromUrlHash(''), '')
  assert.equal(telegramAuth.initDataFromUrlHash('#tgWebAppVersion=7.0'), '')
})

console.log('encounters — collect derivations + union merge (Fit v2, amendment #10):')
{
  const enc = await import('../src/lib/encounters.js')
  const { mergeEncounters, mergeLearnerState } = await import('../src/lib/stateMerge.js')

  check('ankiEncounterWords: rated cards only (due or positive count)', () => {
    const cards = [
      { id: 'c1', front: '猫' }, { id: 'c2', front: '犬' },
      { id: 'c3', front: '鳥' }, { id: 'c4', front: '魚' },
    ]
    const progress = { due: { c1: '2026-11-08' }, count: { c2: 2, c3: 0 } }
    assert.deepEqual(enc.ankiEncounterWords(progress, cards), ['猫', '犬'])
    assert.deepEqual(enc.ankiEncounterWords(null, cards), [])
    assert.deepEqual(enc.ankiEncounterWords(progress, []), [])
  })

  check('speedEncounterWords: answered prompts only, word half of the key', () => {
    const stats = { '猫|ねこ': { m: 1, h: 2 }, '犬|いぬ': { m: 0, h: 0 }, '鳥|とり': { m: 0, h: 1 } }
    assert.deepEqual(enc.speedEncounterWords(stats), ['猫', '鳥'])
    assert.deepEqual(enc.speedEncounterWords(null), [])
  })

  check('collectEncounterWords is storage-safe with nothing stored', () => {
    assert.deepEqual(enc.collectEncounterWords(), [])
  })

  check('mergeEncounters unions and never shrinks', () => {
    assert.deepEqual(mergeEncounters(['猫', '犬'], ['犬', '鳥']), ['猫', '犬', '鳥'])
    assert.deepEqual(mergeEncounters(['猫', '犬'], []), ['猫', '犬'])
    assert.deepEqual(mergeEncounters([], ['猫']), ['猫'])
    assert.deepEqual(mergeEncounters(null, undefined), [])
    assert.deepEqual(mergeEncounters([' 猫 ', 42, ''], ['猫']), ['猫'])
  })

  check('mergeLearnerState carries encounters as a union slice', () => {
    const merged = mergeLearnerState(
      { encounters: ['猫'] },
      { encounters: ['犬', '猫'] },
    )
    assert.deepEqual(merged.encounters, ['猫', '犬'])
    assert.deepEqual(mergeLearnerState({}, {}).encounters, [])
  })

  check('lensEncounterWords: the Lens store derivation is a plain cleaned list', () => {
    assert.deepEqual(enc.lensEncounterWords([' 語る ', '語る', '', 42, '日本語']), ['語る', '日本語'])
    assert.deepEqual(enc.lensEncounterWords(null), [])
    assert.deepEqual(enc.lensEncounterWords('語る'), [])
    assert.deepEqual(enc.loadLensEncounters(), []) // storage-safe with nothing stored
  })

  check('recordLensEncounters unions into its own store, never shrinks, and collect sees Lens words', () => {
    const store = new Map()
    const prev = globalThis.localStorage
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    }
    try {
      assert.deepEqual(enc.recordLensEncounters(['日本語']), ['日本語'])
      assert.deepEqual(enc.recordLensEncounters(['日本語', '語る']), ['日本語', '語る'])
      assert.deepEqual(enc.recordLensEncounters([]), ['日本語', '語る']) // a later, smaller write never shrinks it
      assert.deepEqual(enc.recordLensEncounters(['日本語']), ['日本語', '語る'])
      assert.deepEqual(enc.loadLensEncounters(), ['日本語', '語る'])
      // The collector — the exact output learnerState puts in the
      // document and buildKnownSet reads — carries the Lens words.
      const collected = enc.collectEncounterWords()
      assert.ok(collected.includes('日本語') && collected.includes('語る'))
      // And the merged document keeps them (union slice, above).
      const merged = mergeLearnerState({ encounters: collected }, { encounters: [] })
      assert.ok(merged.encounters.includes('日本語') && merged.encounters.includes('語る'))
    } finally {
      if (prev === undefined) delete globalThis.localStorage
      else globalThis.localStorage = prev
    }
  })
}


console.log('guest entry + first-run catalogs (Doc 12 audit #1/#2, fixed 2026-11-07):')
{
  const guest = await import('../src/lib/guest.js')
  const { adoptAnonKeys } = await import('../src/lib/anonMerge.js')
  const mkStorage = () => {
    const m = new Map()
    return {
      get length() { return m.size },
      key: (i) => [...m.keys()][i] ?? null,
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    }
  }

  check('guest choice persists on the device (the gate does not return on load)', () => {
    const st = mkStorage()
    assert.equal(guest.loadGuestChoice(st), null)
    const rec = guest.saveGuestChoice(st, new Date('2026-11-07T00:00:00.000Z'))
    assert.equal(rec.at, '2026-11-07T00:00:00.000Z')
    assert.deepEqual(guest.loadGuestChoice(st), rec)
    guest.clearGuestChoice(st)
    assert.equal(guest.loadGuestChoice(st), null)
  })

  check('guest sign-in adopts the guest work via the AuthContext session path (adoptAnonKeys)', () => {
    const st = mkStorage()
    guest.saveGuestChoice(st)
    st.setItem('n2:anon:progress', JSON.stringify({ streak: 4 }))
    st.setItem('n2:anon:settings', JSON.stringify({ furigana: true }))
    // AuthContext's session effect calls exactly this on sign-in.
    assert.equal(adoptAnonKeys('user-1', st), 2)
    assert.equal(JSON.parse(st.getItem('n2:user-1:progress')).streak, 4)
    assert.equal(st.getItem('n2:anon:progress'), null)
    assert.equal(adoptAnonKeys('user-1', st), 0) // idempotent — second sign-in adopts nothing
    // Account data wins over a leftover anon copy.
    st.setItem('n2:anon:progress', JSON.stringify({ streak: 1 }))
    assert.equal(adoptAnonKeys('user-1', st), 0)
    assert.equal(JSON.parse(st.getItem('n2:user-1:progress')).streak, 4)
  })

  const { derivePlan, PERSONAS, PAINS, PROOF_TARGETS } = await import('../src/lib/profile.js')
  const { modeLabel, modeLine } = await import('../src/lib/modes.js')
  const { t: translate } = await import('../src/lib/i18n.js')
  const frTr = (k, v) => translate('fr', k, v)

  check('onboarding option data carries keys that resolve in all three languages', () => {
    for (const entry of [...PERSONAS, ...PAINS, ...PROOF_TARGETS]) {
      for (const lang of ['en', 'fr', 'ja']) {
        assert.notEqual(translate(lang, entry.labelKey), entry.labelKey, `${lang} ${entry.labelKey}`)
        assert.notEqual(translate(lang, entry.descKey), entry.descKey, `${lang} ${entry.descKey}`)
      }
    }
    assert.equal(translate('en', PERSONAS[0].labelKey), 'Resident worker in Japan')
    assert.equal(translate('en', PAINS[1].descKey), 'Recognition is fine — production freezes')
  })

  check('derivePlan English (default translator) is byte-identical to the pre-catalog output', () => {
    const cold = derivePlan(null, null)
    assert.equal(cold.line, 'Tell the app what hurts first — then today’s plan is built around your problem, not around features.')
    assert.deepEqual(cold.actions, [
      { tab: 'diagnosis', label: 'Health-check diagnosis', reason: 'Start with the checkup — 10 minutes' },
      { tab: 'voice', label: 'Voice Loop scene', reason: 'One real scene, spoken out loud' },
      { tab: 'anki', label: 'Review queue (max 10 new)', reason: 'A small, winnable queue' },
    ])
    const noDiag = derivePlan({ persona: 'resident', pains: ['speaking'], proofTarget: 'jlpt' }, null)
    assert.equal(noDiag.line, 'Resident worker in Japan. What hurts: I can read, but I can’t speak. Run the 10-minute diagnosis once, and today’s plan sharpens itself around your weakest section.')
    const withDiag = derivePlan({ persona: 'resident', pains: ['habit'], proofTarget: 'jlpt' }, { jlptEstimate: 'N3', weakest: 'listening' })
    assert.equal(withDiag.line, 'Your problem: my habit keeps breaking. Your checkup says N3 level with listening weakest — today attacks exactly that, on the way to A JLPT level (N5 → N1).')
    assert.deepEqual(withDiag.actions.map((a) => [a.tab, a.label, a.reason]), [
      ['n2listening', 'Listening — one play, no transcript first', 'Your weakest section: listening'],
      ['dashboard', 'Your capped Today session', 'My habit keeps breaking'],
      ['anki', 'Review queue (max 10 new)', 'My habit keeps breaking'],
    ])
    assert.equal(withDiag.focusNote, 'My habit keeps breaking')
  })

  check('derivePlan + modes resolve in French through the caller’s translator', () => {
    const fr = derivePlan({ persona: 'resident', pains: ['habit'], proofTarget: 'jlpt' }, { jlptEstimate: 'N3', weakest: 'listening' }, frTr)
    assert.ok(fr.line.startsWith('Votre problème : mon habitude se brise sans arrêt. Votre bilan dit un niveau N3'), fr.line)
    assert.equal(modeLabel('badweek'), 'Bad Week')
    assert.equal(modeLine('cruise'), 'Steady week. Same small size, same direction — that steadiness is exactly what compounds.')
    assert.equal(modeLabel('event', frTr), 'Approche de l’examen')
  })
}

// ——— I18N ROUND 2 ———
console.log('i18n round 2 — promise mirrors, loop stats, diagnosis draft:')
{
  const { t: tr2 } = await import('../src/lib/i18n.js')
  const enTr2 = (k, v) => tr2('en', k, v)
  const frTr2 = (k, v) => tr2('fr', k, v)
  const { computeSixtyDayPromise, resolvePromiseText } = await import('../src/lib/promise.js')

  const resolveAll = (p, tr) => ({
    height: resolvePromiseText(tr, p.heightKey, p.height),
    reasoning: p.reasoning.map((line, i) => resolvePromiseText(tr, p.reasoningKeys[i], line)),
    plan: p.plan.map((line, i) => resolvePromiseText(tr, p.planKeys[i], line)),
    honesty: resolvePromiseText(tr, { key: p.honestyKey }, p.honesty),
  })

  check('promise (next-level): resolving the key mirrors in EN reproduces the stored text exactly', () => {
    const p = computeSixtyDayPromise({ jlptEstimate: 'N3', sections: { language: 45, reading: 40, listening: 42 }, total: 127 }, {})
    assert.equal(p.kind, 'next-level')
    assert.deepEqual(resolveAll(p, enTr2), { height: p.height, reasoning: p.reasoning, plan: p.plan, honesty: p.honesty })
  })

  check('promise (rescue, section below the line): EN byte-identity incl. nested section label + life line', () => {
    const p = computeSixtyDayPromise({ jlptEstimate: 'N2', sections: { language: 30, reading: 12, listening: 28 }, total: 70 }, {})
    assert.equal(p.kind, 'rescue')
    assert.deepEqual(resolveAll(p, enTr2), { height: p.height, reasoning: p.reasoning, plan: p.plan, honesty: p.honesty })
    assert.ok(p.height.includes('handle one full day of real life'), p.height)
  })

  check('promise (BJT side line + N1 margin): EN byte-identity incl. the note suffix', () => {
    const p = computeSixtyDayPromise({ jlptEstimate: 'N3', sections: { language: 45, reading: 40, listening: 42 }, total: 127, bjtScore: 350, bjtBand: 'J3' }, { pains: ['keigo'] })
    assert.equal(p.reasoning.length, 4)
    assert.ok(p.reasoning[3].includes('next line is 400 (the N2-category line'), p.reasoning[3])
    assert.deepEqual(resolveAll(p, enTr2), { height: p.height, reasoning: p.reasoning, plan: p.plan, honesty: p.honesty })
    const n1 = computeSixtyDayPromise({ jlptEstimate: 'N1', sections: { language: 40, reading: 38, listening: 35 }, total: 113 }, { persona: 'parent' })
    assert.equal(n1.kind, 'n1-margin')
    assert.deepEqual(resolveAll(n1, enTr2), { height: n1.height, reasoning: n1.reasoning, plan: n1.plan, honesty: n1.honesty })
  })

  check('promise: a user-written real-life goal carries no life key and passes through untouched', () => {
    const p = computeSixtyDayPromise({ jlptEstimate: 'N2', sections: { language: 30, reading: 12, listening: 28 }, total: 70 }, { realLifeGoal: 'Survive the PTA meeting' })
    assert.equal(p.lifeKey, null)
    assert.ok(p.height.includes('survive the PTA meeting'), p.height)
    assert.equal(resolvePromiseText(enTr2, p.heightKey, p.height), p.height)
    assert.equal(resolvePromiseText(frTr2, p.heightKey, p.height).includes('survive the PTA meeting'), true)
  })

  check('promise: the same mirrors resolve in French (render-time language, stored record untouched)', () => {
    const p = computeSixtyDayPromise({ jlptEstimate: 'N3', sections: { language: 45, reading: 40, listening: 42 }, total: 127 }, {})
    const fr = resolveAll(p, frTr2)
    assert.ok(fr.height.startsWith('Réussir N2'), fr.height)
    assert.ok(fr.reasoning[0].startsWith('Votre bilan vous estime'), fr.reasoning[0])
    assert.ok(p.height.startsWith('Pass N2'), p.height)
  })

  const { agentLoopStats } = await import('../src/lib/loopStats.js')
  const loopTwin = {
    mode: 'cruise',
    rhythm: { callsKept: 3 },
    speaking: { attempts: 0, masteredScenes: 2 },
    fingerprint: { a: { count: 7 } },
    vocab: { bySource: { reader: 4, mining: 6 } },
  }
  const loopMetrics = [{ type: 'diagnosis_completed', at: new Date().toISOString() }, { type: 'diagnosis_completed', at: new Date().toISOString() }]

  check('loopStats: no translator → English, byte-identical to the pre-catalogue strings', () => {
    const s = agentLoopStats({ twin: loopTwin, metrics: loopMetrics })
    assert.equal(s.michi.stat, '2 checkups read')
    assert.equal(s.michi.detail, 'Mode: Cruise')
    assert.equal(s.saki.stat, null)
    assert.equal(s.koe.stat, '3 calls taken')
    assert.equal(s.koe.detail, '2 scenes mastered in Voice Loop')
    assert.equal(s.nao.stat, '7 slips spotted')
    assert.equal(s.hori.stat, '10 words mined into your queue')
    assert.equal(s.hori.detail, '4 from the Reader · 6 from your documents')
  })

  check('loopStats: a French translator localises every stat and the mode line', () => {
    const s = agentLoopStats({ twin: loopTwin, metrics: loopMetrics, tr: frTr2 })
    assert.equal(s.michi.stat, '2 bilans lus')
    assert.equal(s.michi.detail, 'Mode : Croisière')
    assert.equal(s.koe.stat, '3 appels passés')
    assert.equal(s.koe.detail, '2 scènes maîtrisées dans le Voice Loop')
    assert.equal(s.nao.stat, '7 erreurs repérées')
    assert.equal(s.hori.stat, '10 mots minés vers votre file')
    assert.equal(s.hori.detail, '4 depuis le Reader · 6 depuis vos documents')
  })

  // Diagnosis draft lifecycle (audit #6) with a localStorage fake.
  const store = new Map()
  const prevLS = globalThis.localStorage
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  try {
    const draft = await import('../src/lib/diagnosisDraft.js')
    const runState = { phase: 'quiz', step: 3, levelIdx: 3, current: { kind: 'vocab', level: 'N2', prompt: 'p', options: [] }, answers: [{ level: 'N3', correct: true, kind: 'vocab' }], itemSet: null, lIdx: 0, lCorrect: 0, rIdx: 0, rCorrect: 0, poolNote: '', usedWords: ['猫'] }
    const now = new Date('2026-11-07T10:00:00Z')

    check('diagnosis draft: save → load round-trips the run state, stamped with the bank version', () => {
      assert.equal(draft.saveDiagnosisDraft(runState, now), true)
      const loaded = draft.loadDiagnosisDraft(now)
      assert.ok(loaded)
      assert.equal(loaded.bankVersion, 1)
      assert.deepEqual(loaded.state, runState)
    })

    check('diagnosis draft: a draft 7 days old or older is refused; 6 days is fine', () => {
      assert.ok(draft.loadDiagnosisDraft(new Date('2026-11-13T09:59:59Z')))
      assert.equal(draft.loadDiagnosisDraft(new Date('2026-11-14T10:00:00Z')), null)
      assert.equal(draft.isDraftFresh(draft.makeDiagnosisDraft(runState, now), new Date('2026-11-20T10:00:00Z')), false)
    })

    check('diagnosis draft: bank-version mismatch and malformed drafts are refused', () => {
      const stale = draft.makeDiagnosisDraft(runState, now); stale.bankVersion = 99
      store.set(draft.DIAGNOSIS_DRAFT_KEY, JSON.stringify(stale))
      assert.equal(draft.loadDiagnosisDraft(now), null)
      store.set(draft.DIAGNOSIS_DRAFT_KEY, '{not json')
      assert.equal(draft.loadDiagnosisDraft(now), null)
      store.set(draft.DIAGNOSIS_DRAFT_KEY, JSON.stringify({ v: 1, bankVersion: 1, savedAt: now.toISOString(), state: { phase: 'result', answers: [] } }))
      assert.equal(draft.loadDiagnosisDraft(now), null)
      store.set(draft.DIAGNOSIS_DRAFT_KEY, JSON.stringify({ v: 1, bankVersion: 1, savedAt: now.toISOString(), state: { phase: 'quiz', answers: [], current: null } }))
      assert.equal(draft.loadDiagnosisDraft(now), null)
    })

    check('diagnosis draft: clear removes it (finish / start-over path)', () => {
      draft.saveDiagnosisDraft(runState, now)
      assert.ok(draft.loadDiagnosisDraft(now))
      draft.clearDiagnosisDraft()
      assert.equal(draft.loadDiagnosisDraft(now), null)
    })
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prevLS
  }
}

console.log(`\nphase2: ${passed} checks passed (incl. scheduler-auth)`)
