// Device-level exam date preference — like the furigana toggle this is a
// per-device choice, so it lives in localStorage only (no Supabase sync).
const KEY = 'n2:exam-date'
const EVENT = 'n2:exam-date-changed'

const DEFAULT = { mode: 'july' }

export function getExamSetting() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (s && ['july', 'december', 'custom'].includes(s.mode)) return s
    }
  } catch { /* malformed storage — fall back to default */ }
  return DEFAULT
}

export function setExamSetting(setting) {
  try {
    localStorage.setItem(KEY, JSON.stringify(setting))
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export const EXAM_DATE_EVENT = EVENT
