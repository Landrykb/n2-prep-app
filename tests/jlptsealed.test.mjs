// JLPT sealed bank + pool split tests (Doc 21 pool law applied to JLPT).
// Run: TZ=UTC node tests/jlptsealed.test.mjs

import assert from 'node:assert'

const sealed = await import('../src/data/jlptSealed.js')
const data = await import('../src/data.js')
const n2l = await import('../src/data/n2Listening.js')
const lp = await import('../src/data/listeningPlus.js')
const mock = await import('../src/lib/mockExam.js')
const profileMod = await import('../src/lib/profile.js')
const bjtExam = await import('../src/lib/bjtExam.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const validQuestions = (qs, owner) => {
  for (const q of qs) {
    assert.ok(q.prompt && q.options.length === 4, `${owner}: shape`)
    assert.equal(q.options.filter((o) => o.correct).length, 1, `${owner}: exactly one correct`)
  }
}

check('sealed bank integrity: shapes, one correct answer each', () => {
  assert.ok(sealed.sealedPassages.length >= 6)
  assert.ok(sealed.sealedListening.length >= 6)
  const ids = new Set()
  for (const p of sealed.sealedPassages) {
    assert.ok(!ids.has(p.id)); ids.add(p.id)
    assert.ok(p.text.length > 50)
    validQuestions(p.questions, p.id)
  }
  for (const l of sealed.sealedListening) {
    assert.ok(!ids.has(l.id)); ids.add(l.id)
    assert.equal(l.audio, null, 'sealed listening rides the voice lane, no practice audio file')
    assert.ok(l.script.length > 10)
    validQuestions(l.questions, l.id)
  }
})

check('governance: sealed titles never appear in the practice surfaces', () => {
  const practiceTitles = new Set([
    ...data.passages.map((p) => p.title),
    ...n2l.n2Listening.map((l) => l.title),
    ...lp.listeningPlus.map((l) => l.title),
  ])
  for (const p of sealed.sealedPassages) assert.ok(!practiceTitles.has(p.title), p.title)
  for (const l of sealed.sealedListening) assert.ok(!practiceTitles.has(l.title), l.title)
})

check('full N2 mock: sealed paper — reading and listening are 100% sealed, real N2 times', () => {
  const exam = mock.buildMockExam('full', 42, { level: 'N2' })
  assert.equal(exam.meta.sealed, true)
  const sealedReading = new Set(sealed.sealedPassages.map((p) => p.title))
  const sealedListening = new Set(sealed.sealedListening.map((l) => l.title))
  const readingGroups = exam.sections[0].groups.filter((g) => g.passage)
  const listeningGroups = exam.sections[1].groups
  assert.ok(readingGroups.length >= 6)
  assert.ok(readingGroups.every((g) => sealedReading.has(g.passage.title)))
  assert.ok(listeningGroups.length >= 6)
  assert.ok(listeningGroups.every((g) => sealedListening.has(g.listening.title)))
  assert.equal(exam.sections[0].timeMin, 105)
  assert.equal(exam.sections[1].timeMin, 50)
})

check('full N1 mock: real N1 times, and honestly not sealed yet', () => {
  const exam = mock.buildMockExam('full', 7, { level: 'N1' })
  assert.equal(exam.sections[0].timeMin, 110)
  assert.equal(exam.sections[1].timeMin, 55)
  assert.equal(exam.meta.sealed, false)
})

check('quick N2 mock: practice pool only, never sealed', () => {
  const exam = mock.buildMockExam('quick', 9, { level: 'N2' })
  assert.equal(exam.meta.sealed, false)
  const sealedTitles = new Set([...sealed.sealedPassages.map((p) => p.title), ...sealed.sealedListening.map((l) => l.title)])
  for (const g of exam.sections[0].groups) if (g.passage) assert.ok(!sealedTitles.has(g.passage.title))
  for (const g of exam.sections[1].groups) assert.ok(!sealedTitles.has(g.listening.title))
})

check('ladder gate: a passed full mock proves only when sealed', () => {
  const dx = { jlptEstimate: 'N2', total: 97, sections: { language: 38, reading: 37, listening: 22 }, bjtScore: 348 }
  const byId = (rungs) => Object.fromEntries(rungs.map((r) => [r.id, r]))
  const ev = (events) => ({ metrics: events, now: new Date('2026-11-08T12:00:00') })
  const base = { type: 'mock_completed', at: '2026-11-08T09:00:00', level: 'N2', length: 'full', passed: true, scaled: { lk: 40, reading: 38, listening: 30, total: 108 } }
  const unsealed = byId(profileMod.ladderWithStatus(dx, ev([base])))
  assert.notEqual(unsealed.n2.status, 'reached', 'practised texts cannot prove')
  const sealedRun = byId(profileMod.ladderWithStatus(dx, ev([{ ...base, sealed: true }])))
  assert.equal(sealedRun.n2.status, 'reached', 'a sealed pass proves')
})

check('BJT bookable: claimable band = best sealed score minus the safety margin', () => {
  assert.equal(bjtExam.bjtBookable([]).bestSealed, null)
  const mixedOnly = bjtExam.bjtBookable([{ type: 'bjt_exam_completed', score: 700, sealed: false }])
  assert.equal(mixedOnly.bestSealed, null, 'a mixed paper is not booking evidence')
  const r = bjtExam.bjtBookable([{ type: 'bjt_exam_completed', score: 512, sealed: true }])
  assert.equal(r.claimable, 'J2') // 512 - 30 = 482, still J2
  assert.equal(r.nextBand, 'J1')
  assert.equal(r.pointsToNext, 18)
  const r2 = bjtExam.bjtBookable([{ type: 'bjt_exam_completed', score: 575, sealed: true }])
  assert.equal(r2.claimable, 'J1') // 575 - 30 = 545 >= 530
  assert.equal(r2.nextBand, 'J1+')
})

console.log(`\njlptsealed: ${passed} checks passed`)
