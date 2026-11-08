// Gate metrics, minimal (P1-7 / Doc 11 §Gate metrics).
//
// Doc 11 names the numbers the whole product is judged by, and until now
// none of them existed anywhere. Four events, no more:
//
//   session_completed  { minutes, proof }     — a finished One Session
//   diagnosis_completed { total, estimate }   — a finished Diagnosis
//   call_outcome       { outcome }            — kept | missed | partial
//   effort_check       { answer, variant }    — the felt-effort answer
//
// Events live locally first (jpn:metrics:v1, capped) so signed-out
// learners count too, and mirror best-effort to `metrics_events`
// (migration 00007, owner-only RLS) when signed in. The mirror is
// fire-and-forget: a failed insert never touches the learning flow, and
// the local copy remains the on-device truth.
//
// The headline derived number is the North Star: minutes per proof
// point. It is computed from real events only — when there is not yet
// a single proof point, surfaces must say "not enough data yet" rather
// than show a flattering zero.

export const METRICS_KEY = 'jpn:metrics:v1'
const CAP = 500

export function loadMetrics() {
  try {
    const list = JSON.parse(localStorage.getItem(METRICS_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

async function pushMetric(event) {
  try {
    const { supabase, isSupabaseConfigured } = await import('./supabaseClient.js')
    if (!isSupabaseConfigured || !supabase) return
    const { data } = await supabase.auth.getSession()
    const user = data?.session?.user
    if (!user) return
    const { type, at, ...payload } = event
    await supabase.from('metrics_events').insert({ user_id: user.id, type, payload, created_at: at })
  } catch { /* best effort — local copy is the fallback truth */ }
}

/** Stable dedupe key for one event: type + timestamp + payload. */
export function metricEventKey(event) {
  if (!event || typeof event !== 'object') return ''
  const { type, at, ...rest } = event
  const keys = Object.keys(rest).sort()
  const body = keys.map((k) => `${k}=${JSON.stringify(rest[k])}`).join('&')
  return `${type || ''}|${at || ''}|${body}`
}

/**
 * Merge server rows (metrics_events shape: { type, payload,
 * created_at }) into the local list. The app reads only its own
 * device's local copy, while the Reader bot writes events only to
 * the server — split-brain (integration audit #8): a Telegram-only
 * learner looked inactive in the app, and the Day-30 churn math
 * could judge them churned. Rows whose key already exists locally
 * (this device's own mirrored events) are skipped; bot-only events
 * land. Returns how many were added.
 */
export function mergeRemoteMetrics(rows) {
  const remote = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.type === 'string')
    .map((r) => ({ type: r.type, at: r.created_at, ...(r.payload && typeof r.payload === 'object' ? r.payload : {}) }))
  if (!remote.length) return 0
  try {
    const list = loadMetrics()
    const seen = new Set(list.map(metricEventKey))
    let added = 0
    for (const e of remote) {
      const key = metricEventKey(e)
      if (!key || seen.has(key)) continue
      seen.add(key)
      list.push(e)
      added++
    }
    if (added) {
      list.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
      localStorage.setItem(METRICS_KEY, JSON.stringify(list.slice(-CAP)))
    }
    return added
  } catch { return 0 }
}

/** Pull this user's server events once (sign-in) and merge them in. */
export async function pullRemoteMetrics() {
  try {
    const { supabase, isSupabaseConfigured } = await import('./supabaseClient.js')
    if (!isSupabaseConfigured || !supabase) return 0
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData?.session?.user
    if (!user) return 0
    const { data, error } = await supabase
      .from('metrics_events')
      .select('type, payload, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(500)
    if (error || !data) return 0
    return mergeRemoteMetrics(data)
  } catch { return 0 }
}

export function recordMetric(type, payload = {}) {
  const event = { type, at: new Date().toISOString(), ...payload }
  try {
    const list = loadMetrics()
    list.push(event)
    localStorage.setItem(METRICS_KEY, JSON.stringify(list.slice(-CAP)))
  } catch { /* storage full/blocked — metrics never break learning */ }
  void pushMetric(event)
  return event
}

/** Pure summary over an event list — the numbers Today/Twin display. */
export function summariseMetrics(events) {
  const list = Array.isArray(events) ? events : []
  const sessions = list.filter((e) => e.type === 'session_completed')
  const minutes = sessions.reduce((s, e) => s + (Number(e.minutes) || 0), 0)
  const proofPoints = sessions.reduce((s, e) => s + (Number(e.proof) || 0), 0)
  const calls = list.filter((e) => e.type === 'call_outcome')
  const effort = list.filter((e) => e.type === 'effort_check')
  return {
    sessions: sessions.length,
    minutes: Math.round(minutes * 10) / 10,
    proofPoints,
    // The North Star. Null until at least one proof point exists —
    // callers render "not enough data yet" for null, never 0.
    minutesPerProofPoint: proofPoints > 0 ? Math.round((minutes / proofPoints) * 10) / 10 : null,
    diagnoses: list.filter((e) => e.type === 'diagnosis_completed').length,
    callsKept: calls.filter((e) => e.outcome === 'kept').length,
    callsMissed: calls.filter((e) => e.outcome === 'missed').length,
    callsPartial: calls.filter((e) => e.outcome === 'partial').length,
    effortChecks: effort.length,
    lastEffort: effort.length ? effort[effort.length - 1].answer : null,
  }
}
