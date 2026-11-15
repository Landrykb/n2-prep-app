import { useEffect, useMemo, useState } from 'react'
import { localDictionary, loadDictionary } from '../lib/dictionary.js'
import { buildFuriganaIndex } from '../lib/furigana.js'
import { loadWordSearchIndex } from '../lib/wordsDb.js'

const KANJI_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
import { FuriganaContext } from '../lib/furiganaContext.js'

const STORAGE_KEY = 'n2:furigana'

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * App-wide furigana toggle. When on, KanjiTapText (used for nearly every
 * Japanese string in the app) annotates recognised words and kanji with a
 * <ruby>/<rt> reading, using the same merged dictionary as the Dictionary
 * tab and selection lookup — so it works consistently on every page.
 */
export function FuriganaProvider({ children }) {
  const [enabled, setEnabled] = useState(readStored)
  const [dict, setDict] = useState(localDictionary)

  useEffect(() => {
    let live = true
    loadDictionary().then(async (d) => {
      if (!live) return
      setDict(d)
      // Wide compounds (2026-11-15, "all others too"): the deck
      // dictionary does not carry every compound the text can
      // hold — 面談 fell back to per-kanji fragments in the
      // ruby. Merge the WordsDB common index UNDER the deck
      // (deck entries win, so curated readings and overrides
      // stand), kanji-bearing words only. Best effort: if the
      // index cannot load, the deck alone keeps working.
      try {
        const rows = await loadWordSearchIndex()
        if (!live || !Array.isArray(rows)) return
        const seen = new Set(d.byWord.keys())
        const extra = []
        for (const row of rows) {
          const w = row?.[1]
          const r = row?.[2]
          if (!w || !r) continue
          for (const v of String(w).split('/')) {
            if (!v || seen.has(v) || !KANJI_CHAR.test(v)) continue
            seen.add(v)
            extra.push({ word: v, reading: r })
          }
        }
        if (!extra.length) return
        const entries = [...d.entries, ...extra]
        const byLength = [...entries].sort((a, b) => b.word.length - a.word.length)
        setDict({ ...d, entries, byLength })
      } catch { /* the deck alone is a working state */ }
    })
    return () => { live = false }
  }, [])

  const index = useMemo(() => buildFuriganaIndex(dict), [dict])

  const toggle = () => {
    setEnabled((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* storage unavailable — the toggle just won't persist across reloads */
      }
      return next
    })
  }

  const value = useMemo(() => ({ enabled, toggle, index }), [enabled, index])

  return <FuriganaContext.Provider value={value}>{children}</FuriganaContext.Provider>
}
