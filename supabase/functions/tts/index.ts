import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { synthesizeSpeechOgg, validateTtsText, MAX_TTS_CHARS, resolveTtsCast } from './voice.ts'

// Neural voice for the Sensei call (Doc 17 decision, 2026-11-06:
// FREE route for now — Microsoft Edge TTS, ja-JP-NanamiNeural).
//
//   POST { text }  →  200 audio/ogg (OGG/Opus bytes)
//                    →  400 { error } for an empty / overlong /
//                       malformed request (client speaks with the
//                       device voice instead — see neuralVoice.js)
//                    →  502 { error } when synthesis itself fails,
//                       for the same fallback reason.
//
// Deployed with verify_jwt=true: the gateway rejects callers without
// a valid user JWT before this code runs, so there is no in-function
// auth logic and nothing to configure. No secrets are read, accepted,
// or logged here — the synthesis route needs none (voice.ts), and
// request text is never logged either (Doc 10 §6).
//
// `text` is capped at MAX_TTS_CHARS (600): a call line is short, and
// the cap keeps this free endpoint from being used as a general
// long-form synthesizer.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405)
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be JSON like { "text": "…" }.' }, 400)
  }
  const verdict = validateTtsText((body as { text?: unknown } | null)?.text)
  if (!verdict.ok) {
    const message = verdict.reason === 'too_long'
      ? `That line is too long to speak this way (max ${MAX_TTS_CHARS} characters).`
      : 'Nothing to speak — send a non-empty "text".'
    return json({ error: message, reason: verdict.reason }, 400)
  }
  const cast = resolveTtsCast((body as { voice?: unknown } | null)?.voice)
  const audio = await synthesizeSpeechOgg(verdict.text, cast.edge, cast.pitch)
  if (!audio) {
    // Fail closed with a distinct status: the client's contract is
    // "any non-200 → device voice", and 502 says honestly that the
    // voice service, not the request, is what failed.
    return json({ error: 'The neural voice is unavailable right now.' }, 502)
  }
  return new Response(audio, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'audio/ogg' },
  })
})
