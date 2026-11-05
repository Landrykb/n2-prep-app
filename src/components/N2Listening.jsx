import { useMemo, useState } from 'react'
import { Headphones } from 'lucide-react'
import { n2Listening } from '../data/n2Listening.js'
import { listeningPlus } from '../data/listeningPlus.js'
import TtsButton from './TtsButton.jsx'
import KanjiTapText from './KanjiTapText.jsx'
import MiniQuiz from './MiniQuiz.jsx'

const ALL = [...n2Listening, ...listeningPlus]
const LEVELS = ['all', 'N5', 'N4', 'N3', 'N2', 'N1']

// Listening across all levels (was N2-only). One play at natural speed in the
// real exam; transcripts stay hidden until after you answer.
export default function N2Listening() {
  const [level, setLevel] = useState('all')
  const [active, setActive] = useState(0)
  const [showTranscript, setShowTranscript] = useState(false)

  const items = useMemo(() => (level === 'all' ? ALL : ALL.filter((l) => l.level === level)), [level])
  const item = items[Math.min(active, items.length - 1)]

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Headphones size={20} className="text-[#FF8A75]" />
          <h2 className="text-2xl font-bold text-white">Listening — N5 to N1</h2>
        </div>
        <p className="text-sm text-slate-400">JLPT-style listening at every level. Press play, listen, then answer the Japanese questions. The transcript is hidden until you reveal it — the real exam gives you one play and no transcript.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {LEVELS.map((lv) => (
          <button key={lv} onClick={() => { setLevel(lv); setActive(0); setShowTranscript(false) }} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${level === lv ? 'bg-[#FF6B57] text-white' : 'bg-bun-700 text-slate-300 hover:bg-bun-600'}`}>
            {lv === 'all' ? `All levels (${ALL.length})` : lv}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {items.map((l, i) => (
          <button key={`${l.title}-${i}`} onClick={() => { setActive(i); setShowTranscript(false) }} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${item === l ? 'bg-[#FF6B57] text-white' : 'bg-bun-700 text-slate-300 hover:bg-bun-600'}`}>
            {l.title} <span className="text-slate-400">· {l.level}</span>
          </button>
        ))}
      </div>

      {item && (
        <div className="rounded-2xl glass p-5 card-glow space-y-4">
          <div>
            <h3 className="text-lg font-bold text-white">{item.title}</h3>
            <p className="text-xs text-slate-400">{item.level} · listen first, then answer</p>
          </div>
          <p className="text-xs text-slate-500">JLPTでは音声は一度だけ流れます。まず聞いてから、日本語の質問に答えてください。</p>
          <div className="flex flex-wrap gap-2">
            <TtsButton text={item.script} className="px-3 py-1.5 text-sm font-medium" />
            <button onClick={() => setShowTranscript((s) => !s)} className="px-3 py-1.5 rounded-lg bg-bun-700 text-slate-300 hover:bg-bun-600 text-xs font-medium">
              {showTranscript ? 'Hide transcript' : 'Show transcript'}
            </button>
          </div>
          {showTranscript && (
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 leading-loose text-slate-100">
              <KanjiTapText text={item.script} />
            </div>
          )}
          <MiniQuiz key={`${item.title}-${active}`} questions={item.questions} />
        </div>
      )}
    </div>
  )
}
