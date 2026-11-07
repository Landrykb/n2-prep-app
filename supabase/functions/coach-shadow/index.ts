import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { buildCoachMessages, letterFromModelText, validateCoachRequest } from './contract.ts'

// Michi, the Coach — the AI Coach in SHADOW MODE (Doc 05 §9.1,
// Phase 3 step 3). POST { twinSummary, weekFacts, rulesLetter } →
// { ok: true, letter } | { ok: false, reason }.
//
// SHADOW CONTRACT: the client fires this when the rules Coach's
// weekly letter for the current week is generated or shown
// (CoachLetter.jsx), and logs the (rules, AI) pair plus a
// `coach_shadow` comparison metric. The AI letter is NEVER shown to
// the learner, NEVER saved as a letter, and NEVER acted on — this
// function writes a letter-shaped JSON answer only, holds no state,
// and touches no table. The rules letter remains the only letter
// the user ever sees, until the Coach eval gate (Doc 08 §4.2) —
// factual consistency + Landry's own read of consecutive shadow
// letters — says otherwise.
//
// The model's answer passes through contract.ts's strict
// validation: the rules letter's shape, week and mode equality,
// every numeral checked against the posted facts (an invented
// number discards the whole letter), the promise/guarantee and
// no-shame blocklists, and the quiet-mode contradiction proxy. Any
// violation discards the whole answer with a named reason.
//
// Auth: deploy with verify_jwt=true (the tts/chat/corrector
// pattern) — the gateway rejects callers without a valid user JWT
// before this code runs, and the client only calls it for signed-in
// learners. No in-function auth logic, and nothing about the request
// is logged.
//
// Env: OPENROUTER_API_KEY (the project secret reader-bot reuses),
// optional COACH_MODEL (Tier A, Doc 03 §2 — default
// 'anthropic/claude-sonnet-4.5', the current OpenRouter id for the
// Claude Sonnet class; swap by env, never by code edit).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405)
  }
  // Fail closed when the gateway key is absent (reader-bot's named
  // 'no_key' outcome, as an HTTP status): shadow mode quietly stops,
  // the app never notices.
  const key = Deno.env.get('OPENROUTER_API_KEY') ?? ''
  if (!key) return json({ error: 'no_key' }, 503)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be JSON.', reason: 'bad_json' }, 400)
  }
  const verdict = validateCoachRequest(body)
  if (!verdict.ok) {
    return json({ error: 'Invalid coach request.', reason: verdict.reason }, 400)
  }

  const model = Deno.env.get('COACH_MODEL') ?? DEFAULT_MODEL
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': Deno.env.get('APP_URL') ?? 'https://yonde.app',
        'X-Title': 'Yonde',
      },
      body: JSON.stringify({
        model,
        messages: buildCoachMessages(verdict.value),
        // A letter has voice latitude (phrasing, warmth), so the
        // temperature is low but not zero — 0.3 (Doc 05 §9.1). The
        // facts have no latitude at all; the contract enforces that.
        temperature: 0.3,
        max_tokens: 2000,
      }),
    })
    if (!res.ok) {
      // Doc 03 §3 rule 4: a provider failure is a stop, not a retry
      // loop — shadow mode simply misses this sample.
      console.error(`coach-shadow: OpenRouter HTTP ${res.status}`)
      return json({ ok: false, reason: `http_${res.status}` }, 502)
    }
    const data = await res.json().catch(() => null)
    const raw = data?.choices?.[0]?.message?.content
    const result = letterFromModelText(raw, { ...verdict.value, nowIso: new Date().toISOString() })
    if (!result.ok) {
      console.error(`coach-shadow: model output rejected reason=${result.reason}`)
      return json({ ok: false, reason: `invalid_output:${result.reason}` }, 502)
    }
    return json({ ok: true, letter: result.letter })
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : 'network'
    console.error(`coach-shadow: call failed reason=${reason}`)
    return json({ ok: false, reason }, 502)
  } finally {
    clearTimeout(timer)
  }
})
