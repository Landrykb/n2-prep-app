// Planner SHADOW MODE (Doc 05 §5.1, Phase 3 step 2).
//
// After the rules planner builds and saves the day's plan
// (planner.js buildPlan — the Daily Plan point every caller shares),
// this module fire-and-forgets the same ingredients to the
// `planner-shadow` edge function (Saki, Tier A via OpenRouter): the
// Twin summary, the rules plan, and the candidate pools the rules
// chose from. The function's answer passes a strict contract
// server-side (ids must exist in the pools, the mode must equal the
// rules plan's mode, item count within ±2, experiment echo-only);
// when it validates, the client stores the pair { date, rulesPlan,
// aiPlan } in a local ring log and logs ONE metric — planner_shadow
// { rulesItems, aiItems, overlap }.
//
// The rules plan remains the ONLY plan the user ever sees. The AI
// plan is never rendered, never saved as a plan, and never changes
// any behaviour. Every failure here — signed out, unconfigured,
// offline, capped, function error, invalid AI plan — is silent by
// design; shadow mode must be invisible when it cannot run.
//
// Cost guard: at most ONE shadow call per device per local day
// (stamp below). The Planner is a once-a-day job (Doc 03 §4: ~$0.55–
// 0.70/user/month at one Tier A call per day); the stamp is what
// keeps rebuilds-until-consumed from multiplying that.

import { recordMetric } from './metrics.js'
import { loadTwin, twinSummaryForAi, topPatterns } from './twin.js'
import { loadQueue } from './queue.js'
import { buildSessionCards, todayStr, loadSessionState } from './session.js'
import { scenes } from '../data/scenes.js'
import { listeningPlus } from '../data/listeningPlus.js'
import { n2Listening } from '../data/n2Listening.js'

export const PLANNER_SHADOW_ENABLED = true
export const PLANNER_SHADOW_DAILY_CAP = 1
export const PLANNER_SHADOW_KEY = 'jpn:plannerShadow:v1' // the pair ring log
export const PLANNER_SHADOW_STAMP_KEY = 'jpn:plannerShadowStamp:v1' // { date, count }
export const PLANNER_SHADOW_LOG_CAP = 14

// ---------------------------------------------------------- stamp state
// Pure helpers over the stored stamp { date: 'YYYY-MM-DD', count } —
// the correctorShadow pattern, with a local (not UTC) day: a plan is
// a local-day object, so the cap rolls over with the learner's day.

export function shadowStampFor(raw, today) {
  if (!raw || typeof raw !== 'object' || raw.date !== today || typeof raw.count !== 'number') {
    return { date: today, count: 0 }
  }
  return { date: today, count: Math.max(0, Math.floor(raw.count)) }
}

export function canShadowPlan(state, today, cap = PLANNER_SHADOW_DAILY_CAP) {
  return shadowStampFor(state, today).count < cap
}

export function nextShadowStamp(state, today) {
  const cur = shadowStampFor(state, today)
  return { date: today, count: cur.count + 1 }
}

function loadStamp(storage, today) {
  try {
    return shadowStampFor(JSON.parse(storage?.getItem(PLANNER_SHADOW_STAMP_KEY) || 'null'), today)
  } catch { return { date: today, count: 0 } }
}

function saveStamp(storage, state) {
  try { storage?.setItem(PLANNER_SHADOW_STAMP_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

// ------------------------------------------------------------- pair log
/** Append a pair to the ring log (last PLANNER_SHADOW_LOG_CAP pairs).
 *  A pair for a date already present is replaced — a re-shadow of the
 *  same day supersedes, never duplicates. Pure. */
export function appendShadowPair(log, pair) {
  const list = Array.isArray(log) ? log.filter((p) => p && typeof p === 'object') : []
  const date = pair?.date || pair?.rulesPlan?.forDate
  if (!date || !pair?.rulesPlan || !pair?.aiPlan) return list.slice(-PLANNER_SHADOW_LOG_CAP)
  const next = list.filter((p) => (p.date || p.rulesPlan?.forDate) !== date)
  next.push({ date, rulesPlan: pair.rulesPlan, aiPlan: pair.aiPlan })
  return next.slice(-PLANNER_SHADOW_LOG_CAP)
}

export function loadShadowLog(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(PLANNER_SHADOW_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveShadowLog(storage, log) {
  try { storage?.setItem(PLANNER_SHADOW_KEY, JSON.stringify(log)) } catch { /* ignore */ }
}

// ------------------------------------------------------------ item refs
/** Canonical item references for a plan — mirrored in
 *  planner-shadow/contract.ts (the test suite pins them equal). */
export function planItemRefs(plan) {
  if (!plan) return []
  const refs = []
  if (plan.opener?.sceneId) refs.push(`scene:${plan.opener.sceneId}`)
  for (const id of plan.cardIds || []) refs.push(`card:${id}`)
  if (plan.listeningItemId) refs.push(`listening:${plan.listeningItemId}`)
  return refs
}

/** Share of the rules plan's items the AI plan also chose (0..1). */
export function overlapFor(rulesPlan, aiPlan) {
  const rules = planItemRefs(rulesPlan)
  if (!rules.length) return 0
  const ai = new Set(planItemRefs(aiPlan))
  const shared = rules.filter((r) => ai.has(r)).length
  return Math.round((shared / rules.length) * 1000) / 1000
}

/** The planner_shadow metric payload — the shadow comparison itself. */
export function shadowMetricFor(rulesPlan, aiPlan) {
  return {
    rulesItems: planItemRefs(rulesPlan).length,
    aiItems: planItemRefs(aiPlan).length,
    overlap: overlapFor(rulesPlan, aiPlan),
  }
}

// ---------------------------------------------------------------- pools
/**
 * The candidate pools the rules planner actually chooses among
 * (planner.js): every scene; the session-card candidates
 * (buildSessionCards' due+fresh five) PLUS the slump/bad-week re-win
 * pool (queue items with reps ≥ 2) that planCards falls back to; the
 * full listening bank pickListeningForDiagnosis ranks; and the
 * Twin's top fingerprint patterns (the focus candidates). Entries
 * carry the label the UI would show (title / front / pattern label)
 * so the function can resolve display text from code-side data.
 */
export function buildPlannerPools({ queue = [], twin = null } = {}) {
  const cardMap = new Map()
  const addCard = (item) => {
    if (item?.id && !cardMap.has(item.id)) cardMap.set(item.id, { id: item.id, front: item.front || '' })
  }
  for (const c of buildSessionCards(queue)) addCard(c)
  for (const item of queue) if ((item?.fsrs?.reps || 0) >= 2) addCard(item)
  return {
    scenes: scenes.map((s) => ({ id: s.id, title: s.title })),
    cards: [...cardMap.values()],
    listening: [...listeningPlus, ...n2Listening].map((b) => ({ id: b.id || b.title, title: b.title })),
    focus: twin ? topPatterns(twin, 3).map((p) => ({ id: p.id, label: p.label })) : [],
  }
}

// -------------------------------------------------------------- runner
/**
 * One shadow comparison, with every dependency injectable for tests.
 * deps: { enabled, cap, storage, today, getSession, invoke, metric }.
 * Resolves true when a pair was logged, false when it was skipped
 * for any reason; NEVER rejects.
 */
export async function runPlannerShadow(input, deps = {}) {
  try {
    const enabled = deps.enabled ?? PLANNER_SHADOW_ENABLED
    if (!enabled) return false
    const { twinSummary, rulesPlan, pools } = input || {}
    if (!twinSummary || !rulesPlan?.forDate || !rulesPlan?.opener?.sceneId || !pools) return false

    const storage = deps.storage !== undefined ? deps.storage : safeLocalStorage()
    const today = deps.today || todayStr()
    const stamp = loadStamp(storage, today)
    if (!canShadowPlan(stamp, today, deps.cap ?? PLANNER_SHADOW_DAILY_CAP)) return false

    const getSession = deps.getSession || defaultGetSession
    const session = await getSession()
    if (!session) return false // signed out — shadow is a signed-in-only comparison

    // Spend the stamp slot BEFORE the call: a failed call still cost
    // a request slot upstream in the worst case, and the stamp's job
    // is to bound calls per day, not successes.
    saveStamp(storage, nextShadowStamp(stamp, today))

    const invoke = deps.invoke || defaultInvoke
    const data = await invoke({ twinSummary, rulesPlan, pools })
    if (!data?.ok || !data.plan || typeof data.plan !== 'object') return false

    saveShadowLog(storage, appendShadowPair(loadShadowLog(storage), {
      date: rulesPlan.forDate, rulesPlan, aiPlan: data.plan,
    }))
    const metric = deps.metric || recordMetric
    metric('planner_shadow', shadowMetricFor(rulesPlan, data.plan))
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
  const { data, error } = await supabase.functions.invoke('planner-shadow', { body })
  if (error) return null
  return data
}

/**
 * The production entry point planner.js calls right after the rules
 * plan is saved: assembles the real ingredients from the stores
 * (Twin summary from the Twin, pools from the queue + Twin) and
 * fires the comparison. Fire-and-forget; can never throw or reject
 * into the planning flow.
 */
export function shadowPlan(rulesPlan) {
  if (!PLANNER_SHADOW_ENABLED) return
  try {
    const twin = loadTwin()
    const input = {
      twinSummary: twinSummaryForAi(twin),
      rulesPlan,
      pools: buildPlannerPools({ queue: loadQueue(), twin }),
    }
    void runPlannerShadow(input).catch(() => { /* shadow is silent */ })
  } catch { /* shadow is silent */ }
}

// ------------------------------------------------------ outcome scoring
// The scorer for a future Coach view (no UI now). It reads the pair
// log against the learner's REAL completion records for those dates:
//
//   - cards: the queue itself — an item counts as completed on the
//     local date of its FSRS lastReview (fsrs.js stamps it at rating
//     time), wherever it was rated (One Session, Today review).
//   - scene + listening: the day's saved One Session state
//     (jpn:session:v1) — sceneDone (mastered that day) and
//     listeningPicked (the bite was attempted). The session state is
//     a single current-day record, so scene/listening completions
//     are only knowable for the day the state belongs to; card
//     completions survive in the queue for every date.
//
// HONESTY RULE (binding on any future surface): the AI plan was
// never shown, so its score is NOT performance. aiWouldHaveMatched
// measures how much of what the learner actually did the AI plan
// happened to contain — overlap-with-reality. It must never be
// quoted as "the AI planned better/worse"; rulesFollowed is the only
// follow-through number, and it describes the learner, not Saki.

/** Item refs the learner actually completed on one local date. */
export function completedRefsForDate(dateStr, { queue = [], sessionState = null } = {}) {
  const refs = new Set()
  for (const item of queue || []) {
    const fsrs = item?.fsrs
    if (!fsrs?.lastReview || !(fsrs.reps > 0)) continue
    try {
      if (todayStr(new Date(fsrs.lastReview)) === dateStr) refs.add(`card:${item.id}`)
    } catch { /* unparseable stamp — not a completion record */ }
  }
  if (sessionState && sessionState.date === dateStr) {
    if (sessionState.sceneDone && sessionState.sceneId) refs.add(`scene:${sessionState.sceneId}`)
    if (sessionState.listeningPicked != null && sessionState.listeningTitle) {
      refs.add(`listening:${sessionState.listeningTitle}`)
    }
  }
  return refs
}

/** Score one pair against one date's completed refs. */
export function scoreShadowPair(pair, completedRefs) {
  const done = completedRefs instanceof Set ? completedRefs : new Set(completedRefs || [])
  const rulesRefs = planItemRefs(pair?.rulesPlan)
  const aiRefs = planItemRefs(pair?.aiPlan)
  const frac = (refs) => (refs.length
    ? Math.round((refs.filter((r) => done.has(r)).length / refs.length) * 1000) / 1000
    : 0)
  return {
    date: pair?.date || pair?.rulesPlan?.forDate || null,
    rulesItems: rulesRefs.length,
    rulesFollowed: frac(rulesRefs),
    aiItems: aiRefs.length,
    aiWouldHaveMatched: frac(aiRefs),
  }
}

/**
 * Score a whole log. completionsByDate maps 'YYYY-MM-DD' → a Set (or
 * array) of completed refs, built by the caller from real records
 * (completedRefsForDate over the queue + session state). Pairs whose
 * date has NO completion record are left unscored — a plan for a day
 * not yet lived is not a zero.
 */
export function scoreShadowLog(log, completionsByDate = {}) {
  const pairs = Array.isArray(log) ? log : []
  const scored = []
  let unscored = 0
  for (const pair of pairs) {
    const date = pair?.date || pair?.rulesPlan?.forDate
    if (!date || !completionsByDate || !(date in completionsByDate)) { unscored += 1; continue }
    scored.push(scoreShadowPair(pair, completionsByDate[date]))
  }
  const mean = (key) => (scored.length
    ? Math.round((scored.reduce((a, s) => a + s[key], 0) / scored.length) * 1000) / 1000
    : null)
  return {
    scored,
    unscored,
    pairs: scored.length,
    meanRulesFollowed: mean('rulesFollowed'),
    meanAiWouldHaveMatched: mean('aiWouldHaveMatched'),
  }
}

/** Convenience for the future Coach view: completions for the log's
 *  dates from the live stores (queue history + today's session). */
export function completionsFromStores(log, { queue = null, sessionState = undefined } = {}) {
  const q = queue ?? loadQueue()
  const ss = sessionState === undefined ? loadSessionState() : sessionState
  const out = {}
  for (const pair of Array.isArray(log) ? log : []) {
    const date = pair?.date || pair?.rulesPlan?.forDate
    if (date && !(date in out)) out[date] = completedRefsForDate(date, { queue: q, sessionState: ss })
  }
  return out
}
