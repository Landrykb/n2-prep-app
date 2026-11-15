// Kanji cards (2026-11-15): the echo schedule is ONE schedule
// shared by the Telegram bot and the app — pin the two copies
// together, and pin the schedule math the app writes with.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok', name)
  } catch (err) {
    console.error('FAIL', name)
    throw err
  }
}

const lib = await import('../src/lib/cardSchedule.js')
const botSrc = readFileSync(
  new URL('../supabase/functions/reader-bot/index.ts', import.meta.url),
  'utf8',
)

check('echo hours: app and bot copies are identical', () => {
  const m = botSrc.match(/CARD_ECHO_HOURS = \[([0-9, ]+)\]/)
  assert.ok(m, 'bot CARD_ECHO_HOURS not found')
  const botHours = m[1].split(',').map((x) => Number(x.trim()))
  assert.deepEqual(lib.CARD_ECHO_HOURS, botHours)
})

check('echo hours: the approved best-practice shape', () => {
  assert.deepEqual(lib.CARD_ECHO_HOURS, [0, 4, 9, 24, 48, 96, 168, 336, 720, 1440])
  assert.equal(lib.CARD_TOTAL, 10)
})

check('nextDueFor: offsets ride from the first meeting', () => {
  const first = '2026-11-15T00:00:00.000Z'
  assert.equal(lib.nextDueFor(first, 1).toISOString(), '2026-11-15T04:00:00.000Z')
  assert.equal(lib.nextDueFor(first, 3).toISOString(), '2026-11-16T00:00:00.000Z')
  assert.equal(lib.nextDueFor(first, 9).toISOString(), '2027-01-14T00:00:00.000Z')
})

check('nextDueFor: a completed run parks a year out', () => {
  const first = '2026-11-15T00:00:00.000Z'
  assert.equal(lib.nextDueFor(first, 10).toISOString(), '2027-11-15T00:00:00.000Z')
})

console.log(`kanjicards: ${passed} checks passed`)
