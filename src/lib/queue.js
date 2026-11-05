// The ONE unified review queue.
//
// Every source of personal study material — voice-loop errors, mined
// sentences from the learner's own documents, manual saves — lands in a
// single localStorage queue scheduled by the FSRS-style scheduler in
// fsrs.js. One queue is the anti-abandonment design: there is never a
// second or third pile waiting in another tab.

import { createCardState, reviewCard, isDue } from './fsrs.js'

export const QUEUE_KEY = 'jpn:queue:v1'

export function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveQueue(items) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
  } catch { /* storage full / unavailable — queue just won't persist */ }
}

/** Stable id for a queue item, so re-adding the same material dedupes. */
export function queueItemId(source, front) {
  let h = 0
  const s = `${source}|${front}`
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return `q${(h >>> 0).toString(36)}-${s.length}`
}

/**
 * Add items to the queue. Each item: { front, back, reading?, source, level?, note? }.
 * Duplicates (same source+front) are skipped. Returns { queue, added }.
 */
export function addToQueue(newItems, now = new Date()) {
  const queue = loadQueue()
  const seen = new Set(queue.map((i) => i.id))
  let added = 0
  for (const item of newItems || []) {
    if (!item?.front) continue
    const id = item.id || queueItemId(item.source || 'manual', item.front)
    if (seen.has(id)) continue
    seen.add(id)
    queue.push({
      id,
      front: item.front,
      back: item.back || '',
      reading: item.reading || '',
      note: item.note || '',
      source: item.source || 'manual',
      level: item.level || '',
      createdAt: now.toISOString(),
      fsrs: createCardState(now),
    })
    added++
  }
  saveQueue(queue)
  return { queue, added }
}

export function removeFromQueue(id) {
  const queue = loadQueue().filter((i) => i.id !== id)
  saveQueue(queue)
  return queue
}

/** Rate a queue item; its FSRS state advances and it leaves until due again. */
export function rateQueueItem(id, rating, now = new Date()) {
  const queue = loadQueue().map((i) =>
    i.id === id ? { ...i, fsrs: reviewCard(i.fsrs || createCardState(now), rating, now) } : i,
  )
  saveQueue(queue)
  return queue
}

/** Due items (reviewed before and due now) + brand-new items, capped. */
export function todaySession(queue, { maxNew = 10, maxDue = 20, now = new Date() } = {}) {
  const due = []
  const fresh = []
  for (const item of queue) {
    if (!item.fsrs?.reps) fresh.push(item)
    else if (isDue(item.fsrs, now)) due.push(item)
  }
  due.sort((a, b) => new Date(a.fsrs.due) - new Date(b.fsrs.due))
  return {
    due: due.slice(0, maxDue),
    fresh: fresh.slice(0, maxNew),
    dueTotal: due.length,
    newTotal: fresh.length,
  }
}

export function queueStats(queue, now = new Date()) {
  const { dueTotal, newTotal } = todaySession(queue, { now })
  return {
    total: queue.length,
    due: dueTotal,
    fresh: newTotal,
    mastered: queue.filter((i) => (i.fsrs?.reps || 0) >= 3 && !isDue(i.fsrs, now)).length,
  }
}
