// Corrector SHADOW MODE (Doc 05 §4, Phase 3 step 1).
//
// After the local rule classifier records a voice error's fingerprint
// (twin.js recordVoiceAttempt), this module fire-and-forgets the same
// production to the `corrector` edge function (Nao, Tier B via
// OpenRouter) and logs ONE metric — corrector_shadow { agree,
// ruleCategory, aiCategory } — comparing the AI's category with the
// rules'. The comparison stream is what the Doc 08 §4 eval gate reads
// alongside the gold-set eval: ≥90% gold agreement, ≥80% per category
// with ≥5 cases, two consecutive live runs, and only then does the
// AI take the job.
//
// The rules remain 100% authoritative: the AI answer is never shown,
// never stored in the Twin, and never changes any behaviour. Every
// failure here — signed out, unconfigured, offline, capped, function
// error — is silent by design; shadow mode must be invisible when it
// cannot run.
//
// Cost guard: CORRECTOR_SHADOW_DAILY_CAP shadow calls per device per
// local day (localStorage counter below). At cohort scale that is
// plenty of comparison samples per learner; the cap exists so a
// heavy practice day cannot turn into unbounded Tier B spend
// (Doc 03 §4: Corrector ≈15–30 items/day is the budgeted shape).

import { recordMetric } from './metrics.js'

export const CORRECTOR_SHADOW_ENABLED = true
export const CORRECTOR_SHADOW_DAILY_CAP = 20
export const CORRECTOR_SHADOW_KEY = 'jpn:correctorShadow:v1'

// ---------------------------------------------------------- cap state
// Pure helpers over the stored counter { date: 'YYYY-MM-DD', count }.
// A stored counter from another day counts as zero — the day rollover
// is the reset; there is no timer and no cleanup job.

export function shadowStateFor(raw, today) {
  if (!raw || typeof raw !== 'object' || raw.date !== today || typeof raw.count !== 'number') {
    return { date: today, count: 0 }
  }
  return { date: today, count: Math.max(0, Math.floor(raw.count)) }
}

export function canShadow(state, today, cap = CORRECTOR_SHADOW_DAILY_CAP) {
  return shadowStateFor(state, today).count < cap
}

export function nextShadowState(state, today) {
  const cur = shadowStateFor(state, today)
  return { date: today, count: cur.count + 1 }
}

function loadShadowState(storage, today) {
  try {
    return shadowStateFor(JSON.parse(storage?.getItem(CORRECTOR_SHADOW_KEY) || 'null'), today)
  } catch { return { date: today, count: 0 } }
}

function saveShadowState(storage, state) {
  try { storage?.setItem(CORRECTOR_SHADOW_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

// ------------------------------------------------------------ metric
/** The corrector_shadow metric payload — the shadow comparison itself. */
export function shadowMetricFor(ruleCategory, aiCategory) {
  return { agree: ruleCategory === aiCategory, ruleCategory, aiCategory }
}

// -------------------------------------------------------------- runner
/**
 * One shadow comparison, with every dependency injectable for tests.
 * deps: { enabled, cap, storage, today, getSession, invoke, metric }.
 * Resolves true when a comparison was logged, false when it was
 * skipped for any reason; NEVER rejects.
 */
export async function runCorrectorShadow(input, deps = {}) {
  try {
    const enabled = deps.enabled ?? CORRECTOR_SHADOW_ENABLED
    if (!enabled) return false
    const { production, target = '', context = '', ruleCategory = null } = input || {}
    if (!production || !ruleCategory) return false

    const storage = deps.storage !== undefined ? deps.storage : safeLocalStorage()
    const today = deps.today || new Date().toISOString().slice(0, 10)
    const state = loadShadowState(storage, today)
    if (!canShadow(state, today, deps.cap ?? CORRECTOR_SHADOW_DAILY_CAP)) return false

    const getSession = deps.getSession || defaultGetSession
    const session = await getSession()
    if (!session) return false // signed out — shadow is a signed-in-only comparison

    // Spend the cap slot BEFORE the call: a failed call still cost a
    // request slot upstream in the worst case, and the counter's job
    // is to bound calls per day, not successes.
    saveShadowState(storage, nextShadowState(state, today))

    const invoke = deps.invoke || defaultInvoke
    const data = await invoke({ production, target, context, ruleCategory })
    if (!data?.ok || typeof data.category !== 'string') return false

    const metric = deps.metric || recordMetric
    metric('corrector_shadow', shadowMetricFor(ruleCategory, data.category))
    return true
  } catch { return false }
}

function safeLocalStorage() {
  try { return globalThis.localStorage || null } catch { return null }
}

async function defaultGetSession() {
  const { supabase, isSupabaseConfigured } = await import('./supabaseClient.js')
  if (!isSupabaseConfigured || !supabase) return null
  const { data } = await supabase.auth.getSession()
  return data?.session || null
}

async function defaultInvoke(body) {
  const { supabase, isSupabaseConfigured } = await import('./supabaseClient.js')
  if (!isSupabaseConfigured || !supabase) return null
  const { data, error } = await supabase.functions.invoke('corrector', { body })
  if (error) return null
  return data
}

/**
 * The production entry point twin.js calls: fire-and-forget, returns
 * nothing, can never throw or reject into the learning flow.
 */
export function shadowClassify(input) {
  if (!CORRECTOR_SHADOW_ENABLED) return
  void runCorrectorShadow(input).catch(() => { /* shadow is silent */ })
}
