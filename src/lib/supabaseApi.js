import { supabase } from './supabaseClient.js'

export async function getUserProgress(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase.from('user_progress').select('*').eq('user_id', userId).single()
  if (error && error.code !== 'PGRST116') {
    console.error('getUserProgress error:', error)
  }
  return data
}

export async function setUserProgress(userId, { streak, daily, anki, mocks, settings }) {
  if (!supabase || !userId) return
  const payload = { user_id: userId, updated_at: new Date().toISOString() }
  if (streak !== undefined) payload.streak = streak
  if (daily !== undefined) payload.daily = daily
  if (anki !== undefined) payload.anki = anki
  if (mocks !== undefined) payload.mocks = mocks
  if (settings !== undefined) payload.settings = settings
  const { error } = await supabase.from('user_progress').upsert(payload, { onConflict: 'user_id' })
  if (error) console.error('setUserProgress error:', error)
}

export async function savePushSubscription(userId, subscription) {
  // Returns whether the row actually landed. It console.error'd
  // and returned undefined until 2026-11-11, while the settings
  // card read the LOCAL browser subscription and showed "on" —
  // the server held zero rows (the upsert itself was failing on
  // a missing updated_at column, migration 00026), so no push
  // could ever be delivered. Callers now fail honestly.
  if (!supabase || !userId || !subscription?.endpoint) return false
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,endpoint' })
  if (error) {
    console.error('savePushSubscription error:', error)
    return false
  }
  return true
}

export async function deletePushSubscription(userId, endpoint) {
  if (!supabase || !userId || !endpoint) return
  const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint)
  if (error) console.error('deletePushSubscription error:', error)
}

export async function getErrorLogs(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('error_logs')
    .select('*')
    .eq('user_id', userId)
    .order('next_review', { ascending: true })
  if (error) {
    console.error('getErrorLogs error:', error)
    return []
  }
  return data || []
}

export async function getDueErrorLogs(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('error_logs')
    .select('*')
    .eq('user_id', userId)
    .lte('next_review', new Date().toISOString())
    .order('next_review', { ascending: true })
  if (error) {
    console.error('getDueErrorLogs error:', error)
    return []
  }
  return data || []
}

const srsIntervals = [1, 1, 2, 4, 7, 14, 30]

export async function addErrorLog(userId, log) {
  if (!supabase || !userId) return null
  const payload = {
    user_id: userId,
    review_count: 0,
    next_review: new Date(Date.now() + 86400000).toISOString(),
    ...log,
  }
  const { data, error } = await supabase
    .from('error_logs')
    .insert(payload)
    .select()
    .single()
  if (error) console.error('addErrorLog error:', error)
  return data
}

export async function reviewErrorLog(userId, id, currentCount) {
  if (!supabase || !userId || !id) return
  const next = currentCount + 1
  const days = srsIntervals[Math.min(next, srsIntervals.length - 1)]
  const nextReview = new Date(Date.now() + days * 86400000).toISOString()
  const { error } = await supabase
    .from('error_logs')
    .update({ review_count: next, next_review: nextReview })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) console.error('reviewErrorLog error:', error)
}

export async function deleteErrorLog(userId, id) {
  if (!supabase || !userId) return
  const { error } = await supabase.from('error_logs').delete().eq('id', id).eq('user_id', userId)
  if (error) console.error('deleteErrorLog error:', error)
}
