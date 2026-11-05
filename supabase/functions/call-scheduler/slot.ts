// Ported slot logic for the Yobidashi server scheduler.
//
// This is a FAITHFUL port of the deterministic slot logic in
// src/lib/calls.js (dateHash + slotDateFor). The client and the server must
// agree on the exact minute a summons belongs to — if they ever disagree,
// the push arrives for a slot the app doesn't have. The port is pinned by
// tests/phase2.test.mjs, which compares both implementations over a matrix
// of dates/windows/timezones. If you change one side, change both and run
// the test.
//
// Deliberately written in plain-JS syntax (no TS-only constructs) so the
// node test can load this file unmodified.
//
// The only addition over the client logic is timezone handling: the client
// works in device-local time; the server knows each user's IANA timezone
// (call_windows.timezone) and computes the same wall-clock minute there,
// then converts it to a UTC instant for comparison with `now`.

export function dateHash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function minutesOfDay(hhmm) {
  const [h, m] = String(hhmm || '08:00').split(':').map((x) => parseInt(x, 10))
  return (Number.isFinite(h) ? h : 8) * 60 + (Number.isFinite(m) ? m : 0)
}

/** The deterministic slot minute (minutes after local midnight). Mirrors
 *  slotDateFor() in src/lib/calls.js exactly: same hash input, same span
 *  rule (5 minutes clear of the window's end edge, degenerate window = 30). */
export function slotMinuteOfDay(dateStr, window, windowIndex) {
  const start = minutesOfDay(window.start)
  let end = minutesOfDay(window.end)
  if (end <= start) end = start + 30
  const span = Math.max(1, end - start - 5)
  const offset = dateHash(`${dateStr}|call|${windowIndex}|${window.start}-${window.end}`) % span
  return start + offset
}

/** 'yyyy-mm-dd' for an instant, in the given IANA timezone. */
export function localDateStr(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant)
  const p = {}
  for (const part of parts) p[part.type] = part.value
  return `${p.year}-${p.month}-${p.day}`
}

function tzOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)
  const p = {}
  for (const part of parts) p[part.type] = part.value
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** UTC instant of a wall-clock minute on a local date in a timezone. */
export function zonedSlotToUtc(dateStr, minuteOfDayValue, timeZone) {
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10))
  const guess = Date.UTC(y, m - 1, d, 0, minuteOfDayValue, 0)
  let utc = guess - tzOffsetMs(new Date(guess), timeZone)
  utc = guess - tzOffsetMs(new Date(utc), timeZone) // refine once — settles DST-edge guesses
  return new Date(utc)
}

/** Stable id for one (user, day, window) slot — the call_dispatches PK. */
export function slotIdFor(userId, dateStr, windowIndex) {
  return `${userId}|${dateStr}|${windowIndex}`
}

/**
 * Today's slots for one user's synced settings, mirroring ensureToday() in
 * src/lib/calls.js: one slot per window, using the first N windows where
 * N = clamp(callsPerDay, 1..3, windows.length).
 * Returns [{ windowIndex, minuteOfDay, atUtc }].
 */
export function todaysSlots(settings, dateStr, timeZone) {
  const windows = Array.isArray(settings?.windows) ? settings.windows : []
  if (!windows.length) return []
  const n = Math.max(1, Math.min(3, settings.callsPerDay || 1, windows.length))
  const out = []
  for (let i = 0; i < n; i++) {
    const minute = slotMinuteOfDay(dateStr, windows[i], i)
    out.push({ windowIndex: i, minuteOfDay: minute, atUtc: zonedSlotToUtc(dateStr, minute, timeZone) })
  }
  return out
}
