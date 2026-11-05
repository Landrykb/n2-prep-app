import { Mic } from 'lucide-react'
import { MIC_EXPLANATION } from '../lib/micConsent.js'

// In-flow microphone explanation, shown BEFORE the browser/OS permission
// prompt the first time a user reaches for the mic on this device
// (Doc 15 §1 — Apple 2.5.14, Play Prominent Disclosure). Two equal doors:
// "Use Microphone" (affirmative consent) and "Type Instead" (never a
// lesser path — Doc 10 §4: the typed path needs no consent and is always
// offered).
export default function MicPrompt({ onUseMic, onTypeInstead }) {
  return (
    <div className="rounded-xl bg-[#FF6B57]/10 border border-[#FF6B57]/30 p-4 space-y-3">
      <p className="text-sm font-bold text-white flex items-center gap-2"><Mic size={15} className="text-[#FF8A75]" /> Before the microphone</p>
      <p className="text-sm text-slate-300 leading-relaxed">{MIC_EXPLANATION}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={onUseMic} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-medium">Use Microphone</button>
        <button onClick={onTypeInstead} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">Type Instead</button>
      </div>
    </div>
  )
}
