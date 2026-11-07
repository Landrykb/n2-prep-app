// THE LEARNER TWIN (Doc 04) — a structured, growing model of the learner,
// stored locally at jpn:twin:v1. This module is the local source of truth;
// the cloud mirror (learner_twin table, Doc 04 §3) is synced by
// twinSync.js whenever the learner is signed in — local stays authoritative
// offline and wins any tie (see twinMerge.js).
//
// What the Twin holds: section levels + trend (from diagnosis history —
// scores are written ONLY by diagnosis code), the error fingerprint
// (18-pattern taxonomy, Doc 05 §2.2), personal vocabulary stats (derived
// from the ONE queue), life context (mirrored from the profile), rhythm
// (sessions, calls, felt effort), a learning-style model with per-method
// proof-point proxies, and the current adaptation mode (written only by
// modes.js — code, never AI).
//
// HONESTY RULES baked in here:
// - Speaking/register figures carry estimate: 'heuristic' permanently.
// - The fingerprint classifier is a HEURISTIC over local signals (missing
//   key phrases, scene metadata, lapse events). It is labelled as such in
//   the UI; it finds likely patterns, it does not grade like a teacher.
// - Learning-style "proof points" are a PROXY (scenes mastered, cards
//   graduated, items answered right), labelled as such wherever shown.

import { loadQueue } from './queue.js'
import { loadProfile, loadDiagnosis } from './profile.js'
import { loadCallState } from './calls.js'
import { todayStr } from './session.js'
import { recordMetric } from './metrics.js'
import { appendDiagnosisHistory } from './day30.js'
import { shadowClassify } from './correctorShadow.js'

export const TWIN_KEY = 'jpn:twin:v1'
export const DIAGNOSIS_HISTORY_KEY = 'jpn:diagnosisHistory:v1'
export const MASTERED_KEY = 'jpn:voice:mastered'
export const EFFORT_KEY = 'jpn:effort:v1'

// ---------------------------------------------------------------- taxonomy
// Doc 05 §2.2 — extend only by doc amendment.
export const ERROR_PATTERNS = [
  { id: 'particle-ha-ga', label: 'は vs が (topic vs subject)', plain: 'Choosing between は and が — the topic marker and the subject marker.' },
  { id: 'particle-ni-de', label: 'に vs で (place/time markers)', plain: 'に for where something exists or the time it happens; で for where an action happens.' },
  { id: 'particle-wo-omission', label: 'Dropped を', plain: 'The object marker を quietly going missing before a verb.' },
  { id: 'word-order', label: 'Word order', plain: 'Japanese puts the verb last — pieces landing in English order.' },
  { id: 'counter-documents', label: 'Counter for documents (通・枚)', plain: 'Copies and documents are counted in 通 or 枚 — never 個.' },
  { id: 'counter-people', label: 'Counter for people (人・名)', plain: 'People are counted in 人, or 名 in polite service Japanese.' },
  { id: 'counter-general', label: 'General counters (個・つ)', plain: 'Everyday things take 個 or つ — picking the wrong counter family.' },
  { id: 'verb-form-te', label: 'て-form (joining actions)', plain: 'The て-form that chains actions and makes requests.' },
  { id: 'verb-form-nai', label: 'ない-form (negatives)', plain: 'Building “don’t / not” forms correctly.' },
  { id: 'past-tense-slip', label: 'Past tense slips', plain: 'Saying it happened — た-forms and their timing.' },
  { id: 'keigo-direction', label: 'Keigo direction (respectful vs humble)', plain: '尊敬語 raises the other person; 謙譲語 lowers you. Swapping them flips the meaning.' },
  { id: 'keigo-over-polite', label: 'Too polite', plain: 'So formal it sounds distant — politeness past what the moment needs.' },
  { id: 'keigo-under-polite', label: 'Not polite enough', plain: 'Plain forms where the setting expects です・ます politeness.' },
  { id: 'register-mix', label: 'Register mix', plain: 'Casual and polite styles mixed inside one conversation.' },
  { id: 'listening-numbers-dates', label: 'Listening: numbers & dates', plain: 'Catching numbers, prices, times and dates at natural speed.' },
  { id: 'listening-negation', label: 'Listening: negatives', plain: 'A small ない or ません flipping the meaning — and getting missed.' },
  { id: 'listening-speed-drop', label: 'Listening: losing the thread', plain: 'The sentence moving on before the meaning lands — speed, not knowledge.' },
  { id: 'vocab-near-miss', label: 'Near-miss word', plain: 'The right idea with a close-but-wrong word (転出届 vs 転入届).' },
  { id: 'pronunciation-unintelligible', label: 'Hard to catch (transcript)', plain: 'The voice transcript barely matched the line. This is judged from the transcript, never from sound — a heuristic label.' },
]
export const patternById = (id) => ERROR_PATTERNS.find((p) => p.id === id)

// ------------------------------------------------------------ persistence
function emptyTwin() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sections: {}, // written by recordDiagnosis only
    speaking: { estimate: 'heuristic', attempts: 0, masteredEvents: 0, scoreSum: 0, avgBest: null },
    register: { estimate: 'heuristic', keigoAttempts: 0, bjtBand: null, bjtScore: null },
    fingerprint: {}, // patternId -> { count, recentWeight, lastSeenAt, example }
    vocab: { queueTotal: 0, graduated: 0, fresh: 0, bySource: {} },
    life: null, // mirrored from profile on refresh
    rhythm: {
      sessionLog: [], // { date, minutes, accuracy01, lapseRate, proof }
      lastSessionAt: null,
      callsKept: 0, callsMissed: 0,
      feltEffortRecent: [],
    },
    accuracyRecent: [], // { at, kind, score01 } capped
    learningStyle: {
      methods: {
        voice: { sessions: 0, minutes: 0, proof: 0 },
        mining: { sessions: 0, minutes: 0, proof: 0 },
        listening: { sessions: 0, minutes: 0, proof: 0 },
        reading: { sessions: 0, minutes: 0, proof: 0 },
      },
      lastExperiment: null, // written by planner.js when an experiment concludes
      note: null,
    },
    mode: 'cruise',
    modeSince: new Date().toISOString(),
    userCorrections: [],
  }
}

export function loadTwin() {
  try {
    const raw = localStorage.getItem(TWIN_KEY)
    if (!raw) return emptyTwin()
    const parsed = JSON.parse(raw)
    const base = emptyTwin()
    return {
      ...base, ...parsed,
      speaking: { ...base.speaking, ...(parsed.speaking || {}) },
      register: { ...base.register, ...(parsed.register || {}) },
      rhythm: { ...base.rhythm, ...(parsed.rhythm || {}) },
      learningStyle: {
        ...base.learningStyle, ...(parsed.learningStyle || {}),
        methods: { ...base.learningStyle.methods, ...((parsed.learningStyle || {}).methods || {}) },
      },
      fingerprint: parsed.fingerprint || {},
      sections: parsed.sections || {},
    }
  } catch { return emptyTwin() }
}

// Subscribers notified after every save (twinSync.js registers the cloud
// push here — kept as a registry so this module never imports sync code).
const twinSaveListeners = new Set()
export function onTwinSaved(fn) {
  twinSaveListeners.add(fn)
  return () => twinSaveListeners.delete(fn)
}

export function saveTwin(twin) {
  const next = { ...twin, updatedAt: new Date().toISOString() }
  try { localStorage.setItem(TWIN_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  for (const fn of twinSaveListeners) { try { fn(next) } catch { /* a listener must never break a save */ } }
  return next
}

export function deleteTwin() {
  try {
    localStorage.removeItem(TWIN_KEY)
    localStorage.removeItem('jpn:plan:v1')
    localStorage.removeItem('jpn:coach:v1')
  } catch { /* ignore */ }
}

// ------------------------------------------------------- diagnosis history
export function loadDiagnosisHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DIAGNOSIS_HISTORY_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function pushDiagnosisHistory(result) {
  if (!result?.sections) return loadDiagnosisHistory()
  const history = loadDiagnosisHistory()
  const entry = {
    at: result.at || new Date().toISOString(),
    jlptEstimate: result.jlptEstimate,
    total: result.total,
    sections: { ...result.sections },
    weakest: result.weakest,
    bjtScore: result.bjtScore ?? null,
    bjtBand: result.bjtBand ?? null,
  }
  // Diagnosis.jsx re-renders with the same result object; guard duplicates.
  const last = history[history.length - 1]
  if (last && last.at === entry.at) return history
  // Day-30 cohort measurement (day30.js, Doc 11 §7): the append caps
  // the history while PINNING the first diagnosis — the Day-30 delta
  // is anchored on it and must stay computable forever.
  const next = appendDiagnosisHistory(history, entry)
  try { localStorage.setItem(DIAGNOSIS_HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next
}

/** Section deltas between the two most recent diagnoses (null if < 2). */
export function diagnosisDeltas() {
  const h = loadDiagnosisHistory()
  if (h.length < 2) return null
  const prev = h[h.length - 2]
  const last = h[h.length - 1]
  const sections = {}
  for (const k of Object.keys(last.sections || {})) {
    sections[k] = (last.sections[k] ?? 0) - (prev.sections?.[k] ?? 0)
  }
  return { from: prev, to: last, sections, total: (last.total ?? 0) - (prev.total ?? 0) }
}

// ------------------------------------------------------------ fingerprint
const COUNTER_DOC = /[通枚]/
const COUNTER_PEOPLE = /[人名]/
const COUNTER_GENERAL = /[個つ本台件]/
const NEGATION = /ない|ません|なかった/

/**
 * HEURISTIC classifier (fallback Corrector, Doc 05 §4): turns one failed
 * voice attempt into 0–2 taxonomy pattern ids, using only local signals —
 * the scene's own metadata, which key phrases went missing, and how far
 * the transcript landed from the model. Labelled heuristic everywhere.
 */
export function classifyVoiceError({ scene, text, missing = [], score = 0 }) {
  if (!scene || score >= 85) return []
  const out = []
  const meta = `${scene.targetPattern || ''} ${scene.commonError || ''} ${scene.keigoNote || ''}`
  const missingJoined = (missing || []).join(' ')
  const isKeigoScene = (scene.for || []).includes('keigo') || scene.domain === 'Business' || /keigo|尊敬|謙譲/i.test(meta)

  if (COUNTER_DOC.test(missingJoined)) out.push('counter-documents')
  else if (COUNTER_PEOPLE.test(missingJoined)) out.push('counter-people')
  else if (COUNTER_GENERAL.test(missingJoined)) out.push('counter-general')

  if (/instead of/i.test(scene.commonError || '')) out.push('vocab-near-miss')
  if (/order/i.test(meta) && !out.includes('word-order')) out.push('word-order')
  if (/は.*が|topic|subject marker/i.test(meta)) out.push('particle-ha-ga')
  if (/に.*で|exist|location marker/i.test(meta) && out.length < 2) out.push('particle-ni-de')
  if (/drop|missing.*を|を.*missing/i.test(meta)) out.push('particle-wo-omission')
  if (/て-form|〜て|て形/i.test(meta) && out.length < 2) out.push('verb-form-te')
  if (/ない-form|negative form/i.test(meta) && out.length < 2) out.push('verb-form-nai')
  if (/past|〜た|た-form/i.test(meta) && out.length < 2) out.push('past-tense-slip')

  if (isKeigoScene) {
    const plainEnding = /(だ|である|する|行く|来る)[。．]?$/.test((text || '').trim())
    if (plainEnding && /(です|ます)/.test(scene.model || '')) out.unshift('register-mix')
    else if (missing.length > 0 && !out.includes('keigo-direction')) out.unshift('keigo-direction')
    else if (out.length === 0) out.push('keigo-under-polite')
  }

  const deduped = [...new Set(out)].slice(0, 2)
  if (deduped.length) return deduped
  if (score < 25 && (text || '').trim().length >= 4) return ['pronunciation-unintelligible']
  if (score >= 40 && missing.length === 0) return ['vocab-near-miss']
  return []
}

/** Heuristic pattern guess for a queue lapse (Again rating), from card text. */
export function classifyQueueLapse(item) {
  if (!item) return []
  const text = `${item.front || ''} ${item.note || ''} ${item.back || ''}`
  if (/転入届|転出届/.test(text)) return ['vocab-near-miss']
  if (COUNTER_DOC.test(text) && /counter|通|枚/i.test(text)) return ['counter-documents']
  if (/尊敬|謙譲|keigo/i.test(text)) return ['keigo-direction']
  return []
}

/** Listening misses: numbers/dates first, then negation, else speed. */
export function classifyListeningMiss(scriptText) {
  const s = scriptText || ''
  if (/[0-9０-９]|時|日|月|年|円|分/.test(s)) return ['listening-numbers-dates']
  if (NEGATION.test(s)) return ['listening-negation']
  return ['listening-speed-drop']
}

function recordPatterns(twin, patternIds, example) {
  const now = new Date().toISOString()
  for (const id of patternIds || []) {
    if (!patternById(id)) continue
    const cur = twin.fingerprint[id] || { count: 0, recentWeight: 0, lastSeenAt: null, example: '' }
    // recentWeight: simple decay toward the new event (half-life feel
    // without a nightly job — refreshed against lastSeen gap in days).
    const days = cur.lastSeenAt ? Math.max(0, (Date.now() - new Date(cur.lastSeenAt).getTime()) / 86400000) : 0
    const decayed = cur.recentWeight * Math.pow(0.5, days / 21)
    twin.fingerprint[id] = {
      count: cur.count + 1,
      recentWeight: Math.min(1, decayed + 0.34),
      lastSeenAt: now,
      example: example || cur.example || '',
    }
  }
  return twin
}

/** Top fingerprint patterns by recent weight (then count) — Saki's input. */
export function topPatterns(twin, n = 3) {
  return Object.entries(twin.fingerprint || {})
    .map(([id, v]) => ({ id, ...v, label: patternById(id)?.label || id, plain: patternById(id)?.plain || '' }))
    .sort((a, b) => (b.recentWeight - a.recentWeight) || (b.count - a.count))
    .slice(0, n)
}

// ------------------------------------------------------------- event hooks
function pushAccuracy(twin, kind, score01) {
  twin.accuracyRecent = [...(twin.accuracyRecent || []), { at: new Date().toISOString(), kind, score01 }]
    .slice(-60)
  return twin
}

function bumpMethod(twin, method, { sessions = 0, minutes = 0, proof = 0 } = {}) {
  const m = twin.learningStyle.methods[method]
  if (!m) return twin
  m.sessions += sessions
  m.minutes += minutes
  m.proof += proof
  return twin
}

/** A voice attempt (VoiceLoop / OneSession / Sensei Call exchange). */
export function recordVoiceAttempt({ scene, text, score, missing = [] }) {
  let twin = loadTwin()
  twin.speaking.attempts += 1
  twin.speaking.scoreSum += score || 0
  twin.speaking.avgBest = twin.speaking.attempts
    ? Math.round(twin.speaking.scoreSum / twin.speaking.attempts)
    : null
  const isKeigoScene = (scene?.for || []).includes('keigo') || scene?.domain === 'Business'
  if (isKeigoScene) twin.register.keigoAttempts += 1
  if (score >= 85) {
    twin.speaking.masteredEvents += 1
    bumpMethod(twin, 'voice', { proof: 1 })
  } else {
    const patterns = classifyVoiceError({ scene, text, missing, score })
    recordPatterns(twin, patterns, text)
    // Corrector shadow mode (Doc 05 §4): the rules' verdict above is
    // the only one recorded — but the same production is also sent,
    // fire-and-forget, to the AI Corrector so the two classifications
    // can be compared in the corrector_shadow metric (Doc 08 §4 gate).
    // Silent when signed out / capped / unreachable; changes nothing.
    if (patterns.length) {
      shadowClassify({
        production: text,
        target: scene?.model || '',
        context: { sceneId: scene?.id || null, targetPattern: scene?.targetPattern || '', missing },
        ruleCategory: patterns[0],
      })
    }
  }
  pushAccuracy(twin, 'voice', (score || 0) / 100)
  return saveTwin(twin)
}

/** A queue rating (Today quick review / OneSession cards). */
export function recordQueueRating(item, rating) {
  let twin = loadTwin()
  if (rating === 1) recordPatterns(twin, classifyQueueLapse(item), item?.front || '')
  return saveTwin(twin)
}

/** A finished One Session (or busy-day session). */
export function recordSessionSummary({ minutes = 0, accuracy01 = null, lapseRate = null, proof = 0, listeningCorrect = null, listeningScript = '' }) {
  let twin = loadTwin()
  const now = new Date()
  twin.rhythm.sessionLog = [...(twin.rhythm.sessionLog || []), {
    date: todayStr(now), minutes, accuracy01, lapseRate, proof,
  }].slice(-21)
  twin.rhythm.lastSessionAt = now.toISOString()
  bumpMethod(twin, 'voice', { sessions: 1, minutes })
  if (listeningCorrect !== null && listeningCorrect !== undefined) {
    bumpMethod(twin, 'listening', { sessions: 1, proof: listeningCorrect ? 1 : 0 })
    if (!listeningCorrect) recordPatterns(twin, classifyListeningMiss(listeningScript), '')
    pushAccuracy(twin, 'listening', listeningCorrect ? 1 : 0)
  }
  return saveTwin(twin)
}

/** Sensei Call outcomes. */
export function recordCallOutcome({ kept, bestScore = null, partial = false }) {
  let twin = loadTwin()
  if (kept) twin.rhythm.callsKept += 1
  else twin.rhythm.callsMissed += 1
  if (kept && bestScore !== null) pushAccuracy(twin, 'voice', Math.min(1, bestScore / 100))
  // Gate metric (Doc 11): kept | missed | partial (ended warmly early).
  recordMetric('call_outcome', { outcome: partial ? 'partial' : kept ? 'kept' : 'missed' })
  return saveTwin(twin)
}

/** Mining run that produced/added cards. */
export function recordMining({ cardsFound = 0, cardsAdded = 0 }) {
  let twin = loadTwin()
  bumpMethod(twin, 'mining', {
    sessions: cardsFound > 0 ? 1 : 0,
    minutes: Math.round(cardsAdded * 0.5),
    proof: 0,
  })
  return saveTwin(twin)
}

/** Reading activity (diagnosis reading item). */
export function recordReading({ correct }) {
  let twin = loadTwin()
  bumpMethod(twin, 'reading', { sessions: 1, proof: correct ? 1 : 0 })
  return saveTwin(twin)
}

/** Every finished diagnosis also writes the Twin's section levels. */
export function recordDiagnosis(result) {
  pushDiagnosisHistory(result)
  let twin = loadTwin()
  const history = loadDiagnosisHistory()
  const map = { language: 'language', reading: 'reading', listening: 'listening' }
  for (const [src, dst] of Object.entries(map)) {
    const score = result?.sections?.[src]
    if (typeof score !== 'number') continue
    const trend = history.map((h) => h.sections?.[src]).filter((v) => typeof v === 'number').slice(-6)
    twin.sections[dst] = { score, of: 60, trend, updatedAt: new Date().toISOString() }
  }
  if (result?.bjtBand) { twin.register.bjtBand = result.bjtBand; twin.register.bjtScore = result.bjtScore ?? null }
  return saveTwin(twin)
}

export function removePattern(patternId) {
  const twin = loadTwin()
  delete twin.fingerprint[patternId]
  twin.userCorrections = [...(twin.userCorrections || []), { at: new Date().toISOString(), kind: 'pattern-removed', patternId }]
  return saveTwin(twin)
}

// ------------------------------------------------------- derived refresh
function loadMasteredScenes() {
  try { return JSON.parse(localStorage.getItem(MASTERED_KEY) || '[]') } catch { return [] }
}

/**
 * Recompute the derived parts of the Twin from their source stores:
 * vocab stats from the ONE queue, life context from the profile, speaking
 * mastered count from VoiceLoop's store, felt effort from its key. Cheap
 * and idempotent — call it before reading the Twin for display/planning.
 */
export function refreshTwin() {
  let twin = loadTwin()
  const queue = loadQueue()
  const bySource = {}
  let graduated = 0
  let fresh = 0
  for (const item of queue) {
    bySource[item.source || 'manual'] = (bySource[item.source || 'manual'] || 0) + 1
    if ((item.fsrs?.reps || 0) >= 3) graduated++
    if (!item.fsrs?.reps) fresh++
  }
  twin.vocab = { queueTotal: queue.length, graduated, fresh, bySource }
  // Mining proof points (proxy) = mined cards that have graduated in the
  // queue. Absolute count, recomputed — never double-counted.
  twin.learningStyle.methods.mining.proof = queue.filter(
    (i) => i.source === 'mining' && (i.fsrs?.reps || 0) >= 3,
  ).length

  const profile = loadProfile()
  if (profile) {
    twin.life = {
      persona: profile.persona || null,
      pains: profile.pains || [],
      proofTarget: profile.proofTarget || null,
    }
  }
  const mastered = loadMasteredScenes()
  twin.speaking.masteredScenes = Array.isArray(mastered) ? mastered.length : 0
  const diagnosis = loadDiagnosis()
  if (diagnosis?.bjtBand) { twin.register.bjtBand = diagnosis.bjtBand; twin.register.bjtScore = diagnosis.bjtScore ?? null }

  try {
    const effort = JSON.parse(localStorage.getItem(EFFORT_KEY) || '[]')
    if (Array.isArray(effort)) twin.rhythm.feltEffortRecent = effort.slice(-7).map((e) => e.answer)
  } catch { /* ignore */ }

  const calls = loadCallState()
  if (Array.isArray(calls.history) && calls.history.length) {
    twin.rhythm.callsKept = calls.history.filter((h) => h.status === 'completed').length
    twin.rhythm.callsMissed = calls.history.filter((h) => h.status === 'missed').length
  }
  return saveTwin(twin)
}

/** Learning-style rows for display: proof points per hour (proxy) + confidence words. */
export function learningStyleRows(twin) {
  const conf = (trials) => (trials > 20 ? 'solid' : trials >= 8 ? 'getting clearer' : 'early days')
  return Object.entries(twin.learningStyle?.methods || {}).map(([id, m]) => ({
    id,
    trials: m.sessions,
    minutes: m.minutes,
    proof: m.proof,
    proofPerHour: m.minutes > 0 ? Math.round((m.proof / (m.minutes / 60)) * 10) / 10 : null,
    confidence: conf(m.sessions),
  }))
}

export function twinSummaryForAi(twin) {
  // Doc 05 §2.1 shape — kept ready for the AI tiers; used by the local
  // rule-based Planner today so the swap later is a transport change only.
  const diagnosis = loadDiagnosis()
  return {
    level: diagnosis?.jlptEstimate ? `${diagnosis.jlptEstimate} (est.)` : 'not diagnosed yet',
    sections: {
      language: twin.sections?.language?.score ?? null,
      reading: twin.sections?.reading?.score ?? null,
      listening: twin.sections?.listening?.score ?? null,
    },
    weakestSection: diagnosis?.weakest || null,
    mode: twin.mode,
    topFingerprint: topPatterns(twin, 3).map((p) => ({ pattern: p.id, weight: Math.round(p.recentWeight * 100) / 100 })),
    proofTarget: twin.life?.proofTarget || null,
    dueCount: twin.vocab ? Math.max(0, twin.vocab.queueTotal - twin.vocab.graduated) : 0,
  }
}
