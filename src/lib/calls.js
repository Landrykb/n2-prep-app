// Sensei Call — the manufactured requirement.
//
// Person B's lab and C & D's company REQUIRED Japanese every day; a life
// that requires none lets the level slip. Sensei Call manufactures a small
// daily requirement: at a pseudo-random minute inside windows the learner
// sets, the app initiates a short spoken-Japanese call.
//
// Persistence without punishment: a missed call gets exactly ONE callback,
// then a kind inbox message with a 60-second version, then silence for the
// day. No streaks, no penalties, no red numbers — history is "calls kept".
//
// Honest transport limit: this is a web app. While the app is closed it can
// only reach the learner via push notification (see hooks/usePush.js); the
// call itself is a call-style screen inside the app. No real telephony.

import { scenes } from '../data/scenes.js'
import { todayStr } from './session.js'

export const CALLS_KEY = 'jpn:calls:v1'
export const INBOX_KEY = 'jpn:inbox:v1'
// sessionStorage hand-off for a summons tapped from a push notification:
// the service worker messages App.jsx, which stashes the slot here and
// routes to the Yobidashi screen; SenseiCall consumes it once on mount.
export const INCOMING_CALL_KEY = 'jpn:incoming-call:v1'
export const MASTERY = 85

export function dateHash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

export const DEFAULT_WINDOWS = [
  { start: '08:00', end: '09:30' },
  { start: '12:30', end: '14:00' },
  { start: '19:00', end: '21:00' },
]

export function defaultCallSettings() {
  return {
    enabled: false,
    senseiName: 'Sensei',
    persistence: 'standard', // 'gentle' | 'standard'
    callsPerDay: 2,
    windows: DEFAULT_WINDOWS.map((w) => ({ ...w })),
  }
}

function defaultCallState() {
  return { settings: defaultCallSettings(), days: {}, history: [] }
}

export function loadCallState() {
  try {
    const raw = localStorage.getItem(CALLS_KEY)
    if (!raw) return defaultCallState()
    const parsed = JSON.parse(raw)
    return {
      settings: { ...defaultCallSettings(), ...(parsed.settings || {}) },
      days: parsed.days || {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
    }
  } catch { return defaultCallState() }
}

export function saveCallState(state) {
  try { localStorage.setItem(CALLS_KEY, JSON.stringify(state)) } catch { /* ignore */ }
  return state
}

export function loadInbox() {
  try {
    const parsed = JSON.parse(localStorage.getItem(INBOX_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function saveInbox(list) {
  try { localStorage.setItem(INBOX_KEY, JSON.stringify(list)) } catch { /* ignore */ }
  return list
}

/** Add an inbox message unless one with the same id already exists. */
export function addInboxMessage(msg) {
  const list = loadInbox()
  if (list.some((m) => m.id === msg.id)) return list
  list.unshift(msg)
  saveInbox(list)
  return list
}

export function markInboxDone(id) {
  const list = loadInbox().map((m) => (m.id === id ? { ...m, done: true } : m))
  saveInbox(list)
  return list
}

function minutesOfDay(hhmm) {
  const [h, m] = String(hhmm || '08:00').split(':').map((x) => parseInt(x, 10))
  return (Number.isFinite(h) ? h : 8) * 60 + (Number.isFinite(m) ? m : 0)
}

export function fmtTime(date) {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/**
 * The deterministic slot minute for a window on a given day: a hash of
 * date + window decides ONE minute inside the window, so the slot is stable
 * across renders/reloads but varies day to day and window to window.
 */
export function slotDateFor(dateStr, window, windowIndex) {
  const start = minutesOfDay(window.start)
  let end = minutesOfDay(window.end)
  if (end <= start) end = start + 30 // degenerate window → treat as 30 min
  const span = Math.max(1, end - start - 5) // keep 5 min clear of the end edge
  const offset = dateHash(`${dateStr}|call|${windowIndex}|${window.start}-${window.end}`) % span
  const d = new Date(`${dateStr}T00:00:00`)
  d.setMinutes(start + offset)
  return d
}

/**
 * Scene chain for one call: the pain-matched scene for this slot first,
 * then up to (count-1) follow-up scenes from the same domain (falling back
 * to the other top pain-matched scenes). 2–4 exchanges, all real scenes —
 * no invented Japanese.
 */
export function pickCallScenes(profile, dateStr, slotIndex = 0, count = 3) {
  const pains = new Set(profile?.pains || [])
  const persona = profile?.persona
  const score = (s) => (s.for || []).reduce((acc, tag) => acc + (pains.has(tag) || tag === persona || (persona === 'parent' && tag === 'life-admin') || (persona === 'business' && tag === 'keigo') ? 1 : 0), 0)
  const ranked = [...scenes].sort((a, b) => score(b) - score(a))
  const top = ranked.slice(0, Math.max(3, Math.min(6, ranked.length)))
  const lead = top[dateHash(`${dateStr}|call${slotIndex}`) % top.length] || ranked[0]
  const chain = [lead]
  const sameDomain = ranked.filter((s) => s.id !== lead.id && s.domain === lead.domain)
  const rest = ranked.filter((s) => s.id !== lead.id && s.domain !== lead.domain)
  for (const s of [...sameDomain, ...rest]) {
    if (chain.length >= Math.max(2, Math.min(4, count))) break
    chain.push(s)
  }
  return chain
}

/**
 * Generate today's slots from settings (idempotent): one slot per call
 * window, using the first N windows where N = callsPerDay. Existing slots
 * (and their outcomes) are never regenerated.
 */
export function ensureToday(state, now = new Date()) {
  const date = todayStr(now)
  if (state.days[date]) return state
  const { settings } = state
  const day = { date, slots: [], callback: null, stopped: false, inboxSent: false }
  if (settings.enabled) {
    const n = Math.max(1, Math.min(3, settings.callsPerDay || 1, settings.windows.length))
    for (let i = 0; i < n; i++) {
      const at = slotDateFor(date, settings.windows[i], i)
      // Born-expired: a slot whose minute is already more than
      // an hour past when the day is created (settings saved
      // late in the day, app first opened in the evening) was
      // never really offered — it starts as skipped and can
      // never ring. Fresher past slots stay pending for the
      // one catch-up offer in SenseiCall's trigger check.
      const bornExpired = at.getTime() < now.getTime() - 60 * 60000
      day.slots.push({
        idx: i, windowIndex: i, at: at.toISOString(),
        windowLabel: `${settings.windows[i].start}–${settings.windows[i].end}`,
        status: bornExpired ? 'skipped' : 'pending', // pending | ringing | completed | callback-scheduled | missed | skipped
        catchupShown: false, callbackUsed: false,
      })
    }
  }
  return { ...state, days: { ...state.days, [date]: day } }
}

/** Callback delay after a miss: standard 20–40 min (deterministic), gentle a flat ~40 min. */
export function callbackDelayMinutes(state, dateStr, slotIdx) {
  if (state.settings.persistence === 'gentle') return 40
  return 20 + (dateHash(`${dateStr}|callback|${slotIdx}`) % 21)
}

/**
 * Register a miss for a slot (declined, rung out, or hung up before the
 * first exchange). First miss → schedule the ONE callback and return
 * { kind: 'callback', at }. If this miss WAS the callback → final: create
 * the inbox message, mark the slot missed, and stop calls for the day.
 * Mutates and returns { state, outcome } — caller saves.
 */
export function registerMiss(state, { slotIdx, wasCallback, sceneTitle, now = new Date() }) {
  const date = todayStr(now)
  const day = state.days[date]
  if (!day) return { state, outcome: { kind: 'none' } }
  const next = { ...state, days: { ...state.days, [date]: { ...day, slots: day.slots.map((s) => ({ ...s })) } } }
  const nDay = next.days[date]
  const slot = nDay.slots.find((s) => s.idx === slotIdx)
  if (!slot) return { state: next, outcome: { kind: 'none' } }

  if (!wasCallback && !slot.callbackUsed) {
    const delay = callbackDelayMinutes(next, date, slotIdx)
    const at = new Date(now.getTime() + delay * 60000)
    slot.status = 'callback-scheduled'
    slot.callbackUsed = true
    nDay.callback = { at: at.toISOString(), slotIdx, status: 'pending' }
    return { state: next, outcome: { kind: 'callback', at } }
  }

  // The callback was missed too (or none was allowed): kind close for the day.
  slot.status = 'missed'
  nDay.callback = nDay.callback ? { ...nDay.callback, status: 'missed' } : null
  nDay.stopped = true
  nDay.slots = nDay.slots.map((s) => (s.status === 'pending' || s.status === 'callback-scheduled' ? { ...s, status: 'skipped' } : s))
  let inbox = null
  if (!nDay.inboxSent) {
    nDay.inboxSent = true
    inbox = {
      id: `missed-${date}-${slotIdx}`,
      at: now.toISOString(),
      kind: 'missed-call',
      title: 'Sorry I missed you',
      body: `We missed each other twice today${sceneTitle ? ` — the call was going to be about: ${sceneTitle}` : ''}. No problem at all. Here is the 60-second version whenever you have a minute:`,
      slotIdx, date, done: false,
    }
    addInboxMessage(inbox)
  }
  return { state: next, outcome: { kind: 'inbox', inbox } }
}

/** Record a finished/missed call in history (framed as "calls kept"). */
export function recordHistory(state, entry) {
  const history = [{ id: `h-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, at: new Date().toISOString(), ...entry }, ...state.history].slice(0, 60)
  return { ...state, history }
}
