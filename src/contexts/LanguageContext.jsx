import { useCallback, useEffect, useMemo, useState } from 'react'
import { LanguageContext } from '../lib/languageContext.js'
import { LANGUAGES, DEFAULT_LANGUAGE, t as translate } from '../lib/i18n.js'
import { LANGUAGE_IDS, STATE_SYNCED_EVENT, loadLanguage, saveLanguage } from '../lib/learnerState.js'

/**
 * App-wide UI language (Doc 20). Per-user and account-bound:
 *   - Boot reads the localStorage mirror (learnerState's language
 *     slice key) so the first paint is already in the user's
 *     language — no reload, no flash of English.
 *   - When the synced learner-state document lands (applyLearnerState
 *     fires STATE_SYNCED_EVENT), the account's choice wins if it is
 *     newer — the merge already picked the winner before applying.
 *   - setLang writes BOTH the mirror and the synced slice through
 *     learnerState.saveLanguage, which emits the save-event bus, so
 *     stateSync pushes the choice to the account like any other
 *     slice. A choice on one device follows the account everywhere.
 * No stored choice → English, byte-identical to the pre-i18n app.
 */
export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => loadLanguage()?.lang || DEFAULT_LANGUAGE)

  useEffect(() => {
    const onSynced = () => {
      const stored = loadLanguage()
      if (stored?.lang && LANGUAGE_IDS.includes(stored.lang)) setLangState(stored.lang)
    }
    window.addEventListener(STATE_SYNCED_EVENT, onSynced)
    return () => window.removeEventListener(STATE_SYNCED_EVENT, onSynced)
  }, [])

  const setLang = useCallback((next) => {
    if (!LANGUAGE_IDS.includes(next)) return
    saveLanguage(next)
    setLangState(next)
  }, [])

  const value = useMemo(() => ({
    lang,
    setLang,
    languages: LANGUAGES,
    t: (key, vars) => translate(lang, key, vars),
  }), [lang, setLang])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
