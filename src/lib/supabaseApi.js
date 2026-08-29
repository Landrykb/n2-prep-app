import { supabase } from './supabaseClient.js'

export async function getUserProgress(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase.from('user_progress').select('*').eq('user_id', userId).single()
  if (error && error.code !== 'PGRST116') {
    console.error('getUserProgress error:', error)
  }
  return data
}

export async function setUserProgress(userId, { streak, daily }) {
  if (!supabase || !userId) return
  const payload = { user_id: userId, updated_at: new Date().toISOString() }
  if (streak !== undefined) payload.streak = streak
  if (daily !== undefined) payload.daily = daily
  const { error } = await supabase.from('user_progress').upsert(payload, { onConflict: 'user_id' })
  if (error) console.error('setUserProgress error:', error)
}

export async function getErrorLogs(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('error_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('getErrorLogs error:', error)
    return []
  }
  return data || []
}

export async function addErrorLog(userId, log) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('error_logs')
    .insert({ user_id: userId, ...log })
    .select()
    .single()
  if (error) console.error('addErrorLog error:', error)
  return data
}

export async function deleteErrorLog(userId, id) {
  if (!supabase || !userId) return
  const { error } = await supabase.from('error_logs').delete().eq('id', id).eq('user_id', userId)
  if (error) console.error('deleteErrorLog error:', error)
}
