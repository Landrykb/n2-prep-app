// BJT exam tests — bank integrity, pool governance (sealed vs practice),
// assembly, scoring, form-practice generators, and the ladder's sealed gate.
// Run: TZ=UTC node tests/bjtexam.test.mjs

import assert from 'node:assert'

const bank = await import('../src/data/bjtBank.js')
const exam = await import('../src/lib/bjtExam.js')
const profileMod = await import('../src/lib/profile.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const { BJT_FORMS } = bank

check('bank integrity: ids, forms, pools, one correct answer per item', () => {
  const ids = new Set()
  for (const g of bank.bjtAllGroups) {
    assert.ok(!ids.has(g.id), `duplicate group id ${g.id}`)
    ids.add(g.id)
    assert.ok(BJT_FORMS[g.form], `unknown form ${g.form}`)
    assert.ok(g.pool === 'sealed' || g.pool === 'practice', `bad pool ${g.pool}`)
    assert.ok(g.items.length >= 1)
    for (const item of g.items) {
      assert.equal(item.options.length, 4, `${g.id}: options must be 4`)
      assert.ok(Number.isInteger(item.answer) && item.answer >= 0 && item.answer < 4, `${g.id}: answer range`)
      assert.equal(new Set(item.options).size, 4, `${g.id}: duplicate options`)
      assert.ok(item.prompt && item.prompt.length > 0, `${g.id}: empty prompt`)
    }
  }
})

check('sealed bank fills the full real paper: 80 questions, every form at its official count', () => {
  const counts = {}
  for (const g of bank.bjtAllGroups.filter((x) => x.pool === 'sealed')) {
    counts[g.form] = (counts[g.form] || 0) + g.items.length
  }
  let total = 0
  for (const [form, spec] of Object.entries(BJT_FORMS)) {
    assert.equal(counts[form] || 0, spec.count, `${form}: sealed ${counts[form] || 0} != ${spec.count}`)
    total += counts[form] || 0
  }
  assert.equal(total, 80)
})

check('governance: practice pool never contains a sealed group', () => {
  const sealedIds = new Set(bank.bjtAllGroups.filter((g) => g.pool === 'sealed').map((g) => g.id))
  for (const g of exam.practiceGroups()) {
    assert.ok(!sealedIds.has(g.id), `practice group ${g.id} collides with sealed`)
    assert.equal(g.pool, 'practice')
  }
})

check('assembly: sealed paper is complete, 80 questions, all sealed', () => {
  const paper = exam.assemblePaper({ sealedOnly: true, seed: 42 })
  assert.equal(paper.totalQuestions, 80)
  assert.deepEqual(paper.thin, [])
  assert.equal(paper.sealed, true)
  assert.ok(paper.groups.every((g) => g.pool === 'sealed'))
})

check('assembly: mixed paper also fills 80 but is not sealed-proof', () => {
  const paper = exam.assemblePaper({ sealedOnly: false, seed: 3 })
  assert.equal(paper.totalQuestions, 80)
  assert.equal(paper.sealed, paper.groups.every((g) => g.pool === 'sealed'))
})

check('scoring: perfect paper = 800 / J1+, empty paper = 0 / J5', () => {
  const paper = exam.assemblePaper({ sealedOnly: true, seed: 1 })
  const perfect = {}
  for (const g of paper.groups) g.items.forEach((item, i) => { perfect[exam.itemKey(g, i)] = item.answer })
  const r1 = exam.scorePaper(paper, perfect)
  assert.equal(r1.score, 800)
  assert.equal(r1.band, 'J1+')
  assert.equal(r1.misses.length, 0)
  const r0 = exam.scorePaper(paper, {})
  assert.equal(r0.score, 0)
  assert.equal(r0.band, 'J5')
  assert.equal(r0.misses.length, 80)
})

check('bands follow the official thresholds', () => {
  assert.equal(exam.bandForScore(600), 'J1+')
  assert.equal(exam.bandForScore(599), 'J1')
  assert.equal(exam.bandForScore(530), 'J1')
  assert.equal(exam.bandForScore(529), 'J2')
  assert.equal(exam.bandForScore(420), 'J2')
  assert.equal(exam.bandForScore(419), 'J3')
  assert.equal(exam.bandForScore(320), 'J3')
  assert.equal(exam.bandForScore(319), 'J4')
  assert.equal(exam.bandForScore(200), 'J4')
  assert.equal(exam.bandForScore(199), 'J5')
  assert.equal(exam.rankForAccuracy(0.95), 7)
  assert.equal(exam.rankForAccuracy(0.5), 3)
  assert.equal(exam.rankForAccuracy(0.1), 1)
})

check('generators: keigo variants are mechanically valid register items', () => {
  const items = exam.genKeigoPractice(5, 11)
  assert.equal(items.length, 5)
  for (const it of items) {
    assert.equal(it.options.length, 4)
    assert.equal(new Set(it.options).size, 4)
    const correct = it.options[it.answer]
    assert.ok(/^(部長は|私は)/.test(correct), `frame broken: ${correct}`)
    assert.ok(correct.includes('ます'), `not a masu form: ${correct}`)
    assert.ok(it.generated === true)
  }
})

check('generators: vocab and bamen variants are valid', () => {
  const vocab = exam.genVocabPractice(5, 5)
  assert.equal(vocab.length, 5)
  for (const it of vocab) {
    assert.equal(it.options.length, 4)
    assert.ok(it.answer >= 0 && it.answer < 4)
  }
  const bamen = exam.genBamenPractice(3, 2)
  assert.equal(bamen.length, 3)
  for (const it of bamen) assert.ok(it.scene && it.options.length === 4)
})

check('form practice: bank forms serve items, generated forms serve variants', () => {
  const reading = exam.practiceItemsForForm('sougouR', { seed: 1, count: 3 })
  assert.ok(reading.length >= 1)
  assert.ok(reading.every((it) => typeof it.doc === 'string' && it.doc.length > 0))
  const keigo = exam.practiceItemsForForm('hatsugen', { seed: 1, count: 5 })
  assert.equal(keigo.length, 5)
})

check('weakest forms come from the learner record, weakest first', () => {
  const metrics = [{ type: 'bjt_exam_completed', score: 500, sealed: true, sections: { goi: { acc: 0.9 }, hatsugen: { acc: 0.3 }, bamen: { acc: 0.6 } } }]
  assert.deepEqual(exam.weakestForms(metrics), ['hatsugen', 'bamen', 'goi'])
})

check('ladder gate: only a SEALED exam proves BJT rungs; any full exam sets the water basis', () => {
  const dx = { jlptEstimate: 'N2', total: 97, sections: { language: 38, reading: 37, listening: 22 }, bjtScore: 348 }
  const byId = (rungs) => Object.fromEntries(rungs.map((r) => [r.id, r]))
  const ev = (events) => ({ metrics: events, now: new Date('2026-11-08T12:00:00') })
  const t0 = { type: 'diagnosis_completed', at: '2026-11-07T15:19:00' }
  const mixed = byId(profileMod.ladderWithStatus(dx, ev([
    t0, { type: 'bjt_exam_completed', at: '2026-11-08T09:00:00', score: 512, band: 'J2', sealed: false },
  ])))
  assert.notEqual(mixed.bjt480.status, 'reached', 'a mixed paper must not prove')
  assert.equal(mixed.bjt400.status, 'covered', 'but its score fills the water (512/400)')
  assert.equal(mixed.bjt400.fill, 1)
  const sealed = byId(profileMod.ladderWithStatus(dx, ev([
    t0, { type: 'bjt_exam_completed', at: '2026-11-08T09:00:00', score: 512, band: 'J2', sealed: true },
  ])))
  assert.equal(sealed.bjt480.status, 'reached', 'a sealed pass proves')
})

console.log(`\nbjtexam: ${passed} checks passed`)
