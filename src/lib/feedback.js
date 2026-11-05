// In-app feedback (P1-8). A learner's note is ALWAYS kept locally first
// (jpn:feedback:v1) so it can never be lost to a network failure; when
// signed in it also goes to the `feedback` table (migration 00008,
// owner-only RLS). Signed out — or if the insert fails — the UI offers
// a mailto fallback with the note pre-filled, addressed to the support
// address in brand config. No silent drops, no fake "sent" states:
// saveFeedback reports exactly where the note landed.

import { brand } from './brand.js'

export const FEEDBACK_KEY = 'jpn:feedback:v1'

export function loadFeedback() {
  try {
    const list = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

/** @returns {Promise<{local: true, sent: boolean}>} sent = reached the table */
export async function saveFeedback(body, context = '') {
  const entry = { at: new Date().toISOString(), body, context }
  try {
    const list = loadFeedback()
    list.push(entry)
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list.slice(-50)))
  } catch { /* ignore */ }
  let sent = false
  try {
    const { supabase, isSupabaseConfigured } = await import('./supabaseClient.js')
    if (isSupabaseConfigured && supabase) {
      const { data } = await supabase.auth.getSession()
      const user = data?.session?.user
      if (user) {
        const { error } = await supabase.from('feedback').insert({ user_id: user.id, body, context })
        sent = !error
      }
    }
  } catch { sent = false }
  return { local: true, sent }
}

export function feedbackMailto(body) {
  const subject = encodeURIComponent('Yonde feedback')
  const text = encodeURIComponent(body || '')
  return `mailto:${brand.supportEmail}?subject=${subject}&body=${text}`
}
