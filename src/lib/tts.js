// Central Japanese text-to-speech (P1-2 fix).
//
// Before this module, every call site set `u.lang = 'ja-JP'` and hoped the
// device default voice was Japanese. On many Windows/Android builds it is
// not — so the model pronunciation learners copy could arrive in an English
// voice, silently. This picker chooses a real Japanese voice when one
// exists, caches the choice, and reports honestly when none exists so the
// UI can label the fallback instead of pretending.
//
// Voice loading is async in every browser: getVoices() often returns []
// until 'voiceschanged' fires. ensureVoices() waits for that (with a short
// timeout) so a first tap does not race an empty list.

export const hasJapaneseText = (text) =>
  /[぀-ヿ㐀-䶿一-鿿ｱ-ﾝ]/.test(text || '')

/** Pure scoring so tests can pin the preference order. Higher = better. */
export function scoreJapaneseVoice(v) {
  if (!v) return -1
  const lang = (v.lang || '').toLowerCase()
  const name = (v.name || '').toLowerCase()
  let score = 0
  if (lang === 'ja-jp') score += 100
  else if (lang.startsWith('ja')) score += 60
  else return -1 // not a Japanese voice at all
  if (name.includes('japan') || name.includes('日本')) score += 20
  // Humanlike tiers (neural / premium / enhanced builds of a voice) sound
  // markedly less robotic — they outrank the plain named voices below.
  if (/(premium|enhanced|neural|natural)/.test(name)) score += 30
  // Named native voices shipped by the major platforms.
  if (/(kyoko|o-ren|otoya|hattori|ichiro|ayumi|haruka|sayaka)/.test(name)) score += 15
  if (v.localService) score += 5 // on-device voices don't vanish with the network
  return score
}

/** Pick the best Japanese voice from a list (or null when none exists). */
export function pickJapaneseVoiceFrom(voices) {
  let best = null
  let bestScore = 0
  for (const v of voices || []) {
    const s = scoreJapaneseVoice(v)
    if (s > bestScore) { best = v; bestScore = s }
  }
  return best
}

let cachedVoice = null
let cachedChecked = false

function readVoices() {
  try { return window.speechSynthesis.getVoices() || [] } catch { return [] }
}

export function ensureVoices(timeoutMs = 600) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return resolve([])
    const now = readVoices()
    if (now.length) return resolve(now)
    let done = false
    const finish = () => { if (!done) { done = true; resolve(readVoices()) } }
    try { window.speechSynthesis.addEventListener('voiceschanged', function h() { finish(); window.speechSynthesis.removeEventListener('voiceschanged', h) }) } catch { /* older browsers */ }
    setTimeout(finish, timeoutMs)
  })
}

/** The device's best Japanese voice, or null (callers must label the fallback). */
export async function japaneseVoice() {
  if (cachedChecked && cachedVoice) return cachedVoice
  const voices = await ensureVoices()
  cachedVoice = pickJapaneseVoiceFrom(voices)
  cachedChecked = true
  return cachedVoice
}

/** Synchronous best-effort status for UI labels (after any speak attempt it is accurate). */
export function hasJapaneseVoiceSync() {
  if (cachedChecked) return !!cachedVoice
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
  return !!pickJapaneseVoiceFrom(readVoices())
}

export function ttsAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * Unlock speech on iOS: Safari only lets speechSynthesis start after a
 * user gesture has "primed" it. Call this inside a tap handler (e.g.
 * Accept on the call screen) with a near-silent utterance so the first
 * real line, spoken later from an effect, is allowed to make sound.
 */
export function primeSpeech() {
  if (!ttsAvailable()) return
  try {
    const u = new SpeechSynthesisUtterance('、')
    u.volume = 0
    u.lang = 'ja-JP'
    u.rate = 2
    window.speechSynthesis.speak(u)
  } catch { /* priming is best-effort only */ }
}

/**
 * Speak text (Japanese when it contains Japanese, English otherwise).
 * Returns a promise resolving true when speech started. When no Japanese
 * voice exists we still speak with lang='ja-JP' — browsers sometimes map
 * the lang to a voice getVoices() didn't list — but the resolved value's
 * `fallback` flag lets the UI say so honestly.
 *
 * Options beyond the original { onend, onerror }:
 * - rate: utterance rate (callers that omit it get the browser default,
 *   exactly as before).
 * - onEnd: completion callback for state machines (the Sensei Call flow).
 *   Invoked exactly once — on the utterance's 'end', on its 'error', or
 *   from a safety timer (estimate 1200ms + 90ms per character, scaled by
 *   rate) in case the browser never fires either event, which happens on
 *   some builds when an utterance is cancelled silently. Callers that
 *   don't pass onEnd get no timer and unchanged behaviour.
 */
export async function speakText(text, { onend, onerror, rate, onEnd } = {}) {
  if (!ttsAvailable() || !text) {
    // A flow waiting on onEnd must never hang on a device with no speech
    // at all — complete immediately so its next step can run.
    if (onEnd) onEnd()
    return { started: false, fallback: false }
  }
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const ja = hasJapaneseText(text)
  u.lang = ja ? 'ja-JP' : 'en-US'
  const rateOk = typeof rate === 'number' && rate > 0
  if (rateOk) u.rate = rate
  let fallback = false
  if (ja) {
    const v = await japaneseVoice()
    if (v) u.voice = v
    else fallback = true
  }
  let endFired = false
  let endTimer = null
  const fireEnd = () => {
    if (endFired) return
    endFired = true
    if (endTimer) { clearTimeout(endTimer); endTimer = null }
    if (onEnd) onEnd()
  }
  if (onend) u.onend = onend
  if (onEnd) {
    const legacyEnd = u.onend
    u.onend = (e) => { if (legacyEnd) legacyEnd(e); fireEnd() }
    endTimer = setTimeout(fireEnd, Math.round((1200 + 90 * text.length) / (rateOk ? rate : 1)))
  }
  u.onerror = (e) => { if (onerror) onerror(e); fireEnd() }
  try { synth.speak(u); return { started: true, fallback } } catch { fireEnd(); return { started: false, fallback } }
}
