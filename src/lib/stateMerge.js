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
  return [...byAt.values()].sort((a, b) => ts(a.at) - ts(b.at))
}

/**
 * Merge two learner-state documents ({ queue, profile, diagnosis,
 * diagnosisHistory, promise, declaredLevel }). Returns a new document;
 * inputs untouched. declaredLevel is a single document like the
 * others — the newer declaration (its `at`) wins whole.
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
