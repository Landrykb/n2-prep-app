// Learner-state cloud sync (P0-1, Doc 04 §3): the ONE queue, profile,
// diagnosis (+ history) and promise — the assets the product accumulates.
//
// Mirrors the Twin mirror's contract (twinSync.js):
//   - Local storage is the offline source of truth.
//   - On sign-in: pull the cloud document, MERGE it with local via
//     stateMerge.mergeLearnerState (union for the queue and history,
//     newer-wins per document slice), apply the merged result locally,
//     and push it back up. Guest work is therefore ADOPTED by the
//     account on first sign-in, never orphaned (P1-4's new-layer half;
//     the legacy n2:anon:* half is anonMerge.js).
//   - On every local save of a synced slice (stateEvents bus): debounced
//     push of the whole document. One row per user, jsonb — the same
//     document contract as the Twin (migration 00006).
//   - Signed out: does nothing at all.

import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { collectLearnerState, applyLearnerState } from './learnerState.js'
import { mergeLearnerState } from './stateMerge.js'
import { onLearnerStateSaved } from './stateEvents.js'

let activeUserId = null
let status = 'local-only' // local-only | syncing | synced | error
let unsubscribeSave = null
let pushTimer = null
const statusListeners = new Set()

// First-sync gate (Landry, 2026-11-11: "It showed me N4 level,
// everything empty and the welcome questionnaire for several
// seconds or minutes before showing my real account info"):
// auth resolving is NOT data resolving. Until the FIRST pull
// has landed and been applied, the app must show skeletons —
// never the factory-default profile (an N4, an empty queue, a
// welcome questionnaire) dressed as the learner's real state.
// Pending settles on success AND on error (local state is the
// fallback, never a trap), plus a hard 15s escape so a stalled
// network can never skeleton-lock the app; the pull continues
// in the background and applies when it lands.
let firstSyncPending = false
let firstSyncTimer = null

export function isFirstSyncPending() {
  return firstSyncPending
}

function setFirstSyncPending(next) {
  if (firstSyncPending === next) return
  firstSyncPending = next
  for (const fn of statusListeners) { try { fn(status) } catch { /* ignore */ } }
}

export function getStateSyncState() {
  return activeUserId ? status : 'local-only'
}

export function subscribeStateSync(fn) {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

function setStatus(next) {
  status = next
  for (const fn of statusListeners) { try { fn(next) } catch { /* ignore */ } }
}

async function pushStateNow() {
  if (!supabase || !activeUserId) return
  setStatus('syncing')
  // Pull-merge-push (integration audit #1): the cloud document is
  // shared with the Telegram bot, which writes mined words and level
  // declarations into the SAME row. A blind whole-document upsert
  // would erase anything the bot (or another device) wrote since this
  // device last pulled — so every push first re-reads the row, merges
  // it with the local document (union/never-lose rules in
  // stateMerge.js), applies the merged result locally, and only then
  // upserts. If the re-read fails, the push is skipped entirely:
  // overwriting sight-unseen is exactly the failure this prevents.
  let cloudState = null
  try {
    const { data, error } = await supabase
      .from('learner_state')
      .select('state, updated_at')
      .eq('user_id', activeUserId)
      .maybeSingle()
    if (error) throw error
    cloudState = data?.state || null
  } catch (err) {
    console.error('stateSync pre-push pull error:', err)
    setStatus('error')
    return
  }
  const state = cloudState
    ? mergeLearnerState(collectLearnerState(), cloudState)
    : collectLearnerState()
  if (cloudState) applyLearnerState(state)
  const { error } = await supabase
    .from('learner_state')
    .upsert(
      { user_id: activeUserId, state, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  setStatus(error ? 'error' : 'synced')
  if (error) console.error('stateSync push error:', error)
}

function schedulePush() {
  if (!activeUserId) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => { pushStateNow().catch(() => setStatus('error')) }, 1500)
}

export async function initStateSync(user) {
  if (!isSupabaseConfigured || !supabase || !user?.id) return
  if (activeUserId === user.id) return
  stopStateSync()
  activeUserId = user.id
  setStatus('syncing')
  setFirstSyncPending(true)
  if (firstSyncTimer) clearTimeout(firstSyncTimer)
  firstSyncTimer = setTimeout(() => setFirstSyncPending(false), 15000)

  try {
    const { data, error } = await supabase
      .from('learner_state')
      .select('state, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) throw error
    const cloudState = data?.state || null
    const state = cloudState
      ? mergeLearnerState(collectLearnerState(), cloudState)
      : collectLearnerState()
    if (cloudState) applyLearnerState(state)
    // The account's data is ON SCREEN from this line — unblock
    // the skeleton before the write-back below finishes.
    setFirstSyncPending(false)
    if (firstSyncTimer) { clearTimeout(firstSyncTimer); firstSyncTimer = null }
    // Push the (possibly merged) local truth up so the cloud
    // reflects this device — including first-sign-in adoption
    // of guest work. This used to route through pushStateNow,
    // which PULLED THE ROW A SECOND TIME before upserting —
    // two serial selects on every cold start for a merge window
    // of milliseconds. The init upsert writes the document the
    // pull above just produced; every LATER push keeps the full
    // pull-merge-push guard in pushStateNow.
    const { error: upError } = await supabase
      .from('learner_state')
      .upsert(
        { user_id: user.id, state, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
    if (upError) throw upError
    setStatus('synced')
  } catch (err) {
    console.error('stateSync pull error:', err)
    setStatus('error')
    setFirstSyncPending(false)
    if (firstSyncTimer) { clearTimeout(firstSyncTimer); firstSyncTimer = null }
  }

  unsubscribeSave = onLearnerStateSaved(() => schedulePush())
}

export function stopStateSync() {
  if (unsubscribeSave) { unsubscribeSave(); unsubscribeSave = null }
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
  if (firstSyncTimer) { clearTimeout(firstSyncTimer); firstSyncTimer = null }
  setFirstSyncPending(false)
  activeUserId = null
  setStatus('local-only')
}
