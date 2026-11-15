// The kanji-card echo schedule — pure, shared, and pinned by
// tests/kanjicards.test.mjs against the bot's copy in
// supabase/functions/reader-bot/index.ts. Three showings the
// first day, then expanding gaps out to two months (best
// practice, owner-approved 2026-11-15).
export const CARD_ECHO_HOURS = [0, 4, 9, 24, 48, 96, 168, 336, 720, 1440]
export const CARD_TOTAL = CARD_ECHO_HOURS.length
export const CARD_FORGOT_HOURS = 3

/** The next due time after `sends` completed showings. */
export function nextDueFor(firstSeenAt, sends) {
  const first = new Date(firstSeenAt).getTime()
  if (sends >= CARD_TOTAL) return new Date(first + 365 * 24 * 3600_000)
  return new Date(first + CARD_ECHO_HOURS[sends] * 3600_000)
}
