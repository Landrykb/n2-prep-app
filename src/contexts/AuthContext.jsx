import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'
import { AuthContext } from '../lib/authContext.js'
import { initTwinSync, stopTwinSync } from '../lib/twinSync.js'
import { initStateSync, stopStateSync } from '../lib/stateSync.js'
import { pullRemoteMetrics } from '../lib/metrics.js'
import { adoptAnonKeys } from '../lib/anonMerge.js'
import { syncCallWindows } from '../lib/callSync.js'
import { bridgeTelegramSession, getTelegramInitData, reportTelegramDiag, telegramDoorPresent } from '../lib/telegramAuth.js'
import { loadGuestChoice, saveGuestChoice } from '../lib/guest.js'

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [telegramBridgeStatus, setTelegramBridgeStatus] = useState('not-telegram')
  // Guest entry (Doc 12 audit #1): the choice is remembered on this
  // device, so a learner who chose guest once is never re-gated on
  // load. `guest` only matters while there is no session.
  const [guest, setGuest] = useState(() => loadGuestChoice() !== null)

  const continueAsGuest = () => {
    saveGuestChoice()
    setGuest(true)
  }

  useEffect(() => {
    if (!supabase) return

    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, next) => {
      if (active) setSession(next)
    })

    const bootstrap = async () => {
      const { data } = await supabase.auth.getSession()
      if (!active) return

      let currentSession = data.session

      // Telegram Mini App only (Doc 16 §5 amendment #8): the
      // webview's own storage starts empty even for a linked
      // learner, so exchange Telegram's signed launch identity for
      // the linked account's session BEFORE the initial loading
      // state resolves — a linked learner never sees the sign-in
      // screen flash. The bridge also runs when a session already
      // exists in the webview, so a different account is corrected
      // to the account this Telegram chat is linked to. With no
      // initData, this branch is skipped and bootstrap is exactly
      // the ordinary getSession path.
      const tgInitData = getTelegramInitData()
      if (tgInitData) {
        const status = await bridgeTelegramSession({
          client: supabase,
          currentSession,
        })
        if (!active) return
        setTelegramBridgeStatus(status)
        if (status !== 'bridged' && status !== 'already') {
          reportTelegramDiag({ stage: status, initData: tgInitData })
        }
        if (status === 'bridged' || status === 'already') {
          const refreshed = await supabase.auth.getSession()
          if (!active) return
          currentSession = refreshed.data.session
        }
      } else if (telegramDoorPresent()) {
        // Arrived through a Telegram door (?tg= marker, or
        // Telegram's object) but with no launch data the bridge
        // can use: the one case the bridge cannot even attempt —
        // report it so the failure has a name (telegram_auth_diag).
        reportTelegramDiag({ stage: 'no-initdata' })
      }

      if (active) {
        setSession(currentSession)
        setLoading(false)
      }
    }

    bootstrap().catch(() => {
      if (active) setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
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
      // Bot-written events (passage_sent, word_mined, …) live only
      // on the server; pull them into the local metrics list so the
      // app's summaries see the learner's whole activity (audit #8).
      pullRemoteMetrics().catch(() => {})
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
    telegramBridgeStatus,
    isSupabaseConfigured,
    guest,
    continueAsGuest,
    signUp: (email, password) => supabase?.auth.signUp({ email, password }),
    signIn: (email, password) => supabase?.auth.signInWithPassword({ email, password }),
    signOut: () => supabase?.auth.signOut(),
    // Password reset (Doc 12 audit #1): the reset email links back to
    // the app's canonical origin (production: https://jpn2easy.vercel.app).
    // The UI copy never confirms whether the email has an account.
    resetPassword: (email) => supabase?.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/` : 'https://jpn2easy.vercel.app/',
    }),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
