// Heard Words — the Vault (Doc 22, Landry's ask 2026-11-11).
//
// The panel answers "what did Hori hear TODAY"; the vault is
// the collection itself: every word ever kept, visible every
// time, with how many sit inside, how many are already
// mastered, and the details one tap down. The stored rows are
// per-day counts ({item, kind, count, day}) — the vault is a
// pure aggregation over them, nothing new is recorded, and the
// privacy shape does not change: words and counts, never
// conversations.
//
// Mastery uses the product's own bars, no new definition:
// a queue word counts mastered at fsrs.reps >= 3 (the queue
// stats bar in queue.js), and an encountered word counts
// mastered because encounters carry full proven credit
// (Fit v2). Deck credit below the band does NOT count here —
// the vault's mastered number is about what the learner has
// actually practised or met, not what their level presumes.

export const VAULT_FLOOR = 2

/** Aggregate per-day rows into one entry per distinct item. */
export function aggregateHeardRows(rows) {
  const byItem = new Map()
  const allDays = new Set()
  for (const r of rows ?? []) {
    const item = typeof r?.item === 'string' ? r.item.trim() : ''
    if (!item) continue
    const count = Number.isFinite(r?.count) ? Math.max(0, Math.floor(r.count)) : 0
    const day = typeof r?.day === 'string' ? r.day : ''
    if (day) allDays.add(day)
    let e = byItem.get(item)
    if (!e) {
      e = { item, kind: r?.kind === 'expr' ? 'expr' : 'word', total: 0, days: new Set(), firstDay: day, lastDay: day }
      byItem.set(item, e)
    }
    e.total += count
    if (day) {
      e.days.add(day)
      if (!e.firstDay || day < e.firstDay) e.firstDay = day
      if (!e.lastDay || day > e.lastDay) e.lastDay = day
    }
  }
  const entries = [...byItem.values()].map((e) => ({
    item: e.item,
    kind: e.kind,
    total: e.total,
    dayCount: e.days.size,
    firstDay: e.firstDay,
    lastDay: e.lastDay,
  }))
  return { entries, dayTotal: allDays.size }
}

/** The mastered set: queue fronts proven by reps + encounters. */
export function masteredSetFrom(queueItems, encounterWords) {
  const set = new Set()
  for (const item of queueItems ?? []) {
    const front = typeof item?.front === 'string' ? item.front.trim() : ''
    if (front && (item?.fsrs?.reps ?? 0) >= 3) set.add(front)
  }
  for (const w of encounterWords ?? []) {
    const word = typeof w === 'string' ? w.trim() : ''
    if (word) set.add(word)
  }
  return set
}

/** Headline numbers for the vault card. */
export function vaultSummary(entries, masteredSet) {
  const kept = entries.length
  const named = entries.filter((e) => e.total >= VAULT_FLOOR).length
  const hearings = entries.reduce((n, e) => n + e.total, 0)
  const mastered = masteredSet
    ? entries.filter((e) => masteredSet.has(e.item)).length
    : 0
  return { kept, named, once: kept - named, hearings, mastered }
}

/** Display orderings (stable, deterministic). */
export function sortVaultEntries(entries, mode) {
  const byItem = (a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : 0)
  const arr = [...entries]
  if (mode === 'recent') {
    arr.sort((a, b) => (b.lastDay < a.lastDay ? -1 : b.lastDay > a.lastDay ? 1 : 0) || b.total - a.total || byItem(a, b))
  } else {
    arr.sort((a, b) => b.total - a.total || (b.lastDay < a.lastDay ? -1 : b.lastDay > a.lastDay ? 1 : 0) || byItem(a, b))
  }
  return arr
}
