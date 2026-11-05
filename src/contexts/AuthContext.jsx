import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'
import { AuthContext } from '../lib/authContext.js'
import { initTwinSync, stopTwinSync } from '../lib/twinSync.js'
import { initStateSync, stopStateSync } from '../lib/stateSync.js'
import { adoptAnonKeys } from '../lib/anonMerge.js'
import { syncCallWindows } from '../lib/callSync.js'

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, next) => {
      setSession(next)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Phase 2 cloud sync (Doc 02 §5, Doc 04 §7): a signed-in learner gets
  // the Twin cloud mirror + server-side Yobidashi scheduling. Signed-out
  // stays fully local — zero behaviour change. Both initialisers are
  // idempotent per user, so session refreshes don't re-run the pull.
  //
  // Readiness step 3 (P0-1/P1-4): the learner state (queue, profile,
  // diagnosis, promise) syncs the same way — and on sign-in, guest work
  // is ADOPTED, never orphaned: legacy n2:anon:* keys move into the
  // user's namespace (anonMerge), and the jpn:* state merges with the
  // account's cloud copy (stateSync + stateMerge).
  const userId = session?.user?.id ?? null
  useEffect(() => {
    if (userId && session?.user) {
      adoptAnonKeys(userId)
      initTwinSync(session.user).catch(() => {})
      initStateSync(session.user).catch(() => {})
      syncCallWindows().catch(() => {})
    } else {
      stopTwinSync()
      stopStateSync()
    }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    isSupabaseConfigured,
    signUp: (email, password) => supabase?.auth.signUp({ email, password }),
    signIn: (email, password) => supabase?.auth.signInWithPassword({ email, password }),
    signOut: () => supabase?.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
