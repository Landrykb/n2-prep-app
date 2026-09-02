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

export function daysToJLPT(now = new Date()) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const target = nextJLPTDate(today)
  const diff = target - today
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}
