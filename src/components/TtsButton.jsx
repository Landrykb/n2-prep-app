import { useState } from 'react'
import { Volume2, Loader2 } from 'lucide-react'
import { ttsAvailable } from '../lib/tts.js'
import { speakSenseiLine } from '../lib/neuralVoice.js'
import { useLanguage } from '../hooks/useLanguage.js'

export default function TtsButton({ text, className = '' }) {
  const { t } = useLanguage()
  const [speaking, setSpeaking] = useState(false)
  const [fallback, setFallback] = useState(false)
  // Neural audio needs only an Audio element; the device voice
  // needs speechSynthesis. Either one makes the button real.
  const [available] = useState(() => ttsAvailable() || typeof Audio !== 'undefined')

  const speak = (e) => {
    e?.stopPropagation()
    if (!available || !text) return
    setSpeaking(true)
    // The neural chain first (Doc 17): Edge's Nanami from this
    // device, then the tts function, then the device voice. These
    // lines are the model a learner listens to and repeats — the
    // robotic device voice was never good enough for that job
    // (Landry, 2026-11-07), and it was the only route this button
    // had. speakSenseiLine stops any line still playing, so a
    // second tap restarts cleanly, and its onEnd fires once.
    speakSenseiLine(text, {
      onEnd: () => setSpeaking(false),
      // Honest label (P1-2): the device voice had to serve and it
      // has no Japanese voice — say so, as before.
      onFallback: (res) => { if (res?.fallback) setFallback(true) },
    })
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
