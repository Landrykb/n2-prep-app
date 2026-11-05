// Production-readiness node tests (run: TZ=UTC node tests/readiness.test.mjs)
// Pins for the 2026-11-05 readiness fix sequence — the logic where a bug
// silently loses learner data or lies to a learner:
//  1. Queue/state merges (P0-1): union, never shrink, documented winners.
//  2. Restore planner (P0-1): app keys only, merges not overwrites.
//  3. TTS voice scoring (P1-2): a Japanese voice wins; absence is honest.
//  4. Mic error copy (P1-1): every kind gets plain language; aborted silent.
//  5. Diagnosis items (P0-2): rotation excludes last run; component maths.
//  6. Gate metrics (P1-7): the North Star is null until real proof exists.
//  7. Level mocks (P0-3): pass marks belong to the paper's level; thin
//     banks are labelled, never silently faked.

import assert from 'node:assert'

const { pickQueueWinner, mergeQueues, mergeLearnerState, mergeDiagnosisHistory, mergeAnkiProgress } = await import('../src/lib/stateMerge.js')
const { validateExport, planRestore } = await import('../src/lib/restore.js')
const { scoreJapaneseVoice, pickJapaneseVoiceFrom } = await import('../src/lib/tts.js')
const { micErrorCopy } = await import('../src/lib/speechErrors.js')
const { bandOrder, sectionComponent, selectDiagnosisItems } = await import('../src/lib/diagnosisItems.js')
const { summariseMetrics } = await import('../src/lib/metrics.js')
const { buildMockExam, scoreExam } = await import('../src/lib/mockExam.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const item = (id, reps, lastReview = '', stability = 0) => ({ id, fsrs: { reps, lastReview, stability } })

console.log('queue merge winners (reps → lastReview → stability → local):')
check('more reps wins', () => assert.equal(pickQueueWinner(item('a', 1), item('a', 3)), 'cloud'))
check('fewer reps loses', () => assert.equal(pickQueueWinner(item('a', 5), item('a', 2)), 'local'))
check('later review breaks a reps tie', () => assert.equal(
  pickQueueWinner(item('a', 2, '2026-11-01T00:00:00Z'), item('a', 2, '2026-11-03T00:00:00Z')), 'cloud'))
check('higher stability breaks a review tie', () => assert.equal(
  pickQueueWinner(item('a', 2, '2026-11-01T00:00:00Z', 4), item('a', 2, '2026-11-01T00:00:00Z', 9)), 'cloud'))
check('full tie keeps local', () => assert.equal(
  pickQueueWinner(item('a', 2, '2026-11-01T00:00:00Z', 4), item('a', 2, '2026-11-01T00:00:00Z', 4)), 'local'))
check('missing side never wins', () => {
  assert.equal(pickQueueWinner(null, item('a', 0)), 'cloud')
  assert.equal(pickQueueWinner(item('a', 0), null), 'local')
})

console.log('queue merge is a union (never shrinks):')
check('disjoint queues concatenate', () => {
  const merged = mergeQueues([item('a', 1), item('b', 1)], [item('c', 1)])
  assert.deepEqual(merged.map((i) => i.id), ['a', 'b', 'c'])
})
check('shared id keeps the further-along copy', () => {
  const merged = mergeQueues([item('a', 1)], [item('a', 4), item('b', 0)])
  assert.equal(merged.length, 2)
  assert.equal(merged.find((i) => i.id === 'a').fsrs.reps, 4)
})
check('empty other side returns local intact', () => {
  assert.equal(mergeQueues([item('a', 1)], []).length, 1)
  assert.equal(mergeQueues([], [item('a', 1)]).length, 1)
  assert.deepEqual(mergeQueues(null, null), [])
})

console.log('learner-state document merge:')
check('newer diagnosis wins, missing slices are filled', () => {
  const merged = mergeLearnerState(
    { diagnosis: { at: '2026-11-01T00:00:00Z', total: 90 } },
    { diagnosis: { at: '2026-11-04T00:00:00Z', total: 110 }, promise: { at: '2026-11-04T00:00:00Z' } },
  )
  assert.equal(merged.diagnosis.total, 110)
  assert.ok(merged.promise)
})
check('history unions by timestamp', () => {
  const merged = mergeDiagnosisHistory([{ at: '2026-11-01' }, { at: '2026-11-03' }], [{ at: '2026-11-02' }, { at: '2026-11-03' }])
  assert.equal(merged.length, 3)
  assert.equal(merged[1].at, '2026-11-02')
})

console.log('anki progress merge (per card, never overwrite):')
check('higher count wins per card, other cards survive', () => {
  const merged = mergeAnkiProgress(
    { due: { a: '2026-11-10', b: '2026-11-09' }, count: { a: 3, b: 2 }, lastDate: '2026-11-05', newToday: 1, newLimit: 20 },
    { due: { a: '2026-11-08' }, count: { a: 1, c: 5 }, lastDate: '2026-11-04', newToday: 0, newLimit: 30 },
  )
  assert.equal(merged.count.a, 3) // local further along — kept
  assert.equal(merged.due.a, '2026-11-10')
  assert.equal(merged.count.c, 5) // cloud-only card adopted
  assert.equal(merged.count.b, 2)
  assert.equal(merged.newLimit, 30)
})

console.log('restore planner:')
check('validateExport rejects non-exports', () => {
  assert.equal(validateExport(null).ok, false)
  assert.equal(validateExport({ hello: 1 }).ok, false)
  assert.equal(validateExport({ data: { 'unrelated:key': 1 } }).ok, false)
  assert.equal(validateExport({ data: { 'jpn:queue:v1': [] } }).ok, true)
})
check('foreign keys are ignored, never written', () => {
  const { writes, report } = planRestore({}, { 'evil:key': 1, 'jpn:session:v1': { x: 1 } })
  assert.equal(report.ignoredKeys, 1)
  assert.ok(!('evil:key' in writes))
  assert.ok('jpn:session:v1' in writes) // app key, gap-filled
})
check('queue restore merges and reports counts', () => {
  const current = { 'jpn:queue:v1': [item('a', 5)] }
  const imported = { 'jpn:queue:v1': [item('a', 1), item('b', 2)] }
  const { writes, report } = planRestore(current, imported)
  assert.equal(report.queueBefore, 1)
  assert.equal(report.queueAfter, 2)
  assert.equal(report.queueAdded, 1)
  assert.equal(writes['jpn:queue:v1'].find((i) => i.id === 'a').fsrs.reps, 5) // local progress kept
})
check('existing non-merge keys are kept, not overwritten', () => {
  const { writes, report } = planRestore({ 'jpn:calls:v1': { mine: true } }, { 'jpn:calls:v1': { theirs: true } })
  assert.ok(!('jpn:calls:v1' in writes))
  assert.equal(report.skippedKeys, 1)
})

console.log('tts voice scoring:')
const voice = (name, lang, localService = false) => ({ name, lang, localService })
check('a named native ja-JP voice beats a plain ja-JP voice', () => {
  const picked = pickJapaneseVoiceFrom([voice('Microsoft David', 'en-US', true), voice('Plain Voice', 'ja-JP'), voice('Kyoko', 'ja-JP', true)])
  assert.equal(picked.name, 'Kyoko')
  assert.ok(scoreJapaneseVoice(voice('Kyoko', 'ja-JP', true)) > scoreJapaneseVoice(voice('Plain Voice', 'ja-JP')))
  assert.ok(scoreJapaneseVoice(voice('Samantha', 'en-US')) < 0)
})
check('any ja voice beats a non-ja default', () => {
  const picked = pickJapaneseVoiceFrom([voice('Samantha', 'en-US', true), voice('Otoya', 'ja-JP')])
  assert.equal(picked.name, 'Otoya')
})
check('no ja voice → null (the UI labels the fallback honestly)', () => {
  assert.equal(pickJapaneseVoiceFrom([voice('Samantha', 'en-US')]), null)
  assert.equal(pickJapaneseVoiceFrom([]), null)
})

console.log('mic error copy:')
const copyText = (c) => (c ? `${c.title} ${c.body}` : '')
check('blocked mic gets recovery steps + the typing door', () => {
  const copy = micErrorCopy('not-allowed')
  assert.ok(/blocked/i.test(copy.title) && /typing/i.test(copyText(copy)))
  assert.deepEqual(micErrorCopy('service-not-allowed'), copy)
})
check('no-speech / no-mic / network each get their own plain line', () => {
  assert.ok(/catch/i.test(copyText(micErrorCopy('no-speech'))))
  assert.ok(/microphone/i.test(copyText(micErrorCopy('audio-capture'))))
  assert.ok(/connection/i.test(copyText(micErrorCopy('network'))))
})
check('aborted is deliberately silent; unknown kinds still say something', () => {
  assert.equal(micErrorCopy('aborted'), null)
  assert.ok(copyText(micErrorCopy('something-else')).length > 10)
})

console.log('diagnosis item banks:')
check('band order starts at the band and steps down before up', () => {
  assert.deepEqual(bandOrder(2), [2, 1, 3, 0, 4])
  assert.equal(bandOrder(0)[0], 0)
  assert.equal(bandOrder(4)[0], 4)
})
check('section component generalises the old 38/9 exactly', () => {
  assert.equal(sectionComponent(1, 1), 38)
  assert.equal(sectionComponent(0, 1), 9)
  assert.equal(sectionComponent(2, 2), 38)
  assert.equal(sectionComponent(1, 2), 24) // 9 + 29/2, rounded
  assert.equal(sectionComponent(0, 0), 9)
})
const fakeDict = {
  entries: Array.from({ length: 24 }, (_, i) => ({
    word: `単語${i}`, reading: `たんご${i}`, meaning: `word ${i}`, level: 'N3', type: 'Vocab',
  })),
}
check('selection returns two per section, deck-generated where no real bank exists', () => {
  const sel = selectDiagnosisItems(fakeDict, 2, {})
  assert.equal(sel.listening.length, 2)
  assert.equal(sel.reading.length, 2)
  assert.equal(sel.band, 'N3')
  // Reading has NO real items below N2/N2-only pool → at N3 the real N2
  // passages fill the set (band order reaches N2); listening at N3 is real.
  assert.ok(sel.listening.every((i) => i.id && i.question?.options?.length >= 2))
})
check('rotation: last run’s items are excluded while alternatives exist', () => {
  const first = selectDiagnosisItems(fakeDict, 2, {})
  const second = selectDiagnosisItems(fakeDict, 2, {
    listening: first.listening.map((i) => i.id),
    reading: first.reading.map((i) => i.id),
  })
  const firstIds = new Set([...first.listening, ...first.reading].map((i) => i.id))
  assert.ok(second.listening.every((i) => !firstIds.has(i.id)), 'listening rotated')
})

console.log('gate metrics summary:')
check('no proof points → the North Star is null, never a flattering 0', () => {
  const s = summariseMetrics([{ type: 'session_completed', minutes: 10, proof: 0 }])
  assert.equal(s.minutesPerProofPoint, null)
  assert.equal(s.sessions, 1)
})
check('minutes per proof point from real events only', () => {
  const s = summariseMetrics([
    { type: 'session_completed', minutes: 10, proof: 2 },
    { type: 'session_completed', minutes: 5, proof: 1 },
    { type: 'call_outcome', outcome: 'kept' },
    { type: 'call_outcome', outcome: 'partial' },
    { type: 'call_outcome', outcome: 'missed' },
    { type: 'diagnosis_completed', total: 100 },
  ])
  assert.equal(s.minutesPerProofPoint, 5)
  assert.equal(s.callsKept + s.callsPartial + s.callsMissed, 3)
  assert.equal(s.diagnoses, 1)
})

console.log('level-matched mocks:')
check('pass mark belongs to the paper level (N5 80 · N1 100)', () => {
  const mkExam = (level) => ({
    level,
    sections: [{ groups: [{ name: 'g', questions: [{ id: 'q1', type: 'reading', options: [{ label: 'a', correct: true }] }] }] }],
  })
  assert.equal(scoreExam(mkExam('N5'), { q1: 0 }).passMark, 80)
  assert.equal(scoreExam(mkExam('N1'), { q1: 0 }).passMark, 100)
  assert.equal(scoreExam(mkExam('N2'), { q1: 0 }).passMark, 90)
})
check('a non-N2 paper labels its estimated sections', () => {
  const exam = buildMockExam('quick', 42, { level: 'N3', dict: fakeDict })
  assert.equal(exam.level, 'N3')
  const sections = exam.meta.estimated.map((e) => e.section)
  assert.ok(sections.some((s) => /Grammar/.test(s)), 'grammar labelled')
  assert.ok(sections.some((s) => /Reading/.test(s)), 'reading labelled')
})
check('an N2 paper claims no estimates it does not make', () => {
  const exam = buildMockExam('quick', 42, { level: 'N2', dict: null })
  assert.equal(exam.level, 'N2')
  assert.equal(exam.meta.estimated.length, 0)
})

console.log(`\nreadiness: ${passed} checks passed`)
