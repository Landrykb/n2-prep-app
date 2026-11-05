// Problem-first profile: who the learner is, what hurts, and what proof
// they are climbing toward. Diagnosis and the Today prescription READ this
// profile — the app starts from the person's problem, not from features.

import { emitLearnerStateSaved } from './stateEvents.js'

export const PROFILE_KEY = 'jpn:profile:v1'
export const DIAGNOSIS_KEY = 'jpn:diagnosis:v1'
export const LAST_VISIT_KEY = 'jpn:last-visit:v1'

export const PERSONAS = [
  { id: 'resident', label: 'Resident worker in Japan', desc: 'Living and working here — Japanese is daily life, not a hobby' },
  { id: 'job-hunter', label: 'Job hunter needing N2+', desc: 'Blocked at the résumé filter until the level is on paper' },
  { id: 'student', label: 'Student', desc: 'Building toward study, work, or a longer future in Japan' },
  { id: 'ssw', label: 'Specified Skilled Worker', desc: 'Needs solid everyday + workplace Japanese to grow' },
  { id: 'business', label: 'Business professional (BJT / keigo)', desc: 'Meetings, clients, email — register is the job' },
  { id: 'parent', label: 'Parent in Japan', desc: 'School notes, city office, hospital — for your family, not just you' },
]

export const PAINS = [
  { id: 'habit', label: 'My habit keeps breaking', desc: 'Start for 1–2 days, then life happens and the app dies', focus: ['dashboard', 'anki'] },
  { id: 'speaking', label: 'I can read, but I can’t speak', desc: 'Recognition is fine — production freezes', focus: ['voice', 'speed'] },
  { id: 'listening', label: 'I fail the listening section', desc: 'One play, natural speed, gone before I process it', focus: ['n2listening', 'voice'] },
  { id: 'slipped', label: 'My Japanese slipped after years in Japan', desc: 'It was better before I slowed down', focus: ['diagnosis', 'voice', 'anki'] },
  { id: 'blocked-job', label: 'Blocked from jobs / promotion / visa points', desc: 'The level is the gate, not the work itself', focus: ['mock', 'diagnosis', 'bjt'] },
  { id: 'keigo', label: 'I freeze in meetings / keigo', desc: 'I know what to say — not how to say it at work', focus: ['voice', 'bjt'] },
  { id: 'life-admin', label: 'Can’t handle city office / hospital / school alone', desc: 'Real tasks in Japanese still need a helper', focus: ['voice', 'mine'] },
]

export const PROOF_TARGETS = [
  { id: 'jlpt', label: 'A JLPT level (N5 → N1)', desc: 'Pass with margin — overall mark AND every section ≥ 19/60' },
  { id: 'bjt', label: 'A BJT band (J5 → J1+)', desc: 'Business Japanese that employers can score 0–800' },
  { id: 'hsp', label: 'Highly Skilled Professional points', desc: 'N1 = 15 pts · N2 = 10 pts · BJT ≥480 = N1 category · ≥400 = N2 category' },
  { id: 'real-life', label: 'A real-life height', desc: 'First meeting in Japanese · immigration alone · the job interview itself' },
]

export function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveProfile(profile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, updatedAt: new Date().toISOString() })); emitLearnerStateSaved() } catch { /* ignore */ }
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
export const PROOF_LADDER = [
  { id: 'foundation', label: 'N5–N4 foundation', proof: 'JLPT N5 80 / N4 90 · every section ≥ 19/60', unlocks: 'Daily life without panic; Specified Skilled Worker floor', jlptOrder: 1 },
  { id: 'bridge', label: 'N3 bridge', proof: 'JLPT N3 95/180', unlocks: 'Everyday Japan handled alone — counters, calls, school', jlptOrder: 2 },
  { id: 'n2', label: 'N2 — the job filter', proof: 'JLPT N2 90/180', unlocks: 'Passes the résumé filter · HSP +10 pts · B2 evidence for language roles', jlptOrder: 3 },
  { id: 'bjt400', label: 'BJT 400', proof: 'BJT ≥ 400 (upper J3)', unlocks: 'Counts as the N2 category for HSP points · B2 evidence', jlptOrder: 3 },
  { id: 'bjt480', label: 'BJT 480', proof: 'BJT ≥ 480 (inside J2)', unlocks: 'Counts as the N1 category for HSP points (15 pts)', jlptOrder: 4 },
  { id: 'n1', label: 'N1', proof: 'JLPT N1 100/180', unlocks: 'Client-facing, legal/medical, management-track roles · HSP +15 pts', jlptOrder: 4 },
  { id: 'j1', label: 'BJT J1 / J1+', proof: 'BJT 530–599 (J1) · 600–800 (J1+)', unlocks: 'Appropriate — then sufficient — communication in any business situation', jlptOrder: 5 },
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

const TAB_LABELS = {
  dashboard: 'Your capped Today session', anki: 'Review queue (max 10 new)', voice: 'Voice Loop scene',
  n2listening: 'Listening — one play, no transcript first', mock: 'Timed mock exam', diagnosis: 'Health-check diagnosis',
  bjt: 'BJT trainer', mine: 'Mine your own documents', speed: 'Speed Cards', errors: 'Error Log review', lessons: 'Grammar pattern',
}

/**
 * Derive today's prescription from profile + diagnosis.
 * Returns { line, actions: [{tab, label, reason}], focusNote }.
 */
export function derivePlan(profile, diagnosis) {
  const painIds = profile?.pains || []
  const pains = PAINS.filter((p) => painIds.includes(p.id))
  const focusTabs = []
  for (const p of pains) for (const t of p.focus) if (!focusTabs.includes(t)) focusTabs.push(t)

  const weakest = diagnosis?.weakest
  if (weakest === 'listening' && !focusTabs.includes('n2listening')) focusTabs.unshift('n2listening')
  if (weakest === 'language' && !focusTabs.includes('lessons')) focusTabs.unshift('lessons')
  if (weakest === 'reading' && !focusTabs.includes('reading')) focusTabs.unshift('reading')

  const actions = focusTabs.slice(0, 4).map((tab) => ({
    tab,
    label: TAB_LABELS[tab] || tab,
    reason: pains.find((p) => p.focus.includes(tab))?.label || (diagnosis && weakest ? `Your weakest section: ${weakest}` : 'From your diagnosis'),
  }))
  if (!actions.length) {
    actions.push(
      { tab: 'diagnosis', label: TAB_LABELS.diagnosis, reason: 'Start with the checkup — 10 minutes' },
      { tab: 'voice', label: TAB_LABELS.voice, reason: 'One real scene, spoken out loud' },
      { tab: 'anki', label: TAB_LABELS.anki, reason: 'A small, winnable queue' },
    )
  }

  const personaLabel = PERSONAS.find((p) => p.id === profile?.persona)?.label
  const mainPain = pains[0]?.label
  const targetLabel = PROOF_TARGETS.find((t) => t.id === profile?.proofTarget)?.label
  let line
  if (!profile) line = 'Tell the app what hurts first — then today’s plan is built around your problem, not around features.'
  else if (diagnosis) line = `${mainPain ? `Your problem: ${mainPain.charAt(0) === 'I' && mainPain.charAt(1) === ' ' ? mainPain : mainPain.charAt(0).toLowerCase() + mainPain.slice(1)}. ` : ''}Your checkup says ${diagnosis.jlptEstimate} level with ${weakest} weakest — today attacks exactly that, on the way to ${targetLabel || 'your next height'}.`
  else line = `${personaLabel ? `${personaLabel}. ` : ''}${mainPain ? `What hurts: ${mainPain.charAt(0) === 'I' && mainPain.charAt(1) === ' ' ? mainPain : mainPain.charAt(0).toLowerCase() + mainPain.slice(1)}. ` : ''}Run the 10-minute diagnosis once, and today’s plan sharpens itself around your weakest section.`

  return { line, actions, focusNote: pains.map((p) => p.label).join(' · ') }
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
