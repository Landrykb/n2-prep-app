import { useState, useMemo, useEffect, useRef } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import KanjiTapText from './KanjiTapText.jsx'

export default function MiniQuiz({ questions, onResult }) {
  const [selected, setSelected] = useState(Array(questions.length).fill(null))
  const [show, setShow] = useState(Array(questions.length).fill(false))

  const choose = (qi, oi) => {
    setSelected((s) => s.map((v, i) => (i === qi ? oi : v)))
    setShow((s) => s.map((v, i) => (i === qi ? true : v)))
  }

  const score = useMemo(() => questions.reduce((acc, q, i) => acc + (selected[i] !== null && q.options[selected[i]].correct ? 1 : 0), 0), [questions, selected])

  // Fleet hook (2026-11-08): when every question has been answered,
  // the run reports itself ONCE — score + the missed questions — so
  // the hosting surface (Listening, BJT) can land the result in the
  // Twin, the one queue and the metrics instead of the score dying
  // on this screen. Callers key this component per set, so a new
  // set remounts and the guard resets with it.
  const firedRef = useRef(false)
  useEffect(() => {
    if (!onResult || firedRef.current) return
    if (!show.length || !show.every(Boolean)) return
    firedRef.current = true
    const misses = questions.filter((q, i) => !(selected[i] !== null && q.options[selected[i]]?.correct))
    onResult({ correct: score, total: questions.length, misses })
  })

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">Score: {score} / {questions.length}</p>
      {questions.map((q, qi) => (
        <div key={qi} className="rounded-2xl glass p-4 card-glow">
          <p className="text-slate-200 font-medium mb-3">{qi + 1}. {q.prompt}</p>
          {q.level && <span className="text-[10px] px-2 py-0.5 rounded bg-bun-700 text-slate-400 mb-2 inline-block">{q.level}</span>}
          <div className="grid gap-2">
            {q.options.map((opt, oi) => {
              const isCorrect = opt.correct
              const isChosen = selected[qi] === oi
              const isRevealed = show[qi]
              const cls = [
                'w-full text-left px-4 py-3 rounded-xl border transition flex items-center gap-2',
                isRevealed && isCorrect ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200' : isRevealed && isChosen ? 'bg-rose-500/15 border-rose-500/50 text-rose-200' : 'bg-bun-700/40 border-bun-600/30 text-slate-200 hover:bg-bun-700/60',
              ].join(' ')
              return (
                <button key={oi} onClick={() => choose(qi, oi)} disabled={isRevealed} className={cls}>
                  {isRevealed && isCorrect ? <CheckCircle2 size={16} className="shrink-0" /> : isRevealed && isChosen ? <XCircle size={16} className="shrink-0" /> : <span className="text-slate-500 shrink-0">{String.fromCharCode(65 + oi)}.</span>}
                  {opt.label}
                </button>
              )
            })}
          </div>
          {show[qi] && <p className="text-sm text-slate-400 mt-3 bg-bun-900/40 rounded-lg p-3"><KanjiTapText text={q.explanation} className="text-slate-400" /></p>}
        </div>
      ))}
    </div>
  )
}
