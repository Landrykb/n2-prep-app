// Twin cloud mirror sync (Doc 04 §3/§7, Phase 2).
//
// The Twin lives locally first (jpn:twin:v1 is the offline source of
// truth). When the learner is signed in, this module mirrors it to the
// `learner_twin` table:
//   - On sign-in: pull the cloud row and MERGE it with local by
//     collection (twinMerge.js mergeTwins) — neither device's
//     fingerprint, session log or counters are ever discarded.
//   - On every local save (twin.js onTwinSaved): debounced
//     pull-merge-push, the same contract as stateSync — a push never
//     overwrites cloud work this device has not seen.
// Signed-out: this module does nothing at all — local only, zero behaviour
// change. Sync state is surfaced quietly in TwinView via getTwinSyncState()
// / subscribeTwinSync().

import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { TWIN_KEY, loadTwin, onTwinSaved } from './twin.js'
import { mergeTwins } from './twinMerge.js'

export const TWIN_SYNC_EVENT = 'jpn:twin-synced'

let activeUserId = null
let status = 'local-only' // local-only | syncing | synced | error
let unsubscribeSave = null
let pushTimer = null
const statusListeners = new Set()

export function getTwinSyncState() {
  return activeUserId ? status : 'local-only'
}

export function subscribeTwinSync(fn) {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

function setStatus(next) {
  status = next
  for (const fn of statusListeners) { try { fn(next) } catch { /* ignore */ } }
}

async function pushTwinNow() {
  if (!supabase || !activeUserId) return
  setStatus('syncing')
  // Pull-merge-push (integration audit #3): re-read the cloud Twin
  // and merge by collection before writing, so a push from this
  // device can never erase work another device (or the bot's
  // surfaces) recorded since this device last pulled. On a failed
  // pull, do NOT push — overwriting blind is the bug being fixed.
  let twin = loadTwin()
  try {
    const { data, error } = await supabase
      .from('learner_twin')
      .select('twin, updated_at')
      .eq('user_id', activeUserId)
      .maybeSingle()
    if (error) throw error
    const cloudTwin = data?.twin || null
    if (cloudTwin) {
      const merged = mergeTwins(twin, cloudTwin)
      if (merged && JSON.stringify(merged) !== JSON.stringify(twin)) {
        adoptCloudTwin(merged)
        twin = merged
      }
    }
  } catch (err) {
    console.error('twinSync pre-push pull error:', err)
    setStatus('error')
    return
  }
  const { error } = await supabase
    .from('learner_twin')
    .upsert(
      { user_id: activeUserId, twin, updated_at: twin.updatedAt || new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  setStatus(error ? 'error' : 'synced')
  if (error) console.error('twinSync push error:', error)
}

function schedulePush() {
  if (!activeUserId) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => { pushTwinNow().catch(() => setStatus('error')) }, 1500)
}

/** Adopt a cloud Twin locally, verbatim (its own updatedAt is preserved —
 *  saveTwin() would restamp it and fake a newer local write). */
function adoptCloudTwin(cloudTwin) {
  try {
    localStorage.setItem(TWIN_KEY, JSON.stringify(cloudTwin))
    window.dispatchEvent(new CustomEvent(TWIN_SYNC_EVENT))
  } catch { /* ignore */ }
}

export async function initTwinSync(user) {
  if (!isSupabaseConfigured || !supabase || !user?.id) return
  if (activeUserId === user.id) return // already running for this user
  stopTwinSync()
  activeUserId = user.id
  setStatus('syncing')

  // Pull-on-login with the collection merge: adopt the merged
  // Twin locally, then push it up so the cloud holds the union too.
  try {
    const { data, error } = await supabase
      .from('learner_twin')
      .select('twin, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) throw error
    const cloudTwin = data?.twin || null
    const localTwin = loadTwin()
    if (cloudTwin) {
      const merged = mergeTwins(localTwin, cloudTwin)
      if (merged && JSON.stringify(merged) !== JSON.stringify(localTwin)) adoptCloudTwin(merged)
    }
    await pushTwinNow()
  } catch (err) {
    console.error('twinSync pull error:', err)
    setStatus('error')
  }

  unsubscribeSave = onTwinSaved(() => schedulePush())
}

export function stopTwinSync() {
  if (unsubscribeSave) { unsubscribeSave(); unsubscribeSave = null }
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
  activeUserId = null
  setStatus('local-only')
}
