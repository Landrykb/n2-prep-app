// GUEST ENTRY (Doc 12 cohort-readiness audit #1, fixed 2026-11-07).
//
// The app is local-first: signed out, the Twin, queue, diagnosis and
// plan all live on this device (the guest path the libs always had).
// What was missing was a DOOR: with Supabase configured, App rendered
// only the AuthModal, so the guest machinery was unreachable and a new
// learner hit an email round-trip before any value.
//
// The choice is remembered on this device (`jpn:guest:v1`): choosing
// guest once means the sign-in gate never reappears on load — the
// modal returns only via an explicit action (Create Your Account in
// the sidebar, or an account-only door). Nothing here creates a
// parallel guest system: guests use the same local state as the
// pre-Supabase app, and signing up later ADOPTS that work through the
// existing sign-in path (AuthContext: adoptAnonKeys for legacy
// n2:anon:* keys + stateSync/stateMerge for the jpn:* document).

export const GUEST_KEY = 'jpn:guest:v1'

/** The stored guest choice ({ at } | null). Injectable storage for tests. */
export function loadGuestChoice(storage = localStorage) {
  try {
    const raw = storage.getItem(GUEST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed.at === 'string' ? parsed : null
  } catch { return null }
}

/** Remember the guest choice on this device. Returns the record. */
export function saveGuestChoice(storage = localStorage, now = new Date()) {
  const rec = { at: now.toISOString() }
  try { storage.setItem(GUEST_KEY, JSON.stringify(rec)) } catch { /* ignore */ }
  return rec
}

/** Forget the guest choice (the gate returns on next load). */
export function clearGuestChoice(storage = localStorage) {
  try { storage.removeItem(GUEST_KEY) } catch { /* ignore */ }
}
