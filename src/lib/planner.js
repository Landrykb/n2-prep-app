// SAKI, THE PLANNER — local rule-based v1 (Doc 05 §5).
//
// Saki prepares tomorrow so the learner never faces a setup decision:
// one scene, a capped set of cards, one listening bite — chosen from the
// Twin (error fingerprint first), the profile (pains), the diagnosis
// (weakest section, level), and the current adaptation mode (Doc 05 §7).
//
// This v1 is DETERMINISTIC RULES wearing the exact JSON shape the future
// Tier-A Planner will produce (Doc 05 §5 schema), so swapping in the AI
// later is a transport change, not a redesign. Every plan is stamped
// source: 'rules-v1' — never presented as AI-made.
//
// Method experiments (meta-learning, Doc 05 §5 guardrails): ONE variable
// at a time, measured in proof points, never started or advanced during
// Slump / BadWeek / EventApproach. Conclusions are written by measurement
// code (this module) into the Twin — visible in the Twin view as a
// plain-language method note.

import { scenes } from '../data/scenes.js'
import { loadQueue } from './queue.js'
import { loadProfile, loadDiagnosis } from './profile.js'
import { loadTwin, saveTwin, refreshTwin, topPatterns } from './twin.js'
import { detectMode } from './modes.js'
import { todayStr, pickSceneForProfile, pickListeningForDiagnosis, buildSessionCards } from './session.js'
import { shadowPlan } from './plannerShadow.js'
import { emitLearnerStateSaved } from './stateEvents.js'
import { t as translate } from './i18n.js'

// Plan lines live in the language catalogs (Doc 20, first-run slice
// 2026-11-07): scene picks carry a reason KEY + vars, and the plan
// stores noteKey/noteVars next to the English `note`. The stored
// `note` stays byte-identical English — the planner-shadow contract
// and the Coach facts read it as the record of what was planned —
// while Today renders the same line from the keys in the learner's
// language. Older stored plans have no keys and render their `note`.
const enTr = (key, vars) => translate('en', key, vars)

export const PLAN_KEY = 'jpn:plan:v1'
const MAX_CARDS = 5

// -------------------------------------------------------------- storage
// The plan state is a learner-state slice (integration audit #7): it
// rides the synced state document so Saki's "one guided day" is the
// same on every device — a plan consumed on the phone is not offered
// fresh on the desktop.
export function loadPlanState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAN_KEY) || 'null')
    if (parsed && typeof parsed === 'object') return { plans: {}, experiment: null, experimentLog: [], ...parsed }
  } catch { /* ignore */ }
  return { plans: {}, experiment: null, experimentLog: [] }
}
function savePlanState(state) {
  try { localStorage.setItem(PLAN_KEY, JSON.stringify(state)); emitLearnerStateSaved() } catch { /* ignore */ }
  return state
}
export function loadPlans() { return loadPlanState() }

// ---------------------------------------------------------- scene choice
const PATTERN_SCENE_HINTS = {
  'counter-documents': /通|枚|書類|証明/,
  'counter-people': /人|名|人数/,
  'counter-general': /個|つ|本|台/,
  'keigo-direction': /尊敬|謙譲|keigo/i,
  'keigo-over-polite': /尊敬|謙譲|keigo/i,
  'keigo-under-polite': /尊敬|謙譲|keigo/i,
  'register-mix': /尊敬|謙譲|keigo|敬語/i,
  'vocab-near-miss': /instead of/i,
  'particle-ha-ga': /は|が/,
  'particle-ni-de': /に|で/,
  'particle-wo-omission': /を/,
  'verb-form-te': /て/,
  'verb-form-nai': /ない/,
  'past-tense-slip': /た/,
  'word-order': /order/i,
}

function sceneMatchesPattern(scene, patternId) {
  const hint = PATTERN_SCENE_HINTS[patternId]
  if (!hint) return false
  if (patternId?.startsWith('keigo') || patternId === 'register-mix') {
    return (scene.for || []).includes('keigo') || scene.domain === 'Business' || hint.test(`${scene.targetPattern} ${scene.keigoNote}`)
  }
  return hint.test(`${scene.targetPattern} ${scene.commonError} ${(scene.keyPhrases || []).join(' ')}`)
}

/** The scene that exercises one fingerprint pattern, picked
 *  deterministically for the day — the same choice fingerprintScene
 *  makes for the plan. Exported for the TwinView trips cards:
 *  their Practice This door opens the Voice Loop on exactly this
 *  scene (via the 'yonde:voice-scene' deep link), so the door
 *  targets the pattern on the card, not practice in general.
 *  Null when no scene exercises the pattern. */
export function sceneForPattern(patternId, dateStr) {
  const candidates = scenes.filter((s) => sceneMatchesPattern(s, patternId))
  if (!candidates.length) return null
  let h = 0
  const key = `${dateStr}|fp|${patternId}`
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0
  return candidates[Math.abs(h) % candidates.length]
}

function fingerprintScene(twin, dateStr) {
  const top = topPatterns(twin, 2)
  for (const p of top) {
    if (p.id.startsWith('listening')) continue // listening patterns steer the bite, not the scene
    const scene = sceneForPattern(p.id, dateStr)
    if (scene) return { scene, reasonKey: 'planner.reasonFingerprint', reasonVars: { label: p.label } }
  }
  return null
}

function strongestScene(profile, dateStr) {
  // Comeback material: the domain where the learner has the most mastered
  // scenes — a re-win first, then forward.
  let masteredIds = []
  try { masteredIds = JSON.parse(localStorage.getItem('jpn:voice:mastered') || '[]') } catch { /* ignore */ }
  const byDomain = {}
  for (const s of scenes) if (masteredIds.includes(s.id)) byDomain[s.domain] = (byDomain[s.domain] || 0) + 1
  const bestDomain = Object.entries(byDomain).sort((a, b) => b[1] - a[1])[0]?.[0]
  if (bestDomain) {
    const fresh = scenes.find((s) => s.domain === bestDomain && !masteredIds.includes(s.id))
    if (fresh) return { scene: fresh, reasonKey: 'planner.reasonStrongestFresh', reasonVars: { domain: bestDomain } }
    const again = scenes.find((s) => s.domain === bestDomain)
    if (again) return { scene: again, reasonKey: 'planner.reasonStrongestAgain', reasonVars: { domain: bestDomain } }
  }
  return { scene: pickSceneForProfile(profile, dateStr), reasonKey: 'planner.reasonMatched', reasonVars: {} }
}

function eventScene(diagnosis, dateStr) {
  const want = diagnosis?.jlptEstimate || 'N3'
  const order = ['N5', 'N4', 'N3', 'N2', 'N1']
  const wi = Math.max(0, order.indexOf(want))
  const examDomains = ['Work', 'Business', 'City Office', 'Phone']
  const pool = [...scenes].sort((a, b) => {
    const da = Math.abs(order.indexOf(a.level) - wi) + (examDomains.includes(a.domain) ? 0 : 0.5)
    const db = Math.abs(order.indexOf(b.level) - wi) + (examDomains.includes(b.domain) ? 0 : 0.5)
    return da - db
  })
  let h = 0
  for (let i = 0; i < dateStr.length; i++) h = (Math.imul(31, h) + dateStr.charCodeAt(i)) | 0
  const top = pool.slice(0, 3)
  return { scene: top[Math.abs(h) % top.length], reasonKey: 'planner.reasonEvent', reasonVars: { level: want } }
}

// ----------------------------------------------------------- card choice
function planCards(queue, mode, diagnosis, budget) {
  if (mode === 'slump' || mode === 'badweek') {
    // Re-wins only: cards already learned (reps ≥ 2), most stable first.
    // No new items — new material is paused until the slide stops.
    const rewins = queue
      .filter((i) => (i.fsrs?.reps || 0) >= 2)
      .sort((a, b) => (b.fsrs?.stability || 0) - (a.fsrs?.stability || 0))
    const cap = mode === 'badweek' ? 2 : 3
    if (rewins.length) return rewins.slice(0, cap)
  }
  const cards = buildSessionCards(queue)
  if (mode === 'event' && diagnosis?.jlptEstimate) {
    const atLevel = cards.filter((c) => c.level === diagnosis.jlptEstimate)
    const rest = cards.filter((c) => c.level !== diagnosis.jlptEstimate)
    return [...atLevel, ...rest].slice(0, budget)
  }
  return cards.slice(0, budget)
}

// ------------------------------------------------------------ experiment
const EXPERIMENT_ROTATION = [
  { variable: 'scene-source', label: 'where your scene comes from', variants: ['mistake-first', 'problem-first'], variantLabels: { 'mistake-first': 'scenes picked from your top mistake', 'problem-first': 'scenes picked from the problem you named' } },
  { variable: 'card-budget', label: 'how many cards a day holds', variants: ['5', '3'], variantLabels: { 5: '5-card days', 3: '3-card days' } },
]
const EXPERIMENT_SESSIONS_NEEDED = 6

function maybeStartExperiment(state, twin, mode) {
  if (state.experiment) return state.experiment
  if (['slump', 'badweek', 'event'].includes(mode)) return null
  if ((twin.rhythm.sessionLog || []).length < 1) return null // need a baseline first
  const done = new Set((state.experimentLog || []).map((e) => e.variable))
  const nextDef = EXPERIMENT_ROTATION.find((d) => !done.has(d.variable)) || EXPERIMENT_ROTATION[(state.experimentLog || []).length % EXPERIMENT_ROTATION.length]
  const log = state.experimentLog || []
  const variantIdx = log.filter((e) => e.variable === nextDef.variable).length % nextDef.variants.length
  const baselineProof = (twin.rhythm.sessionLog || []).slice(-6)
  const baselineAvg = baselineProof.length
    ? baselineProof.reduce((a, s) => a + (s.proof || 0), 0) / baselineProof.length
    : 0
  const exp = {
    id: `exp-${Date.now().toString(36)}`,
    variable: nextDef.variable,
    variant: nextDef.variants[variantIdx],
    label: nextDef.label,
    variantLabel: nextDef.variantLabels[nextDef.variants[variantIdx]],
    startedAt: new Date().toISOString(),
    sessionsSeen: 0,
    proofSum: 0,
    baselineAvgProof: Math.round(baselineAvg * 100) / 100,
  }
  state.experiment = exp
  return exp
}

function concludeExperiment(state, exp) {
  const avg = exp.sessionsSeen ? exp.proofSum / exp.sessionsSeen : 0
  let result
  if (exp.baselineAvgProof > 0 && avg < exp.baselineAvgProof * 0.8) result = 'retired'
  else if (exp.baselineAvgProof > 0 && avg >= exp.baselineAvgProof) result = 'kept'
  else result = 'inconclusive'
  const twin = loadTwin()
  twin.learningStyle.lastExperiment = {
    variable: exp.variable, variant: exp.variant, result,
    sessions: exp.sessionsSeen, avgProof: Math.round(avg * 100) / 100,
    concludedAt: new Date().toISOString(),
  }
  twin.learningStyle.note =
    result === 'kept'
      ? `We tried ${exp.variantLabel} for ${exp.sessionsSeen} sessions. It earned you at least as much proof as before — it stays.`
      : result === 'retired'
        ? `We tried ${exp.variantLabel} for ${exp.sessionsSeen} sessions. It earned you less than your usual mix, so we stopped it.`
        : `We tried ${exp.variantLabel} for ${exp.sessionsSeen} sessions. Too close to call — your usual mix continues.`
  saveTwin(twin)
  state.experimentLog = [...(state.experimentLog || []), { ...exp, result, concludedAt: new Date().toISOString() }]
  state.experiment = null
  return state
}

/** Called when a session built from a plan finishes. Advances (or, in a
 *  protected mode, politely ignores) the active experiment. */
export function noteSessionForExperiment(plan, { proof = 0 } = {}) {
  const state = loadPlanState()
  const exp = state.experiment
  if (!exp || !plan?.experiment || plan.experiment.id !== exp.id) return state
  const { mode } = detectMode()
  if (['slump', 'badweek', 'event'].includes(mode)) return state // stability first (Doc 05 §5.3)
  exp.sessionsSeen += 1
  exp.proofSum += proof || 0
  if (exp.sessionsSeen >= EXPERIMENT_SESSIONS_NEEDED) concludeExperiment(state, exp)
  else state.experiment = exp
  return savePlanState(state)
}

// -------------------------------------------------------------- the plan
export function buildPlan(forDate, { save = true } = {}) {
  const twin = refreshTwin()
  const profile = loadProfile()
  const diagnosis = loadDiagnosis()
  const queue = loadQueue()
  const { mode, signals } = detectMode()
  const state = loadPlanState()
  const experiment = maybeStartExperiment(state, twin, mode)

  // Scene: mode first, experiment second, fingerprint/problem last.
  let pick
  if (signals.comeback && mode !== 'event') pick = strongestScene(profile, forDate)
  else if (mode === 'event') pick = eventScene(diagnosis, forDate)
  else if (experiment?.variable === 'scene-source' && experiment.variant === 'problem-first') {
    pick = { scene: pickSceneForProfile(profile, forDate), reasonKey: 'planner.reasonExperiment', reasonVars: {} }
  } else {
    pick = fingerprintScene(twin, forDate) || { scene: pickSceneForProfile(profile, forDate), reasonKey: 'planner.reasonMatched', reasonVars: {} }
  }

  const budget = experiment?.variable === 'card-budget' ? Number(experiment.variant) || MAX_CARDS : MAX_CARDS
  const cards = planCards(queue, mode, diagnosis, budget)
  const bite = pickListeningForDiagnosis(diagnosis, forDate)
  const top = topPatterns(twin, 1)[0]
  const minutes = Math.max(3, Math.round(3 + cards.length * 0.5 + 2))

  const modeReasonKeys = {
    slump: 'planner.reasonSlump',
    badweek: 'planner.reasonBadweek',
    event: 'planner.reasonEventMode',
    surge: 'planner.reasonSurge',
  }
  const reasonKey = mode === 'cruise' ? pick.reasonKey : modeReasonKeys[mode]
  const reasonVars = mode === 'cruise' ? pick.reasonVars || {} : {}
  const modeReason = enTr(reasonKey, reasonVars)

  const plan = {
    forDate,
    opener: { kind: 'scene', sceneId: pick.scene.id },
    sceneTitle: pick.scene.title,
    cardIds: cards.map((c) => c.id),
    cardBudget: cards.length,
    listeningItemId: bite.id || bite.title,
    listeningTitle: bite.title,
    focusPattern: top && !['slump', 'badweek'].includes(mode) ? top.id : null,
    focusLabel: top ? top.label : null,
    experiment: experiment ? { id: experiment.id, variable: experiment.variable, variant: experiment.variant, variantLabel: experiment.variantLabel } : null,
    mode,
    comeback: !!signals.comeback,
    minutes,
    source: 'rules-v1',
    createdAt: new Date().toISOString(),
    consumed: false,
    note: enTr(cards.length === 1 ? 'planner.noteOne' : 'planner.noteMany', { title: pick.scene.title, cards: cards.length, minutes, reason: modeReason }),
    noteKey: cards.length === 1 ? 'planner.noteOne' : 'planner.noteMany',
    noteVars: { reasonKey, reasonVars },
  }
  if (save) {
    state.plans = { ...(state.plans || {}), [forDate]: plan }
    savePlanState(state)
    // Planner shadow mode (Doc 05 §5.1): the saved rules plan is the
    // one the learner gets — but a Tier A AI planner now also writes
    // its own plan for the same day, fire-and-forget, so the two can
    // be compared (planner_shadow metric + the local pair log).
    // Silent when signed out / capped / unreachable; changes nothing.
    shadowPlan(plan)
  }
  return plan
}

/** The saved plan for a date, built on first ask. Plans are rebuilt only
 *  until consumed — once a session used one, it stands as the record. */
export function getPlanFor(dateStr) {
  const state = loadPlanState()
  const existing = state.plans?.[dateStr]
  if (existing) return existing
  return buildPlan(dateStr)
}

export function markPlanConsumed(dateStr) {
  const state = loadPlanState()
  if (state.plans?.[dateStr]) {
    state.plans[dateStr] = { ...state.plans[dateStr], consumed: true }
    savePlanState(state)
  }
  return state
}

export function tomorrowStr(now = new Date()) {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  return todayStr(d)
}
