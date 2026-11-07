import { Mic } from 'lucide-react'
import { useLanguage } from '../hooks/useLanguage.js'

// In-flow microphone explanation, shown BEFORE the browser/OS permission
// prompt the first time a user reaches for the mic on this device
// (Doc 15 §1 — Apple 2.5.14, Play Prominent Disclosure). Two equal doors:
// "Use Microphone" (affirmative consent) and "Type Instead" (never a
// lesser path — Doc 10 §4: the typed path needs no consent and is always
// offered). The words come from the language catalog (Doc 20, mic.*);
// the EN catalog values are MIC_EXPLANATION's exact text (lib/micConsent
// .js), so the promise is identical in every language.
export default function MicPrompt({ onUseMic, onTypeInstead }) {
  const { t } = useLanguage()
  return (
    <div className="rounded-xl bg-[#FF6B57]/10 border border-[#FF6B57]/30 p-4 space-y-3">
      <p className="text-sm font-bold text-white flex items-center gap-2"><Mic size={15} className="text-[#FF8A75]" /> {t('mic.beforeTitle')}</p>
      <p className="text-sm text-slate-300 leading-relaxed">{t('mic.explanation')}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={onUseMic} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-medium">{t('mic.use')}</button>
        <button onClick={onTypeInstead} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">{t('mic.typeInstead')}</button>
      </div>
    </div>
  )
}
