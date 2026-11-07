// Diagnosis item banks (P0-2 fix).
//
// Before this module, the listening score rested on the FIRST N3 dialogue
// and the reading score on the FIRST passage — the same two items, every
// run, forever. Re-diagnosis "growth" could be pure memorisation, and one
// coin-flip item could swing a section across the 19/60 line and flip the
// written Promise with it.
//
// Now: listening and reading each draw TWO items from a level-banded pool
// (listeningPlus dialogues / reading passages), rotated so the items used
// last time are excluded whenever the pool allows. Section maths keeps
// its shape — language*0.35 + a section component — with the old binary
// component (38 right / 9 wrong) generalised to a proportion:
// 9 + 29 * (correct / items). With one item it reduces to the old numbers
// exactly.
//
// Pool reality, stated plainly: listening has real items at every level
// (N2 only one); reading passages exist only at N2. Where a band lacks
// real items, items are GENERATED FROM THE DECK — a real deck word, its
// real reading and meaning, inside one fixed template frame, with
// distractors drawn from real deck meanings at the same level. No
// Japanese is invented beyond those frames, and generated items are
// flagged (`generated: true`) all the way into the result's sample
// record, so trends can see what the score was actually built from.

import { listeningPlus } from '../data/listeningPlus.js'
import { passages } from '../data.js'
import { quizPool } from './dictionary.js'

export const LEVEL_IDS = ['N5', 'N4', 'N3', 'N2', 'N1']
export const ITEMS_PER_SECTION = 2

// The item-bank/selection scheme version. There is no upstream bank
// version to read — the SELECTION SCHEME is the versioned thing: pools,
// banding, rotation and the generated-item frames in this module. Bump
// this whenever a change would make an in-progress diagnosis draft
// (lib/diagnosisDraft.js) meaningless to resume.
export const DIAGNOSIS_ITEMS_VERSION = 1

const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

/** Level visit order for a band: exact, one below, one above, then out. */
export function bandOrder(bandIdx) {
  const out = []
  for (const off of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
    const i = bandIdx + off
    if (i >= 0 && i < LEVEL_IDS.length && !out.includes(i)) out.push(i)
  }
  return out
}

export const listeningItemId = (item) => `L:${item.title}`
export const readingItemId = (item) => `R:${item.title}`

function normaliseListening(item) {
  const q = item.questions?.[0]
  if (!q) return null
  return { id: listeningItemId(item), level: item.level, generated: false, title: item.title, script: item.script, question: q }
}
function normaliseReading(item) {
  const q = item.questions?.[0]
  if (!q) return null
  return { id: readingItemId(item), level: item.level, generated: false, title: item.title, text: item.text, question: q }
}

/** A listening item built from one real deck entry: the word is spoken,
 *  the question asks its (real) meaning, distractors are real meanings
 *  of other words at the same level. */
export function generatedListeningItem(dict, levelId, usedWords) {
  const pool = quizPool(dict, { levels: [levelId] }).filter((e) => !usedWords.has(e.word))
  if (pool.length < 4) return null
  const entry = pick(pool)
  usedWords.add(entry.word)
  const distractors = shuffle(pool.filter((e) => e.word !== entry.word && e.meaning !== entry.meaning)).slice(0, 3)
  if (distractors.length < 3) return null
  return {
    id: `genL:${entry.word}`, level: levelId, generated: true, title: 'One Word, By Ear',
    script: entry.word,
    question: {
      prompt: 'You will hear one word. What does it mean?',
      options: shuffle([entry.meaning, ...distractors.map((d) => d.meaning)]).map((label) => ({ label, correct: label === entry.meaning })),
    },
  }
}

/** A reading item built from one real deck entry inside a fixed frame.
 *  The frame is the only Japanese beyond the entry itself — a template,
 *  not an invention. */
export function generatedReadingItem(dict, levelId, usedWords) {
  const pool = quizPool(dict, { levels: [levelId] }).filter((e) => !usedWords.has(e.word))
  if (pool.length < 4) return null
  const entry = pick(pool)
  usedWords.add(entry.word)
  const distractors = shuffle(pool.filter((e) => e.word !== entry.word && e.meaning !== entry.meaning)).slice(0, 3)
  if (distractors.length < 3) return null
  return {
    id: `genR:${entry.word}`, level: levelId, generated: true, title: 'One Word, In Writing',
    text: `「${entry.word}」${entry.reading ? `（${entry.reading}）` : ''}という言葉があります。この言葉の意味は何ですか。`,
    question: {
      prompt: 'What does this word mean?',
      options: shuffle([entry.meaning, ...distractors.map((d) => d.meaning)]).map((label) => ({ label, correct: label === entry.meaning })),
    },
  }
}

function selectFromPool(realItems, bandIdx, { count, excludeIds, makeGenerated }) {
  const byLevel = new Map()
  for (const item of realItems) {
    if (!byLevel.has(item.level)) byLevel.set(item.level, [])
    byLevel.get(item.level).push(item)
  }
  const order = bandOrder(bandIdx)
  const chosen = []
  // Pass 1: fresh items only (rotation — never repeat last run's items
  // while alternatives exist). Pass 2: allow repeats if the pool is dry.
  for (const allowReuse of [false, true]) {
    for (const li of order) {
      if (chosen.length >= count) break
      const pool = shuffle(byLevel.get(LEVEL_IDS[li]) || [])
      for (const item of pool) {
        if (chosen.length >= count) break
        if (!allowReuse && excludeIds.has(item.id)) continue
        if (chosen.some((c) => c.id === item.id)) continue
        chosen.push(item)
      }
    }
    if (chosen.length >= count) break
  }
  // Top up with deck-generated items at the band level.
  const usedWords = new Set()
  while (chosen.length < count) {
    const gen = makeGenerated(LEVEL_IDS[bandIdx], usedWords)
    if (!gen) break
    chosen.push(gen)
  }
  return chosen
}

/**
 * Select this run's listening + reading items.
 * @param dict      the loaded dictionary (for generated top-ups)
 * @param bandIdx   index into LEVEL_IDS — the band the run is pitched at
 * @param lastUsed  { listening: string[], reading: string[] } item ids
 *                  used by the previous run (excluded when possible)
 */
export function selectDiagnosisItems(dict, bandIdx, lastUsed = {}) {
  const realListening = listeningPlus.map(normaliseListening).filter(Boolean)
  const realReading = passages.map(normaliseReading).filter(Boolean)
  const listening = selectFromPool(realListening, bandIdx, {
    count: ITEMS_PER_SECTION,
    excludeIds: new Set(lastUsed.listening || []),
    makeGenerated: (levelId, used) => (dict ? generatedListeningItem(dict, levelId, used) : null),
  })
  const reading = selectFromPool(realReading, bandIdx, {
    count: ITEMS_PER_SECTION,
    excludeIds: new Set(lastUsed.reading || []),
    makeGenerated: (levelId, used) => (dict ? generatedReadingItem(dict, levelId, used) : null),
  })
  return { listening, reading, band: LEVEL_IDS[bandIdx] }
}

/** Section score component: the old 38/9 binary generalised to a share. */
export function sectionComponent(correct, total) {
  if (!total) return 9
  return Math.round(9 + 29 * (correct / total))
}
