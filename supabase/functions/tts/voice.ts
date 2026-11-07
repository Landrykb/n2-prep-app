// Yonde call voice — Microsoft Edge TTS synthesis for the Sensei call
// (Doc 17 decision, 2026-11-06: FREE route for now).
//
// Same synthesis code as reader-bot/voice.ts (the Reader's voice-out),
// copied deliberately: edge functions deploy independently, and the two
// surfaces must be able to diverge without breaking each other. Landry's
// decision: neural voice uses free options only for now — this Edge
// route (ja-JP-NanamiNeural), NOT the priced Google Neural2 upgrade,
// which stays documented in Doc 17 as the future keyed path. The
// synthesizeSpeechOgg signature is the seam when that day comes.
//
// The service is a free consumer endpoint, NOT an SLA'd API: that is
// exactly why this module's contract is `Uint8Array | null`, null on
// ANY failure, and why the client always falls back to the device
// voice (src/lib/neuralVoice.js → src/lib/tts.js) when this function
// errors. Speech is an enhancement; the call never depends on it.
//
// Protocol summary (the public edge-tts wire format):
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
// Deliberately written in plain-JS syntax (no TS-only constructs)
// like reader-bot/voice.ts, so the node test suite can load it.

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
const OUTPUT_FORMAT = 'ogg-24khz-16bit-mono-opus'
const VOICE_NAME = 'ja-JP-NanamiNeural'
const TIMEOUT_MS = 20000

// One call line is short (a scene partner/model line); 600 chars is a
// generous ceiling that keeps a runaway request from becoming a long,
// expensive synthesis. The client enforces the same cap before asking
// (src/lib/neuralText.js) — this server-side check is the real gate.
export const MAX_TTS_CHARS = 600

/**
 * Validate + clean an incoming TTS request text. Pure, so tests can
 * pin the contract: non-strings, empty/whitespace-only, and over-cap
 * texts are rejected (the handler answers 400); anything accepted is
 * returned trimmed.
 */
export function validateTtsText(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'not_text' }
  const clean = text.trim()
  if (!clean) return { ok: false, reason: 'empty' }
  if (clean.length > MAX_TTS_CHARS) return { ok: false, reason: 'too_long' }
  return { ok: true, text: clean }
}

// Windows ticks (100ns units since 0001-01-01) for a Unix-ms instant.
function windowsTicks(unixMs) {
  return BigInt(Math.round(unixMs)) * 10000n + 116444736000000000n
}

async function secMsGec() {
  // Round the tick count DOWN to a 300-second boundary, per protocol.
  let ticks = windowsTicks(Date.now())
  ticks -= ticks % 3000000000n // 300s in 100ns units
  const bytes = new TextEncoder().encode(`${ticks}${TRUSTED_CLIENT_TOKEN}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Voice casts (mirror of src/lib/voiceCast.js — the function
// tree is self-contained, so the table is a deliberate copy;
// keep the two in step). A cast picks the Edge voice and an
// SSML pitch lift for the younger casts.
const CASTS = {
  female: { edge: 'ja-JP-NanamiNeural', pitch: '+0Hz' },
  male: { edge: 'ja-JP-KeitaNeural', pitch: '+0Hz' },
  girl: { edge: 'ja-JP-NanamiNeural', pitch: '+35Hz' },
  boy: { edge: 'ja-JP-KeitaNeural', pitch: '+25Hz' },
}
export function resolveTtsCast(cast) {
  return CASTS[cast] || CASTS.female
}

function buildSsml(text, voiceName, pitch = '+0Hz') {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP">` +
    `<voice name="${voiceName}"><prosody pitch="${pitch}" rate="+0%">${escapeXml(text)}</prosody></voice></speak>`
}

/**
 * Synthesise `text` to OGG/Opus bytes via Edge TTS, or return null.
 * Null on ANY failure: timeout, socket error, protocol surprise,
 * empty audio. Callers must treat voice as an enhancement.
 */
export async function synthesizeSpeechOgg(text, voiceName = VOICE_NAME, pitch = '+0Hz') {
  const clean = typeof text === 'string' ? text.trim() : ''
  if (!clean) return null
  let ws = null
  try {
    const gec = await secMsGec()
    const url = `wss://${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${GEC_VERSION}` +
      `&ConnectionId=${crypto.randomUUID().replace(/-/g, '')}`
    ws = new WebSocket(url)
    const chunks = []
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('edge-tts timeout')), TIMEOUT_MS)
      const settle = (fn, value) => { clearTimeout(timer); fn(value) }
      ws.onopen = () => {
        const stamp = new Date().toUTCString()
        const config = 'Content-Type:application/json; charset=utf-8\r\n' +
          'Path:speech.config\r\n\r\n' +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
                  outputFormat: OUTPUT_FORMAT,
                },
              },
            },
          })
        ws.send(`X-Timestamp:${stamp}\r\n${config}`)
        const ssmlFrame = `X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${stamp}\r\n` +
          'Path:ssml\r\n\r\n' +
          buildSsml(clean, voiceName, pitch)
        ws.send(ssmlFrame)
      }
      ws.onmessage = async (event) => {
        try {
          if (typeof event.data === 'string') {
            if (event.data.includes('Path:turn.end')) settle(resolve, true)
          } else {
            // Binary frame: 2-byte big-endian header length, then a
            // header block ("Path:audio" + content type), then audio.
            const buf = new Uint8Array(
              event.data instanceof Blob ? await event.data.arrayBuffer() : event.data,
            )
            if (buf.length < 2) return
            const headerLen = (buf[0] << 8) | buf[1]
            const header = new TextDecoder().decode(buf.subarray(2, 2 + headerLen))
            if (header.includes('Path:audio')) {
              chunks.push(buf.subarray(2 + headerLen))
            }
          }
        } catch (err) {
          settle(reject, err instanceof Error ? err : new Error(String(err)))
        }
      }
      ws.onerror = () => settle(reject, new Error('edge-tts socket error'))
      ws.onclose = () => settle(resolve, true) // a closed turn with audio is a success
    })
    await done
    if (chunks.length === 0) return null
    const total = chunks.reduce((n, c) => n + c.length, 0)
    if (total === 0) return null
    const out = new Uint8Array(total)
    let at = 0
    for (const c of chunks) { out.set(c, at); at += c.length }
    return out
  } catch (err) {
    console.error('tts voice: synthesis failed:', err instanceof Error ? err.message : err)
    return null
  } finally {
    try { ws?.close() } catch { /* already closed */ }
  }
}
