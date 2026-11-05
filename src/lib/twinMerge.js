// Pure Twin merge guard (Doc 04 §3/§7) — no imports, so it is directly
// node-testable (tests/phase2.test.mjs) and reusable from twinSync.js.
//
// Rule: last-write-wins by the Twin's own `updatedAt`, with a hard guard —
// a cloud copy may replace the local Twin ONLY when it is strictly newer.
// An older (or equal, or undated) cloud copy must never overwrite local
// state: the local Twin is the offline source of truth, and a stale cloud
// row (e.g. written by another device before it saw today's work) would
// silently delete a day of learning.

export function twinTimestamp(twin) {
  const t = Date.parse(twin?.updatedAt || '')
  return Number.isFinite(t) ? t : 0
}

/** Returns 'cloud' when the cloud Twin should be adopted locally, else 'local'. */
export function pickNewerTwin(localTwin, cloudTwin) {
  if (!cloudTwin) return 'local'
  if (!localTwin) return 'cloud'
  return twinTimestamp(cloudTwin) > twinTimestamp(localTwin) ? 'cloud' : 'local'
}
