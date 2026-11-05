import { useState } from 'react'
import { Volume2, Loader2 } from 'lucide-react'
import { speakText, ttsAvailable } from '../lib/tts.js'

export default function TtsButton({ text, className = '' }) {
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
        title="Read out loud"
        className={`p-2 rounded-xl bg-bun-700 text-violet-300 hover:bg-violet-600/20 hover:text-violet-200 transition ${className}`}
      >
        {speaking ? <Loader2 size={18} className="animate-spin" /> : <Volume2 size={18} />}
      </button>
      {fallback && <span className="text-[10px] leading-tight text-amber-300/90 max-w-[110px]">No Japanese voice on this device — closest voice used</span>}
    </span>
  )
}
