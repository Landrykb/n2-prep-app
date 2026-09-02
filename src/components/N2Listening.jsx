import { useState } from 'react'
import { Headphones } from 'lucide-react'
import { n2Listening } from '../data/n2Listening.js'
import TtsButton from './TtsButton.jsx'
import KanjiTapText from './KanjiTapText.jsx'
import MiniQuiz from './MiniQuiz.jsx'

export default function N2Listening() {
  const [active, setActive] = useState(0)
  const [showTranscript, setShowTranscript] = useState(false)

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Headphones size={20} className="text-violet-400" />
          <h2 className="text-2xl font-bold text-white">N2 Listening</h2>
        </div>
        <p className="text-sm text-slate-400">JLPT-style listening practice. Press play, listen to the conversation, then answer the Japanese questions. The transcript is hidden until you reveal it.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {n2Listening.map((l, i) => (
          <button key={i} onClick={() => { setActive(i); setShowTranscript(false) }} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${active === i ? 'bg-violet-600 text-white' : 'bg-bun-700 text-slate-300 hover:bg-bun-600'}`}>
            {l.title} <span className="text-slate-400">· {l.level}</span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl glass p-5 card-glow space-y-4">
        <div>
          <h3 className="text-lg font-bold text-white">{n2Listening[active].title}</h3>
          <p className="text-xs text-slate-400">{n2Listening[active].level} · listen first, then answer</p>
        </div>

        <p className="text-xs text-slate-500">JLPT N2では音声を聞いて、日本語の質問と選択肢から答えます。</p>

        <div className="flex flex-wrap gap-2">
          <TtsButton text={n2Listening[active].script} className="px-3 py-1.5 text-sm font-medium" />
          <button onClick={() => setShowTranscript((s) => !s)} className="px-3 py-1.5 rounded-lg bg-bun-700 text-slate-300 hover:bg-bun-600 text-xs font-medium">
            {showTranscript ? 'Hide transcript' : 'Show transcript'}
          </button>
        </div>

        {showTranscript && (
          <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 leading-loose text-slate-100">
            <KanjiTapText text={n2Listening[active].script} />
          </div>
        )}

        <MiniQuiz key={active} questions={n2Listening[active].questions} />
      </div>
    </div>
  )
}
