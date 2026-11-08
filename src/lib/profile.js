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
  { id: 'foundation', label: 'N5–N4 foundation', proof: 'JLPT N5 80 / N4 90 · every section ≥ 19/60', unlocks: 'Daily life without panic; Specified Skilled Worker floor', jlptOrder: 1 , labelKey: 'ladder.foundation.label', proofKey: 'ladder.foundation.proof', unlocksKey: 'ladder.foundation.unlocks' },
  { id: 'bridge', label: 'N3 bridge', proof: 'JLPT N3 95/180', unlocks: 'Everyday Japan handled alone — counters, calls, school', jlptOrder: 2 , labelKey: 'ladder.bridge.label', proofKey: 'ladder.bridge.proof', unlocksKey: 'ladder.bridge.unlocks' },
  { id: 'n2', label: 'N2 — the job filter', proof: 'JLPT N2 90/180', unlocks: 'Passes the résumé filter · HSP +10 pts · B2 evidence for language roles', jlptOrder: 3 , labelKey: 'ladder.n2.label', proofKey: 'ladder.n2.proof', unlocksKey: 'ladder.n2.unlocks' },
  { id: 'bjt400', label: 'BJT 400', proof: 'BJT ≥ 400 (upper J3)', unlocks: 'Counts as the N2 category for HSP points · B2 evidence', jlptOrder: 3 , labelKey: 'ladder.bjt400.label', proofKey: 'ladder.bjt400.proof', unlocksKey: 'ladder.bjt400.unlocks' },
  { id: 'bjt480', label: 'BJT 480', proof: 'BJT ≥ 480 (inside J2)', unlocks: 'Counts as the N1 category for HSP points (15 pts)', jlptOrder: 4 , labelKey: 'ladder.bjt480.label', proofKey: 'ladder.bjt480.proof', unlocksKey: 'ladder.bjt480.unlocks' },
  { id: 'n1', label: 'N1', proof: 'JLPT N1 100/180', unlocks: 'Client-facing, legal/medical, management-track roles · HSP +15 pts', jlptOrder: 4 , labelKey: 'ladder.n1.label', proofKey: 'ladder.n1.proof', unlocksKey: 'ladder.n1.unlocks' },
  { id: 'j1', label: 'BJT J1 / J1+', proof: 'BJT 530–599 (J1) · 600–800 (J1+)', unlocks: 'Appropriate — then sufficient — communication in any business situation', jlptOrder: 5 , labelKey: 'ladder.j1.label', proofKey: 'ladder.j1.proof', unlocksKey: 'ladder.j1.unlocks' },
]

const JLPT_ORDER = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4, 'N1+': 5 }

export function ladderWithStatus(diagnosis) {
  const currentOrder = diagnosis?.jlptEstimate ? (JLPT_ORDER[diagnosis.jlptEstimate] ?? -1) : -1
  let nextMarked = false
  return PROOF_LADDER.map((h) => {
    let status = 'locked'
    if (h.jlptOrder <= currentOrder) status = 'reached'
    else if (!nextMarked) { status = 'next'; nextMarked = true }
    return { ...h, status }
  })
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
