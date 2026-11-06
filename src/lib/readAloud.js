// Read-aloud scoring for the WEB Reader (Doc 16 §5 amendment #5) —
// the free route to R2's proof-of-reading on this surface.
//
// The Telegram surface proves a read with a voice note whose server-
// side transcription waits on a keyed STT slot (Doc 16 §6). The web
// surface needs no key and no server of ours: the browser's own Web
// Speech API (window.SpeechRecognition / webkitSpeechRecognition)
// transcribes in the page, free, and THIS module scores the
// transcript against the passage text in code — deterministic,
// Tier 0, exactly the spine/senses split the rest of the Reader
// keeps. (The transcription itself is the browser vendor's built-in
// service; Yonde receives only the transcript text, in-page, and
// keeps only the score.)
//
// The scoring is pure text maths over two strings, pinned by
// tests/reader.test.mjs. Since Doc 16 §5 amendment #6 it HAS a
// server twin — supabase/functions/reader-bot/score.ts — because
// the Telegram surface now scores too (Groq Whisper transcription,
// server-side). TWIN WARNING: change both files together; the test
// suite imports both and runs them over shared fixtures.
//
// HONESTY: the score is a TEXT MATCH — how much of the passage's
// characters the learner's voice covered, in order. It is NOT a
// pronunciation grade, and every surface that shows it says so.
// Speech recognition also mis-hears: it swaps kanji for homophones
// and drops particles, so an honest full read rarely scores 1.0.
// The threshold below is set with that noise in mind, never against
// the learner.

/**
 * The score at/above which a web read-aloud counts as a comfortable
 * read (the same effect a Telegram voice note inside its duration
 * window earns — Doc 16 §5 amendment #4's machinery, applyFeedback
 * 'read'). Justification: coverage counts passage characters actually
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
