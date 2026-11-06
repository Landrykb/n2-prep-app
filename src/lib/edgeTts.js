// Browser-direct Microsoft Edge TTS for the call voice (Doc 17
// amendment, 2026-11-06 late).
//
// Why this exists: the `tts` edge function runs the same protocol
// from Supabase, but live tests on 2026-11-06 proved Microsoft's
// read-aloud endpoint refuses/times out synthesis from datacenter
// egress (consistent 502s). The protocol was designed for end-user
// devices — it is literally how Edge's Read Aloud feature runs — so
// the learner's own browser opens the websocket instead. Same voice
// (ja-JP-NanamiNeural), same free endpoint, $0, no API key.
//
// Protocol: a faithful port of supabase/functions/reader-bot/voice.ts
// (and its deliberate copy in supabase/functions/tts/voice.ts) to
// browser APIs — global WebSocket, crypto.subtle, Blob assembly.
//   wss://speech.platform.bing.com/consumer/speech/synthesize/
//     readaloud/edge/v1?TrustedClientToken=...&Sec-MS-GEC=...
//   Sec-MS-GEC = SHA-256 hex (uppercase) of the ASCII string
//     "<windowsTicks rounded down to 300s><trusted client token>"
//   then two text frames: an X-Timestamp'd speech.config selecting
//     the output format, and an ssml frame carrying the text; the
//     service answers with text metadata frames and binary frames
//     whose body (after a short "Path:audio" header block) is the
//     audio, until a "Path:turn.end" text frame closes the turn.
//
// Contract: synthesizeInBrowser(text) → Promise<Blob|null>. Null on
// ANY failure (timeout, socket error, protocol surprise, empty
// audio, unsupported environment) — it never throws, so the caller
// can fall through to the next voice source. Browser adaptations vs
// the Deno twin: no headers can be set on a browser WebSocket (the
// protocol needs none — everything rides in the URL), and binary
// frames are read with binaryType='arraybuffer' instead of Deno's
// Blob/Uint8Array message data.
//
// The pure helpers are exported so tests/tts.test.mjs can pin the
// wire format in node, exactly like the server twins.

// The Edge read-aloud TRUSTED CLIENT TOKEN below is a PUBLIC constant:
// it ships in Microsoft's own Edge client and in every open-source
// edge-tts implementation, is identical for every user worldwide, is
// not issued to anyone, and cannot be rotated or revoked — it only
// feeds the Sec-MS-GEC checksum. It is not a credential.
// (GitGuardian flagged it as a generic high-entropy secret on
// 2026-11-06; resolved as a false positive.) gitguardian:ignore
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WSS_URL = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
const GEC_VERSION = '1-130.0.2849.68'

export const EDGE_TTS_OUTPUT_FORMAT = 'ogg-24khz-16bit-mono-opus'
export const EDGE_TTS_VOICE_NAME = 'ja-JP-NanamiNeural'
export const EDGE_TTS_AUDIO_TYPE = 'audio/ogg'
export const EDGE_TTS_TIMEOUT_MS = 15000

// ------------------------------------------------------------------
// Pure protocol helpers (pinned by tests/tts.test.mjs)

// Windows ticks (100ns units since 0001-01-01) for a Unix-ms instant.
export function windowsTicks(unixMs) {
  return BigInt(Math.round(unixMs)) * 10000n + 116444736000000000n
}

// The exact ASCII string Sec-MS-GEC hashes: the tick count rounded
// DOWN to a 300-second boundary, followed by the trusted client token.
export function buildGecInput(unixMs) {
  let ticks = windowsTicks(unixMs)
  ticks -= ticks % 3000000000n // 300s in 100ns units
  return `${ticks}${TRUSTED_CLIENT_TOKEN}`
}

/** Sec-MS-GEC for an instant: SHA-256 hex (uppercase) of buildGecInput. */
export async function computeSecMsGec(unixMs, subtle = globalThis.crypto?.subtle) {
  if (!subtle) return null
  const bytes = new TextEncoder().encode(buildGecInput(unixMs))
  const digest = await subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildSsml(text, voiceName = EDGE_TTS_VOICE_NAME) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP">` +
    `<voice name="${voiceName}"><prosody pitch="+0Hz" rate="+0%">${escapeXml(text)}</prosody></voice></speak>`
}

/** First text frame: the speech.config selecting the output format. */
export function buildSpeechConfigFrame(stamp) {
  const config = 'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
            outputFormat: EDGE_TTS_OUTPUT_FORMAT,
          },
        },
      },
    })
  return `X-Timestamp:${stamp}\r\n${config}`
}

/** Second text frame: the SSML carrying the line to speak. */
export function buildSsmlFrame(text, { stamp, requestId, voiceName = EDGE_TTS_VOICE_NAME } = {}) {
  return `X-RequestId:${requestId}\r\n` +
    'Content-Type:application/ssml+xml\r\n' +
    `X-Timestamp:${stamp}\r\n` +
    'Path:ssml\r\n\r\n' +
    buildSsml(text, voiceName)
}

/** True when a text frame closes the turn. */
export function isTurnEnd(data) {
  return typeof data === 'string' && data.includes('Path:turn.end')
}

/**
 * Parse one binary frame: 2-byte big-endian header length, then a
 * header block ("Path:audio" + content type), then the audio bytes.
 * Returns the audio Uint8Array for audio frames, null for anything
 * else (non-audio header, truncated frame, unexpected shape).
 */
export function parseAudioFrame(data) {
  const buf = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : null
  if (!buf || buf.length < 2) return null
  const headerLen = (buf[0] << 8) | buf[1]
  if (2 + headerLen > buf.length) return null
  const header = new TextDecoder().decode(buf.subarray(2, 2 + headerLen))
  if (!header.includes('Path:audio')) return null
  return buf.subarray(2 + headerLen)
}

// ------------------------------------------------------------------
// Synthesis

// In-flight cancellations, so stopping speech (mute, hang-up, mic
// opening) can abort a synthesis that has not produced audio yet —
// half-duplex must never wait on, or be spoken over by, a socket.
const inFlight = new Set()

/** Abort every in-flight browser synthesis (each resolves null). */
export function cancelBrowserSynthesis() {
  for (const cancel of [...inFlight]) {
    try { cancel() } catch { /* best effort */ }
  }
}

function randomId() {
  try { return crypto.randomUUID().replace(/-/g, '') } catch { /* older engines */ }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`
}

/**
 * Synthesise `text` to an OGG/Opus Blob via Edge TTS from THIS
 * browser, or return null. Null on ANY failure: unsupported
 * environment, timeout, socket error/close without audio, empty
 * audio, cancellation via cancelBrowserSynthesis(). Never throws.
 *
 * Options exist for the node test suite (fake socket, short timeout);
 * production callers pass nothing.
 */
export async function synthesizeInBrowser(text, {
  voiceName = EDGE_TTS_VOICE_NAME,
  timeoutMs = EDGE_TTS_TIMEOUT_MS,
  WebSocketImpl = globalThis.WebSocket,
  subtle = globalThis.crypto?.subtle,
  now = () => Date.now(),
} = {}) {
  const clean = typeof text === 'string' ? text.trim() : ''
  if (!clean) return null
  if (typeof WebSocketImpl !== 'function' || !subtle) return null
  let ws = null
  let cancelFn = null
  try {
    const gec = await computeSecMsGec(now(), subtle)
    if (!gec) return null
    const url = `wss://${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${GEC_VERSION}` +
      `&ConnectionId=${randomId()}`
    const chunks = []
    const blob = await new Promise((resolve) => {
      let settled = false
      const settle = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (cancelFn) inFlight.delete(cancelFn)
        resolve(value)
      }
      const assemble = () => {
        if (chunks.length === 0) return null
        const total = chunks.reduce((n, c) => n + c.length, 0)
        if (total === 0) return null
        return new Blob(chunks, { type: EDGE_TTS_AUDIO_TYPE })
      }
      const timer = setTimeout(() => {
        try { ws?.close() } catch { /* already closed */ }
        settle(null)
      }, timeoutMs)
      cancelFn = () => {
        try { ws?.close() } catch { /* already closed */ }
        settle(null)
      }
      inFlight.add(cancelFn)
      try {
        ws = new WebSocketImpl(url)
      } catch { settle(null); return }
      try { ws.binaryType = 'arraybuffer' } catch { /* Blob data is handled too */ }
      ws.onopen = () => {
        try {
          const stamp = new Date(now()).toUTCString()
          ws.send(buildSpeechConfigFrame(stamp))
          ws.send(buildSsmlFrame(clean, { stamp, requestId: randomId(), voiceName }))
        } catch { settle(null) }
      }
      ws.onmessage = async (event) => {
        try {
          if (typeof event.data === 'string') {
            if (isTurnEnd(event.data)) settle(assemble())
          } else if (event.data instanceof Blob) {
            const audio = parseAudioFrame(new Uint8Array(await event.data.arrayBuffer()))
            if (audio && audio.length > 0) chunks.push(audio)
          } else {
            const audio = parseAudioFrame(event.data)
            if (audio && audio.length > 0) chunks.push(audio)
          }
        } catch { settle(null) }
      }
      ws.onerror = () => settle(null)
      ws.onclose = () => settle(assemble()) // a closed turn with audio is a success
    })
    return blob
  } catch {
    return null
  } finally {
    if (cancelFn) inFlight.delete(cancelFn)
    try { ws?.close() } catch { /* already closed */ }
  }
}
