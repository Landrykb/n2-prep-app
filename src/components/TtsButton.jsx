import { useState } from 'react'
import { Volume2, Loader2 } from 'lucide-react'

export default function TtsButton({ text, className = '' }) {
  const [speaking, setSpeaking] = useState(false)
  const [available] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window)

  const speak = (e) => {
    e?.stopPropagation()
    if (!available || !text) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ja-JP'
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    setSpeaking(true)
    window.speechSynthesis.speak(u)
  }

  if (!available) return null
  return (
    <button
      onClick={speak}
      title="Read out loud"
      className={`p-2 rounded-xl bg-bun-700 text-violet-300 hover:bg-violet-600/20 hover:text-violet-200 transition ${className}`}
    >
      {speaking ? <Loader2 size={18} className="animate-spin" /> : <Volume2 size={18} />}
    </button>
  )
}
