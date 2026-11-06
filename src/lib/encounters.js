// Encounters (Doc 16 §5 amendment #10, Fit v2): the words a learner
// has GENUINELY MET outside the one queue. The fitting known set used
// to see only queue fronts plus below-band deck credit — an
// assumption. An encounter is evidence: the word was on the screen,
// in front of this learner, in a surface that recorded the meeting.
// Encounter words therefore earn FULL credit in the known set (they
// ride buildKnownSet's personal-vocab slot) and define the seen-
// kanji set the dose ranking reads.
//
// SOURCES — only stores with a real persisted per-word record:
//   · Anki (the deck tab): progress is { due, count } keyed by card
//     id; a card id appears there only after the learner RATED the
//     card (any rating — the card was seen and judged). The words
//     are derived where cards and progress coexist (Anki.jsx) and
//     recorded into the store below, because the deck itself is a
//     fetched asset the sync layer cannot read synchronously.
//   · Speed Cards (drills): speedStats persists { m, h } per
//     `word|reading` key; a key exists only after the learner
//     ANSWERED that prompt. Derived live at collect time.
// NOT sources (inspected, excluded — no per-word record exists):
//   · Grammar lessons: no persisted per-word progress store at all.
//   · VoiceLoop: its mastered store is keyed by SCENE, not by word.
//   · Diagnosis: its misses already land in the queue / error log,
//     which the known set reads directly.
//
// The store is a plain word list under ENCOUNTERS_KEY, carried in
// the learner_state document as the `encounters` slice and union-
// merged (stateMerge.mergeEncounters) — it never shrinks.

import { emitLearnerStateSaved } from './stateEvents.js'
import { loadStats } from './speedStats.js'

export const ENCOUNTERS_KEY = 'jpn:encounters:v1'
const ENCOUNTERS_CAP = 12000

const cleanWords = (words) => {
  const out = []
  const seen = new Set()
  for (const w of words || []) {
    if (typeof w !== 'string') continue
    const word = w.trim()
    if (!word || seen.has(word)) continue
    seen.add(word)
    out.push(word)
  }
  return out
}

export function loadEncounters() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ENCOUNTERS_KEY) || '[]')
    return Array.isArray(parsed) ? cleanWords(parsed) : []
  } catch { return [] }
}

/**
 * Union new words into the encounter store. Emits the state-saved
 * event ONLY when something was actually added, so callers can run
 * it on every render/mount without churn. Returns the full list.
 */
export function recordEncounters(words) {
  const current = loadEncounters()
  const seen = new Set(current)
  const fresh = cleanWords(words).filter((w) => !seen.has(w))
  if (fresh.length === 0) return current
  const next = [...current, ...fresh].slice(0, ENCOUNTERS_CAP)
  try {
    localStorage.setItem(ENCOUNTERS_KEY, JSON.stringify(next))
    emitLearnerStateSaved()
  } catch { /* storage unavailable — encounters simply stay local-session */ }
  return next
}

/**
 * Anki encounter words from a progress object and the deck cards:
 * every card whose id carries a rating record (present in `due` —
 * every rating writes a due date — or with a positive `count`).
 * Cards merely DISPLAYED in a list were never rated and are not
 * encounters; the rating is the meeting.
 */
export function ankiEncounterWords(progress, cards) {
  const byId = new Map((cards || []).filter((c) => c?.id && c?.front).map((c) => [c.id, c.front]))
  const ids = new Set([
    ...Object.keys(progress?.due || {}),
    ...Object.keys(progress?.count || {}).filter((id) => (progress.count[id] || 0) > 0),
  ])
  return cleanWords([...ids].map((id) => byId.get(id)).filter(Boolean))
}

/**
 * Speed Cards encounter words from the persisted stats: the word
 * half of each `word|reading` key with at least one recorded
 * answer (hit or miss — both are meetings).
 */
export function speedEncounterWords(stats) {
  const words = []
  for (const [key, rec] of Object.entries(stats || {})) {
    if (((rec?.m || 0) + (rec?.h || 0)) < 1) continue
    words.push(String(key).split('|')[0])
  }
  return cleanWords(words)
}

/**
 * The full encounter list for the state document: the recorded
 * store (Anki derivations land there) unioned with the live Speed
 * Cards derivation, so a drill word counts from the moment it is
 * answered even before anything records it anywhere else.
 */
export function collectEncounterWords() {
  return cleanWords([...loadEncounters(), ...speedEncounterWords(loadStats())])
}
