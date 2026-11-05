// Backup restore planner (P0-1): turns an export file back into data.
//
// The export format is accountDeletion.collectAllLocalData()'s output:
//   { exportedAt, data: { '<localStorage key>': <parsed value>, ... } }
// This planner is PURE — it takes the current device's data map and the
// imported file's data map and returns { writes, report }: which keys to
// write, with what values, and honest counts for the UI. Applying the
// writes is the caller's job (TwinView), so the merge rules live here,
// testable, in one place (tests/readiness.test.mjs).
//
// Safety rules:
//  - Only app keys are ever written (jpn:* / n2:* / mock-history) — a
//    restore file can never touch anything outside the app's namespace.
//  - The queue is union-merged (stateMerge): restoring a backup ADDS
//    what this device is missing and keeps the further-along copy of
//    what both have. It never shrinks the queue.
//  - Twin / profile / diagnosis / promise: the newer document wins
//    (same guards as cloud sync). An old backup cannot rewind today.
//  - Diagnosis history: union by timestamp.
//  - Every other key (call settings, session state, mastered scenes…)
//    is restored ONLY when this device has no value for it — a backup
//    fills gaps, it does not silently overwrite the present.

import { mergeQueues, mergeDiagnosisHistory } from './stateMerge.js'
import { pickNewerTwin } from './twinMerge.js'

export const QUEUE_KEY = 'jpn:queue:v1'
export const TWIN_KEY = 'jpn:twin:v1'
export const PROFILE_KEY = 'jpn:profile:v1'
export const DIAGNOSIS_KEY = 'jpn:diagnosis:v1'
export const DIAGNOSIS_HISTORY_KEY = 'jpn:diagnosisHistory:v1'
export const PROMISE_KEY = 'jpn:promise:v1'

const APP_PREFIXES = ['jpn:', 'n2:']
const EXTRA_KEYS = ['mock-history']
export const isAppKey = (k) => APP_PREFIXES.some((p) => k.startsWith(p)) || EXTRA_KEYS.includes(k)

const ts = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0 }

export function validateExport(parsed) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'That file is not a Yonde export — it is not JSON data we recognise.' }
  const data = parsed.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'That file has no data section — it does not look like a Yonde export (yonde-my-data.json).' }
  const keys = Object.keys(data).filter(isAppKey)
  if (!keys.length) return { ok: false, reason: 'That export contains no Yonde data keys — nothing to restore.' }
  return { ok: true, data, keys }
}

export function planRestore(current, imported) {
  const writes = {}
  const report = {
    queueBefore: 0, queueAfter: 0, queueAdded: 0,
    twin: 'kept', slicesUpdated: [], slicesKept: [],
    historyBefore: 0, historyAfter: 0,
    restoredKeys: 0, skippedKeys: 0, ignoredKeys: 0,
  }
  const cur = current || {}
  const imp = imported || {}

  for (const [key, value] of Object.entries(imp)) {
    if (!isAppKey(key)) { report.ignoredKeys++; continue }

    if (key === QUEUE_KEY) {
      const before = Array.isArray(cur[key]) ? cur[key] : []
      const merged = mergeQueues(before, Array.isArray(value) ? value : [])
      report.queueBefore = before.length
      report.queueAfter = merged.length
      report.queueAdded = merged.length - before.length
      if (JSON.stringify(merged) !== JSON.stringify(before)) writes[key] = merged
      continue
    }
    if (key === TWIN_KEY) {
      if (pickNewerTwin(cur[key] || null, value || null) === 'cloud') { writes[key] = value; report.twin = 'updated' }
      continue
    }
    if (key === DIAGNOSIS_HISTORY_KEY) {
      const before = Array.isArray(cur[key]) ? cur[key] : []
      const merged = mergeDiagnosisHistory(before, Array.isArray(value) ? value : [])
      report.historyBefore = before.length
      report.historyAfter = merged.length
      if (merged.length !== before.length) writes[key] = merged
      continue
    }
    if (key === PROFILE_KEY || key === DIAGNOSIS_KEY || key === PROMISE_KEY) {
      const stampOf = key === PROFILE_KEY ? (d) => d?.updatedAt : (d) => d?.at
      const mine = cur[key]
      if (!mine || ts(stampOf(value)) > ts(stampOf(mine))) { writes[key] = value; report.slicesUpdated.push(key) }
      else report.slicesKept.push(key)
      continue
    }
    // Any other app key: fill gaps only.
    if (cur[key] === undefined) { writes[key] = value; report.restoredKeys++ }
    else report.skippedKeys++
  }
  return { writes, report }
}
