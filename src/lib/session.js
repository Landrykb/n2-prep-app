// One Session helpers — pure selection + persistence for the single
// auto-sequenced daily session (src/components/OneSession.jsx).
//
// The session has NO choices: a scene matched to the learner's pains, up to
// five queue cards, one listening bite. Partial progress is saved to
// jpn:session:v1 and resuming continues exactly where the learner stopped —
// a half-finished session is a saved session, never an incomplete one.

import { scenes } from '../data/scenes.js'
import { listeningPlus } from '../data/listeningPlus.js'
import { n2Listening } from '../data/n2Listening.js'
import { todaySession } from './queue.js'
import { recordMetric } from './metrics.js'
import { emitLearnerStateSaved } from './stateEvents.js'

export const SESSION_KEY = 'jpn:session:v1'
export const EFFORT_KEY = 'jpn:effort:v1'
export const INTENT_KEY = 'jpn:session:intent' // 'full' | 'busy', set by Today buttons

export const MASTERY = 85
export const MAX_SESSION_CARDS = 5

export function todayStr(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dateHash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Scene matched to the learner's problem: pain/persona-tagged scenes first,
 *  with a stable per-day rotation so a resumed session keeps its scene. */
export function pickSceneForProfile(profile, dateStr) {
  const pains = new Set(profile?.pains || [])
  const persona = profile?.persona
  const score = (s) => (s.for || []).reduce((acc, tag) => acc + (pains.has(tag) || tag === persona || (persona === 'parent' && tag === 'life-admin') || (persona === 'business' && tag === 'keigo') ? 1 : 0), 0)
  const ranked = [...scenes].sort((a, b) => score(b) - score(a))
  const top = ranked.slice(0, Math.max(3, Math.min(6, ranked.length)))
  return top[dateHash(dateStr) % top.length] || ranked[0]
}

const LEVEL_ORDER = ['N5', 'N4', 'N3', 'N2', 'N1']

/** One listening bite: level nearest the diagnosis estimate — and when the
 *  weakest section IS listening, that is the level it trains at. */
export function pickListeningForDiagnosis(diagnosis, dateStr) {
  const pool = [...listeningPlus, ...n2Listening]
  const want = diagnosis?.jlptEstimate || 'N3'
  const wantIdx = Math.max(0, LEVEL_ORDER.indexOf(want))
  const byDistance = [...pool].sort((a, b) => {
    const da = Math.abs(LEVEL_ORDER.indexOf(a.level) - wantIdx)
    const db = Math.abs(LEVEL_ORDER.indexOf(b.level) - wantIdx)
    return da - db
  })
  const nearest = byDistance.filter((d) => Math.abs(LEVEL_ORDER.indexOf(d.level) - wantIdx) === Math.abs(LEVEL_ORDER.indexOf(byDistance[0].level) - wantIdx))
  return nearest[dateHash(`${dateStr}|listening`) % nearest.length]
}

/** Up to 5 of today's queue cards: genuinely due first, then new. */
export function buildSessionCards(queue, now = new Date()) {
  const s = todaySession(queue, { maxNew: MAX_SESSION_CARDS, maxDue: MAX_SESSION_CARDS, now })
  return [...s.due, ...s.fresh].slice(0, MAX_SESSION_CARDS)
}

/**
 * Minutes estimate shown on the Today button. Transparent arithmetic:
 * voice scene ≈ 3 min (busy-day variant is scene-only), ~30 s per card,
 * listening bite ≈ 2 min. Rounded, minimum 3.
 */
export function estimateSessionMinutes(queue, { busy = false, now = new Date() } = {}) {
  if (busy) return 3
  const cards = buildSessionCards(queue, now).length
  return Math.max(3, Math.round(3 + cards * 0.5 + 2))
}

export function loadSessionState() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveSessionState(state) {
  // The in-progress session is a learner-state slice (integration
  // audit #9): it rides the synced state document, so a session
  // finished on one device carries its `recorded` guard to every
  // other device and can never be recorded twice.
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(state)); emitLearnerStateSaved() } catch { /* ignore */ }
  return state
}

export function clearSessionState() {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

export function loadIntent() {
  try { return localStorage.getItem(INTENT_KEY) === 'busy' ? 'busy' : 'full' } catch { return 'full' }
}

export function setIntent(variant) {
  try { localStorage.setItem(INTENT_KEY, variant) } catch { /* ignore */ }
}

/** Felt-effort check history: [{ date, variant, answer }] — one per day+variant. */
export function saveEffort(answer, variant, now = new Date()) {
  recordMetric('effort_check', { answer, variant }) // gate metric (Doc 11)
  const date = todayStr(now)
  let list = []
  try { list = JSON.parse(localStorage.getItem(EFFORT_KEY) || '[]') } catch { list = [] }
  if (!Array.isArray(list)) list = []
  list = list.filter((e) => !(e.date === date && e.variant === variant))
  list.push({ date, variant, answer, at: now.toISOString() })
  try { localStorage.setItem(EFFORT_KEY, JSON.stringify(list)) } catch { /* ignore */ }
  return list
}
