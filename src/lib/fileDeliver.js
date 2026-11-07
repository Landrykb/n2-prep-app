// Delivering a generated file (backup JSON, CSV export) to the
// person holding the device.
//
// The old route — an <a download> click on a blob URL — works on
// desktop but inside the Telegram Mini App webview it NAVIGATES
// the whole app to the raw file: Landry tapped "move my
// progress" and got a full screen of JSON (2026-11-07). Never
// navigate to a blob again.
//
// deliverTextFile():
//  1. stashes a copy on-device first (localStorage), so the
//     data exists even if every delivery route fails;
//  2. offers the system share sheet with a real File when the
//     platform supports it (Save to Files, send it, …);
//  3. falls back to a classic download ONLY in a plain browser
//     (not a Telegram webview, where it would navigate);
//  4. last resort: the clipboard.
// Returns how it was delivered: 'shared' | 'downloaded' |
// 'copied' | 'stashed'. Never throws.

const STASH_PREFIX = 'yonde:file:'

export function stashFile(filename, text) {
  try { localStorage.setItem(STASH_PREFIX + filename, text) } catch { /* full/blocked — delivery still proceeds */ }
}

export function readStashedFile(filename) {
  try { return localStorage.getItem(STASH_PREFIX + filename) } catch { return null }
}

function inTelegramWebview() {
  try { return Boolean(window.Telegram?.WebApp?.initData) || window.location.hash.includes('tgWebAppData') } catch { return false }
}

export async function deliverTextFile({ filename, text, mime = 'text/plain' }) {
  stashFile(filename, text)
  // Share sheet first where files can be shared.
  try {
    const file = new File([text], filename, { type: mime })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] })
      return 'shared'
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return 'shared' // they closed the sheet; the stash exists
    /* fall through */
  }
  // Classic download — plain browsers only.
  if (!inTelegramWebview()) {
    try {
      const blob = new Blob([text], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      return 'downloaded'
    } catch { /* fall through */ }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch { /* fall through */ }
  return 'stashed'
}
