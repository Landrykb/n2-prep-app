// Yonde Reader voice-out — Microsoft Edge TTS synthesis (Doc 16,
// 2026-11-06 late: R2 voice pulled forward).
//
// The bot sends every passage as a Telegram voice note as well as
// text, so a learner can HEAR the passage Hori fitted for them —
// and so the read-aloud proof (voice-in) has a model to shadow.
// Synthesis route: the free Microsoft Edge "Read Aloud" service
// (the edge-tts protocol over wss) — no API key, neural ja-JP
// voices, OGG/Opus output that Telegram voice notes want natively.
// It is a free consumer endpoint, NOT an SLA'd API: that is exactly
// why this module's contract is `Uint8Array | null`, null on ANY
// failure, and why the bot never lets the text send depend on it.
// The keyed upgrade (Google Cloud ja-JP-Neural2, pennies per call,
// utterance caching) is priced in Doc 17 and replaces this module's
// innards when Landry gives the word — the synthesizeSpeechOgg
// signature is the seam.
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
// like fit.ts / segment.ts, so the node test suite can load it.

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

function buildSsml(text, voiceName) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP">` +
    `<voice name="${voiceName}"><prosody pitch="+0Hz" rate="+0%">${escapeXml(text)}</prosody></voice></speak>`
}

/**
 * Synthesise `text` to OGG/Opus bytes via Edge TTS, or return null.
 * Null on ANY failure: timeout, socket error, protocol surprise,
 * empty audio. Callers must treat voice as an enhancement — the
 * passage text is already sent by the time this runs.
 */
export async function synthesizeSpeechOgg(text, voiceName = VOICE_NAME) {
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
          buildSsml(clean, voiceName)
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
    console.error('reader-bot voice: synthesis failed:', err instanceof Error ? err.message : err)
    return null
  } finally {
    try { ws?.close() } catch { /* already closed */ }
  }
}
