import { useEffect, useRef, useState } from 'react'
import { Timer, Award, FileText } from 'lucide-react'
import { bjtTrainerItems } from '../data/bjtTrainer.js'
import { estimateBjtScore, bjtBandForScore } from '../lib/levels.js'
import TtsButton from './TtsButton.jsx'
import KanjiTapText from './KanjiTapText.jsx'
import MiniQuiz from './MiniQuiz.jsx'

const TIME_PER_ITEM = 120 // seconds — BJT pace: ~80 questions in ~2h ≈ 90s/q; combined items get a little more

// Timed BJT Part-II-style trainer: listen (TTS) + read the document TOGETHER,
// then answer. Ends with a band estimate from accuracy under time pressure.
export default function BjtTrainer() {
  const [idx, setIdx] = useState(0)
  const [showDoc, setShowDoc] = useState(true)
  const [secondsLeft, setSecondsLeft] = useState(TIME_PER_ITEM)
  const [running, setRunning] = useState(false)
  const [finishedAll, setFinishedAll] = useState(false)
  const timerRef = useRef(null)

  const item = bjtTrainerItems[idx]
  const totalQuestions = bjtTrainerItems.reduce((a, i) => a + i.questions.length, 0)

  useEffect(() => {
    if (!running) return
    timerRef.current = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timerRef.current)
  }, [running, idx])

  const startItem = (i) => { setIdx(i); setSecondsLeft(TIME_PER_ITEM); setRunning(true); setShowDoc(true) }
  const next = () => {
    if (idx + 1 >= bjtTrainerItems.length) { setFinishedAll(true); setRunning(false) }
    else startItem(idx + 1)
  }

  // Band estimate is a heuristic from the learner interacting with MiniQuiz is
  // not tracked centrally, so the estimate here is driven by a self-report of
  // how many they got right — kept honest by showing MiniQuiz's own score.
  const [selfScore, setSelfScore] = useState('')
  const selfNum = Number(selfScore)
  const hasSelf = selfScore !== '' && !Number.isNaN(selfNum) && selfNum >= 0 && selfNum <= totalQuestions
  const estScore = hasSelf ? estimateBjtScore(selfNum / totalQuestions) : null
  const band = estScore !== null ? bjtBandForScore(estScore) : null

  return (
    <section className="space-y-4">
      <div className="rounded-2xl glass p-5 card-glow space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2"><Timer size={18} className="text-amber-300" /> BJT Trainer — listening + reading, combined and timed</h3>
        <p className="text-sm text-slate-400">This is the real BJT’s hardest format (Part II): you hear an announcement <em>and</em> read a document, and the answer needs both. {TIME_PER_ITEM} seconds per item. Scored 0–800 in bands J5 → J1+; remember the immigration anchors: <span className="text-slate-200">400 = N2 category, 480 = N1 category</span> for Highly Skilled Professional points.</p>
        <div className="flex flex-wrap gap-2">
          {bjtTrainerItems.map((it, i) => (
            <button key={it.id} onClick={() => { setFinishedAll(false); startItem(i) }} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${idx === i && !finishedAll ? 'bg-violet-600 text-white' : 'bg-bun-700 text-slate-300 hover:bg-bun-600'}`}>{it.title} · {it.level}</button>
          ))}
        </div>
      </div>

      {!finishedAll && item && (
        <div className="rounded-2xl glass p-5 card-glow space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h4 className="font-bold text-white">{item.title} <span className="text-xs text-slate-400">· {item.level}</span></h4>
            <span className={`flex items-center gap-1.5 text-sm font-semibold ${secondsLeft <= 20 ? 'text-rose-300' : 'text-slate-300'}`}><Timer size={15} /> {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}{secondsLeft === 0 ? ' — time. In the real BJT you would have to move on.' : ''}</span>
          </div>
          <div className="flex items-center gap-3">
            <TtsButton text={item.script} className="px-4 py-2 text-sm font-medium" />
            <span className="text-sm text-slate-300">Listen first (in the exam: once), with the document open.</span>
          </div>
          <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mb-2"><FileText size={13} /> Business document</p>
            {showDoc ? <pre className="whitespace-pre-wrap text-sm text-slate-100 leading-relaxed font-sans"><KanjiTapText text={item.document} /></pre> : <p className="text-sm text-slate-500">Document hidden.</p>}
            <button onClick={() => setShowDoc((s) => !s)} className="mt-2 text-xs px-2.5 py-1 rounded-lg bg-bun-700 text-slate-300 hover:bg-bun-600">{showDoc ? 'Hide document' : 'Show document'}</button>
          </div>
          <MiniQuiz key={item.id} questions={item.questions} />
          <button onClick={next} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">{idx + 1 >= bjtTrainerItems.length ? 'Finish and estimate my band' : 'Next item'}</button>
        </div>
      )}

      {finishedAll && (
        <div className="rounded-2xl glass p-5 card-glow space-y-3">
          <h4 className="font-bold text-white flex items-center gap-2"><Award size={17} className="text-emerald-300" /> Band estimate</h4>
          <p className="text-sm text-slate-300">Add up the green scores MiniQuiz showed you across all {bjtTrainerItems.length} items ({totalQuestions} questions), and enter your total:</p>
          <div className="flex items-center gap-2">
            <input type="number" min="0" max={totalQuestions} value={selfScore} onChange={(e) => setSelfScore(e.target.value)} className="w-24 rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none" />
            <span className="text-sm text-slate-400">/ {totalQuestions} correct</span>
          </div>
          {band && <p className="text-sm text-slate-200">Estimated BJT score <span className="font-bold text-white">~{estScore}</span> → band <span className="font-bold text-emerald-300">{band.id}</span> ({band.min}–{band.max}): {band.descriptor} {band.hsp ? <span className="block text-xs text-slate-400 mt-1">{band.hsp}</span> : null}</p>}
          <p className="text-xs text-slate-500">Estimate only — from a {totalQuestions}-question trainer set, not the real ~80-question CBT. Use it to decide when booking the real BJT (retakes wait 3 months) is worth it.</p>
          <button onClick={() => { setFinishedAll(false); startItem(0) }} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm">Run it again</button>
        </div>
      )}
    </section>
  )
}
