// Loads the generated kanji library (public/data/kanji/{LEVEL}.json), produced
// by scripts/build-kanji.mjs from KANJIDIC2 + KanjiVG + the Anki deck. Split by
// JLPT level so a learner studying N2 only downloads ~200 kB, not all 2,136 kanji.
//
// The hand-written entries in src/data.js (kanjiLessons) have a fully authored
// example sentence + glossary for a handful of characters; those are merged on
// top of the generated data so nothing is lost.

import { kanjiLessons } from '../data.js'

export const KANJI_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1']

const byHandwritten = new Map(kanjiLessons.map((k) => [k.char, k]))

function withHandwrittenOverride(entry) {
  const hand = byHandwritten.get(entry.char)
  if (!hand) return entry
  // Keep the generated entry's structure/radicals/level, but prefer the
  // hand-authored story and example sentence where they exist.
  return {
    ...entry,
    story: hand.story || entry.story,
    storyFr: hand.storyFr || entry.storyFr,
    example: hand.example || entry.example,
    exampleGlossary: hand.exampleGlossary?.length ? hand.exampleGlossary : entry.exampleGlossary,
    doodle: hand.doodle || entry.doodle,
    gradient: hand.gradient || entry.gradient,
  }
}

const cache = new Map()

/** Fetch and cache one level's kanji list (~100-700 entries). */
export function loadKanjiLevel(level) {
  if (!cache.has(level)) {
    cache.set(
      level,
      fetch(`/data/kanji/${level}.json`)
        .then((r) => {
          if (!r.ok) throw new Error(`kanji/${level}.json request failed (${r.status})`)
          return r.json()
        })
        .then((rows) => rows.map(withHandwrittenOverride))
        .catch(() => [])
    )
  }
  return cache.get(level)
}

/** Fetch every level and flatten into one list (used by search/quiz pools). */
export function loadAllKanji() {
  return Promise.all(KANJI_LEVELS.map(loadKanjiLevel)).then((lists) => lists.flat())
}
