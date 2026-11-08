// Pure merge logic for the learner state (P0-1 / P1-4) — no imports, so it
// is directly node-testable (tests/readiness.test.mjs) and shared by
// stateSync.js (cloud <-> local) and restore.js (backup file -> local).
//
// THE RULE THAT OUTRANKS ALL OTHERS: merging never loses learning.
// A merge may pick a *version* of an item, but it may never drop an item
// that exists on either side. Deletion stays an explicit user act
// (removeFromQueue, account deletion) — sync is not a delete channel.
//
// QUEUE items (same id on both sides) — which copy wins, and why:
//   FSRS progress is effectively monotonic per card. reviewCard() runs on
//   every rating and always increments `reps`, and `lastReview` moves
//   forward with it. So the copy with MORE reps has strictly more learning
//   history behind it; nothing the other copy knows can be newer in any
//   way that matters. Ties break toward the later `lastReview` (the most
//   recent actual interaction), then higher `stability` (the stronger
//   memory estimate), then local (the device in hand is the tie-breaker —
//   it is also the offline source of truth, same as the Twin guard).
//
// PROFILE / DIAGNOSIS / PROMISE — single documents, not collections, so
// there is nothing to union: each carries its own timestamp
// (profile.updatedAt, diagnosis.at, promise.at) and the newer one wins
// whole. Local wins ties. A slice missing on one side is taken from the
// other — again, nothing is lost by merging.
//
// DIAGNOSIS HISTORY — a list keyed by its `at` timestamp: union, dedupe
// by `at`, sorted ascending. Two devices' histories interleave honestly.
// Capped at 24 with the FIRST entry pinned (day30.js
// DIAGNOSIS_HISTORY_CAP): the Day-30 delta is anchored on the first
// diagnosis, so capping keeps first + newest, never first-evicting.
//
// MODE SPELLS — a list keyed by `startedAt` (day30.js): union; on a
// shared startedAt the closed copy wins (it carries the endedAt),
// between two closed copies the later endedAt wins; capped at the
// last 26. The same rule lives in day30.js (mergeModeSpells) — it is
// duplicated here only to keep this module import-free; the day30
// test suite pins both implementations to identical output.

export function fsrsProgressKey(item) {
  const f = item?.fsrs || {}
  return [
    f.reps || 0,
    Date.parse(f.lastReview || '') || 0,
    f.stability || 0,
  ]
}

/** Returns 'local' or 'cloud' (the winning copy of a same-id queue item). */
export function pickQueueWinner(localItem, cloudItem) {
  if (!localItem) return 'cloud'
  if (!cloudItem) return 'local'
  const a = fsrsProgressKey(localItem)
  const b = fsrsProgressKey(cloudItem)
  for (let i = 0; i < a.length; i++) {
    if (b[i] > a[i]) return 'cloud'
    if (a[i] > b[i]) return 'local'
  }
  return 'local'
}

/** Union-merge two queues by item id. Local order is preserved; items
 *  that exist only on the other side append in their own order. */
export function mergeQueues(localQueue, cloudQueue) {
  const local = Array.isArray(localQueue) ? localQueue : []
  const other = Array.isArray(cloudQueue) ? cloudQueue : []
  const otherById = new Map(other.filter((i) => i?.id).map((i) => [i.id, i]))
  const seen = new Set()
  const out = []
  for (const item of local) {
    if (!item?.id) { out.push(item); continue }
    seen.add(item.id)
    const rival = otherById.get(item.id)
    out.push(rival && pickQueueWinner(item, rival) === 'cloud' ? rival : item)
  }
  for (const item of other) {
    if (item?.id && !seen.has(item.id)) { seen.add(item.id); out.push(item) }
  }
  return out
}

const ts = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0 }

function pickDoc(localDoc, otherDoc, stampOf) {
  if (!otherDoc) return localDoc ?? null
  if (!localDoc) return otherDoc
  return ts(stampOf(otherDoc)) > ts(stampOf(localDoc)) ? otherDoc : localDoc
}

export function mergeDiagnosisHistory(localHist, otherHist) {
  const byAt = new Map()
  for (const e of [...(Array.isArray(localHist) ? localHist : []), ...(Array.isArray(otherHist) ? otherHist : [])]) {
    if (e && e.at) byAt.set(e.at, e)
  }
  const sorted = [...byAt.values()].sort((a, b) => ts(a.at) - ts(b.at))
  if (sorted.length <= 24) return sorted
  return [sorted[0], ...sorted.slice(-23)]
}

export function mergeModeSpells(localSpells, otherSpells) {
  const byStart = new Map()
  const put = (s) => {
    if (!s || typeof s.mode !== 'string' || !s.mode || !Number.isFinite(ts(s.startedAt)) || ts(s.startedAt) === 0) return
    const clean = { mode: s.mode, startedAt: s.startedAt, endedAt: s.endedAt && Number.isFinite(ts(s.endedAt)) ? s.endedAt : null }
    const prev = byStart.get(clean.startedAt)
    if (!prev) { byStart.set(clean.startedAt, clean); return }
    if (prev.mode !== clean.mode) return
    const prevEnd = prev.endedAt ? ts(prev.endedAt) : -Infinity
    const cleanEnd = clean.endedAt ? ts(clean.endedAt) : -Infinity
    if (cleanEnd > prevEnd) byStart.set(clean.startedAt, clean)
  }
  for (const s of Array.isArray(localSpells) ? localSpells : []) put(s)
  for (const s of Array.isArray(otherSpells) ? otherSpells : []) put(s)
  const sorted = [...byStart.values()].sort((a, b) => ts(a.startedAt) - ts(b.startedAt))
  return sorted.slice(-26)
}

/**
 * Encounters (Fit v2, amendment #10): a plain word list merged by
 * UNION — local order first, the other side's new words appended.
 * An encounter, once met, was met: the merged list can only ever
 * grow, never shrink, whichever side is older.
 */
export function mergeEncounters(localWords, otherWords) {
  const out = []
  const seen = new Set()
  for (const w of [...(Array.isArray(localWords) ? localWords : []), ...(Array.isArray(otherWords) ? otherWords : [])]) {
    if (typeof w !== 'string') continue
    const word = w.trim()
    if (!word || seen.has(word)) continue
    seen.add(word)
    out.push(word)
  }
  return out
}

/**
 * Saki's plan state (integration audit #7): { plans: {date: plan},
 * experiment, experimentLog }. Plans merge PER DATE: a consumed copy
 * beats an unconsumed copy of the same day (work already done from a
 * plan is never un-done by a merge), otherwise the later-created plan
 * wins; dates present on only one side are kept. The running
 * experiment: the only copy wins; same id → the copy that has seen
 * more sessions (then more proof) wins; different ids → the later
 * start wins. The experiment log unions by experiment id.
 */
export function mergePlanStates(localState, otherState) {
  const L = localState && typeof localState === 'object' ? localState : null
  const O = otherState && typeof otherState === 'object' ? otherState : null
  if (!L) return O
  if (!O) return L
  const plans = { ...(L.plans || {}) }
  for (const [date, plan] of Object.entries(O.plans || {})) {
    const mine = plans[date]
    if (!mine) { plans[date] = plan; continue }
    if (!!plan?.consumed !== !!mine?.consumed) { if (plan?.consumed) plans[date] = plan; continue }
    if (ts(plan?.createdAt) > ts(mine?.createdAt)) plans[date] = plan
  }
  let experiment = L.experiment || null
  const otherExp = O.experiment || null
  if (otherExp && !experiment) experiment = otherExp
  else if (otherExp && experiment) {
    if (otherExp.id === experiment.id) {
      const a = [experiment.sessionsSeen || 0, experiment.proofSum || 0]
      const b = [otherExp.sessionsSeen || 0, otherExp.proofSum || 0]
      if (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1])) experiment = otherExp
    } else if (ts(otherExp.startedAt) > ts(experiment.startedAt)) experiment = otherExp
  }
  const logById = new Map()
  for (const e of [...(Array.isArray(L.experimentLog) ? L.experimentLog : []), ...(Array.isArray(O.experimentLog) ? O.experimentLog : [])]) {
    if (e?.id && !logById.has(e.id)) logById.set(e.id, e)
  }
  return { plans, experiment, experimentLog: [...logById.values()] }
}

/**
 * The in-progress One Session (integration audit #9): one document
 * per learner, keyed by its `date`. A later date wins whole (a new
 * day is a new session). Same date → the MORE-PROGRESSED copy wins:
 * done/recorded beats not (a finished session is never resurrected
 * as unfinished, and its `recorded` guard travels with it), then the
 * higher step, then more rated cards, then the better scene result,
 * then the later start.
 */
export function mergeSessionStates(localState, otherState) {
  const L = localState && typeof localState === 'object' ? localState : null
  const O = otherState && typeof otherState === 'object' ? otherState : null
  if (!L) return O
  if (!O) return L
  if ((O.date || '') !== (L.date || '')) return (O.date || '') > (L.date || '') ? O : L
  const progress = (s) => [
    s.done || s.recorded ? 1 : 0,
    s.step || 0,
    Array.isArray(s.ratedIds) ? s.ratedIds.length : 0,
    s.sceneBest || 0,
    s.sceneAttempts || 0,
    ts(s.segmentStartAt) || ts(s.startedAt),
  ]
  const a = progress(L)
  const b = progress(O)
  for (let i = 0; i < a.length; i++) {
    if (b[i] > a[i]) return O
    if (a[i] > b[i]) return L
  }
  return L
}

/**
 * Merge two learner-state documents ({ queue, profile, diagnosis,
 * diagnosisHistory, promise, declaredLevel, encounters, language,
 * modeSpells, plan, session }).
 * Returns a new document; inputs untouched. declaredLevel and
 * language are single documents like the others — the newer one
 * (its `at`) wins whole.
 * Encounters union (above): met words are never un-met by a merge.
 * Mode spells union by startedAt (above): a spell, once recorded,
 * is never un-recorded by a merge.
 * Plan merges per date with consumed-wins (above); the session
 * merges by date then by progress (above).
 */
export function mergeLearnerState(local, other) {
  const L = local || {}
  const O = other || {}
  return {
    queue: mergeQueues(L.queue, O.queue),
    profile: pickDoc(L.profile, O.profile, (d) => d.updatedAt),
    diagnosis: pickDoc(L.diagnosis, O.diagnosis, (d) => d.at),
    diagnosisHistory: mergeDiagnosisHistory(L.diagnosisHistory, O.diagnosisHistory),
    promise: pickDoc(L.promise, O.promise, (d) => d.at),
    declaredLevel: pickDoc(L.declaredLevel, O.declaredLevel, (d) => d.at),
    language: pickDoc(L.language, O.language, (d) => d.at),
    voiceCast: pickDoc(L.voiceCast, O.voiceCast, (d) => d.at),
    encounters: mergeEncounters(L.encounters, O.encounters),
    modeSpells: mergeModeSpells(L.modeSpells, O.modeSpells),
    plan: mergePlanStates(L.plan, O.plan),
    session: mergeSessionStates(L.session, O.session),
  }
}

/**
 * Legacy Anki progress merge (P1-4): { due, count, lastDate, newToday,
 * newLimit } per device/cloud. Per card, the copy with the higher review
 * count is further along; its due date is the fresher schedule. Count
 * ties break toward the side with the later lastDate (the more recent
 * device), then toward the other side (cloud — the shared copy).
 */
export function mergeAnkiProgress(local, other) {
  if (!other) return local
  if (!local) return other
  const due = { ...(local.due || {}) }
  const count = { ...(local.count || {}) }
  const otherIsFresher = ts(other.lastDate) > ts(local.lastDate)
  for (const [id, c] of Object.entries(other.count || {})) {
    const mine = count[id] || 0
    if (c > mine || (c === mine && otherIsFresher)) {
      count[id] = c
      if (other.due?.[id]) due[id] = other.due[id]
    }
  }
  return {
    due,
    count,
    lastDate: otherIsFresher ? other.lastDate : local.lastDate,
    newToday: otherIsFresher ? (other.newToday || 0) : (local.newToday || 0),
    newLimit: Math.max(local.newLimit || 20, other.newLimit || 20),
  }
}
