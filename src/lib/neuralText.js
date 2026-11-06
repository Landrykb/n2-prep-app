// Pure helpers for the neural call voice (Doc 17 decision, 2026-11-06:
// free Edge TTS route). Kept free of browser/Supabase imports so the
// node test suite can pin the contract; the runtime that uses them
// lives in neuralVoice.js.
//
// The cap mirrors the tts edge function's MAX_TTS_CHARS: a text the
// server would reject never leaves the device — the caller goes
// straight to the device voice instead of wasting a round trip.

export const NEURAL_TTS_MAX_CHARS = 600

/**
 * The text to send to the neural voice, or null when it should not be
 * sent at all (not a string, empty once trimmed, or over the cap).
 * The server still validates independently — this is a latency
 * shortcut, not the gate.
 */
export function prepareNeuralText(text) {
  if (typeof text !== 'string') return null
  const clean = text.trim()
  if (!clean) return null
  if (clean.length > NEURAL_TTS_MAX_CHARS) return null
  return clean
}

/**
 * Estimated spoken duration of a line, the same estimate tts.js uses
 * for its safety timer (1200ms + 90ms per character, scaled by rate).
 * neuralVoice.js adds network slack on top for its watchdog; spotlight
 * timing in SenseiCall uses the base estimate, unchanged.
 */
export function estimateSpeechMs(text, rate = 1) {
  const r = typeof rate === 'number' && rate > 0 ? rate : 1
  return Math.round((1200 + 90 * (text || '').length) / r)
}
