import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { buildPlannerMessages, planFromModelText, validatePlannerRequest } from './contract.ts'

// Saki, the Planner — the AI Planner in SHADOW MODE (Doc 05 §5.1,
// Phase 3 step 2). POST { twinSummary, rulesPlan, pools } →
// { ok: true, plan } | { ok: false, reason }.
//
// SHADOW CONTRACT: the client fires this right after the rules
// planner saves the day's plan (planner.js buildPlan), and logs the
// (rules, AI) pair plus a `planner_shadow` comparison metric. The
// AI plan is NEVER shown to the learner, NEVER saved as a plan, and
// NEVER acted on — this function writes a plan-shaped JSON answer
// only, holds no state, and touches no table. The rules plan remains
// the only plan the user ever sees, until a future Planner eval
// (Doc 08 §4, Saki row) says otherwise.
//
// The model's answer passes through contract.ts's strict validation:
// ids must exist in the posted pools, the mode must equal the rules
// plan's mode (the mode is the deterministic spine's — the AI may
// not override it), the date must match, the item count must land
// within ±2 of the rules plan's, and the experiment must echo the
// rules plan's (experiments are code-run). Any violation discards
// the whole answer with a named reason.
//
// Auth: deploy with verify_jwt=true (the tts/chat/corrector
// pattern) — the gateway rejects callers without a valid user JWT
// before this code runs, and the client only calls it for signed-in
// learners. No in-function auth logic, and nothing about the request
// is logged.
//
// Env: OPENROUTER_API_KEY (the project secret reader-bot reuses),
// optional PLANNER_MODEL (Tier A, Doc 03 §2 — default
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
  const verdict = validatePlannerRequest(body)
  if (!verdict.ok) {
    return json({ error: 'Invalid planner request.', reason: verdict.reason }, 400)
  }

  const model = Deno.env.get('PLANNER_MODEL') ?? DEFAULT_MODEL
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
        messages: buildPlannerMessages(verdict.value),
        // Planning has some latitude (which scene, which cards), so
        // the temperature is low but not zero — 0.2 max (Doc 05 §5.1).
        temperature: 0.2,
        max_tokens: 1500,
      }),
    })
    if (!res.ok) {
      // Doc 03 §3 rule 4: a provider failure is a stop, not a retry
      // loop — shadow mode simply misses this sample.
      console.error(`planner-shadow: OpenRouter HTTP ${res.status}`)
      return json({ ok: false, reason: `http_${res.status}` }, 502)
    }
    const data = await res.json().catch(() => null)
    const raw = data?.choices?.[0]?.message?.content
    const result = planFromModelText(raw, verdict.value)
    if (!result.ok) {
      console.error(`planner-shadow: model output rejected reason=${result.reason}`)
      return json({ ok: false, reason: `invalid_output:${result.reason}` }, 502)
    }
    return json({ ok: true, plan: result.plan })
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : 'network'
    console.error(`planner-shadow: call failed reason=${reason}`)
    return json({ ok: false, reason }, 502)
  } finally {
    clearTimeout(timer)
  }
})
