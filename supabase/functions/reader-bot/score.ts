// Yonde Reader read-aloud scoring — SERVER PORT (Doc 16 §5
// amendments #5/#6).
//
// This is a near-verbatim port of src/lib/readAloud.js. The client
// module (the web Reader's Read It Aloud) and this port must agree
// exactly: a read the app calls a 0.8 match is the read the bot
// calls a 0.8 match — one ruler for the proof-of-reading, whichever
// surface measured it. The bot's surface arrived with amendment #6:
// the Telegram voice note is transcribed by Groq's Whisper
// (READER_STT_API_KEY) and scored HERE, in code — the transcription
// is an AI sense; the score is spine, like every Reader verdict.
//
// TWIN WARNING: change both files together. Parity + behaviour are
// pinned by tests/reader.test.mjs, which imports both
// implementations and runs them over shared fixtures.
//
// Deliberately written in plain-JS syntax (no TS-only constructs)
// so the node test can load this file unmodified — the same trick
// as fit.ts / segment.ts.
//
// HONESTY: the score is a TEXT MATCH — how much of the passage's
// characters the learner's voice covered, in order. It is NOT a
// pronunciation grade, and every surface that shows it says so.
// Speech recognition also mis-hears: it swaps kanji for homophones
// and drops particles, so an honest full read rarely scores 1.0.
// The threshold below is set with that noise in mind, never against
// the learner.

/**
 * The score at/above which a read-aloud counts as a comfortable
 * read (amendment #4's applyFeedback 'read' transition).
 * Justification: coverage counts passage characters actually
 * voiced, in order, so a skim or half-read lands near the fraction
 * read (~0.3–0.5), while a careful full read under real ASR noise
 * lands ~0.75–0.95. 0.7 sits below honest-read noise and above any
 * partial read — the same forgiving stance as the Telegram duration
 * window (0.35×–2.75×): a proof should never accuse an honest reader.
 */
export const READ_ALOUD_PASS_SCORE = 0.7

/**
 * Normalise a Japanese text or transcript for comparison: unicode
 * compatibility forms folded (NFKC — half-width kana, full-width
 * digits), then every space, punctuation mark and symbol removed.
 * What survives is the character stream the match runs over: kanji,
 * kana, letters, digits. Two texts that differ only in punctuation
 * or spacing normalise identically.
 */
export function normalizeSpeechText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** Longest common subsequence length over code-point arrays. */
function lcsLength(a, b) {
  if (a.length === 0 || b.length === 0) return 0
  let prev = new Array(b.length + 1).fill(0)
  let curr = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = 0
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

/**
 * Score a read-aloud transcript against its passage.
 *   returns { score, matchedChars, targetChars }
 * score is COVERAGE: the share of the passage's normalised
 * characters that appear in the transcript, in order (an LCS ratio).
 * Order matters — reading the passage means reading ITS sequence —
 * but insertions (a restart, a self-correction, an ASR stutter) cost
 * nothing, and a missed stretch costs exactly its length. An empty
 * passage or an empty transcript scores 0: no text, no proof.
 */
export function scoreReadAloud(passageText, transcript) {
  const target = [...normalizeSpeechText(passageText)]
  const said = [...normalizeSpeechText(transcript)]
  if (target.length === 0 || said.length === 0) {
    return { score: 0, matchedChars: 0, targetChars: target.length }
  }
  const matchedChars = lcsLength(target, said)
  return { score: matchedChars / target.length, matchedChars, targetChars: target.length }
}

/**
 * Nao's one fix: the FIRST of the passage's new-word candidates (in
 * the order the passage presents them) that does not appear in the
 * transcript — checked by surface word first, then by dictionary
 * headword (a learner may voice the dictionary form, or recognition
 * may return it). Returns the candidate itself, or null when every
 * candidate was voiced. ONE fix only, ever (Hick's Law): the caller
 * shows this single card and nothing else competes with it.
 */
export function firstMissedCandidate(candidates, transcript) {
  const said = normalizeSpeechText(transcript)
  if (!said) return null
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c?.word) continue
    const forms = [c.word, c.h].map((f) => normalizeSpeechText(f)).filter(Boolean)
    if (forms.length === 0) continue
    if (!forms.some((f) => said.includes(f))) return c
  }
  return null
}

// ---------- the repair ladder (Doc 16 amendment #34) ----------
// When a read misses, the learner is never again asked to repeat
// the WHOLE passage and then graded on the whole passage for a
// part-read (the 7% failure the owner hit on 2026-11-18: the bot
// asked for one sentence, he sent one sentence, and it was scored
// against everything). Instead the miss is repaired in chunks:
// the missed sentences one at a time, then the passage in two
// halves, then the whole passage once more. The helpers below are
// the shared maths of that ladder — which sentences missed, how
// the passage halves — so both surfaces climb the same ladder.
// The hard rule the ladder exists for: a chunk retry is graded
// against its chunk ONLY (scoreReadAloud(chunk, transcript)),
// never against the passage it came from.

/**
 * Split a passage into its sentences: a sentence ends at 。！？
 * or a newline, the terminator stays with its sentence, pieces
 * are trimmed, and pieces with no speakable characters (a stray
 * terminator) drop. The same split the surfaces already use to
 * find the sentence a word lives in.
 */
export function splitPassageSentences(text) {
  return String(text ?? '')
    .split(/(?<=[。！？\n])/)
    .map((s) => s.trim())
    .filter((s) => normalizeSpeechText(s).length > 0)
}

/**
 * The candidates (new words) that live in a chunk of text — the
 * sentence or half currently being repaired — by surface word or
 * headword. Nao's one fix inside a chunk runs over this subset,
 * so the fix she names is always a word the chunk actually holds.
 */
export function candidatesInText(candidates, text) {
  const t = String(text ?? '')
  return (Array.isArray(candidates) ? candidates : []).filter((c) => {
    if (!c?.word) return false
    return t.includes(c.word) || (!!c.h && t.includes(c.h))
  })
}

/**
 * Which of the passage's sentences this read missed, as indexes
 * into splitPassageSentences(passageText), in the order the
 * repair ladder serves them. A sentence missed when its OWN
 * coverage of the transcript sits under the same pass line a
 * full read uses — the sentence was skipped, mangled, or never
 * reached. The sentence holding Nao's one fix (the first missed
 * candidate) always leads the queue when there is one: it is the
 * part the surface already named and asked about, so the ladder
 * starts exactly where the conversation left off; the remaining
 * missed sentences follow in passage order. A sentence whose
 * coverage passed can still be queued by the fix rule — speech
 * recognition can cover a sentence's sounds while swapping the
 * one word that mattered for a homophone.
 */
export function missedSentences(passageText, transcript, candidates) {
  if (!normalizeSpeechText(transcript)) return [] // no transcript — no diagnosis claimed
  const sentences = splitPassageSentences(passageText)
  const missed = []
  sentences.forEach((s, i) => {
    if (scoreReadAloud(s, transcript).score < READ_ALOUD_PASS_SCORE) missed.push(i)
  })
  const fix = firstMissedCandidate(candidates, transcript)
  if (fix) {
    const forms = [fix.word, fix.h].filter(Boolean)
    const idx = sentences.findIndex((s) => forms.some((f) => s.includes(f)))
    if (idx !== -1) {
      const at = missed.indexOf(idx)
      if (at > 0) { missed.splice(at, 1); missed.unshift(idx) }
      else if (at === -1) missed.unshift(idx)
    }
  }
  return missed
}

/**
 * The passage in two halves, split at a sentence boundary so the
 * halves balance by normalised character count as closely as
 * whole sentences allow. Returns { first, second, firstCount,
 * secondCount } (the halves' texts and their sentence counts),
 * or null when the passage has fewer than two sentences — a
 * one-sentence passage has no halves to rebuild through, and
 * its ladder goes from sentence repair straight to the full try.
 */
export function passageHalves(passageText) {
  const sentences = splitPassageSentences(passageText)
  if (sentences.length < 2) return null
  const weights = sentences.map((s) => Math.max(1, normalizeSpeechText(s).length))
  const total = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  let bestCut = 1
  let bestGap = Infinity
  for (let i = 0; i < sentences.length - 1; i++) {
    acc += weights[i]
    const gap = Math.abs(total - 2 * acc)
    if (gap < bestGap) { bestGap = gap; bestCut = i + 1 }
  }
  const first = sentences.slice(0, bestCut)
  const second = sentences.slice(bestCut)
  if (first.length === 0 || second.length === 0) return null
  return { first: first.join(''), second: second.join(''), firstCount: first.length, secondCount: second.length }
}
