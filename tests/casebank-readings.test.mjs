// Yonde case bank — readings display law (run: node tests/casebank-readings.test.mjs)
//
// The Arena method applied to Yonde (Landry, 2026-11-16): a fixed bank of
// cases with known-right answers, graded correctness-first — the produced
// readings list must equal the expected list exactly, entry for entry.
// The bank (tests/casebank/readings.json) is seeded from real failures
// Landry caught by hand on 2026-11-11; every future caught error becomes
// a permanent case here before its fix ships.
//
// Subject: kanjiReadings + spokenText in src/lib/readerFit.js (the app
// side of the twin; supabase/functions/reader-bot/fit.ts carries the
// same law and is pinned by tests/reader.test.mjs parity). The sources
// are stubbed per case: readingOf models the deck gloss — the reading
// of the dictionary entry for the word asked; compoundOf models the
// wider word source (JMdict supplement / WordsDB); altOf models the
// alternate-readings source (Landry's two-readings rule, 2026-11-20).

import assert from 'node:assert'
import { readFileSync } from 'node:fs'

const { kanjiReadings, spokenText } = await import('../src/lib/readerFit.js')
const bank = JSON.parse(readFileSync(new URL('./casebank/readings.json', import.meta.url), 'utf8'))

let passed = 0
const failures = []
for (const c of bank.cases) {
  const readingOf = (w) => c.readingOf[w]
  const compoundOf = c.compoundOf ? (w) => c.compoundOf[w] : undefined
  const altOf = c.altOf ? (w) => c.altOf[w] : undefined
  let got
  try {
    got = kanjiReadings(c.tokens, readingOf, undefined, compoundOf, altOf).map((e) => {
      const out = { word: e.word, reading: e.reading }
      if (Array.isArray(e.alts) && e.alts.length) out.alts = e.alts
      return out
    })
    assert.deepStrictEqual(got, c.expect)
    passed++
    console.log(`  ok ${c.id}`)
  } catch (e) {
    failures.push(c.id)
    console.log(`  FAIL ${c.id}`)
    console.log(`    expected: ${JSON.stringify(c.expect)}`)
    console.log(`    got:      ${JSON.stringify(got)}`)
    console.log(`    pins:     ${c.pins}`)
  }
}
console.log(`\ncasebank readings: ${passed}/${bank.cases.length} cases pass`)

let spokenPassed = 0
const spokenFailures = []
for (const c of bank.spokenCases || []) {
  const readingOf = (w) => c.readingOf[w]
  const altOf = (w) => (c.altOf || {})[w]
  let got
  try {
    got = spokenText(c.tokens, readingOf, altOf)
    assert.strictEqual(got, c.expect)
    spokenPassed++
    console.log(`  ok ${c.id}`)
  } catch (e) {
    spokenFailures.push(c.id)
    console.log(`  FAIL ${c.id}`)
    console.log(`    expected: ${JSON.stringify(c.expect)}`)
    console.log(`    got:      ${JSON.stringify(got)}`)
    console.log(`    pins:     ${c.pins}`)
  }
}
if (bank.spokenCases) console.log(`casebank spoken: ${spokenPassed}/${bank.spokenCases.length} cases pass`)

const allFailures = [...failures, ...spokenFailures]
if (allFailures.length) {
  console.error(`FAILING CASES: ${allFailures.join(', ')}`)
  process.exit(1)
}
