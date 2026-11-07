// Coach shadow-mode tests (run: TZ=UTC npm run test:coach-shadow)
// Pins for Doc 05 §9.1 + Doc 08 §4.2, Phase 3 step 3:
//  1. The contract twin (coach-shadow/contract.ts): request
//     validation against the REAL twin summary shape, prompt
//     assembly, and the strict output contract — the rules letter's
//     shape, week/mode equality, every numeral checked against the
//     facts, the promise/guarantee and no-shame blocklists, the
//     quiet-mode contradiction proxy, citedNumbers echo-only.
//     One invented number discards the whole letter.
//  2. The client wiring (coachShadow.js): flag, once-per-ISO-week
//     stamp, pair ring log, the coach_shadow metric shape, the
//     runner's skip paths — all with fakes; no network.
//  3. The comparison helper: sharedFactReferences counts the fact
//     numerals both letters cite — a similarity signal, not quality.

import assert from 'node:assert'

const contract = await import('../supabase/functions/coach-shadow/contract.ts')
const shadow = await import('../src/lib/coachShadow.js')
const twin = await import('../src/lib/twin.js')
const modes = await import('../src/lib/modes.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }
const checkAsync = async (name, fn) => { await fn(); passed++; console.log(`  ok ${name}`) }

// ------------------------------------------------------------ fixtures
const TWIN_SUMMARY = {
  level: 'N3 (est.)',
  sections: { language: 30, reading: 40, listening: 20 },
  weakestSection: 'listening',
  mode: 'cruise',
  topFingerprint: [{ pattern: 'counter-documents', weight: 0.7 }],
  proofTarget: 'jlpt',
  dueCount: 9,
}

const FACTS = {
  weekStart: '2026-11-02',
  mode: 'cruise',
  modeLabel: 'Cruise',
  sessionCount: 5,
  minutes: 42,
  proof: 7,
  callsKept: 3,
  callsTotal: 4,
  diagnosis: { totalDelta: 6, toTotal: 96, sections: { language: 2, reading: 3, listening: 1 } },
  topPattern: { id: 'counter-documents', label: 'Counter for documents (通・枚)', plain: 'Documents take 通 or 枚.', count: 8 },
  learningStyleNote: null,
  citedNumbers: { sessionCount: 5, minutes: 42, proof: 7, callsKept: 3, callsTotal: 4, diagnosisTotalDelta: 6, topPatternCount: 8 },
}

const RULES_LETTER = {
  weekStart: '2026-11-02',
  generatedAt: '2026-11-07T01:00:00.000Z',
  mode: 'cruise',
  modeLabel: 'Cruise',
  paragraphs: [
    'This week you showed up 5 times for about 42 minutes of practice, and those sessions earned 7 proof points.',
    'Koe, your sensei, reached you 4 times and you kept 3 of those calls.',
    'Between your last two health checks, the movement is: total up 6 at 96/180 (estimate, as always).',
    'The slip Nao, your fixer, keeps meeting most has shown up 8 times so far.',
    'Next week is the same shape as this one, on purpose.',
    '— Michi, your coach. I walk the road with you; the numbers above are quoted exactly.',
  ],
  citedNumbers: { ...FACTS.citedNumbers },
  source: 'rules-v1',
}

const AI_RAW = {
  weekStart: '2026-11-02',
  mode: 'cruise',
  paragraphs: [
    'You showed up 5 times this week, for about 42 minutes, and earned 7 proof points — kept, not crammed.',
    'Koe reached you 4 times and you kept 3 of those calls.',
    'Your last two checkups moved up 6 in total, to 96/180 — a short sample, quoted exactly.',
    'The slip Nao meets most has appeared 8 times; it will keep arriving inside real scenes.',
    'Next week keeps this shape: steady, small, yours.',
    '— Michi, your coach.',
  ],
  citedNumbers: { sessionCount: 5, callsKept: 3 },
}
const CTX = { rulesLetter: RULES_LETTER, weekFacts: FACTS, twinSummary: TWIN_SUMMARY, nowIso: '2026-11-07T02:00:00.000Z' }
const normalised = contract.validateCoachOutput(AI_RAW, CTX)
assert.equal(normalised.ok, true, `fixture AI letter must validate (got ${JSON.stringify(normalised)})`)
const AI_LETTER = normalised.letter

const FACTS_BW = {
  ...FACTS,
  mode: 'badweek',
  modeLabel: 'Bad Week',
  sessionCount: 0,
  minutes: 0,
  proof: 0,
  callsKept: 0,
  callsTotal: 0,
  diagnosis: null,
  topPattern: null,
  citedNumbers: { sessionCount: 0, minutes: 0, proof: 0, callsKept: 0, callsTotal: 0 },
}
const RULES_BW = {
  ...RULES_LETTER,
  mode: 'badweek',
  modeLabel: 'Bad Week',
  paragraphs: [
    'This week is quiet in the record — no sessions and no calls kept. That happens.',
    'Next week asks for one tiny win a day, from your strongest ground.',
    '— Michi, your coach.',
  ],
  citedNumbers: { ...FACTS_BW.citedNumbers },
}
const CTX_BW = { rulesLetter: RULES_BW, weekFacts: FACTS_BW, twinSummary: { ...TWIN_SUMMARY, mode: 'badweek' }, nowIso: CTX.nowIso }
const AI_BW_CLEAN = {
  weekStart: '2026-11-02',
  mode: 'badweek',
  paragraphs: [
    'This week is quiet in the record. Nothing piled up while you were away, and nothing needs catching up.',
    'Next week asks for one tiny win a day, from your strongest ground. When life settles, we re-check where you stand.',
    '— Michi, your coach.',
  ],
  citedNumbers: {},
}

console.log('contract twin — modes, blocklists, request validation:')
check('COACH_MODES equals the code mode ids (modes.js MODES), order included', () => {
  assert.deepEqual(contract.COACH_MODES, Object.keys(modes.MODES))
})
check('blocklists are exactly the documented lists', () => {
  assert.deepEqual(contract.PROMISE_BLOCKLIST, ['guarantee', 'guaranteed', 'will pass', '合格保証', '保証'])
  assert.deepEqual(contract.SHAME_BLOCKLIST, ['lazy', 'failed you', 'disappointed', 'shame'])
  assert.deepEqual(contract.MODE_CONTRADICTION_WORDS, ['surge', 'intensive'])
})
check('a well-formed request validates (facts + rules letter + twin summary anchors agree)', () => {
  const r = contract.validateCoachRequest({ twinSummary: TWIN_SUMMARY, weekFacts: FACTS, rulesLetter: RULES_LETTER })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.value.weekFacts.sessionCount, 5)
  assert.equal(r.value.rulesLetter.source, 'rules-v1')
})
check('the REAL twinSummaryForAi output passes request validation (contract = code shape)', () => {
  const prev = globalThis.localStorage
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  try {
    const summary = twin.twinSummaryForAi(twin.loadTwin())
    const facts = { ...FACTS, mode: summary.mode }
    const letter = { ...RULES_LETTER, mode: summary.mode }
    const r = contract.validateCoachRequest({ twinSummary: summary, weekFacts: facts, rulesLetter: letter })
    assert.equal(r.ok, true, JSON.stringify(r))
  } finally {
    if (prev === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prev
  }
})
check('anchor mismatches are rejected: week, mode (letter vs facts), mode (twin vs facts)', () => {
  assert.equal(
    contract.validateCoachRequest({ twinSummary: TWIN_SUMMARY, weekFacts: FACTS, rulesLetter: { ...RULES_LETTER, weekStart: '2026-11-09' } }).reason,
    'week_anchor_mismatch',
  )
  assert.equal(
    contract.validateCoachRequest({ twinSummary: TWIN_SUMMARY, weekFacts: FACTS, rulesLetter: { ...RULES_LETTER, mode: 'slump' } }).reason,
    'mode_anchor_mismatch',
  )
  assert.equal(
    contract.validateCoachRequest({ twinSummary: { ...TWIN_SUMMARY, mode: 'slump' }, weekFacts: FACTS, rulesLetter: RULES_LETTER }).reason,
    'mode_anchor_mismatch',
  )
})
check('malformed facts / letter / twin summary are rejected with named reasons', () => {
  assert.equal(contract.validateCoachRequest({ twinSummary: TWIN_SUMMARY, weekFacts: { ...FACTS, sessionCount: -1 }, rulesLetter: RULES_LETTER }).reason, 'week_facts_invalid')
  assert.equal(contract.validateCoachRequest({ twinSummary: TWIN_SUMMARY, weekFacts: FACTS, rulesLetter: { ...RULES_LETTER, paragraphs: 'one string' } }).reason, 'rules_letter_invalid')
  assert.equal(contract.validateCoachRequest({ twinSummary: { mode: 'cruise' }, weekFacts: FACTS, rulesLetter: RULES_LETTER }).reason, 'twin_summary_invalid')
  assert.equal(contract.validateCoachRequest({ twinSummary: { ...TWIN_SUMMARY, mode: 'party' }, weekFacts: FACTS, rulesLetter: RULES_LETTER }).reason, 'twin_mode_invalid')
})
check('prompt assembly: static system first (contract, no learner data), learner data last', () => {
  const req = contract.validateCoachRequest({ twinSummary: TWIN_SUMMARY, weekFacts: FACTS, rulesLetter: RULES_LETTER }).value
  const msgs = contract.buildCoachMessages(req)
  assert.equal(msgs[0].role, 'system')
  assert.ok(msgs[0].content.includes('one invented number discards the whole letter'))
  assert.ok(!msgs[0].content.includes('counter-documents') && !msgs[0].content.includes('42'))
  assert.ok(msgs[1].content.includes('counter-documents'))
  assert.ok(msgs[1].content.includes('"dueCount":9'))
})

console.log('contract twin — the strict output contract:')
check('a clean letter validates and is normalised: modeLabel + generatedAt + source stamped by code', () => {
  assert.equal(AI_LETTER.weekStart, '2026-11-02')
  assert.equal(AI_LETTER.mode, 'cruise')
  assert.equal(AI_LETTER.modeLabel, 'Cruise') // from the rules letter, not the model
  assert.equal(AI_LETTER.generatedAt, '2026-11-07T02:00:00.000Z') // ctx clock
  assert.equal(AI_LETTER.source, 'ai-shadow-v1')
  assert.deepEqual(AI_LETTER.citedNumbers, { sessionCount: 5, callsKept: 3 })
})
check('an invented number discards the whole letter (facts say 5 sessions, letter says 12)', () => {
  const bad = { ...AI_RAW, paragraphs: ['You did 12 sessions this week — a record.', ...AI_RAW.paragraphs.slice(1)] }
  assert.equal(contract.validateCoachOutput(bad, CTX).reason, 'number_not_in_facts')
})
check('the /180 diagnosis scale is a fact when (and only when) a diagnosis delta is present', () => {
  const allowed = contract.allowedFactNumbers(FACTS, TWIN_SUMMARY)
  assert.ok(allowed.has(180) && allowed.has(96) && allowed.has(5) && !allowed.has(12))
  const noDiag = contract.allowedFactNumbers(FACTS_BW, CTX_BW.twinSummary)
  assert.ok(!noDiag.has(180))
  const bw180 = { ...AI_BW_CLEAN, paragraphs: ['Your checkup stands at 96/180.', ...AI_BW_CLEAN.paragraphs.slice(1)] }
  assert.equal(contract.validateCoachOutput(bw180, CTX_BW).reason, 'number_not_in_facts')
})
check('a negative delta is citable by its absolute value ("down 3")', () => {
  const facts = { ...FACTS, diagnosis: { totalDelta: -3, toTotal: 90, sections: { language: -1, reading: -2, listening: 0 } }, citedNumbers: { ...FACTS.citedNumbers, diagnosisTotalDelta: -3 } }
  const rules = { ...RULES_LETTER, citedNumbers: { ...facts.citedNumbers } }
  const ai = { ...AI_RAW, paragraphs: ['Your checkups moved down 3 in total, to 90/180.', 'You showed up 5 times for about 42 minutes.', '— Michi, your coach.'], citedNumbers: { diagnosisTotalDelta: -3 } }
  assert.equal(contract.validateCoachOutput(ai, { ...CTX, weekFacts: facts, rulesLetter: rules }).ok, true)
})
check('promise/guarantee language is rejected (English and Japanese forms)', () => {
  const en = { ...AI_RAW, paragraphs: [...AI_RAW.paragraphs, 'Keep this up and you will pass the exam.'] }
  assert.ok(contract.validateCoachOutput(en, CTX).reason.startsWith('promise_language'))
  const guar = { ...AI_RAW, paragraphs: [...AI_RAW.paragraphs, 'Results are guaranteed if you continue.'] }
  assert.ok(contract.validateCoachOutput(guar, CTX).reason.startsWith('promise_language'))
  const ja = { ...AI_RAW, paragraphs: [...AI_RAW.paragraphs, 'この調子なら合格保証です。'] }
  assert.ok(contract.validateCoachOutput(ja, CTX).reason.startsWith('promise_language'))
})
check('shame language is rejected — the no-punishment rule binds the AI too', () => {
  const lazy = { ...AI_RAW, paragraphs: [...AI_RAW.paragraphs, 'Do not be lazy next week.'] }
  assert.equal(contract.validateCoachOutput(lazy, CTX).reason, 'shame_language:lazy')
  const failed = { ...AI_RAW, paragraphs: [...AI_RAW.paragraphs, 'You failed you team by skipping.'] }
  assert.equal(contract.validateCoachOutput(failed, CTX).reason, 'shame_language:failed you')
  const dis = { ...AI_RAW, paragraphs: [...AI_RAW.paragraphs, 'Honestly, I am disappointed.'] }
  assert.equal(contract.validateCoachOutput(dis, CTX).reason, 'shame_language:disappointed')
})
check('quiet modes: surge vocabulary contradicts a bad-week letter; a kind bad-week letter passes', () => {
  assert.equal(contract.validateCoachOutput(AI_BW_CLEAN, CTX_BW).ok, true)
  const surge = { ...AI_BW_CLEAN, paragraphs: ['Time to surge back with an intensive week.', ...AI_BW_CLEAN.paragraphs.slice(1)] }
  assert.equal(contract.validateCoachOutput(surge, CTX_BW).reason, 'mode_contradiction:surge')
  const factsSlump = { ...FACTS_BW, mode: 'slump', modeLabel: 'Slump' }
  const rulesSlump = { ...RULES_BW, mode: 'slump', modeLabel: 'Slump' }
  const ctxSlump = { rulesLetter: rulesSlump, weekFacts: factsSlump, twinSummary: { ...TWIN_SUMMARY, mode: 'slump' }, nowIso: CTX.nowIso }
  const intensive = { ...AI_BW_CLEAN, mode: 'slump', paragraphs: ['An intensive catch-up week is the answer.', ...AI_BW_CLEAN.paragraphs.slice(1)] }
  assert.equal(contract.validateCoachOutput(intensive, ctxSlump).reason, 'mode_contradiction:intensive')
  // …and the same words are legitimate in a surge week:
  const factsSurge = { ...FACTS, mode: 'surge', modeLabel: 'Surge' }
  const rulesSurge = { ...RULES_LETTER, mode: 'surge', modeLabel: 'Surge' }
  const ctxSurge = { rulesLetter: rulesSurge, weekFacts: factsSurge, twinSummary: { ...TWIN_SUMMARY, mode: 'surge' }, nowIso: CTX.nowIso }
  const surgeOk = { ...AI_RAW, mode: 'surge', paragraphs: ['You are climbing; a little surge room is offered, never owed.', ...AI_RAW.paragraphs.slice(1)] }
  assert.equal(contract.validateCoachOutput(surgeOk, ctxSurge).ok, true)
})
check('shape mismatches are rejected with named reasons', () => {
  assert.equal(contract.validateCoachOutput({ ...AI_RAW, paragraphs: 'just one string' }, CTX).reason, 'letter_shape_invalid')
  assert.equal(contract.validateCoachOutput({ ...AI_RAW, paragraphs: [] }, CTX).reason, 'letter_shape_invalid')
  assert.equal(contract.validateCoachOutput(['not', 'an', 'object'], CTX).reason, 'not_an_object')
  assert.equal(contract.validateCoachOutput({ ...AI_RAW, citedNumbers: { sessionCount: 'five' } }, CTX).reason, 'letter_shape_invalid')
})
check('week / mode changes and minted citedNumbers are rejected', () => {
  assert.equal(contract.validateCoachOutput({ ...AI_RAW, weekStart: '2026-11-09' }, CTX).reason, 'week_mismatch')
  assert.equal(contract.validateCoachOutput({ ...AI_RAW, mode: 'surge' }, CTX).reason, 'mode_mismatch')
  assert.equal(contract.validateCoachOutput({ ...AI_RAW, citedNumbers: { sessionCount: 99 } }, CTX).reason, 'cited_numbers_mismatch')
  assert.equal(contract.validateCoachOutput({ ...AI_RAW, citedNumbers: { brandNewFigure: 5 } }, CTX).reason, 'cited_numbers_mismatch')
})
check('fenced model JSON parses end-to-end; garbage is unparseable', () => {
  const fenced = '```json\n' + JSON.stringify(AI_RAW) + '\n```'
  assert.equal(contract.letterFromModelText(fenced, CTX).ok, true)
  assert.equal(contract.letterFromModelText('Dear learner, great week!', CTX).reason, 'unparseable')
})
check('extractNumerals parity: contract twin and client helper agree exactly', () => {
  const samples = ['42 minutes, 1,000 steps', 'up 4.1 points to 96/180', 'N3 (est.) and 0 proof', 'no numbers at all', '']
  for (const s of samples) assert.deepEqual(contract.extractNumerals(s), shadow.extractNumerals(s))
  assert.deepEqual(shadow.extractNumerals('42 minutes, 1,000 steps'), [42, 1000])
  assert.deepEqual(shadow.extractNumerals('up 4.1 points to 96/180'), [4.1, 96, 180])
})

console.log('client wiring (fakes only — no network):')
const fakeStorage = () => {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map }
}
check('flag ships enabled; the ring log cap is the documented 8 pairs', () => {
  assert.equal(shadow.COACH_SHADOW_ENABLED, true)
  assert.equal(shadow.COACH_SHADOW_LOG_CAP, 8)
  assert.equal(shadow.COACH_SHADOW_KEY, 'jpn:coachShadow:v1')
})
check('week stamp: unshadowed week may shadow; the same week may not; a new week may', () => {
  assert.equal(shadow.stampWeekFor(null), null)
  assert.equal(shadow.stampWeekFor({ weekKey: '2026-11-02', at: 'x' }), '2026-11-02')
  assert.equal(shadow.canShadowWeek(null, '2026-11-02'), true)
  assert.equal(shadow.canShadowWeek({ weekKey: '2026-11-02', at: 'x' }, '2026-11-02'), false)
  assert.equal(shadow.canShadowWeek({ weekKey: '2026-11-02', at: 'x' }, '2026-11-09'), true)
  assert.equal(shadow.canShadowWeek(null, ''), false)
  assert.deepEqual(shadow.nextShadowStamp('2026-11-09', '2026-11-09T00:00:00.000Z'), { weekKey: '2026-11-09', at: '2026-11-09T00:00:00.000Z' })
})
check('pair log: appends, replaces a same-week pair, and rings at the cap', () => {
  let log = []
  log = shadow.appendShadowPair(log, { weekKey: '2026-11-02', rulesLetter: RULES_LETTER, aiLetter: AI_LETTER })
  assert.equal(log.length, 1)
  const ai2 = { ...AI_LETTER, generatedAt: 'later' }
  log = shadow.appendShadowPair(log, { weekKey: '2026-11-02', rulesLetter: RULES_LETTER, aiLetter: ai2 })
  assert.equal(log.length, 1)
  assert.equal(log[0].aiLetter.generatedAt, 'later')
  const weeks = ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28']
  for (const w of weeks) {
    log = shadow.appendShadowPair(log, { weekKey: w, rulesLetter: { ...RULES_LETTER, weekStart: w }, aiLetter: AI_LETTER })
  }
  assert.equal(log.length, shadow.COACH_SHADOW_LOG_CAP)
  assert.equal(log[log.length - 1].weekKey, '2026-12-28')
  assert.equal(log[0].weekKey, '2026-11-09') // the 2026-11-02 pair rang out
})
check('metric shape: section counts + factsChecked, nothing else', () => {
  assert.deepEqual(shadow.shadowMetricFor(RULES_LETTER, AI_LETTER), { rulesSections: 6, aiSections: 6, factsChecked: true })
})
check('sharedFactReferences: the numerals BOTH letters cite, sorted — similarity, not quality', () => {
  assert.deepEqual(shadow.sharedFactReferences(RULES_LETTER, AI_LETTER), [3, 4, 5, 6, 7, 8, 42, 96, 180])
  const narrow = { paragraphs: ['Only 5 sessions and 3 kept calls this week.'] }
  assert.deepEqual(shadow.sharedFactReferences(RULES_LETTER, narrow), [3, 5])
  assert.deepEqual(shadow.sharedFactReferences(RULES_LETTER, { paragraphs: ['A quiet note with nothing counted.'] }), [])
})
check('week key: a Saturday belongs to the week that began the Monday before', () => {
  assert.equal(shadow.coachWeekKey(new Date(2026, 10, 7)), '2026-11-02') // Sat 7 Nov 2026
  assert.equal(shadow.coachWeekKey(new Date(2026, 10, 2)), '2026-11-02') // the Monday itself
  assert.equal(shadow.coachWeekKey(new Date(2026, 10, 9)), '2026-11-09') // next Monday
})

const INPUT = { twinSummary: TWIN_SUMMARY, weekFacts: FACTS, rulesLetter: RULES_LETTER }
const baseDeps = (over = {}) => ({
  storage: fakeStorage(),
  getSession: async () => ({ user: { id: 'u1' } }),
  invoke: async () => ({ ok: true, letter: AI_LETTER }),
  metric: () => {},
  nowIso: '2026-11-07T02:00:00.000Z',
  ...over,
})

await checkAsync('a signed-in, unshadowed week stores the pair, spends the stamp, and logs the metric', async () => {
  const logged = []
  const storage = fakeStorage()
  const ran = await shadow.runCoachShadow(INPUT, baseDeps({ storage, metric: (t, p) => logged.push([t, p]) }))
  assert.equal(ran, true)
  assert.deepEqual(logged, [['coach_shadow', { rulesSections: 6, aiSections: 6, factsChecked: true }]])
  const log = JSON.parse(storage.map.get(shadow.COACH_SHADOW_KEY))
  assert.equal(log.length, 1)
  assert.equal(log[0].weekKey, '2026-11-02')
  assert.deepEqual(log[0].aiLetter, AI_LETTER)
  assert.equal(JSON.parse(storage.map.get(shadow.COACH_SHADOW_STAMP_KEY)).weekKey, '2026-11-02')
})
await checkAsync('the once-a-week stamp blocks a second run in the same week; the next week shadows again', async () => {
  let calls = 0
  const storage = fakeStorage()
  const deps = baseDeps({ storage, invoke: async () => { calls += 1; return { ok: true, letter: AI_LETTER } } })
  assert.equal(await shadow.runCoachShadow(INPUT, deps), true)
  assert.equal(await shadow.runCoachShadow(INPUT, deps), false)
  assert.equal(calls, 1)
  const nextWeek = {
    twinSummary: TWIN_SUMMARY,
    weekFacts: { ...FACTS, weekStart: '2026-11-09' },
    rulesLetter: { ...RULES_LETTER, weekStart: '2026-11-09' },
  }
  assert.equal(await shadow.runCoachShadow(nextWeek, deps), true)
  assert.equal(calls, 2)
  assert.equal(JSON.parse(storage.map.get(shadow.COACH_SHADOW_KEY)).length, 2)
})
await checkAsync('disabled / signed-out / incomplete input skip silently without invoking', async () => {
  let calls = 0
  const counting = async () => { calls += 1; return { ok: true, letter: AI_LETTER } }
  assert.equal(await shadow.runCoachShadow(INPUT, baseDeps({ enabled: false, invoke: counting })), false)
  assert.equal(await shadow.runCoachShadow(INPUT, baseDeps({ getSession: async () => null, invoke: counting })), false)
  assert.equal(await shadow.runCoachShadow({ twinSummary: TWIN_SUMMARY, weekFacts: FACTS }, baseDeps({ invoke: counting })), false)
  assert.equal(calls, 0)
})
await checkAsync('function failure / invalid AI answer / transport throws resolve false, store nothing, never reject', async () => {
  const storage = fakeStorage()
  assert.equal(await shadow.runCoachShadow(INPUT, baseDeps({ storage, invoke: async () => ({ ok: false, reason: 'invalid_output:number_not_in_facts' }) })), false)
  assert.equal(await shadow.runCoachShadow(INPUT, baseDeps({ storage, invoke: async () => { throw new Error('offline') } })), false)
  assert.equal(storage.map.has(shadow.COACH_SHADOW_KEY), false)
})

console.log(`\ncoach-shadow: ${passed} checks passed`)
