// Coach SHADOW MODE (Doc 05 §9.1, Phase 3 step 3).
//
// When the rules Coach's weekly letter for the current week is
// generated or shown (CoachLetter.jsx), this module fire-and-forgets
// the same ingredients to the `coach-shadow` edge function (Michi,
// Tier A via OpenRouter): the Twin summary, the week's facts (the
// same code-computed facts the rules letter is built from), and the
// rules letter itself. The function's answer passes a strict
// contract server-side (the rules letter's shape, week/mode
// equality, every numeral checked against the facts, the promise
// and no-shame blocklists, the quiet-mode contradiction proxy);
// when it validates, the client stores the pair { weekKey,
// rulesLetter, aiLetter } in a local ring log and logs ONE metric —
// coach_shadow { rulesSections, aiSections, factsChecked: true }.
//
// The rules letter remains the ONLY letter the user ever sees. The
// AI letter is never rendered, never saved as a letter, and never
// changes any behaviour. Every failure here — signed out,
// unconfigured, offline, already-shadowed this week, function
// error, invalid AI letter — is silent by design; shadow mode must
// be invisible when it cannot run.
//
// Cost guard: at most ONE shadow call per device per ISO week
// (stamp below). The Coach is a once-a-week job (Doc 03 §4); the
// stamp is what keeps re-renders and repeat visits from multiplying
// that into a per-view Tier A call.

import { recordMetric } from './metrics.js'
import { refreshTwin, twinSummaryForAi, topPatterns, diagnosisDeltas, loadDiagnosisHistory } from './twin.js'
import { loadCallState } from './calls.js'
import { detectMode } from './modes.js'
import { SECTION_KEYS } from './levels.js'

export const COACH_SHADOW_ENABLED = true
export const COACH_SHADOW_KEY = 'jpn:coachShadow:v1' // the pair ring log
export const COACH_SHADOW_STAMP_KEY = 'jpn:coachShadowStamp:v1' // { weekKey, at }
export const COACH_SHADOW_LOG_CAP = 8

// ---------------------------------------------------------- week stamp
// Pure helpers over the stored stamp { weekKey, at } — one shadow
// per ISO week (the rules letter's weekStart key), the planner's
// once-per-day stamp at the Coach's weekly cadence.

export function stampWeekFor(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.weekKey !== 'string' || !raw.weekKey) return null
  return raw.weekKey
}

export function canShadowWeek(rawStamp, weekKey) {
  return Boolean(weekKey) && stampWeekFor(rawStamp) !== weekKey
}

export function nextShadowStamp(weekKey, atIso = new Date().toISOString()) {
  return { weekKey, at: atIso }
}

function loadStamp(storage) {
  try {
    return JSON.parse(storage?.getItem(COACH_SHADOW_STAMP_KEY) || 'null')
  } catch { return null }
}

function saveStamp(storage, stamp) {
  try { storage?.setItem(COACH_SHADOW_STAMP_KEY, JSON.stringify(stamp)) } catch { /* ignore */ }
}

// ------------------------------------------------------------- pair log
/** Append a pair to the ring log (last COACH_SHADOW_LOG_CAP pairs).
 *  A pair for a week already present is replaced — a re-shadow of
 *  the same week supersedes, never duplicates. Pure. */
export function appendShadowPair(log, pair) {
  const list = Array.isArray(log) ? log.filter((p) => p && typeof p === 'object') : []
  const weekKey = pair?.weekKey || pair?.rulesLetter?.weekStart
  if (!weekKey || !pair?.rulesLetter || !pair?.aiLetter) return list.slice(-COACH_SHADOW_LOG_CAP)
  const next = list.filter((p) => (p.weekKey || p.rulesLetter?.weekStart) !== weekKey)
  next.push({ weekKey, rulesLetter: pair.rulesLetter, aiLetter: pair.aiLetter })
  return next.slice(-COACH_SHADOW_LOG_CAP)
}

export function loadShadowLog(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(COACH_SHADOW_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveShadowLog(storage, log) {
  try { storage?.setItem(COACH_SHADOW_KEY, JSON.stringify(log)) } catch { /* ignore */ }
}

// ------------------------------------------------------------ numerals
/**
 * Every numeral in a text, as numbers ('12', '4.1', '1,000' → 12,
 * 4.1, 1000). Mirrored in coach-shadow/contract.ts (the test suite
 * pins the two implementations equal on samples).
 */
export function extractNumerals(text) {
  if (typeof text !== 'string') return []
  const out = []
  const re = /\d[\d,]*(?:\.\d+)?/g
  let m
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[0].replace(/,/g, ''))
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

function letterNumerals(letter) {
  const set = new Set()
  for (const p of letter?.paragraphs || []) {
    for (const n of extractNumerals(p)) set.add(n)
  }
  return set
}

/**
 * The fact references BOTH letters cite — the numerals that appear
 * in the rules letter's prose and in the AI letter's prose. This is
 * a SIMILARITY signal only (Doc 05 §9.1): the two letters were
 * written from the same facts, so shared citations say the AI
 * letter is looking at the same week — they say nothing about
 * whether its prose is good, warm, or wise. Quality is the Doc 08
 * §4.2 human gate's question, not this number's.
 */
export function sharedFactReferences(rulesLetter, aiLetter) {
  const rules = letterNumerals(rulesLetter)
  const ai = letterNumerals(aiLetter)
  return [...rules].filter((n) => ai.has(n)).sort((a, b) => a - b)
}

/** The coach_shadow metric payload — the shadow comparison itself. */
export function shadowMetricFor(rulesLetter, aiLetter) {
  return {
    rulesSections: Array.isArray(rulesLetter?.paragraphs) ? rulesLetter.paragraphs.length : 0,
    aiSections: Array.isArray(aiLetter?.paragraphs) ? aiLetter.paragraphs.length : 0,
    factsChecked: true,
  }
}

// ------------------------------------------------------------ week facts
// The week's facts, computed from the SAME sources in the SAME way
// CoachLetter.jsx generateCoachLetter computes them (session log,
// call history, diagnosis history, the error fingerprint, the
// learning-style note). This duplication is deliberate: the rules
// letter's builder is a component module, and the facts must be
// assemblable without rendering it. The two computations read the
// same stores at the same moment, so they agree; the function's
// anchor checks (week/mode equality) would catch a drift as a named
// rejection rather than a wrong comparison.

function weekStart(now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - dow)
  return d
}

export function coachWeekKey(now = new Date()) {
  const s = weekStart(now)
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`
}

export function buildCoachWeekFacts(now = new Date(), twin = refreshTwin()) {
  const { mode, meta } = detectMode(now)
  const startMs = weekStart(now).getTime()
  const inWeek = (iso) => iso && new Date(iso).getTime() >= startMs

  const sessions = (twin.rhythm.sessionLog || []).filter((s) => inWeek(`${s.date}T12:00:00`))
  const sessionCount = sessions.length
  const minutes = sessions.reduce((a, s) => a + (s.minutes || 0), 0)
  const proof = sessions.reduce((a, s) => a + (s.proof || 0), 0)

  const calls = (loadCallState().history || []).filter((h) => inWeek(h.at))
  const callsKept = calls.filter((h) => h.status === 'completed').length
  const callsTotal = calls.length

  const deltas = diagnosisDeltas()
  const history = loadDiagnosisHistory()
  const top = topPatterns(twin, 1)[0]

  const citedNumbers = { sessionCount, minutes, proof, callsKept, callsTotal }
  let diagnosis = null
  if (deltas && history.length >= 2) {
    const sections = {}
    for (const s of SECTION_KEYS) sections[s.id] = deltas.sections[s.id] || 0
    diagnosis = { totalDelta: deltas.total, toTotal: deltas.to.total, sections }
    citedNumbers.diagnosisTotalDelta = deltas.total
  }
  let topPattern = null
  if (top) {
    topPattern = { id: top.id, label: top.label, plain: top.plain, count: top.count }
    citedNumbers.topPatternCount = top.count
  }

  return {
    weekStart: coachWeekKey(now),
    mode,
    modeLabel: meta.label,
    sessionCount,
    minutes,
    proof,
    callsKept,
    callsTotal,
    diagnosis,
    topPattern,
    learningStyleNote: twin.learningStyle?.note || null,
    citedNumbers,
  }
}

// -------------------------------------------------------------- runner
/**
 * One shadow comparison, with every dependency injectable for tests.
 * deps: { enabled, storage, getSession, invoke, metric, nowIso }.
 * Resolves true when a pair was logged, false when it was skipped
 * for any reason; NEVER rejects.
 */
export async function runCoachShadow(input, deps = {}) {
  try {
    const enabled = deps.enabled ?? COACH_SHADOW_ENABLED
    if (!enabled) return false
    const { twinSummary, weekFacts, rulesLetter } = input || {}
    if (!twinSummary || !weekFacts || !rulesLetter?.weekStart) return false
    const weekKey = rulesLetter.weekStart

    const storage = deps.storage !== undefined ? deps.storage : safeLocalStorage()
    const stamp = loadStamp(storage)
    if (!canShadowWeek(stamp, weekKey)) return false

    const getSession = deps.getSession || defaultGetSession
    const session = await getSession()
    if (!session) return false // signed out — shadow is a signed-in-only comparison

    // Spend the week's stamp BEFORE the call: a failed call still
    // cost a request slot upstream in the worst case, and the
    // stamp's job is to bound calls per week, not successes.
    saveStamp(storage, nextShadowStamp(weekKey, deps.nowIso))

    const invoke = deps.invoke || defaultInvoke
    const data = await invoke({ twinSummary, weekFacts, rulesLetter })
    if (!data?.ok || !data.letter || typeof data.letter !== 'object') return false

    saveShadowLog(storage, appendShadowPair(loadShadowLog(storage), {
      weekKey, rulesLetter, aiLetter: data.letter,
    }))
    const metric = deps.metric || recordMetric
    metric('coach_shadow', shadowMetricFor(rulesLetter, data.letter))
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
  const { data, error } = await supabase.functions.invoke('coach-shadow', { body })
  if (error) return null
  return data
}

/**
 * The production entry point CoachLetter.jsx calls when the current
 * week's rules letter is on screen (generated or re-opened):
 * assembles the real ingredients from the stores — the Twin summary
 * and the week's facts, computed exactly as the rules letter's own
 * builder computes them — and fires the comparison. Fire-and-forget;
 * can never throw or reject into the letter flow.
 */
export function shadowCoachLetter(rulesLetter) {
  if (!COACH_SHADOW_ENABLED) return
  try {
    if (!rulesLetter?.weekStart || rulesLetter.source !== 'rules-v1') return
    // The facts are assembled for the current week; a letter from
    // another week is not shadowable against them (the function's
    // week anchor would reject the trio anyway — skip before the
    // week's stamp is ever spent).
    if (rulesLetter.weekStart !== coachWeekKey()) return
    const twin = refreshTwin()
    const input = {
      twinSummary: twinSummaryForAi(twin),
      weekFacts: buildCoachWeekFacts(new Date(), twin),
      rulesLetter,
    }
    void runCoachShadow(input).catch(() => { /* shadow is silent */ })
  } catch { /* shadow is silent */ }
}
