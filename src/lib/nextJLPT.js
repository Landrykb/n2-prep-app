function firstSunday(year, month) {
  const d = new Date(year, month, 1)
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1)
  d.setHours(0, 0, 0, 0)
  return d
}

export function nextJLPTDate(now = new Date()) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const year = today.getFullYear()
  // Applications for the December session have closed; the next practical deadline is July.
  const candidates = [
    firstSunday(year, 6),
    firstSunday(year + 1, 6),
  ].filter((d) => d > today)
  candidates.sort((a, b) => a - b)
  return candidates[0]
}

export function decemberSession(year) {
  return firstSunday(year, 11)
}

export function daysUntil(target, now = new Date()) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const diff = target - today
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export function daysToJLPT(now = new Date()) {
  return daysUntil(nextJLPTDate(now), now)
}

/**
 * Resolve the exam date for a saved preference:
 * { mode: 'july' | 'december' | 'custom', date?: 'YYYY-MM-DD' }.
 * Session modes always roll forward to the next upcoming session; a custom
 * date is used exactly as entered.
 */
export function resolveExamDate(setting, now = new Date()) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (setting?.mode === 'custom' && setting.date) {
    const d = new Date(`${setting.date}T00:00:00`)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (setting?.mode === 'december') {
    const year = today.getFullYear()
    const candidates = [decemberSession(year), decemberSession(year + 1)].filter((d) => d > today)
    candidates.sort((a, b) => a - b)
    return candidates[0]
  }
  return nextJLPTDate(today)
}

export function examSessionLabel(setting) {
  if (setting?.mode === 'december') return 'December JLPT'
  if (setting?.mode === 'custom') return 'My exam'
  return 'July JLPT'
}
