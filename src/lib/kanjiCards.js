// Kanji flash cards — the app half of the Telegram card deck
// (Doc 16, 2026-11-15). One schedule, two doors: the bot sends
// picture cards in Telegram; this module reads and writes the
// SAME kanji_cards rows from the app, so a review done here
// advances the echo there and the other way round.
//
// Echo schedule (best practice, owner-approved): three
// showings the first day, then expanding gaps out to two
// months. CARD_ECHO_HOURS must stay identical to the bot's
// copy in supabase/functions/reader-bot/index.ts — a test
// pins the two together.
import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { loadKanjiIndex, expandIndexRow, getKanjiStrokes } from './kanjiDb.js'
import { loadWordSearchIndex } from './wordsDb.js'

export { CARD_ECHO_HOURS, CARD_TOTAL, nextDueFor } from './cardSchedule.js'
import { CARD_ECHO_HOURS, CARD_TOTAL, CARD_FORGOT_HOURS, nextDueFor } from './cardSchedule.js'

async function currentUserId() {
  if (!isSupabaseConfigured || !supabase) return null
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

/** All of the learner's card rows + the due subset. */
export async function fetchKanjiCards() {
  const userId = await currentUserId()
  if (!userId) return { rows: [], due: [] }
  const { data, error } = await supabase
    .from('kanji_cards')
    .select('kanji, sends, first_seen_at, next_due_at, last_sent_at')
    .eq('user_id', userId)
    .order('next_due_at', { ascending: true })
  if (error || !data) return { rows: [], due: [] }
  const now = Date.now()
  const due = data.filter(
    (r) => r.sends < CARD_TOTAL && new Date(r.next_due_at).getTime() <= now,
  )
  return { rows: data, due }
}

async function updateRow(kanji, patch) {
  const userId = await currentUserId()
  if (!userId) return false
  const { error } = await supabase
    .from('kanji_cards')
    .update(patch)
    .eq('user_id', userId)
    .eq('kanji', kanji)
  return !error
}

/**
 * A showing happened (the question face was presented — the
 * same moment Telegram counts at send). Advances the echo.
 * Returns the advanced row values, or null on failure.
 */
export async function markCardShown(row) {
  const sends = Math.min(row.sends + 1, CARD_TOTAL)
  const patch = {
    sends,
    next_due_at: nextDueFor(row.first_seen_at, sends).toISOString(),
    last_sent_at: new Date().toISOString(),
  }
  return (await updateRow(row.kanji, patch)) ? { ...row, ...patch } : null
}

/**
 * Forgot it: the current step repeats in a few hours instead
 * of moving on (mirrors the bot's Forgot button exactly).
 * Takes the row as advanced by markCardShown.
 */
export async function markCardForgot(row) {
  const patch = {
    sends: Math.max(0, row.sends - 1),
    next_due_at: new Date(Date.now() + CARD_FORGOT_HOURS * 3600_000).toISOString(),
  }
  return (await updateRow(row.kanji, patch)) ? { ...row, ...patch } : null
}

// ---------------------------------------------------------- card data

const dataCache = new Map()

/**
 * Everything a card face needs: { on, kun, meaning, paths,
 * words: [{ word, reading, meaning }] } — the same sources the
 * Telegram PNG is rendered from (KanjiDB + the WordsDB common
 * index), so both doors show the same card.
 */
export async function loadKanjiCardData(char) {
  if (dataCache.has(char)) return dataCache.get(char)
  const [index, strokes, wordIndex] = await Promise.all([
    loadKanjiIndex().catch(() => []),
    getKanjiStrokes(char).catch(() => null),
    loadWordSearchIndex().catch(() => null),
  ])
  const row = (index || []).find((r) => r[0] === char)
  const meta = row ? expandIndexRow(row) : null
  const words = []
  if (Array.isArray(wordIndex)) {
    const found = []
    for (const r of wordIndex) {
      const w = String(r?.[1] ?? '').split('/')[0]
      if (w && w.includes(char) && w.length >= 2 && w.length <= 4 && r[2]) {
        found.push({ word: w, reading: r[2], meaning: r[3] || '' })
      }
    }
    found.sort((a, b) => a.word.length - b.word.length)
    const seen = new Set()
    for (const w of found) {
      if (seen.has(w.word)) continue
      seen.add(w.word)
      words.push(w)
      if (words.length >= 3) break
    }
  }
  const data = {
    on: meta?.on || '',
    kun: meta?.kun || '',
    meaning: meta?.meaning || '',
    paths: strokes?.paths || [],
    words,
  }
  dataCache.set(char, data)
  return data
}
