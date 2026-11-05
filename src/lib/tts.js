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
 * Speak text (Japanese when it contains Japanese, English otherwise).
 * Returns a promise resolving true when speech started. When no Japanese
 * voice exists we still speak with lang='ja-JP' — browsers sometimes map
 * the lang to a voice getVoices() didn't list — but the resolved value's
 * `fallback` flag lets the UI say so honestly.
 */
export async function speakText(text, { onend, onerror } = {}) {
  if (!ttsAvailable() || !text) return { started: false, fallback: false }
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const ja = hasJapaneseText(text)
  u.lang = ja ? 'ja-JP' : 'en-US'
  let fallback = false
  if (ja) {
    const v = await japaneseVoice()
    if (v) u.voice = v
    else fallback = true
  }
  if (onend) u.onend = onend
  u.onerror = (e) => { if (onerror) onerror(e) }
  try { synth.speak(u); return { started: true, fallback } } catch { return { started: false, fallback } }
}
