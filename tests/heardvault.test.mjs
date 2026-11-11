// Heard Words vault — aggregation tests (run: node tests/heardvault.test.mjs)
// Pins for Doc 22's vault (Landry, 2026-11-11): the per-day rows
// aggregate into one entry per distinct word; the mastered set
// uses the product's own bars (queue reps >= 3, encounters);
// the floor splits named words from once-heard ones.

import assert from 'node:assert'
import { aggregateHeardRows, masteredSetFrom, vaultSummary, sortVaultEntries, VAULT_FLOOR } from '../src/lib/heardVault.js'

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

check('rows aggregate per item across days', () => {
  const { entries, dayTotal } = aggregateHeardRows([
    { item: '会議', kind: 'word', count: 3, day: '2026-11-09' },
    { item: '会議', kind: 'word', count: 2, day: '2026-11-10' },
    { item: '駅', kind: 'word', count: 1, day: '2026-11-10' },
  ])
  const kaigi = entries.find((e) => e.item === '会議')
  assert.equal(kaigi.total, 5)
  assert.equal(kaigi.dayCount, 2)
  assert.equal(kaigi.firstDay, '2026-11-09')
  assert.equal(kaigi.lastDay, '2026-11-10')
  assert.equal(dayTotal, 2)
})

check('dirty rows are dropped or clamped, never trusted', () => {
  const { entries } = aggregateHeardRows([
    { item: '  ', kind: 'word', count: 4, day: '2026-11-09' },
    { item: '水', kind: 'word', count: -3, day: '2026-11-09' },
    null, undefined, { count: 2 },
  ])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].total, 0)
})

check('mastered = queue reps>=3 or encountered; nothing else', () => {
  const set = masteredSetFrom(
    [
      { front: '会議', fsrs: { reps: 3 } },
      { front: '駅', fsrs: { reps: 1 } },
      { front: '水', fsrs: { reps: 5 } },
      { front: '空', fsrs: null },
    ],
    ['空', ' 雨 '],
  )
  assert.ok(set.has('会議'))
  assert.ok(!set.has('駅'))
  assert.ok(set.has('水'))
  assert.ok(set.has('空')) // encounter credit
  assert.ok(set.has('雨')) // trimmed
})

check('summary counts kept / named / once / hearings / mastered', () => {
  const { entries } = aggregateHeardRows([
    { item: '会議', kind: 'word', count: 5, day: '2026-11-09' },
    { item: '駅', kind: 'word', count: 1, day: '2026-11-09' },
    { item: '水', kind: 'word', count: VAULT_FLOOR, day: '2026-11-10' },
  ])
  const s = vaultSummary(entries, new Set(['会議']))
  assert.deepEqual(s, { kept: 3, named: 2, once: 1, hearings: 8, mastered: 1 })
})

check('sort: most-heard first, then most recent; recent mode leads with the day', () => {
  const { entries } = aggregateHeardRows([
    { item: 'a', kind: 'word', count: 2, day: '2026-11-08' },
    { item: 'b', kind: 'word', count: 2, day: '2026-11-10' },
    { item: 'c', kind: 'word', count: 9, day: '2026-11-01' },
  ])
  assert.deepEqual(sortVaultEntries(entries, 'heard').map((e) => e.item), ['c', 'b', 'a'])
  assert.deepEqual(sortVaultEntries(entries, 'recent').map((e) => e.item), ['b', 'a', 'c'])
})

console.log(`heardvault: ${passed} checks passed`)
