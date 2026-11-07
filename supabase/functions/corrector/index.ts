import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { buildCorrectorMessages, resultFromModelText, validateCorrectorRequest } from './contract.ts'

// Nao, the Fixer — the AI Corrector in SHADOW MODE (Doc 05 §4,
// Phase 3 step 1). POST { production, target, context, ruleCategory }
// → { ok: true, category, correction, note }.
//
// SHADOW CONTRACT: the client fires this after the local rule
// classifier has already recorded the fingerprint, compares the two
// categories, and logs a `corrector_shadow` metric. The answer is
// NEVER shown to the learner and NEVER written anywhere — this
// function classifies only, holds no state, and touches no table.
// The rules stay 100% authoritative until the Doc 08 §4 eval gate
// passes (≥90% gold-set agreement overall, ≥80% in every category
// with ≥5 cases, two consecutive live runs).
//
// Auth: deploy with verify_jwt=true (the tts/chat pattern) — the
// gateway rejects callers without a valid user JWT before this code
// runs, and the client only calls it for signed-in learners. No
// in-function auth logic, and nothing about the request is logged.
//
// Env: OPENROUTER_API_KEY (the project secret reader-bot reuses),
// optional CORRECTOR_MODEL (Tier B, Doc 03 §2 — default
// 'anthropic/claude-haiku-4.5', the current OpenRouter id for the
// Claude Haiku class; swap by env, never by code edit).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5'

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
  const verdict = validateCorrectorRequest(body)
  if (!verdict.ok) {
    return json({ error: 'Invalid corrector request.', reason: verdict.reason }, 400)
  }

  const model = Deno.env.get('CORRECTOR_MODEL') ?? DEFAULT_MODEL
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
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
        messages: buildCorrectorMessages(verdict.value),
        temperature: 0,
        max_tokens: 400,
      }),
    })
    if (!res.ok) {
      // Doc 03 §3 rule 4: a provider failure is a stop, not a retry
      // loop — shadow mode simply misses this sample.
      console.error(`corrector: OpenRouter HTTP ${res.status}`)
      return json({ ok: false, reason: `http_${res.status}` }, 502)
    }
    const data = await res.json().catch(() => null)
    const raw = data?.choices?.[0]?.message?.content
    const result = resultFromModelText(raw)
    if (!result.ok) {
      console.error(`corrector: model output rejected reason=${result.reason}`)
      return json({ ok: false, reason: `invalid_output:${result.reason}` }, 502)
    }
    return json({ ok: true, ...result.value })
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : 'network'
    console.error(`corrector: call failed reason=${reason}`)
    return json({ ok: false, reason }, 502)
  } finally {
    clearTimeout(timer)
  }
})
