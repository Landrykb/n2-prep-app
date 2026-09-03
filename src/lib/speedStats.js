// Adaptive weighting for Speed Cards.
//
// Every prompt keeps a small record of how often it was missed vs answered
// correctly. Items you keep missing are drawn far more often than items you
// already know, so a session automatically concentrates on your weak spots.

const KEY = 'n2:speed:stats'
const MAX_ENTRIES = 4000

export function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

export function saveStats(stats) {
  try {
    // Keep the store bounded: drop mastered entries first if it grows too large.
    const keys = Object.keys(stats)
    if (keys.length > MAX_ENTRIES) {
      const trimmed = keys
        .map((k) => [k, stats[k]])
        .sort((a, b) => weightOf(b[1]) - weightOf(a[1]))
        .slice(0, MAX_ENTRIES)
      stats = Object.fromEntries(trimmed)
    }
    localStorage.setItem(KEY, JSON.stringify(stats))
  } catch {
    /* storage full or unavailable — weighting simply resets next session */
  }
}

/** Draw weight: missed items are heavily favoured, mastered ones fade out. */
export function weightOf(rec) {
  if (!rec) return 1
  const misses = rec.m || 0
  const hits = rec.h || 0
  // 1 base + 3 per miss, halved for each streak of correct answers beyond misses.
  const w = 1 + misses * 3 - Math.max(0, hits - misses) * 0.4
  return Math.max(0.25, Math.min(w, 12))
}

export function recordResult(stats, key, correct) {
  const rec = stats[key] || { m: 0, h: 0 }
  if (correct) rec.h = (rec.h || 0) + 1
  else rec.m = (rec.m || 0) + 1
  stats[key] = rec
  return stats
}

/** Weighted sample without replacement. */
export function weightedSample(items, count, stats, keyOf) {
  const pool = items.map((item) => ({ item, w: weightOf(stats[keyOf(item)]) }))
  const picked = []
  let total = pool.reduce((s, p) => s + p.w, 0)
  const n = Math.min(count, pool.length)
  for (let i = 0; i < n; i++) {
    let r = Math.random() * total
    let idx = 0
    for (let j = 0; j < pool.length; j++) {
      if (pool[j].w <= 0) continue
      r -= pool[j].w
      if (r <= 0) { idx = j; break }
      idx = j
    }
    picked.push(pool[idx].item)
    total -= pool[idx].w
    pool[idx].w = 0
  }
  return picked
}

/** How many tracked items are still weak (used for the "review" badge). */
export function weakCount(stats) {
  return Object.values(stats).filter((r) => (r.m || 0) > (r.h || 0)).length
}
