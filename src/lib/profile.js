// Problem-first profile: who the learner is, what hurts, and what proof
// they are climbing toward. Diagnosis and the Today prescription READ this
// profile — the app starts from the person's problem, not from features.

import { emitLearnerStateSaved } from './stateEvents.js'
import { computeSixtyDayPromise, savePromise } from './promise.js'
import { t as translate } from './i18n.js'

// Onboarding option copy lives in the language catalogs (Doc 20,
// first-run slice 2026-11-07): the data below carries KEYS
// (profile.persona.* / profile.pain.* / profile.target.*), consumers
// resolve at render. derivePlan composes its line through a
// translator argument — components pass their bound t; lib-internal
// callers get the English default, byte-identical to the old strings.
const enTr = (key, vars) => translate('en', key, vars)

export const PROFILE_KEY = 'jpn:profile:v1'
export const DIAGNOSIS_KEY = 'jpn:diagnosis:v1'
export const LAST_VISIT_KEY = 'jpn:last-visit:v1'

export const PERSONAS = [
  { id: 'resident', labelKey: 'profile.persona.resident.label', descKey: 'profile.persona.resident.desc' },
  { id: 'job-hunter', labelKey: 'profile.persona.job-hunter.label', descKey: 'profile.persona.job-hunter.desc' },
  { id: 'student', labelKey: 'profile.persona.student.label', descKey: 'profile.persona.student.desc' },
  { id: 'ssw', labelKey: 'profile.persona.ssw.label', descKey: 'profile.persona.ssw.desc' },
  { id: 'business', labelKey: 'profile.persona.business.label', descKey: 'profile.persona.business.desc' },
  { id: 'parent', labelKey: 'profile.persona.parent.label', descKey: 'profile.persona.parent.desc' },
]
export const PAINS = [
  { id: 'habit', labelKey: 'profile.pain.habit.label', descKey: 'profile.pain.habit.desc', focus: ['dashboard', 'anki'] },
  { id: 'speaking', labelKey: 'profile.pain.speaking.label', descKey: 'profile.pain.speaking.desc', focus: ['voice', 'speed'] },
  { id: 'listening', labelKey: 'profile.pain.listening.label', descKey: 'profile.pain.listening.desc', focus: ['n2listening', 'voice'] },
  { id: 'slipped', labelKey: 'profile.pain.slipped.label', descKey: 'profile.pain.slipped.desc', focus: ['diagnosis', 'voice', 'anki'] },
  { id: 'blocked-job', labelKey: 'profile.pain.blocked-job.label', descKey: 'profile.pain.blocked-job.desc', focus: ['mock', 'diagnosis', 'bjt'] },
  { id: 'keigo', labelKey: 'profile.pain.keigo.label', descKey: 'profile.pain.keigo.desc', focus: ['voice', 'bjt'] },
  { id: 'life-admin', labelKey: 'profile.pain.life-admin.label', descKey: 'profile.pain.life-admin.desc', focus: ['voice', 'mine'] },
]
export const PROOF_TARGETS = [
  { id: 'jlpt', labelKey: 'profile.target.jlpt.label', descKey: 'profile.target.jlpt.desc' },
  { id: 'bjt', labelKey: 'profile.target.bjt.label', descKey: 'profile.target.bjt.desc' },
  { id: 'hsp', labelKey: 'profile.target.hsp.label', descKey: 'profile.target.hsp.desc' },
  { id: 'real-life', labelKey: 'profile.target.real-life.label', descKey: 'profile.target.real-life.desc' },
]
export function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveProfile(profile) {
  try {
    const stamped = { ...profile, updatedAt: new Date().toISOString() }
    localStorage.setItem(PROFILE_KEY, JSON.stringify(stamped))
    emitLearnerStateSaved()
    // The promise must not go stale when the problem changes
    // (integration audit #19): the planner already plans from the
    // new profile immediately, so PromisePanel/Today would quote a
    // promise computed from the old one until the next diagnosis.
    // When a diagnosis exists, recompute + re-save the promise from
    // the new profile in the same act. No diagnosis → no promise
    // (the promise rule itself), exactly as before.
    try {
      const diagnosis = loadDiagnosis()
      const promise = diagnosis ? computeSixtyDayPromise(diagnosis, stamped) : null
      if (promise) savePromise(promise)
    } catch { /* a promise refresh never blocks saving the profile */ }
  } catch { /* ignore */ }
}

export function saveDiagnosis(diagnosis) {
  try { localStorage.setItem(DIAGNOSIS_KEY, JSON.stringify(diagnosis)); emitLearnerStateSaved() } catch { /* ignore */ }
}

export function loadDiagnosis() {
  try {
    const raw = localStorage.getItem(DIAGNOSIS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// The Proof Ladder: heights, what each one unlocks, and where the learner
// stands. Status comes from the diagnosis estimate when there is one.
// I18N ROUND 2: each rung also carries labelKey/proofKey/unlocksKey into
// the catalogs (ladder.*); label/proof/unlocks stay as the English data
// (and the fallback for anything that renders without a translator).
export const PROOF_LADDER = [
  { id: 'foundation', label: 'N5–N4 foundation', proof: 'JLPT N5 80 / N4 90 · every section ≥ 19/60', unlocks: 'Daily life without panic; Specified Skilled Worker floor', jlptOrder: 1, passMark: 90, proofLevel: 'N4', labelKey: 'ladder.foundation.label', proofKey: 'ladder.foundation.proof', unlocksKey: 'ladder.foundation.unlocks' },
  { id: 'bridge', label: 'N3 bridge', proof: 'JLPT N3 95/180', unlocks: 'Everyday Japan handled alone — counters, calls, school', jlptOrder: 2, passMark: 95, proofLevel: 'N3', labelKey: 'ladder.bridge.label', proofKey: 'ladder.bridge.proof', unlocksKey: 'ladder.bridge.unlocks' },
  { id: 'n2', label: 'N2 — the job filter', proof: 'JLPT N2 90/180', unlocks: 'Passes the résumé filter · HSP +10 pts · B2 evidence for language roles', jlptOrder: 3, passMark: 90, proofLevel: 'N2', labelKey: 'ladder.n2.label', proofKey: 'ladder.n2.proof', unlocksKey: 'ladder.n2.unlocks' },
  { id: 'bjt400', label: 'BJT 400', proof: 'BJT ≥ 400 (upper J3)', unlocks: 'Counts as the N2 category for HSP points · B2 evidence', bjtMin: 400, labelKey: 'ladder.bjt400.label', proofKey: 'ladder.bjt400.proof', unlocksKey: 'ladder.bjt400.unlocks' },
  { id: 'bjt480', label: 'BJT 480', proof: 'BJT ≥ 480 (inside J2)', unlocks: 'Counts as the N1 category for HSP points (15 pts)', bjtMin: 480, labelKey: 'ladder.bjt480.label', proofKey: 'ladder.bjt480.proof', unlocksKey: 'ladder.bjt480.unlocks' },
  { id: 'n1', label: 'N1', proof: 'JLPT N1 100/180', unlocks: 'Client-facing, legal/medical, management-track roles · HSP +15 pts', jlptOrder: 4, passMark: 100, proofLevel: 'N1', labelKey: 'ladder.n1.label', proofKey: 'ladder.n1.proof', unlocksKey: 'ladder.n1.unlocks' },
  { id: 'j1', label: 'BJT J1 / J1+', proof: 'BJT 530–599 (J1) · 600–800 (J1+)', unlocks: 'Appropriate — then sufficient — communication in any business situation', bjtMin: 530, labelKey: 'ladder.j1.label', proofKey: 'ladder.j1.proof', unlocksKey: 'ladder.j1.unlocks' },
]

const JLPT_ORDER = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4, 'N1+': 5 }
const SECTION_FLOOR = 19 // every JLPT paper: no section under 19/60 passes

/**
 * The ladder's water system (Landry, 2026-11-08: "the progress
 * it shows must be real and well measured... If someone sees
 * green in the N2 level it must mean they can go sit for N2 and
 * pass" + "this should not just be design fluke"). Three layers,
 * each fed by a real measurement:
 *
 * 1. THE PROVEN LINE — never recedes, the only green. A rung is
 *    'reached' ONLY when a FULL mock at its proof level (or a
 *    higher one) was passed under the real pass rule — scoreExam
 *    already enforces the level's pass mark AND every section
 *    ≥ 19/60. The diagnosis estimate can NEVER paint green.
 *    BJT rungs are proven the same way, by a full BJT exam
 *    (bjt_exam_completed: the real 80-question, three-part
 *    structure, scored 0–800) at or above the rung's bar.
 *    Short trainer sets are practice, never proof.
 * 2. THE WATER — current readiness, per rung, on the rung's own
 *    scale (BJT rungs on the BJT score; the JLPT rung at the
 *    estimated level by total vs its pass mark, capped by the
 *    weakest section against the 19/60 floor; rungs below the
 *    estimate full; rungs above it empty — never extrapolated).
 *    The water MOVES after the diagnosis: real mock scores pull
 *    the estimate toward themselves (EMA), every practice day
 *    adds a small inflow ("a few days and you solve a few
 *    questions and done" counts), BJT trainer accuracy nudges
 *    the BJT estimate.
 * 3. EVAPORATION — dry days recede the water on both scales
 *    (EVAP_PER_DRY_DAY per full dry day since the last practice
 *    day). Physics, not punishment: the proven line never
 *    evaporates, and any practice day refills.
 *
 * Practice days come from timestamped metric events — sessions,
 * kept/partial calls, listening, reading, drills, BJT sets,
 * passages, mocks. A missed call is not practice.
 */
export const EVAP_PER_DRY_DAY = 0.004
export const PRACTICE_DAY_INFLOW = 0.0015
const INFLOW_TYPES = new Set([
  'session_completed', 'listening_completed', 'reading_completed',
  'drills_completed', 'bjt_completed', 'mock_completed', 'passage_completed',
])

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isInflow(event) {
  if (!event || typeof event.type !== 'string') return false
  if (event.type === 'call_outcome') return event.outcome === 'kept' || event.outcome === 'partial'
  return INFLOW_TYPES.has(event.type)
}

/** Local days (YYYY-MM-DD) with at least one real practice event. */
export function practiceDaysOf(metrics) {
  const days = new Set()
  for (const e of Array.isArray(metrics) ? metrics : []) {
    if (!isInflow(e) || !e.at) continue
    const d = new Date(e.at)
    if (!Number.isNaN(d.getTime())) days.add(dayKey(d))
  }
  return days
}

/** Full dry days in the trailing spell: yesterday, the day
 *  before, … until the last practice day. Practising today or
 *  yesterday means 0. */
export function drySpellDays(metrics, now = new Date()) {
  const days = practiceDaysOf(metrics)
  if (!days.size) return 0
  const last = [...days].sort().at(-1)
  const today = dayKey(now)
  if (last >= today) return 0
  const ms = new Date(`${today}T12:00:00`) - new Date(`${last}T12:00:00`)
  return Math.max(0, Math.round(ms / 86400000) - 1)
}

export function ladderWithStatus(diagnosis, evidence = {}) {
  const metrics = Array.isArray(evidence.metrics) ? evidence.metrics : []
  const now = evidence.now instanceof Date ? evidence.now : new Date()
  const currentOrder = diagnosis?.jlptEstimate ? (JLPT_ORDER[diagnosis.jlptEstimate] ?? -1) : -1
  let total = typeof diagnosis?.total === 'number' ? diagnosis.total : null
  let bjt = typeof diagnosis?.bjtScore === 'number' ? diagnosis.bjtScore : null
  const sections = diagnosis?.sections && typeof diagnosis.sections === 'object' ? Object.values(diagnosis.sections).filter((v) => typeof v === 'number') : []
  let minSection = sections.length ? Math.min(...sections) : null

  // ——— 1 · the proven line ———
  const provenAt = {} // proofLevel -> earliest proving date (ISO)
  let bjtProven = null // best full-BJT-exam score { score, at }
  for (const e of metrics) {
    if (e?.type === 'bjt_exam_completed' && typeof e.score === 'number') {
      // Proof requires a SEALED paper (Landry, 2026-11-08): questions the
      // learner has never practised. A mixed/practice paper still counts
      // as a score estimate for the water below, never as proof.
      if (e.sealed === true && (!bjtProven || e.score > bjtProven.score)) bjtProven = { score: e.score, at: e.at || '' }
      continue
    }
    // JLPT proof also requires a sealed paper (Doc 21 pool law): the
    // paper's reading/listening texts must be ones the learner has
    // never practised. A passed full mock on practised texts is a
    // strong practice result, not proof.
    if (e?.type !== 'mock_completed' || e.passed !== true || e.length !== 'full' || e.sealed !== true) continue
    const lvl = typeof e.level === 'string' ? e.level : null
    if (!lvl || !(lvl in JLPT_ORDER)) continue
    if (!provenAt[lvl] || (e.at && e.at < provenAt[lvl])) provenAt[lvl] = e.at || ''
  }
  const provenOrders = Object.keys(provenAt).map((l) => JLPT_ORDER[l])
  const isProven = (h) => {
    // A BJT rung is proven by a full BJT exam (real structure:
    // 80 questions, three parts) scored at or above its bar.
    if (typeof h.bjtMin === 'number') return bjtProven !== null && bjtProven.score >= h.bjtMin
    return typeof h.proofLevel === 'string'
      && provenOrders.some((o) => o >= JLPT_ORDER[h.proofLevel])
  }

  // ——— 2 · the water moves with real work since the diagnosis ———
  const t0 = metrics
    .filter((e) => e?.type === 'diagnosis_completed' && e.at)
    .map((e) => e.at)
    .sort()
    .at(-1) || null
  if (diagnosis && t0) {
    const after = metrics
      .filter((e) => e?.at && e.at > t0)
      .sort((a, b) => (a.at < b.at ? -1 : 1))
    let latestMockMinSection = null
    for (const e of after) {
      if (e.type === 'mock_completed') {
        const scaledTotal = typeof e.scaled === 'number' ? e.scaled
          : (e.scaled && typeof e.scaled.total === 'number' ? e.scaled.total : null)
        if (total !== null && scaledTotal !== null) {
          const w = e.length === 'full' ? 0.5 : 0.3
          total = total * (1 - w) + scaledTotal * w
        }
        if (e.scaled && typeof e.scaled === 'object') {
          const secs = [e.scaled.lk, e.scaled.reading, e.scaled.listening].filter((v) => typeof v === 'number')
          if (secs.length) latestMockMinSection = Math.min(...secs)
        }
      } else if (e.type === 'bjt_exam_completed' && typeof e.score === 'number') {
        // A full-paper measurement outranks the diagnosis heuristic and the
        // trainer nudges; the latest one (the loop is chronological) wins.
        bjt = e.score
      } else if (e.type === 'bjt_completed' && bjt !== null) {
        const c = typeof e.correct === 'number' ? e.correct : null
        const n = typeof e.total === 'number' ? e.total : null
        if (c !== null && n) bjt = Math.max(0, Math.min(800, bjt + (c / n - 0.5) * 8))
      }
    }
    if (latestMockMinSection !== null) minSection = latestMockMinSection
    const t0Day = dayKey(new Date(t0))
    const inflowDays = [...practiceDaysOf(after)].filter((d) => d > t0Day).length
    if (inflowDays > 0) {
      const f = Math.pow(1 + PRACTICE_DAY_INFLOW, inflowDays)
      if (total !== null) total *= f
      if (bjt !== null) bjt *= f
    }
  }

  // ——— 3 · evaporation ———
  const dry = drySpellDays(metrics, now)
  if (dry > 0) {
    const f = Math.pow(1 - EVAP_PER_DRY_DAY, dry)
    if (total !== null) total *= f
    if (bjt !== null) bjt *= f
  }

  let nextMarked = false
  const rungs = PROOF_LADDER.map((h) => {
    let fill = 0
    if (typeof h.bjtMin === 'number') {
      fill = bjt !== null ? Math.min(bjt / h.bjtMin, 1) : 0
    } else if (currentOrder >= 0) {
      if (h.jlptOrder < currentOrder) fill = 1
      else if (h.jlptOrder === currentOrder && total !== null) {
        fill = Math.min(total / h.passMark, minSection !== null ? minSection / SECTION_FLOOR : 1, 1)
      }
    }
    fill = Math.max(0, fill)
    const proven = isProven(h)
    if (proven) fill = 1
    let status = 'locked'
    if (proven) status = 'reached'
    else if (fill >= 1) status = 'covered'
    else if (fill > 0 && !nextMarked) { status = 'next'; nextMarked = true }
    return { ...h, status, fill, provenAt: proven ? (typeof h.bjtMin === 'number' ? (bjtProven?.at || null) : (provenAt[h.proofLevel] || Object.values(provenAt)[0] || null)) : null }
  })
  if (!nextMarked) {
    const first = rungs.find((h) => h.status === 'covered' || h.status === 'locked')
    if (first) first.status = 'next'
  }
  return rungs
}

const TAB_KEYS = {
  dashboard: 'profile.tab.dashboard',
  anki: 'profile.tab.anki',
  voice: 'profile.tab.voice',
  n2listening: 'profile.tab.n2listening',
  mock: 'profile.tab.mock',
  diagnosis: 'profile.tab.diagnosis',
  bjt: 'profile.tab.bjt',
  mine: 'profile.tab.mine',
  speed: 'profile.tab.speed',
  errors: 'profile.tab.errors',
  lessons: 'profile.tab.lessons',
}

/**
 * Derive today's prescription from profile + diagnosis.
 * Returns { line, actions: [{tab, label, reason}], focusNote }.
 */
export function derivePlan(profile, diagnosis, tr = enTr) {
  const painIds = profile?.pains || []
  const pains = PAINS.filter((p) => painIds.includes(p.id))
  const painLabel = (p) => tr(p.labelKey)
  const focusTabs = []
  for (const p of pains) for (const t of p.focus) if (!focusTabs.includes(t)) focusTabs.push(t)

  const weakest = diagnosis?.weakest
  if (weakest === 'listening' && !focusTabs.includes('n2listening')) focusTabs.unshift('n2listening')
  if (weakest === 'language' && !focusTabs.includes('lessons')) focusTabs.unshift('lessons')
  if (weakest === 'reading' && !focusTabs.includes('reading')) focusTabs.unshift('reading')

  const tabLabel = (tab) => (TAB_KEYS[tab] ? tr(TAB_KEYS[tab]) : tr('profile.tab.reading'))
  const actions = focusTabs.slice(0, 4).map((tab) => ({
    tab,
    label: tabLabel(tab),
    reason: (() => {
      const pain = pains.find((p) => p.focus.includes(tab))
      if (pain) return painLabel(pain)
      return diagnosis && weakest ? tr('profile.reasonWeakest', { section: weakest }) : tr('profile.reasonFromDiagnosis')
    })(),
  }))
  if (!actions.length) {
    actions.push(
      { tab: 'diagnosis', label: tabLabel('diagnosis'), reason: tr('profile.reasonStartCheckup') },
      { tab: 'voice', label: tabLabel('voice'), reason: tr('profile.reasonVoice') },
      { tab: 'anki', label: tabLabel('anki'), reason: tr('profile.reasonQueue') },
    )
  }

  const personaEntry = PERSONAS.find((p) => p.id === profile?.persona)
  const personaLabel = personaEntry ? tr(personaEntry.labelKey) : undefined
  const mainPainEntry = pains[0]
  const mainPain = mainPainEntry ? painLabel(mainPainEntry) : undefined
  const targetEntry = PROOF_TARGETS.find((t) => t.id === profile?.proofTarget)
  const targetLabel = targetEntry ? tr(targetEntry.labelKey) : undefined
  // The pain is woven into the sentence: lower-case its first letter
  // unless it already starts a sentence ("I …"), in whichever language
  // the label was resolved.
  const woven = (label) => (label.charAt(0) === 'I' && label.charAt(1) === ' ' ? label : label.charAt(0).toLowerCase() + label.slice(1))
  let line
  if (!profile) line = tr('profile.lineNoProfile')
  else if (diagnosis) line = tr('profile.lineDiagnosis', {
    painPart: mainPain ? tr('profile.lineYourProblem', { pain: woven(mainPain) }) : '',
    level: diagnosis.jlptEstimate,
    weakest,
    target: targetLabel || tr('profile.lineNextHeight'),
  })
  else line = tr('profile.lineNoDiagnosis', {
    personaPart: personaLabel ? tr('profile.linePersona', { persona: personaLabel }) : '',
    painPart: mainPain ? tr('profile.lineWhatHurts', { pain: woven(mainPain) }) : '',
  })

  return { line, actions, focusNote: pains.map((p) => painLabel(p)).join(' · ') }
}

export function daysSinceLastVisit(now = new Date()) {
  try {
    const raw = localStorage.getItem(LAST_VISIT_KEY)
    if (!raw) return null
    const last = new Date(raw)
    return Math.floor((now - last) / 86400000)
  } catch { return null }
}

export function markVisit(now = new Date()) {
  try { localStorage.setItem(LAST_VISIT_KEY, now.toISOString()) } catch { /* ignore */ }
}
