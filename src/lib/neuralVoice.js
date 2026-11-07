// Neural voice for Sensei's lines in the call (Doc 17 decision,
// 2026-11-06: FREE route for now — the `tts` edge function, Microsoft
// Edge TTS, ja-JP-NanamiNeural).
//
// Contract with SenseiCall's hands-free state machine — IDENTICAL to
// speakText's: onEnd fires exactly once, when the line has finished
// (or when it never really started), so the machine's "~350ms later
// the mic opens" step can never hang. Source order per line:
//
//   1. Browser-direct Edge TTS (edgeTts.js): this device opens the
//      read-aloud websocket itself. Added 2026-11-06 late — live
//      tests proved the endpoint refuses/times out synthesis from
//      the server function's datacenter egress, while the same
//      protocol works from end-user devices (it is how Edge's own
//      Read Aloud runs). Works for guests too: no key, no session.
//   2. The `tts` edge function (signed-in users only — it sits
//      behind verify_jwt), if the browser route fails.
//   3. The device voice (tts.js speakText, Japanese voice picker) on
//      ANY failure of both: network error, a 4xx/5xx from the
//      function, or the browser refusing to play the audio.
//   Whichever source may answer, synthesis/fetching starts the
//   moment the line is known.
//
// Half-duplex is preserved by the caller exactly as before: SenseiCall
// stops speech (stopSpeech → stopNeuralSpeech + speechSynthesis
// cancel) before the mic ever opens, and stopNeuralSpeech completes
// the pending line the way cancelling an utterance does in tts.js —
// its onEnd fires once — so muting Sensei mid-line still steps the
// call forward by itself.

import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { speakText, primeSpeech } from './tts.js'
import { prepareNeuralText, estimateSpeechMs } from './neuralText.js'
import { synthesizeInBrowser, cancelBrowserSynthesis } from './edgeTts.js'
import { resolveCast } from './voiceCast.js'
import { appendErrorLog } from './errorLog.js'

// Voice failures are otherwise invisible: every route fails
// SILENTLY into the next one, so when Landry reported "the
// voices do not play anymore" (2026-11-08) there was nothing
// anywhere naming the failing step. Each route now leaves one
// structured line in the on-device error log (My Twin →
// Privacy shows/shares it) before falling back: which route,
// which stage, and the platform's own reason (the play()
// rejection name, the media error code). Normal successful
// playback logs nothing.
let lastVoiceFailure = null

function logVoice(kind, detail = {}, { sticky = true } = {}) {
  // 'device-fallback' is logged non-sticky: it is the chain's
  // final state, not the cause — the specific step logged just
  // before it (browser-synth-null / server-tts-null /
  // blob-play-rejected) is the one the button should name.
  const now = Date.now()
  if (sticky || !lastVoiceFailure || now - (lastVoiceFailure.atMs || 0) > 15000) {
    lastVoiceFailure = { kind, ...detail, atMs: now }
  }
  try {
    appendErrorLog({ at: new Date().toISOString(), where: 'voice', kind, ...detail })
  } catch { /* logging must never throw */ }
}

// The most recent voice failure, for the play button to show
// under itself — the error log above is write-only in the app
// (no screen displays it), which stranded the first diagnosis
// round (2026-11-08): the reason has to appear where the tap
// happened. Shape: { kind, name?, code? } or null.
export function getLastVoiceFailure() {
  return lastVoiceFailure
}

// The server route is tts-vm now (Doc 17 addendum 5): the old
// `tts` function's own synthesis is dead from Supabase egress,
// so the function enqueues a job for the Voice Worker VM and
// waits for its fast lane — 20 s server-side, so the client
// allows a little more before giving up to the device voice.
const FETCH_TIMEOUT_MS = 22000
// Network + decode slack on top of the spoken-duration estimate: a
// line whose audio has not finished by then counts as finished, so a
// wedged fetch or a silent audio element can never stall the call.
const WATCHDOG_SLACK_MS = 15000

let currentAudio = null
let currentUrl = null
// ONE shared audio element for every neural playback (blob lines
// and pre-rendered files alike). iOS Safari only lets an element
// make sound after it has played inside a user gesture; a fresh
// element created after seconds of synthesis awaits has no
// gesture credit left and its play() is refused or ignored —
// the root cause of the 2026-11-08 "voices do not play
// anymore": the chain's own comment assumed the audio element
// was "primed by the Accept tap", but only speechSynthesis was
// ever primed (primeSpeech, call screen only), and the play
// buttons primed nothing at all. The shared element is primed
// on every tap (primeAudioOutput below), so later async plays
// on the SAME element are allowed to sound.
let sharedAudioEl = null
function sharedAudio() {
  if (!sharedAudioEl) sharedAudioEl = new Audio()
  return sharedAudioEl
}

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

/**
 * Unlock audio output for this page. Call SYNCHRONOUSLY inside
 * a tap handler, before any await: plays a silent clip on the
 * shared element (gesture credit for every later line) and
 * primes the device voice the same way the call screen always
 * did. Best effort; safe to call on every tap.
 */
export function primeAudioOutput() {
  try {
    const a = sharedAudio()
    if (a.paused) {
      a.src = SILENT_WAV
      const p = a.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
  } catch { /* priming is best effort */ }
  try { primeSpeech() } catch { /* best effort */ }
}
let pendingEnd = null
let watchdog = null
// Turn-chain token: speakTurns plays dialogue turns back to
// back. The token is (re)asserted after each turn's line
// starts — speakSenseiLine stops whatever played before,
// which would otherwise kill the chain it belongs to. An
// external stop or a superseding line clears the token and
// the chain quietly ends instead of talking over anyone.
let activeChainToken = null

function clearWatchdog() {
  if (watchdog) { clearTimeout(watchdog); watchdog = null }
}

function teardownAudio() {
  clearWatchdog()
  // Abort any in-flight browser synthesis: a stopped line must never
  // finish synthesising behind the mic's back (half-duplex). No-op
  // once synthesis has settled — its cancel entry removes itself.
  cancelBrowserSynthesis()
  if (currentAudio) {
    try { currentAudio.onended = null; currentAudio.onerror = null; currentAudio.pause() } catch { /* already stopped */ }
    currentAudio = null
  }
  if (currentUrl) {
    try { URL.revokeObjectURL(currentUrl) } catch { /* best effort */ }
    currentUrl = null
  }
}

/**
 * Stop the neural voice now (Sensei muted, hang-up, mic opening).
 * Like speechSynthesis.cancel() in the tts.js flow, stopping completes
 * the pending line: its onEnd fires exactly once.
 */
export function stopNeuralSpeech() {
  activeChainToken = null
  teardownAudio()
  const end = pendingEnd
  pendingEnd = null
  if (end) end()
}

/**
 * Play a pre-rendered audio file (the listening scripts' fixed
 * audio, public/audio/listening/). Fixed content should not ride
 * the live synthesis chain: when the webview's Edge connection
 * stalls, the chain falls back to the device robot voice —
 * exactly what the learner must never imitate (Landry,
 * 2026-11-07, Listening page). A bundled file plays instantly,
 * in the real neural voices the turns were rendered with, and
 * stopNeuralSpeech() stops it like any other line. onError
 * fires when the file cannot play, so the caller can fall back
 * to live synthesis.
 */
export function playAudioFile(src, { onEnd, onError } = {}) {
  stopNeuralSpeech()
  if (!src || typeof Audio === 'undefined') { if (onError) onError(); return }
  let endFired = false
  const fireEnd = () => {
    if (endFired) return
    endFired = true
    teardownAudio()
    if (pendingEnd === fireEnd) pendingEnd = null
    if (onEnd) onEnd()
  }
  const fail = (err) => {
    if (endFired) return
    endFired = true
    const mediaCode = currentAudio?.error?.code ?? null
    teardownAudio()
    if (pendingEnd === fireEnd) pendingEnd = null
    const info = {
      name: err?.name || (mediaCode ? 'media-error' : 'unknown'),
      ...(mediaCode ? { code: mediaCode } : {}),
      src: String(src).split('/').pop() || '',
    }
    logVoice('file-play-failed', info)
    if (onError) onError(info)
    else if (onEnd) onEnd()
  }
  pendingEnd = fireEnd
  try {
    const audio = sharedAudio()
    currentAudio = audio
    audio.src = src
    audio.onended = fireEnd
    audio.onerror = () => fail(null)
    const played = audio.play()
    if (played && typeof played.catch === 'function') played.catch((err) => fail(err))
  } catch (err) { fail(err) }
}

/** The signed-in user's access token, or null (guest / signed out). */
async function sessionToken() {
  if (!isSupabaseConfigured || !supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || null
  } catch { return null }
}

/**
 * Get this line's neural audio: the browser-direct Edge route first
 * (works from the learner's device, guests included), then the tts
 * edge function (signed-in users). Returns a Blob, or null when both
 * routes fail — the caller falls back to the device voice.
 */
async function getNeuralAudio(text, cast = 'female', browserTimeoutMs = null) {
  const c = resolveCast(cast)
  const direct = await synthesizeInBrowser(text, {
    voiceName: c.edge, pitch: c.pitch,
    ...(browserTimeoutMs ? { timeoutMs: browserTimeoutMs } : {}),
  })
  if (direct) return direct
  logVoice('browser-synth-null', { cast })
  const served = await fetchNeuralAudio(text, cast)
  if (!served) logVoice('server-tts-null', { cast })
  return served
}

/**
 * Ask the tts edge function for this line's audio. Returns a Blob, or
 * null on any failure — the caller falls back to the device voice.
 */
async function fetchNeuralAudio(text, cast = 'female') {
  const token = await sessionToken()
  if (!token) return null
  const url = import.meta.env.VITE_SUPABASE_URL
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${url}/functions/v1/tts-vm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: anon,
      },
      body: JSON.stringify({ text, voice: cast }),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const blob = await res.blob()
    return blob && blob.size > 0 ? blob : null
  } catch { return null } finally { clearTimeout(timer) }
}

/**
 * Speak one of Sensei's lines: neural voice first, device voice on
 * any failure. `onEnd` fires exactly once either way. Not async from
 * the caller's point of view — the fetch starts immediately and the
 * fallback decision happens inside.
 */
export function speakSenseiLine(text, { rate = 1, onEnd, onFallback, cast = 'female', browserTimeoutMs = null } = {}) {
  stopNeuralSpeech()
  let endFired = false
  const fireEnd = () => {
    if (endFired) return
    endFired = true
    teardownAudio()
    if (pendingEnd === fireEnd) pendingEnd = null
    if (onEnd) onEnd()
  }
  const deviceFallback = () => {
    if (endFired) return
    logVoice('device-fallback', {}, { sticky: false })
    // onFallback (optional): told WHICH device result served, so a
    // caller like TtsButton can keep its honest no-Japanese-voice
    // label when the device voice had to read Japanese without one.
    speakText(text, { rate, onEnd: fireEnd }).then((res) => {
      if (onFallback) onFallback(res)
    }).catch(() => {})
  }
  const clean = prepareNeuralText(text)
  if (!clean) { deviceFallback(); return }
  pendingEnd = fireEnd
  // Watchdog horizon: whichever duration estimate is longer — the
  // tts.js estimate, or the Reader's measured speaking pace
  // (~6.5 chars/second) — plus network slack.
  const rateOk = typeof rate === 'number' && rate > 0 ? rate : 1
  const horizon = Math.max(estimateSpeechMs(clean, rate), (clean.length / 6.5) * 1000 / rateOk) + WATCHDOG_SLACK_MS
  watchdog = setTimeout(fireEnd, horizon)
  getNeuralAudio(clean, cast, browserTimeoutMs).then((blob) => {
    if (endFired) return
    if (!blob) { clearWatchdog(); deviceFallback(); return }
    try {
      currentUrl = URL.createObjectURL(blob)
      const audio = sharedAudio()
      audio.src = currentUrl
      currentAudio = audio
      const r = typeof rate === 'number' && rate > 0 ? rate : 1
      try { audio.playbackRate = r } catch { /* default rate is fine */ }
      audio.onended = fireEnd
      audio.onerror = fireEnd // a broken stream ends the line; never re-speak over it
      const played = audio.play()
      if (played && typeof played.catch === 'function') {
        // Autoplay refused (no user-gesture credit left): the device
        // voice was primed by the Accept tap, so fall back to it.
        played.catch((err) => { logVoice('blob-play-rejected', { name: err?.name || 'unknown' }); if (!endFired) { clearWatchdog(); teardownAudio(); deviceFallback() } })
      }
    } catch { clearWatchdog(); deviceFallback() }
  })
}

/**
 * Play a dialogue's turns back to back, each in its own cast
 * (listening scripts: 女・男・店長…). onEnd fires once, after
 * the last turn (or when the chain is stopped — the stop path
 * completes the pending line exactly like a single line).
 */
export function speakTurns(turns, { onEnd, onFallback, browserTimeoutMs = null } = {}) {
  const list = (turns || []).filter((t) => t && t.text)
  if (!list.length) { if (onEnd) onEnd(); return }
  const token = {}
  activeChainToken = token
  let i = 0
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    if (onEnd) onEnd()
  }
  const next = () => {
    if (activeChainToken !== token) { finish(); return } // stopped or superseded — still complete the caller
    if (i >= list.length) { finish(); return }
    const turn = list[i++]
    speakSenseiLine(turn.text, {
      cast: turn.cast || 'female',
      onEnd: () => next(),
      ...(onFallback ? { onFallback } : {}),
      ...(browserTimeoutMs ? { browserTimeoutMs } : {}),
    })
    // Re-assert AFTER the call: starting this turn stopped the
    // previous one, and that stop clears the token by design.
    activeChainToken = token
  }
  next()
}
