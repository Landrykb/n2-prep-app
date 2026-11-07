// Corrector shadow-mode tests (run: TZ=UTC npm run test:corrector)
// Pins for Doc 05 §4 + Doc 08 §4, Phase 3 step 1:
//  1. The gold set is real: ≥40 cases, every taxonomy category ≥3,
//     every category id imported from the CODE taxonomy (twin.js
//     ERROR_PATTERNS) — never a copied list.
//  2. The edge function's contract twin (contract.ts) carries the
//     same taxonomy, in the same order, and its validators accept /
//     reject exactly the shapes the function's contract promises.
//  3. The rules-mode eval runner executes over the gold set and
//     reports; the rules' one structural blind spot
//     (keigo-over-polite has no signal path in classifyVoiceError)
//     is pinned as a known miss, not hidden.
//  4. The client shadow wiring: flag, per-day cap state machine,
//     metric shape, and the runner's skip paths (disabled / capped /
//     signed out / function error) — all with fakes; no network.

import assert from 'node:assert'
import { execFileSync } from 'node:child_process'

const twin = await import('../src/lib/twin.js')
const contract = await import('../supabase/functions/corrector/contract.ts')
const evalRunner = await import('../scripts/eval-corrector.mjs')
const shadow = await import('../src/lib/correctorShadow.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }
const checkAsync = async (name, fn) => { await fn(); passed++; console.log(`  ok ${name}`) }

const evalSet = evalRunner.loadEvalSet()
const taxonomyIds = twin.ERROR_PATTERNS.map((p) => p.id)

console.log('gold set integrity (categories from the code taxonomy):')
check('gold set has ≥40 cases', () => {
  assert.ok(evalSet.cases.length >= 40, `only ${evalSet.cases.length}`)
})
check('every taxonomy category is covered ≥3 times', () => {
  const counts = {}
  for (const c of evalSet.cases) counts[c.category] = (counts[c.category] || 0) + 1
  for (const id of taxonomyIds) assert.ok((counts[id] || 0) >= 3, `${id}: ${counts[id] || 0}`)
})
check('every gold category exists in the code taxonomy; no extras', () => {
  for (const c of evalSet.cases) assert.ok(taxonomyIds.includes(c.category), c.id)
})
check('case ids unique; production/target/context/correction all present', () => {
  const seen = new Set()
  for (const c of evalSet.cases) {
    assert.ok(!seen.has(c.id), `dup ${c.id}`)
    seen.add(c.id)
    for (const f of ['production', 'target', 'context', 'correction']) {
      assert.ok(typeof c[f] === 'string' && c[f].trim().length > 0, `${c.id}.${f}`)
    }
    assert.ok(['voice', 'listening', 'queue'].includes(c.kind), `${c.id}.kind`)
  }
})
check('provenance is honest: constructed set, human review pending', () => {
  assert.match(evalSet.provenance, /NOT real learner data/)
  assert.match(evalSet.provenance, /PENDING/)
})

console.log('contract twin (edge function vs code taxonomy):')
check('contract taxonomy ids deep-equal ERROR_PATTERNS ids, order included', () => {
  assert.deepEqual(contract.TAXONOMY_IDS, taxonomyIds)
})
check('a valid model answer passes validation', () => {
  const r = contract.validateCorrectorOutput({
    category: 'counter-documents', correction: '住民票を2通お願いします。', note: 'Copies take 通, not 個.',
  })
  assert.equal(r.ok, true)
  assert.equal(r.value.category, 'counter-documents')
})
check('an out-of-taxonomy category is rejected', () => {
  const r = contract.validateCorrectorOutput({ category: 'counter-paperwork', correction: 'x', note: 'y' })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'category_not_in_taxonomy')
})
check('missing / empty correction or note is rejected', () => {
  assert.equal(contract.validateCorrectorOutput({ category: 'word-order', note: 'y' }).ok, false)
  assert.equal(contract.validateCorrectorOutput({ category: 'word-order', correction: ' ', note: 'y' }).ok, false)
  assert.equal(contract.validateCorrectorOutput({ category: 'word-order', correction: 'x', note: '' }).ok, false)
  assert.equal(contract.validateCorrectorOutput('a string').ok, false)
  assert.equal(contract.validateCorrectorOutput(null).ok, false)
})
check('fenced model JSON parses and validates end-to-end', () => {
  const text = '```json\n{"category":"verb-form-te","correction":"窓を開けてください。","note":"開ける becomes 開けて in requests."}\n```'
  const r = contract.resultFromModelText(text)
  assert.equal(r.ok, true)
  assert.equal(r.value.category, 'verb-form-te')
  assert.equal(contract.resultFromModelText('not json at all').reason, 'unparseable')
})
check('request validation: production required, ruleCategory must be taxonomy or null', () => {
  assert.equal(contract.validateCorrectorRequest({ target: 'x' }).ok, false)
  assert.equal(contract.validateCorrectorRequest({ production: 'x', ruleCategory: 'nope' }).reason, 'rule_category_not_in_taxonomy')
  const ok = contract.validateCorrectorRequest({ production: ' 本読みました ', ruleCategory: 'particle-wo-omission' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.production, '本読みました')
  assert.equal(contract.validateCorrectorRequest({ production: 'x', context: { sceneId: 's1' } }).ok, true)
})
check('prompt assembly: static system first (taxonomy, no learner data), learner data last', () => {
  const msgs = contract.buildCorrectorMessages({ production: '本読みました。', target: '本を読みました。', context: '', ruleCategory: null })
  assert.equal(msgs[0].role, 'system')
  assert.ok(msgs[0].content.includes('particle-ha-ga') && msgs[0].content.includes('pronunciation-unintelligible'))
  assert.ok(!msgs[0].content.includes('本読みました'))
  assert.ok(msgs[1].content.includes('本読みました。'))
})

console.log('rules-mode eval (the offline baseline):')
check('scoreOver runs the real classifiers over the whole gold set', () => {
  const scored = evalRunner.scoreOver(evalSet, evalRunner.ruleClassify)
  assert.equal(scored.total, evalSet.cases.length)
  assert.equal(Object.keys(scored.perCategory).length, taxonomyIds.length)
})
check('known blind spot pinned: the rules can never return keigo-over-polite', () => {
  const scored = evalRunner.scoreOver(evalSet, evalRunner.ruleClassify)
  assert.equal(scored.perCategory['keigo-over-polite'].agree, 0)
  assert.ok(scored.misses.every((m) => m.category === 'keigo-over-polite'))
})
check('the runner script executes offline and reports', () => {
  const out = execFileSync(process.execPath, ['scripts/eval-corrector.mjs'], {
    cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8',
  })
  assert.match(out, /RULES mode/)
  assert.match(out, /keigo-over-polite\s+0\/3/)
})
check('gate verdict: ≥90% overall and no weak category passes; either failing blocks', () => {
  const okScored = { total: 20, agree: 19, perCategory: { a: { total: 10, agree: 9 }, b: { total: 10, agree: 10 } }, misses: [] }
  assert.equal(evalRunner.gateVerdict(okScored).pass, true)
  const lowOverall = { total: 20, agree: 17, perCategory: { a: { total: 10, agree: 9 }, b: { total: 10, agree: 8 } }, misses: [] }
  assert.equal(evalRunner.gateVerdict(lowOverall).pass, false)
  // overall 23/25 = 92% passes the headline number, but category c
  // (5 cases, 60%) is below the 80% floor — the gate must still fail.
  const weakOnly = { total: 25, agree: 23, perCategory: { a: { total: 20, agree: 20 }, c: { total: 5, agree: 3 } }, misses: [] }
  assert.equal(evalRunner.gateVerdict(weakOnly).pass, false)
  assert.deepEqual(evalRunner.gateVerdict(weakOnly).weak, ['c'])
})

console.log('client shadow wiring (fakes only — no network):')
const fakeStorage = () => {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map }
}
const TODAY = '2026-11-07'
check('cap state: fresh day starts at 0, next-day rollover resets, count increments', () => {
  assert.deepEqual(shadow.shadowStateFor(null, TODAY), { date: TODAY, count: 0 })
  assert.deepEqual(shadow.shadowStateFor({ date: '2026-11-06', count: 19 }, TODAY), { date: TODAY, count: 0 })
  assert.deepEqual(shadow.nextShadowState({ date: TODAY, count: 3 }, TODAY), { date: TODAY, count: 4 })
  assert.equal(shadow.canShadow({ date: TODAY, count: shadow.CORRECTOR_SHADOW_DAILY_CAP }, TODAY), false)
  assert.equal(shadow.canShadow({ date: TODAY, count: 3 }, TODAY), true)
})
check('metric shape: agree flag + both categories, nothing else', () => {
  assert.deepEqual(shadow.shadowMetricFor('word-order', 'word-order'), { agree: true, ruleCategory: 'word-order', aiCategory: 'word-order' })
  assert.deepEqual(shadow.shadowMetricFor('word-order', 'vocab-near-miss'), { agree: false, ruleCategory: 'word-order', aiCategory: 'vocab-near-miss' })
})
check('flag ships enabled and the daily cap is the documented 20', () => {
  assert.equal(shadow.CORRECTOR_SHADOW_ENABLED, true)
  assert.equal(shadow.CORRECTOR_SHADOW_DAILY_CAP, 20)
})

const baseDeps = (over = {}) => ({
  storage: fakeStorage(),
  today: TODAY,
  getSession: async () => ({ user: { id: 'u1' } }),
  invoke: async () => ({ ok: true, category: 'word-order', correction: 'x', note: 'y' }),
  metric: () => {},
  ...over,
})
const INPUT = { production: '私は食べました寿司を。', target: '私は寿司を食べました。', context: '', ruleCategory: 'word-order' }

await checkAsync('a signed-in, uncapped shadow call logs the comparison metric', async () => {
  const logged = []
  const storage = fakeStorage()
  const ran = await shadow.runCorrectorShadow(INPUT, baseDeps({ storage, metric: (t, p) => logged.push([t, p]) }))
  assert.equal(ran, true)
  assert.deepEqual(logged, [['corrector_shadow', { agree: true, ruleCategory: 'word-order', aiCategory: 'word-order' }]])
  assert.equal(JSON.parse(storage.map.get(shadow.CORRECTOR_SHADOW_KEY)).count, 1)
})
await checkAsync('a disagreement is logged as agree:false — that stream is the gate input', async () => {
  const logged = []
  const ran = await shadow.runCorrectorShadow(INPUT, baseDeps({
    invoke: async () => ({ ok: true, category: 'vocab-near-miss', correction: 'x', note: 'y' }),
    metric: (t, p) => logged.push([t, p]),
  }))
  assert.equal(ran, true)
  assert.equal(logged[0][1].agree, false)
})
await checkAsync('disabled / capped / signed-out / no-guess all skip silently without invoking', async () => {
  let calls = 0
  const counting = async () => { calls += 1; return { ok: true, category: 'word-order' } }
  assert.equal(await shadow.runCorrectorShadow(INPUT, baseDeps({ enabled: false, invoke: counting })), false)
  const capped = fakeStorage()
  capped.setItem(shadow.CORRECTOR_SHADOW_KEY, JSON.stringify({ date: TODAY, count: shadow.CORRECTOR_SHADOW_DAILY_CAP }))
  assert.equal(await shadow.runCorrectorShadow(INPUT, baseDeps({ storage: capped, invoke: counting })), false)
  assert.equal(await shadow.runCorrectorShadow(INPUT, baseDeps({ getSession: async () => null, invoke: counting })), false)
  assert.equal(await shadow.runCorrectorShadow({ ...INPUT, ruleCategory: null }, baseDeps({ invoke: counting })), false)
  assert.equal(calls, 0)
})
await checkAsync('function failure and transport throws resolve false, log nothing, never reject', async () => {
  const logged = []
  const metric = (t, p) => logged.push([t, p])
  assert.equal(await shadow.runCorrectorShadow(INPUT, baseDeps({ invoke: async () => ({ ok: false, reason: 'no_key' }), metric })), false)
  assert.equal(await shadow.runCorrectorShadow(INPUT, baseDeps({ invoke: async () => { throw new Error('offline') }, metric })), false)
  assert.deepEqual(logged, [])
})

console.log(`\ncorrector: ${passed} checks passed`)
