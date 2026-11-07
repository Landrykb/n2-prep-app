// Planner shadow-mode tests (run: TZ=UTC npm run test:planner-shadow)
// Pins for Doc 05 §5.1 + Doc 08 §4 (Saki row), Phase 3 step 2:
//  1. The contract twin (planner-shadow/contract.ts): request
//     validation against the REAL twin summary shape, prompt
//     assembly, and the strict output contract — pool references,
//     mode equality, date equality, item-count window, cardBudget
//     consistency, experiment echo-only. A hallucinated id anywhere
//     discards the whole plan.
//  2. The client wiring (plannerShadow.js): flag, once-per-local-day
//     stamp, pair ring log, the planner_shadow metric shape, the
//     runner's skip paths — all with fakes; no network.
//  3. The outcome scorer: completions come from real records only
//     (queue FSRS lastReview dates; the day's session state), and
//     the AI number is would-have-matched, never performance.

import assert from 'node:assert'

const contract = await import('../supabase/functions/planner-shadow/contract.ts')
const shadow = await import('../src/lib/plannerShadow.js')
const twin = await import('../src/lib/twin.js')
const modes = await import('../src/lib/modes.js')
const session = await import('../src/lib/session.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }
const checkAsync = async (name, fn) => { await fn(); passed++; console.log(`  ok ${name}`) }

// ------------------------------------------------------------ fixtures
const POOLS = {
  scenes: [
    { id: 'hospital-symptom', title: 'At the hospital' },
    { id: 'city-certificate', title: 'Residence certificate' },
    { id: 'meeting-delay', title: 'Running late' },
  ],
  cards: [
    { id: 'q1', front: '転入届' },
    { id: 'q2', front: '予約' },
    { id: 'q3', front: '熱がある' },
    { id: 'q4', front: '窓' },
    { id: 'q5', front: '傘' },
    { id: 'q6', front: '切符' },
  ],
  listening: [
    { id: 'コンビニで', title: 'コンビニで' },
    { id: '会社での打ち合わせ', title: '会社での打ち合わせ' },
  ],
  focus: [
    { id: 'counter-documents', label: 'Counter for documents (通・枚)' },
    { id: 'listening-negation', label: 'Listening: negatives' },
  ],
}

const TWIN_SUMMARY = {
  level: 'N3 (est.)',
  sections: { language: 30, reading: 40, listening: 20 },
  weakestSection: 'listening',
  mode: 'cruise',
  topFingerprint: [{ pattern: 'counter-documents', weight: 0.7 }],
  proofTarget: 'jlpt',
  dueCount: 9,
}

const RULES_PLAN = {
  forDate: '2026-11-08',
  opener: { kind: 'scene', sceneId: 'city-certificate' },
  sceneTitle: 'Residence certificate',
  cardIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
  cardBudget: 5,
  listeningItemId: 'コンビニで',
  listeningTitle: 'コンビニで',
  focusPattern: 'counter-documents',
  focusLabel: 'Counter for documents (通・枚)',
  experiment: null,
  mode: 'cruise',
  comeback: false,
  minutes: 8,
  source: 'rules-v1',
  createdAt: '2026-11-07T12:00:00.000Z',
  consumed: false,
  note: 'Residence certificate — 5 cards, one listening bite, about 8 minutes.',
}

const AI_RAW = {
  forDate: '2026-11-08',
  opener: { kind: 'scene', sceneId: 'hospital-symptom' },
  cardIds: ['q2', 'q3', 'q6'],
  cardBudget: 3,
  listeningItemId: '会社での打ち合わせ',
  focusPattern: 'listening-negation',
  experiment: null,
  mode: 'cruise',
  minutes: 6,
  note: 'Leans on the listening weakness.',
}
const CTX = { rulesPlan: RULES_PLAN, pools: POOLS }
const normalised = contract.validatePlannerOutput(AI_RAW, CTX)
assert.equal(normalised.ok, true, 'fixture AI plan must validate')
const AI_PLAN = normalised.plan

console.log('contract twin — modes + request validation:')
check('PLAN_MODES equals the code mode ids (modes.js MODES), order included', () => {
  assert.deepEqual(contract.PLAN_MODES, Object.keys(modes.MODES))
})
check('a well-formed request validates; pool entries normalise to {id, label}', () => {
  const r = contract.validatePlannerRequest({ twinSummary: TWIN_SUMMARY, rulesPlan: RULES_PLAN, pools: POOLS })
  assert.equal(r.ok, true)
  assert.deepEqual(r.value.pools.cards[0], { id: 'q1', label: '転入届' })
  assert.deepEqual(r.value.pools.scenes[0], { id: 'hospital-symptom', label: 'At the hospital' })
})
check('the REAL twinSummaryForAi output passes request validation (contract = code shape)', () => {
  const prev = globalThis.localStorage
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  try {
    const summary = twin.twinSummaryForAi(twin.loadTwin())
    assert.equal(typeof summary.dueCount, 'number')
    const r = contract.validatePlannerRequest({ twinSummary: summary, rulesPlan: { ...RULES_PLAN, mode: summary.mode }, pools: POOLS })
    assert.equal(r.ok, true, JSON.stringify(r))
  } finally {
    if (prev === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prev
  }
})
check('mode anchor mismatch (twin summary vs rules plan) is rejected — the pair is not shadowable', () => {
  const r = contract.validatePlannerRequest({
    twinSummary: { ...TWIN_SUMMARY, mode: 'slump' }, rulesPlan: RULES_PLAN, pools: POOLS,
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'mode_anchor_mismatch')
})
check('bad twin summary / bad rules plan / duplicated pool id are rejected with named reasons', () => {
  assert.equal(contract.validatePlannerRequest({ twinSummary: { mode: 'cruise' }, rulesPlan: RULES_PLAN, pools: POOLS }).reason, 'twin_summary_invalid')
  assert.equal(contract.validatePlannerRequest({ twinSummary: { ...TWIN_SUMMARY, mode: 'party' }, rulesPlan: RULES_PLAN, pools: POOLS }).reason, 'twin_mode_invalid')
  assert.equal(contract.validatePlannerRequest({ twinSummary: TWIN_SUMMARY, rulesPlan: { ...RULES_PLAN, cardIds: 'q1' }, pools: POOLS }).reason, 'rules_plan_invalid')
  const dupPools = { ...POOLS, cards: [...POOLS.cards, { id: 'q1', front: 'duplicate' }] }
  assert.equal(contract.validatePlannerRequest({ twinSummary: TWIN_SUMMARY, rulesPlan: RULES_PLAN, pools: dupPools }).reason, 'pools_invalid')
})
check('prompt assembly: static system first (contract, no learner data), learner data last', () => {
  const req = contract.validatePlannerRequest({ twinSummary: TWIN_SUMMARY, rulesPlan: RULES_PLAN, pools: POOLS }).value
  const msgs = contract.buildPlannerMessages(req)
  assert.equal(msgs[0].role, 'system')
  assert.ok(msgs[0].content.includes('invented id discards the whole plan'))
  assert.ok(!msgs[0].content.includes('city-certificate') && !msgs[0].content.includes('counter-documents'))
  assert.ok(msgs[1].content.includes('city-certificate'))
  assert.ok(msgs[1].content.includes('"dueCount":9'))
})

console.log('contract twin — the strict output contract:')
check('a valid AI plan validates and is normalised: titles/labels resolved from pools, source stamped', () => {
  assert.equal(AI_PLAN.sceneTitle, 'At the hospital')
  assert.equal(AI_PLAN.listeningTitle, '会社での打ち合わせ')
  assert.equal(AI_PLAN.focusLabel, 'Listening: negatives')
  assert.equal(AI_PLAN.source, 'ai-shadow-v1')
  assert.equal(AI_PLAN.mode, 'cruise')
  assert.deepEqual(AI_PLAN.cardIds, ['q2', 'q3', 'q6'])
})
check('hallucinated references discard the whole plan (scene / card / listening / focus)', () => {
  const v = (patch) => contract.validatePlannerOutput({ ...AI_RAW, ...patch }, CTX)
  assert.equal(v({ opener: { kind: 'scene', sceneId: 'invented-scene' } }).reason, 'scene_not_in_pool')
  assert.equal(v({ cardIds: ['q2', 'qX'], cardBudget: 2 }).reason, 'card_not_in_pool')
  assert.equal(v({ listeningItemId: 'invented-bite' }).reason, 'listening_not_in_pool')
  assert.equal(v({ focusPattern: 'word-order' }).reason, 'focus_not_in_pool')
})
check('mode override and date change are rejected — the spine owns both', () => {
  assert.equal(contract.validatePlannerOutput({ ...AI_RAW, mode: 'surge' }, CTX).reason, 'mode_mismatch')
  assert.equal(contract.validatePlannerOutput({ ...AI_RAW, forDate: '2026-11-09' }, CTX).reason, 'fordate_mismatch')
})
check('item-count window: rules 7 items — 5 passes (boundary), 3 fails', () => {
  assert.equal(contract.planItemCount(RULES_PLAN), 7)
  assert.equal(contract.validatePlannerOutput(AI_RAW, CTX).ok, true) // 5 items, |5-7| = 2
  const tiny = { ...AI_RAW, cardIds: ['q2'], cardBudget: 1 } // 3 items
  assert.equal(contract.validatePlannerOutput(tiny, CTX).reason, 'item_count_out_of_window')
})
check('cardBudget must equal the card count; duplicated cards are rejected', () => {
  assert.equal(contract.validatePlannerOutput({ ...AI_RAW, cardBudget: 4 }, CTX).reason, 'cardbudget_mismatch')
  assert.equal(contract.validatePlannerOutput({ ...AI_RAW, cardIds: ['q2', 'q2'], cardBudget: 2 }, CTX).reason, 'duplicate_card')
})
check('experiment is echo-only: inventing one fails, changing one fails, echoing passes whole', () => {
  const exp = { id: 'exp-1', variable: 'card-budget', variant: '3', variantLabel: '3-card days' }
  const rulesExp = { ...RULES_PLAN, experiment: exp, cardIds: ['q1', 'q2', 'q3'], cardBudget: 3 }
  const ctxExp = { rulesPlan: rulesExp, pools: POOLS }
  assert.equal(contract.validatePlannerOutput({ ...AI_RAW, experiment: { variable: 'scene-source', variant: 'problem-first' } }, CTX).reason, 'experiment_not_allowed')
  assert.equal(contract.validatePlannerOutput({ ...AI_RAW, experiment: { variable: 'card-budget', variant: '5' } }, ctxExp).reason, 'experiment_mismatch')
  const echoed = contract.validatePlannerOutput({ ...AI_RAW, experiment: { variable: 'card-budget', variant: '3' } }, ctxExp)
  assert.equal(echoed.ok, true)
  assert.deepEqual(echoed.plan.experiment, exp) // the full code-owned object rides through
})
check('fenced model JSON parses end-to-end; garbage is unparseable; bad shapes are named', () => {
  const fenced = '```json\n' + JSON.stringify(AI_RAW) + '\n```'
  assert.equal(contract.planFromModelText(fenced, CTX).ok, true)
  assert.equal(contract.planFromModelText('the plan is basically fine', CTX).reason, 'unparseable')
  assert.equal(contract.planFromModelText('{"forDate":"2026-11-08"}', CTX).reason, 'plan_shape_invalid')
  assert.equal(contract.planFromModelText('[1,2]', CTX).reason, 'not_an_object')
})
check('planItemRefs parity: contract twin and client helper agree exactly', () => {
  assert.deepEqual(contract.planItemRefs(RULES_PLAN), shadow.planItemRefs(RULES_PLAN))
  assert.deepEqual(contract.planItemRefs(AI_PLAN), shadow.planItemRefs(AI_PLAN))
  assert.deepEqual(shadow.planItemRefs(RULES_PLAN), [
    'scene:city-certificate', 'card:q1', 'card:q2', 'card:q3', 'card:q4', 'card:q5', 'listening:コンビニで',
  ])
})

console.log('client wiring (fakes only — no network):')
const fakeStorage = () => {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map }
}
const TODAY = '2026-11-07'
check('flag ships enabled; the cap is the documented once per local day', () => {
  assert.equal(shadow.PLANNER_SHADOW_ENABLED, true)
  assert.equal(shadow.PLANNER_SHADOW_DAILY_CAP, 1)
  assert.equal(shadow.PLANNER_SHADOW_LOG_CAP, 14)
})
check('stamp state: fresh day starts at 0, next-day rollover resets, count increments, cap blocks', () => {
  assert.deepEqual(shadow.shadowStampFor(null, TODAY), { date: TODAY, count: 0 })
  assert.deepEqual(shadow.shadowStampFor({ date: '2026-11-06', count: 1 }, TODAY), { date: TODAY, count: 0 })
  assert.deepEqual(shadow.nextShadowStamp({ date: TODAY, count: 0 }, TODAY), { date: TODAY, count: 1 })
  assert.equal(shadow.canShadowPlan({ date: TODAY, count: 1 }, TODAY), false)
  assert.equal(shadow.canShadowPlan({ date: TODAY, count: 0 }, TODAY), true)
})
check('pair log: appends, replaces a same-date pair, and rings at the cap', () => {
  let log = []
  log = shadow.appendShadowPair(log, { date: '2026-11-08', rulesPlan: RULES_PLAN, aiPlan: AI_PLAN })
  assert.equal(log.length, 1)
  const ai2 = { ...AI_PLAN, minutes: 9 }
  log = shadow.appendShadowPair(log, { date: '2026-11-08', rulesPlan: RULES_PLAN, aiPlan: ai2 })
  assert.equal(log.length, 1)
  assert.equal(log[0].aiPlan.minutes, 9)
  for (let d = 9; d <= 22; d++) {
    log = shadow.appendShadowPair(log, { date: `2026-11-${d}`, rulesPlan: RULES_PLAN, aiPlan: AI_PLAN })
  }
  assert.equal(log.length, shadow.PLANNER_SHADOW_LOG_CAP)
  assert.equal(log[log.length - 1].date, '2026-11-22')
})
check('metric shape: item counts + overlap share of the RULES plan, nothing else', () => {
  assert.deepEqual(shadow.shadowMetricFor(RULES_PLAN, AI_PLAN), { rulesItems: 7, aiItems: 5, overlap: 0.286 })
  assert.equal(shadow.overlapFor(RULES_PLAN, RULES_PLAN), 1)
})
check('pools mirror what planner.js chooses among: session cards + re-wins, listening by title, focus from the Twin', () => {
  const future = new Date(Date.now() + 86400000).toISOString()
  const past = new Date(Date.now() - 86400000).toISOString()
  const queue = [
    ...['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((id) => ({ id, front: `front-${id}`, fsrs: { reps: 0, due: past, lastReview: null } })),
    { id: 'm1', front: 'front-m1', fsrs: { reps: 3, due: future, lastReview: past } },
  ]
  const fakeTwin = { fingerprint: { 'counter-documents': { count: 2, recentWeight: 0.9, lastSeenAt: past, example: '' } } }
  const pools = shadow.buildPlannerPools({ queue, twin: fakeTwin })
  const cardIds = pools.cards.map((c) => c.id)
  assert.ok(cardIds.includes('m1'), 're-win pool (reps ≥ 2) is in the pool even when not due')
  assert.ok(cardIds.includes('f1') && cardIds.includes('f5'), 'session cards are in the pool')
  assert.ok(!cardIds.includes('f6'), 'the sixth fresh card is beyond the session cap and out of the pool')
  assert.equal(pools.cards.find((c) => c.id === 'm1').front, 'front-m1')
  assert.ok(pools.scenes.length > 10 && pools.scenes.every((s) => s.id && s.title))
  assert.ok(pools.listening.length > 5 && pools.listening.every((l) => l.id === l.title), 'listening items carry no id — the title is the id')
  assert.deepEqual(pools.focus, [{ id: 'counter-documents', label: 'Counter for documents (通・枚)' }])
})

const baseDeps = (over = {}) => ({
  storage: fakeStorage(),
  today: TODAY,
  getSession: async () => ({ user: { id: 'u1' } }),
  invoke: async () => ({ ok: true, plan: AI_PLAN }),
  metric: () => {},
  ...over,
})
const INPUT = { twinSummary: TWIN_SUMMARY, rulesPlan: RULES_PLAN, pools: POOLS }

await checkAsync('a signed-in, unstamped shadow run stores the pair and logs the metric', async () => {
  const logged = []
  const storage = fakeStorage()
  const ran = await shadow.runPlannerShadow(INPUT, baseDeps({ storage, metric: (t, p) => logged.push([t, p]) }))
  assert.equal(ran, true)
  assert.deepEqual(logged, [['planner_shadow', { rulesItems: 7, aiItems: 5, overlap: 0.286 }]])
  const log = JSON.parse(storage.map.get(shadow.PLANNER_SHADOW_KEY))
  assert.equal(log.length, 1)
  assert.equal(log[0].date, '2026-11-08')
  assert.deepEqual(log[0].aiPlan, AI_PLAN)
  assert.equal(JSON.parse(storage.map.get(shadow.PLANNER_SHADOW_STAMP_KEY)).count, 1)
})
await checkAsync('the once-a-day stamp blocks a second run the same day (plan rebuilds cannot multiply Tier A calls)', async () => {
  let calls = 0
  const storage = fakeStorage()
  const deps = baseDeps({ storage, invoke: async () => { calls += 1; return { ok: true, plan: AI_PLAN } } })
  assert.equal(await shadow.runPlannerShadow(INPUT, deps), true)
  assert.equal(await shadow.runPlannerShadow(INPUT, deps), false)
  assert.equal(calls, 1)
})
await checkAsync('disabled / signed-out / incomplete input skip silently without invoking', async () => {
  let calls = 0
  const counting = async () => { calls += 1; return { ok: true, plan: AI_PLAN } }
  assert.equal(await shadow.runPlannerShadow(INPUT, baseDeps({ enabled: false, invoke: counting })), false)
  assert.equal(await shadow.runPlannerShadow(INPUT, baseDeps({ getSession: async () => null, invoke: counting })), false)
  assert.equal(await shadow.runPlannerShadow({ twinSummary: TWIN_SUMMARY, rulesPlan: RULES_PLAN }, baseDeps({ invoke: counting })), false)
  assert.equal(calls, 0)
})
await checkAsync('function failure / invalid AI answer / transport throws resolve false, store nothing, never reject', async () => {
  const storage = fakeStorage()
  assert.equal(await shadow.runPlannerShadow(INPUT, baseDeps({ storage, invoke: async () => ({ ok: false, reason: 'invalid_output:mode_mismatch' }) })), false)
  assert.equal(await shadow.runPlannerShadow(INPUT, baseDeps({ storage, invoke: async () => { throw new Error('offline') } })), false)
  assert.equal(storage.map.has(shadow.PLANNER_SHADOW_KEY), false)
})

console.log('outcome scorer (real records only; the AI number is would-have-matched):')
check('completed refs: cards from FSRS lastReview dates; scene/listening only from that date\u2019s session state', () => {
  const today = session.todayStr()
  const yesterday = session.todayStr(new Date(Date.now() - 86400000))
  const queue = [
    { id: 'q1', fsrs: { reps: 2, lastReview: new Date().toISOString() } },
    { id: 'q2', fsrs: { reps: 1, lastReview: new Date(Date.now() - 86400000).toISOString() } },
    { id: 'q3', fsrs: { reps: 0, lastReview: null } },
  ]
  const refsToday = shadow.completedRefsForDate(today, { queue })
  assert.deepEqual([...refsToday], ['card:q1'])
  const refsYesterday = shadow.completedRefsForDate(yesterday, { queue })
  assert.deepEqual([...refsYesterday], ['card:q2'])
  const withSession = shadow.completedRefsForDate(today, {
    queue,
    sessionState: { date: today, sceneId: 'city-certificate', sceneDone: true, listeningPicked: 1, listeningTitle: 'コンビニで' },
  })
  assert.ok(withSession.has('scene:city-certificate') && withSession.has('listening:コンビニで'))
  const staleSession = shadow.completedRefsForDate(today, {
    queue,
    sessionState: { date: yesterday, sceneId: 'city-certificate', sceneDone: true, listeningPicked: 1, listeningTitle: 'コンビニで' },
  })
  assert.ok(!staleSession.has('scene:city-certificate'), 'a stale session state proves nothing about today')
})
check('pair scoring: rulesFollowed counts the shown plan\u2019s completions; the AI fraction is overlap-with-reality', () => {
  const done = new Set(['scene:city-certificate', 'card:q1', 'card:q2', 'listening:コンビニで', 'card:q6'])
  const s = shadow.scoreShadowPair({ date: '2026-11-08', rulesPlan: RULES_PLAN, aiPlan: AI_PLAN }, done)
  assert.equal(s.rulesItems, 7)
  assert.equal(s.rulesFollowed, 0.571) // scene + q1 + q2 + listening = 4/7
  assert.equal(s.aiItems, 5)
  assert.equal(s.aiWouldHaveMatched, 0.4) // q2 + q6 = 2/5 — never "performance"
})
check('log scoring: pairs without a completion record are unscored, not zero; means cover scored pairs only', () => {
  const done = new Set(['scene:city-certificate', 'card:q1', 'card:q2', 'listening:コンビニで', 'card:q6'])
  const log = [
    { date: '2026-11-08', rulesPlan: RULES_PLAN, aiPlan: AI_PLAN },
    { date: '2026-11-09', rulesPlan: RULES_PLAN, aiPlan: AI_PLAN },
  ]
  const r = shadow.scoreShadowLog(log, { '2026-11-08': done })
  assert.equal(r.pairs, 1)
  assert.equal(r.unscored, 1)
  assert.equal(r.meanRulesFollowed, 0.571)
  assert.equal(r.meanAiWouldHaveMatched, 0.4)
  assert.deepEqual(shadow.scoreShadowLog([], {}), {
    scored: [], unscored: 0, pairs: 0, meanRulesFollowed: null, meanAiWouldHaveMatched: null,
  })
})

console.log(`\nplanner-shadow: ${passed} checks passed`)
