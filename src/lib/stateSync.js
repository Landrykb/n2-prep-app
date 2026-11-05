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
  const state = collectLearnerState()
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

  try {
    const { data, error } = await supabase
      .from('learner_state')
      .select('state, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) throw error
    const cloudState = data?.state || null
    if (cloudState) {
      const merged = mergeLearnerState(collectLearnerState(), cloudState)
      applyLearnerState(merged)
    }
    // Push the (possibly merged) local truth up so the cloud reflects
    // this device — including first-sign-in adoption of guest work.
    await pushStateNow()
  } catch (err) {
    console.error('stateSync pull error:', err)
    setStatus('error')
  }

  unsubscribeSave = onLearnerStateSaved(() => schedulePush())
}

export function stopStateSync() {
  if (unsubscribeSave) { unsubscribeSave(); unsubscribeSave = null }
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
  activeUserId = null
  setStatus('local-only')
}
