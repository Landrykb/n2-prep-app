import { useState } from 'react'
import { Volume2, Loader2 } from 'lucide-react'
import { speakText, ttsAvailable } from '../lib/tts.js'
import { useLanguage } from '../hooks/useLanguage.js'

export default function TtsButton({ text, className = '' }) {
  const { t } = useLanguage()
  const [speaking, setSpeaking] = useState(false)
  const [fallback, setFallback] = useState(false)
  const [available] = useState(ttsAvailable)

  const speak = async (e) => {
    e?.stopPropagation()
    if (!available || !text) return
    setSpeaking(true)
    const res = await speakText(text, { onend: () => setSpeaking(false), onerror: () => setSpeaking(false) })
    // Honest label (P1-2): this device has no Japanese voice, so what the
    // learner hears is the closest voice the browser could find.
    if (res?.fallback) setFallback(true)
    if (!res?.started) setSpeaking(false)
  }

  if (!available) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={speak}
        title={t('shell.tts.readAloud')}
        className={`p-2 rounded-xl bg-bun-700 text-[#FF8A75] hover:bg-[#FF6B57]/20 hover:text-[#FFA08D] transition ${className}`}
      >
        {speaking ? <Loader2 size={18} className="animate-spin" /> : <Volume2 size={18} />}
      </button>
      {fallback && <span className="text-[10px] leading-tight text-amber-300/90 max-w-[110px]">{t('shell.tts.noVoice')}</span>}
    </span>
  )
}
