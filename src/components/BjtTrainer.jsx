import { useEffect, useMemo, useRef, useState } from 'react'
import { Timer, Award, FileText, CheckCircle2, XCircle } from 'lucide-react'
import { bjtTrainerItems } from '../data/bjtTrainer.js'
import { estimateBjtScore, bjtBandForScore } from '../lib/levels.js'
import TtsButton from './TtsButton.jsx'
import KanjiTapText from './KanjiTapText.jsx'

const TIME_PER_ITEM = 120 // seconds — BJT pace: ~80 questions in ~2h ≈ 90s/q; combined items get a little more

// Timed BJT Part-II-style trainer: listen (TTS) + read the document TOGETHER,
// then answer. The band estimate is COMPUTED from the learner's actual
// per-item answers inside this component — every question here is multiple
// choice with a checked key, so every item type is auto-scored and no
// self-entered total is needed (or accepted). Unanswered questions count
// as not correct, the way a timed test treats a blank.
export default function BjtTrainer() {
  const [idx, setIdx] = useState(0)
  const [showDoc, setShowDoc] = useState(true)
  const [secondsLeft, setSecondsLeft] = useState(TIME_PER_ITEM)
  const [running, setRunning] = useState(false)
  const [finishedAll, setFinishedAll] = useState(false)
  // answers: { [itemId]: (optionIndex | null)[] } — the scoring record.
  const [answers, setAnswers] = useState({})
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

  const choose = (qi, oi) => {
    setAnswers((cur) => {
      const forItem = [...(cur[item.id] || Array(item.questions.length).fill(null))]
      if (forItem[qi] !== null) return cur // revealed answers are locked, like MiniQuiz
      forItem[qi] = oi
      return { ...cur, [item.id]: forItem }
    })
  }

  const scored = useMemo(() => {
    let correct = 0
    let answered = 0
    const perItem = bjtTrainerItems.map((it) => {
      const picks = answers[it.id] || []
      const c = it.questions.reduce((a, q, qi) => a + (picks[qi] !== null && picks[qi] !== undefined && q.options[picks[qi]]?.correct ? 1 : 0), 0)
      answered += picks.filter((p) => p !== null && p !== undefined).length
      correct += c
      return { id: it.id, title: it.title, correct: c, total: it.questions.length }
    })
    return { correct, answered, perItem, unanswered: totalQuestions - answered }
  }, [answers, totalQuestions])

  const estScore = finishedAll ? estimateBjtScore(scored.correct / totalQuestions) : null
  const band = estScore !== null ? bjtBandForScore(estScore) : null
  const itemPicks = item ? (answers[item.id] || Array(item.questions.length).fill(null)) : []
  const itemAnswered = itemPicks.filter((p) => p !== null && p !== undefined).length

  return (
    <section className="space-y-4">
      <div className="rounded-2xl glass p-5 card-glow space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2"><Timer size={18} className="text-amber-300" /> BJT Trainer — listening + reading, combined and timed</h3>
        <p className="text-sm text-slate-400">This is the real BJT’s hardest format (Part II): you hear an announcement <em>and</em> read a document, and the answer needs both. {TIME_PER_ITEM} seconds per item. Scored 0–800 in bands J5 → J1+; remember the immigration anchors: <span className="text-slate-200">400 = N2 category, 480 = N1 category</span> for Highly Skilled Professional points. Your band at the end is computed from your actual answers — nothing to add up or type in.</p>
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
            <button onClick={() => setShowDoc((s) => !s)} className="mt-2 text-xs px-2.5 py-1 rounded-lg bg-bun-700 text-slate-300 hover:bg-bun-600">{showDoc ? 'Hide Document' : 'Show Document'}</button>
          </div>

          <div className="space-y-4">
            <p className="text-sm text-slate-400">Answered {itemAnswered} / {item.questions.length} in this item — answers lock once shown, so choose like it counts.</p>
            {item.questions.map((q, qi) => {
              const picked = itemPicks[qi]
              const revealed = picked !== null && picked !== undefined
              return (
                <div key={qi} className="rounded-2xl bg-bun-700/30 border border-bun-600/20 p-4 space-y-2">
                  <p className="text-slate-200 font-medium">{qi + 1}. {q.prompt}</p>
                  <div className="grid gap-2">
                    {q.options.map((opt, oi) => {
                      const isChosen = picked === oi
                      const cls = revealed && opt.correct
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200'
                        : revealed && isChosen
                          ? 'bg-rose-500/15 border-rose-500/50 text-rose-200'
                          : 'bg-bun-700/40 border-bun-600/30 text-slate-200 hover:bg-bun-700/60'
                      return (
                        <button key={oi} onClick={() => choose(qi, oi)} disabled={revealed} className={`w-full text-left px-4 py-3 rounded-xl border transition flex items-center gap-2 ${cls}`}>
                          {revealed && opt.correct ? <CheckCircle2 size={16} className="shrink-0" /> : revealed && isChosen ? <XCircle size={16} className="shrink-0" /> : <span className="text-slate-500 shrink-0">{String.fromCharCode(65 + oi)}.</span>}
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                  {revealed && <p className="text-sm text-slate-400 bg-bun-900/40 rounded-lg p-3"><KanjiTapText text={q.explanation} className="text-slate-400" /></p>}
                </div>
              )
            })}
          </div>

          <button onClick={next} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">{idx + 1 >= bjtTrainerItems.length ? 'Finish And Estimate My Band' : 'Next Item'}</button>
        </div>
      )}

      {finishedAll && band && (
        <div className="rounded-2xl glass p-5 card-glow space-y-3">
          <h4 className="font-bold text-white flex items-center gap-2"><Award size={17} className="text-emerald-300" /> Band estimate — from your answers</h4>
          <p className="text-sm text-slate-300">You answered {scored.answered} of {totalQuestions} questions and got <span className="font-bold text-white">{scored.correct} correct</span>.{scored.unanswered > 0 ? ` ${scored.unanswered} left unanswered — counted as not correct, the way a timed test treats a blank.` : ''}</p>
          <ul className="space-y-1">
            {scored.perItem.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm rounded-lg bg-bun-700/30 border border-bun-600/20 px-3 py-2">
                <span className="text-slate-200">{p.title}</span>
                <span className="text-slate-300 font-semibold">{p.correct} / {p.total}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-200">Estimated BJT score <span className="font-bold text-white">~{estScore}</span> → band <span className="font-bold text-emerald-300">{band.id}</span> ({band.min}–{band.max}): {band.descriptor} {band.hsp ? <span className="block text-xs text-slate-400 mt-1">{band.hsp}</span> : null}</p>
          <p className="text-xs text-slate-500">Estimate only — computed from this {totalQuestions}-question trainer set, not the real ~80-question CBT. Every question type in this trainer is multiple choice with a checked key, so the score is fully auto-computed; if a future item type can’t be auto-scored, it will say so and offer a labelled manual entry instead. Use this estimate to decide when booking the real BJT (retakes wait 3 months) is worth it.</p>
          <button onClick={() => { setAnswers({}); setFinishedAll(false); startItem(0) }} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm">Run It Again</button>
        </div>
      )}
    </section>
  )
}
