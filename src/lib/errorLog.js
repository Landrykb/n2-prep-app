// Local crash log (P1-8): the error boundary appends here; the Fleet
// page can show/share it. Kept in lib (not the component file) so the
// boundary module stays component-only.
export const ERROR_LOG_KEY = 'jpn:errorLog:v1'

export function loadErrorLog() {
  try {
    const list = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

export function appendErrorLog(entry) {
  try {
    const list = loadErrorLog()
    list.push(entry)
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(list.slice(-20)))
  } catch { /* ignore — logging must never throw */ }
}
