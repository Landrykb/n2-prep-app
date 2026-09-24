// Mock exam attempt history. Always written to localStorage so guests keep
// their results; signed-in users also sync to user_progress.mocks (jsonb).
// The mocks column ships in migration 00004 — until it exists the remote
// read/write simply no-ops (errors are logged, never thrown).
import { userKey } from './userKey.js'
import { getUserProgress, setUserProgress } from './supabaseApi.js'

const KEY = 'mock-history'
const LIMIT = 30

function readLocal(user) {
  try {
    const raw = localStorage.getItem(userKey(user, KEY))
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeLocal(user, attempts) {
  try {
    localStorage.setItem(userKey(user, KEY), JSON.stringify(attempts.slice(0, LIMIT)))
  } catch { /* storage unavailable */ }
}

function merge(remote, local) {
  const seen = new Map()
  for (const a of [...remote, ...local]) {
    if (a?.id) seen.set(a.id, a)
  }
  return [...seen.values()]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, LIMIT)
}

export async function loadMockHistory(user) {
  const local = readLocal(user)
  if (!user) return local
  const data = await getUserProgress(user.id)
  const remote = Array.isArray(data?.mocks?.attempts) ? data.mocks.attempts : []
  return merge(remote, local)
}

export async function saveMockAttempt(user, attempt) {
  const attempts = merge([], [attempt, ...readLocal(user)])
  writeLocal(user, attempts)
  if (user) {
    try {
      // Separate call from streak/daily/anki: if the mocks column is missing
      // yet, only this upsert fails — core progress writes are unaffected.
      const data = await getUserProgress(user.id)
      const remote = Array.isArray(data?.mocks?.attempts) ? data.mocks.attempts : []
      await setUserProgress(user.id, { mocks: { attempts: merge(remote, [attempt]) } })
    } catch (e) {
      console.error('saveMockAttempt sync error:', e)
    }
  }
  return attempts
}
