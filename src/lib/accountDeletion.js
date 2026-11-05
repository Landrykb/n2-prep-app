// Account & data deletion (Doc 15 §1: Apple 5.1.1(v) — account creation
// requires in-app account deletion; Google Play account-deletion policy —
// in-app path + web link). This module does everything the CLIENT honestly
// can, and says so: local data is wiped completely; the server-side account
// delete needs the `delete-account` edge function specified in Doc 15 §6,
// which does not exist yet. requestServerAccountDeletion() already attempts
// that function — the day it deploys, this flow starts reporting full
// deletion with no client change. Until then it reports 'pending-server'
// and the UI copy says exactly that. No fake success, ever.

import { supabase, isSupabaseConfigured } from './supabaseClient.js'

// Everything this app stores locally: the current jpn:* namespace, the
// legacy n2:* keys (exam date, speed stats, tutor chats), and mock history.
const APP_PREFIXES = ['jpn:', 'n2:']
const EXTRA_KEYS = ['mock-history']

export const isAppLocalKey = (k) => APP_PREFIXES.some((p) => k.startsWith(p)) || EXTRA_KEYS.includes(k)

export function listAppLocalKeys() {
  const keys = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && isAppLocalKey(k)) keys.push(k)
    }
  } catch { /* storage unavailable */ }
  return keys.sort()
}

export function collectAllLocalData() {
  const out = {}
  for (const k of listAppLocalKeys()) {
    const raw = localStorage.getItem(k)
    try { out[k] = JSON.parse(raw) } catch { out[k] = raw }
  }
  return out
}

export function downloadAllLocalData() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data: collectAllLocalData() }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'yonde-my-data.json'
  a.click()
  URL.revokeObjectURL(url)
}

// Removes every app key from this device. Returns how many were removed.
export function wipeAllLocalData() {
  const keys = listAppLocalKeys()
  for (const k of keys) { try { localStorage.removeItem(k) } catch { /* ignore */ } }
  return keys.length
}

// Attempts the server-side account deletion specified in Doc 15 §6.
// Returns one of:
//   'not-configured' — no Supabase in this build (nothing exists server-side)
//   'not-signed-in'  — no account session, so nothing to delete server-side
//   'deleted'        — the edge function confirmed deletion
//   'pending-server' — signed in, but the function is not live yet / failed;
//                      the account row still exists and the UI must say so
export async function requestServerAccountDeletion() {
  if (!isSupabaseConfigured || !supabase) return 'not-configured'
  try {
    const { data } = await supabase.auth.getSession()
    if (!data?.session) return 'not-signed-in'
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' })
    return error ? 'pending-server' : 'deleted'
  } catch {
    return 'pending-server'
  }
}
