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
