// Yonde Reader fitting simulation (Doc 16 §5 amendment, 2026-11-06).
//
// Run: node scripts/simulate-reader-fit.mjs
//
// Rebuilds the bank in memory and asks, per learner band: what share
// of the passages inside the ±1 band window pass the 0.93–0.97 gate
// for a typical learner? Profiles are deterministic (seeded sampling):
//
//   P1 diagnosed + modest queue — band from diagnosis (so below-band
//      deck credit applies), queue = 40 fronts sampled from the deck
//      at the learner's own band.
//   P2 diagnosed + empty queue — credit alone, the floor case.
//   P3 no diagnosis — queue = 40 fronts, NO credit (conservative by
//      design); the bot selects at the N4 default for this profile,
//      but all bands are shown for comparison.
//
// The pre-calibration baseline (2026-11-06, same profiles, old surface
// matching + queue-only known set + old tokenisation) passed 0% in
// every band, best ratio 0.73–0.76 — queue size made no difference,
// because whole-token surface matching almost never hit.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseDeckEntry } from '../src/lib/dictionary.js'
import * as fit from '../src/lib/readerFit.js'
import { buildRows, buildDeckLevels } from './build-reader-bank.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const passages = buildRows()
const deckLevels = buildDeckLevels()

const rows = JSON.parse(readFileSync(join(root, 'public/data/ankiVocab.json'), 'utf8')).map(parseDeckEntry)
const deckByLevel = {}
for (const e of rows) (deckByLevel[e.level] ||= []).push(e.word)

const lcg = (seed) => () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff
function sampleQueue(band, n, seed) {
  const pool = [...new Set(deckByLevel[band] || [])]
  const rnd = lcg(seed)
  const picked = new Set()
  while (picked.size < Math.min(n, pool.length)) picked.add(pool[Math.floor(rnd() * pool.length)])
  return [...picked].map((front) => ({ front }))
}
const seedFor = (band) => 42 + band.length * 7 + band.charCodeAt(1)

function report(title, knownForBand) {
  console.log(`\n== ${title} ==`)
  for (const band of fit.BANDS) {
    const known = knownForBand(band)
    const rank = fit.bandRank(band)
    const inWindow = passages.filter((p) => Math.abs(fit.bandRank(p.band) - rank) <= 1)
    let pass = 0
    let best = 0
    for (const p of inWindow) {
      const r = fit.passageRatio(p.tokens, known)
      if (r > best) best = r
      if (r >= fit.RATIO_MIN && r <= fit.RATIO_MAX) pass++
    }
    console.log(
      `${band}: window ${inWindow.length} passages, pass ${pass} (${inWindow.length ? Math.round((pass / inWindow.length) * 100) : 0}%), best ratio ${best.toFixed(2)}`,
    )
  }
}

console.log(`bank: ${passages.length} passages, deck: ${deckLevels.size} headwords`)
report('P1 diagnosed + modest queue (40 at-band fronts) + below-band credit', (band) =>
  fit.buildKnownSet(sampleQueue(band, 40, seedFor(band)), [], fit.deckCreditSet(deckLevels, band)))
report('P2 diagnosed + empty queue (credit alone)', (band) =>
  fit.buildKnownSet([], [], fit.deckCreditSet(deckLevels, band)))
report('P3 no diagnosis + modest queue (40 at-band fronts), NO credit', (band) =>
  fit.buildKnownSet(sampleQueue(band, 40, seedFor(band)), []))

// P1b: the Yonde-journey profile. In the real product the queue is
// stocked BY the app — Voice Loop misses, lesson words, mining — so a
// typical learner's queue overlaps the app's own content vocabulary
// far more than a uniform deck sample does. This profile samples the
// 40 queue fronts from the headwords the app's own at-band passages
// use (the content the learner has been studying), same credit rules.
const contentPool = {}
for (const band of fit.BANDS) {
  const pool = new Set()
  for (const p of passages) {
    if (p.band !== band) continue
    for (const t of p.tokens) if (t.l === band) pool.add(t.h)
  }
  contentPool[band] = [...pool]
}
function sampleContentQueue(band, n, seed) {
  const pool = contentPool[band]
  const rnd = lcg(seed)
  const picked = new Set()
  while (picked.size < Math.min(n, pool.length)) picked.add(pool[Math.floor(rnd() * pool.length)])
  return [...picked].map((front) => ({ front }))
}
report('P1b diagnosed + app-content queue (40 fronts from at-band content) + credit', (band) =>
  fit.buildKnownSet(sampleContentQueue(band, 40, seedFor(band)), [], fit.deckCreditSet(deckLevels, band)))
