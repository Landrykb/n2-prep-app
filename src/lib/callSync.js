// Yobidashi call-settings sync (Doc 02 §3.2/§5, Phase 2 step 2.5).
//
// The client owns the call settings (jpn:calls:v1). When the learner is
// signed in, this mirrors them to `call_windows` so the server scheduler
// (call-scheduler edge function) can ring a CLOSED app by push. Signed-out
// learners stay fully local — their calls ring when the app opens, exactly
// as before, and the settings UI says which mode they're in
// (callReachMode + SenseiCall's honest copy).
//
// Sync also happens when calls are switched OFF (enabled: false row), so
// the server stops ringing the moment the learner turns calls off here.

import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { loadCallState } from './calls.js'

export function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * 'server'  — signed in: the scheduler can reach a closed app by push.
 * 'device'  — local only: calls ring when the app is opened.
 * Mirrors what the UI promises, so compute it from real state, not flags.
 */
export async function callReachMode() {
  if (!isSupabaseConfigured || !supabase) return 'device'
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.user ? 'server' : 'device'
  } catch {
    return 'device'
  }
}

export async function syncCallWindows(state = loadCallState()) {
  armCallSyncListeners()
  if (!isSupabaseConfigured || !supabase) return 'not-configured'
  try {
    const { data } = await supabase.auth.getSession()
    const user = data?.session?.user
    if (!user) return 'signed-out'
    const s = state?.settings || {}
    const { error } = await supabase
      .from('call_windows')
      .upsert(
        {
          user_id: user.id,
          enabled: Boolean(s.enabled),
          windows: Array.isArray(s.windows) ? s.windows : [],
          calls_per_day: Math.max(1, Math.min(3, s.callsPerDay || 1)),
          persistence: s.persistence === 'gentle' ? 'gentle' : 'standard',
          sensei_name: typeof s.senseiName === 'string' && s.senseiName ? s.senseiName : 'Sensei',
          timezone: deviceTimezone(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
    if (error) {
      console.error('callSync error:', error)
      return 'error'
    }
    return 'synced'
  } catch (err) {
    console.error('callSync error:', err)
    return 'error'
  }
}

// P2-5: timezone + windows used to sync only at sign-in and at settings
// edits — travel across timezones and the server kept ringing at the
// OLD zone's hours. Re-sync whenever the app returns to the front, the
// device reconnects, or the window regains focus. Armed once, from the
// first syncCallWindows call (AuthContext sign-in path).
let listenersArmed = false
export function armCallSyncListeners() {
  if (listenersArmed || typeof window === 'undefined') return
  listenersArmed = true
  const resync = () => { syncCallWindows().catch(() => {}) }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resync() })
  window.addEventListener('online', resync)
  window.addEventListener('focus', resync)
}
