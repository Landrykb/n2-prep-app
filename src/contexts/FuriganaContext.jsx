import { useEffect, useMemo, useState } from 'react'
import { localDictionary, loadDictionary } from '../lib/dictionary.js'
import { buildFuriganaIndex } from '../lib/furigana.js'
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
    loadDictionary().then(setDict)
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
