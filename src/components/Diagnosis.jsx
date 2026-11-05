import { useEffect, useMemo, useRef, useState } from 'react'
import { Stethoscope, ChevronRight, RotateCcw, Target } from 'lucide-react'
import { computeSixtyDayPromise, savePromise } from '../lib/promise.js'
import PromisePanel from './PromisePanel.jsx'
import { loadDictionary, localDictionary, quizPool } from '../lib/dictionary.js'
import { questions as bankQuestions } from '../data.js'
import { selectDiagnosisItems, sectionComponent } from '../lib/diagnosisItems.js'
import { JLPT_LEVELS, jlptLevel, estimateBjtScore, bjtBandForScore, SECTION_KEYS } from '../lib/levels.js'
import { loadProfile, saveDiagnosis, DIAGNOSIS_KEY } from '../lib/profile.js'
import { recordDiagnosis, diagnosisDeltas, recordReading, loadDiagnosisHistory } from '../lib/twin.js'
import { recordMetric } from '../lib/metrics.js'
import Mascot from './Mascot.jsx'
import { ProofLadderView } from './ProblemStart.jsx'
import TtsButton from './TtsButton.jsx'
import KanjiTapText from './KanjiTapText.jsx'

const LEVEL_IDS = ['N5', 'N4', 'N3', 'N2', 'N1']
const VOCAB_STEPS = 8
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

function makeVocabQuestion(dict, levelId, used) {
  const pool = quizPool(dict, { levels: [levelId] }).filter((e) => e.meaning && e.word && !used.has(e.word))
  if (!pool.length) return null
  const entry = pick(pool)
  used.add(entry.word)
  const distractors = shuffle(pool.filter((e) => e.word !== entry.word && e.meaning !== entry.meaning)).slice(0, 3)
  if (distractors.length < 3) return null
  const options = shuffle([entry.meaning, ...distractors.map((d) => d.meaning)]).map((label) => ({ label, correct: label === entry.meaning }))
  return { kind: 'vocab', level: levelId, prompt: `「${entry.word}」${entry.reading ? `（${entry.reading}）` : ''} — what does it mean?`, options, explanation: `${entry.word} = ${entry.meaning}` }
}
function makeGrammarQuestion(used) {
  const pool = bankQuestions.filter((q) => q.type === 'Grammar' && !used.has(`g${q.id}`))
  if (!pool.length) return null
  const q = pick(pool); used.add(`g${q.id}`)
  return { kind: 'grammar', level: 'N2', prompt: q.prompt, options: q.options, explanation: q.explanation }
}

// Adaptive health check: vocab/grammar stepping up on correct, down on wrong,
// then one TTS listening item and one short reading item. ~10 minutes.
export default function Diagnosis({ setActive }) {
  const [phase, setPhase] = useState('intro') // intro | quiz | listening | reading | result
  const [dict, setDict] = useState(localDictionary)
  const [step, setStep] = useState(0)
  const [levelIdx, setLevelIdx] = useState(2) // start at N3
  const [current, setCurrent] = useState(null)
  const [picked, setPicked] = useState(null)
  const [answers, setAnswers] = useState([]) // {level, correct, kind}
  // P0-2: listening + reading are now SETS of level-banded, rotated items
  // (lib/diagnosisItems.js) — two per section, never last run's items
  // while the pool allows. lCorrect/rCorrect count right answers.
  const [itemSet, setItemSet] = useState(null)
  const [lIdx, setLIdx] = useState(0)
  const [lCorrect, setLCorrect] = useState(0)
  const [rIdx, setRIdx] = useState(0)
  const [rCorrect, setRCorrect] = useState(0)
  const [poolNote, setPoolNote] = useState('')
  const [result, setResult] = useState(() => { try { return JSON.parse(localStorage.getItem(DIAGNOSIS_KEY) || 'null') } catch { return null } })
  const usedRef = useRef(new Set())
  const profile = useMemo(loadProfile, [])

  // Day-1 Promise: every finished diagnosis computes (and saves) its
  // 60-day height — next level only when the latent base supports it,
  // otherwise a section-rescue height at the same level. See lib/promise.js.
  const promise = useMemo(() => computeSixtyDayPromise(result, profile), [result, profile])
  useEffect(() => { if (promise) savePromise(promise) }, [promise])

  const grammarSteps = new Set([3, 6])

  const nextQuestion = (forStep, atLevelIdx, used) => {
    if (grammarSteps.has(forStep)) { const g = makeGrammarQuestion(used); if (g) return g }
    return makeVocabQuestion(dict, LEVEL_IDS[atLevelIdx], used) || makeVocabQuestion(dict, 'N2', used) || makeGrammarQuestion(used)
  }

  const selectItems = (d, bandIdx) => {
    const last = loadDiagnosisHistory().at(-1)
    return selectDiagnosisItems(d, bandIdx, {
      listening: last?.sample?.listeningIds || [],
      reading: last?.sample?.readingIds || [],
    })
  }

  const start = async () => {
    const d = await loadDictionary(); setDict(d)
    usedRef.current = new Set()
    setAnswers([]); setStep(0); setLevelIdx(2); setPicked(null)
    setItemSet(null); setLIdx(0); setLCorrect(0); setRIdx(0); setRCorrect(0); setPoolNote('')
    // nextQuestion closes over the stale `dict`; rebuild with loaded dictionary directly:
    const pool = quizPool(d, { levels: ['N3'] })
    const entry = pick(pool)
    if (!entry) { setPoolNote('The word deck could not be loaded on this device, so the check cannot start. Check your connection and try again — nothing was recorded.'); return }
    usedRef.current.add(entry.word)
    const distractors = shuffle(pool.filter((e) => e.word !== entry.word && e.meaning !== entry.meaning)).slice(0, 3)
    setCurrent({ kind: 'vocab', level: 'N3', prompt: `「${entry.word}」${entry.reading ? `（${entry.reading}）` : ''} — what does it mean?`, options: shuffle([entry.meaning, ...distractors.map((x) => x.meaning)]).map((label) => ({ label, correct: label === entry.meaning })), explanation: `${entry.word} = ${entry.meaning}` })
    setPhase('quiz')
  }

  const answer = (opt) => {
    if (picked) return
    setPicked(opt)
    const correct = !!opt.correct
    setAnswers((a) => [...a, { level: current.level, correct, kind: current.kind }])
    const nextIdx = Math.max(0, Math.min(4, levelIdx + (correct ? 1 : -1)))
    setLevelIdx(nextIdx)
    // Prepare the following question after a short reveal, using loaded dict state via closure at click time:
    setTimeout(() => {
      const ns = step + 1
      setPicked(null)
      if (ns >= VOCAB_STEPS) {
        setItemSet(selectItems(dict, nextIdx)); setPhase('listening'); return
      }
      setStep(ns)
      const nq = nextQuestion(ns, nextIdx, usedRef.current)
      if (!nq) {
        // P2-9: never strand the learner on a null question — finish the
        // quiz early with an honest note and continue to listening.
        setPoolNote('The word deck ran short partway through, so the language score rests on fewer words than usual. Listening and reading are unaffected.')
        setItemSet(selectItems(dict, nextIdx)); setPhase('listening'); return
      }
      setCurrent(nq)
    }, 650)
  }

  const finish = (readingCorrectFinal) => {
    const lN = itemSet?.listening.length || 0
    const rN = itemSet?.reading.length || 0
    const totalQ = answers.length + lN + rN
    const correctCount = answers.filter((a) => a.correct).length
    const net = answers.reduce((acc, a) => acc + (a.correct ? 1 : -1), 0)
    const estIdx = Math.max(0, Math.min(4, 2 + Math.round(net / 3)))
    const jlptEstimate = LEVEL_IDS[estIdx]
    const langAcc = answers.length ? correctCount / answers.length : 0
    const language = Math.max(6, Math.min(58, Math.round(langAcc * 44 + (estIdx / 4) * 14)))
    // Same formula shape as the original single-item version; the binary
    // 38/9 component is now the per-set proportion (sectionComponent),
    // so one item can no longer swing a section across the 19/60 line.
    const listening = Math.max(5, Math.min(58, Math.round(language * 0.35 + sectionComponent(lCorrect, lN))))
    const reading = Math.max(5, Math.min(58, Math.round(language * 0.35 + sectionComponent(readingCorrectFinal, rN))))
    const sections = { language, reading, listening }
    const weakestKey = Object.entries(sections).sort((a, b) => a[1] - b[1])[0][0]
    const overallAccuracy = totalQ ? (correctCount + lCorrect + readingCorrectFinal) / totalQ : 0
    const bjtScore = estimateBjtScore(0.2 + 0.68 * overallAccuracy)
    const res = {
      at: new Date().toISOString(), jlptEstimate, sections, total: language + reading + listening,
      weakest: weakestKey, bjtScore, bjtBand: bjtBandForScore(bjtScore).id,
      passMark: jlptLevel(jlptEstimate)?.passMark ?? null,
      // P0-2: what this run actually measured with — the band, the item
      // ids (the next run rotates away from these) and how many items
      // were deck-generated because the band had no real ones.
      sample: {
        band: itemSet?.band || null,
        listeningIds: (itemSet?.listening || []).map((i) => i.id),
        readingIds: (itemSet?.reading || []).map((i) => i.id),
        listeningItems: lN,
        readingItems: rN,
        generatedItems: [...(itemSet?.listening || []), ...(itemSet?.reading || [])].filter((i) => i.generated).length,
      },
    }
    saveDiagnosis(res)
    // Diagnosis history (jpn:diagnosisHistory:v1) + Twin section levels —
    // written by diagnosis code only, so trends stay honest (Doc 04 §5).
    recordDiagnosis(res)
    recordMetric('diagnosis_completed', { total: res.total, estimate: res.jlptEstimate }) // gate metric (Doc 11)
    recordReading({ correct: rN > 0 && readingCorrectFinal * 2 >= rN }) // majority of the reading set
    setResult(res); setPhase('result')
  }

  const prescription = (res) => {
    const lines = []
    const weakestLabel = SECTION_KEYS.find((s) => s.id === res.weakest)?.label
    lines.push({ tab: res.weakest === 'listening' ? 'n2listening' : res.weakest === 'reading' ? 'reading' : 'lessons', text: `Days 1–14, daily: 15 minutes on your weakest section — ${weakestLabel} (${res.sections[res.weakest]}/60 vs the 19/60 survival line). Nothing else matters until this is safe.` })
    lines.push({ tab: 'voice', text: 'Daily: one Voice Loop scene out loud, repeat to mastery. Speaking is trained even though JLPT doesn’t test it — your job and BJT life do.' })
    lines.push({ tab: 'anki', text: 'Daily: review queue, max 10 new cards. When the queue feels heavy, do fewer new — never skip review days entirely.' })
    if ((profile?.pains || []).includes('keigo') || (profile?.pains || []).includes('blocked-job') || profile?.proofTarget === 'bjt' || profile?.proofTarget === 'hsp') {
      lines.push({ tab: 'bjt', text: '3× per week: BJT trainer (listening + document). Your proof target needs business Japanese, not just JLPT Japanese.' })
    }
    if ((profile?.pains || []).includes('listening') || res.weakest === 'listening') {
      lines.push({ tab: 'voice', text: 'Commute: shadowing mode, 10 minutes, material you already understood once. Listening plays ONCE in the real exam — train that way.' })
    }
    lines.push({ tab: 'mock', text: `Day 14: one timed mock at ${res.jlptEstimate} level. Target: total ≥ ${(res.passMark || 90) + 15} with every section ≥ 30/60 in practice — margin, not luck, on exam day.` })
    lines.push({ tab: 'diagnosis', text: 'Then re-run this diagnosis. The ladder moves when the sections move.' })
    return lines
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1"><Stethoscope size={20} className="text-violet-400" /><h2 className="text-2xl font-bold text-white">Diagnosis — your language health check</h2></div>
        <p className="text-sm text-slate-400">Adaptive: right answers step the questions up a level, wrong answers step down. Then two short listening items and two reading items at your band — the items rotate every run, so a re-check measures growth, not memory. About 10 minutes.</p>
      </div>

      {phase === 'intro' && (
        <div className="rounded-2xl glass p-6 card-glow space-y-4">
          <p className="text-sm text-slate-300">Most learners study blind for months. This check estimates your JLPT section scores — language knowledge, reading, listening, each /60 against the <span className="text-white font-semibold">19/60 survival line</span> — plus a rough BJT band, then prescribes your next two weeks{profile ? ' around the problem you named' : ''}.</p>
          {poolNote && phase === 'intro' && <p className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">{poolNote}</p>}
          {result && <p className="text-sm text-slate-400">Last check: <span className="text-white font-semibold">{result.jlptEstimate}</span> · total {result.total}/180 · weakest: {result.weakest} · BJT ~{result.bjtScore} ({result.bjtBand}) · {new Date(result.at).toLocaleDateString()}</p>}
          <button onClick={start} className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">{result ? 'Re-Run Diagnosis' : 'Start Diagnosis'}</button>
          {result && promise && <PromisePanel promise={promise} />}
          {result && <div className="pt-2"><ProofLadderView diagnosis={result} profile={profile} /></div>}
        </div>
      )}

      {phase === 'quiz' && current && (
        <div className="rounded-2xl glass p-6 card-glow space-y-4">
          <p className="text-xs text-slate-400">Question {step + 1} / {VOCAB_STEPS} · testing at <span className="text-violet-300 font-semibold">{current.level}</span> {current.kind === 'grammar' ? '· grammar' : '· vocabulary'}</p>
          <p className="text-lg text-white leading-loose"><KanjiTapText text={current.prompt} /></p>
          <div className="grid gap-2">
            {current.options.map((opt, i) => (
              <button key={i} onClick={() => answer(opt)} disabled={!!picked}
                className={`text-left px-4 py-3 rounded-xl border transition ${picked && opt.correct ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200' : picked === opt && !opt.correct ? 'bg-rose-500/15 border-rose-500/50 text-rose-200' : 'bg-bun-700/40 border-bun-600/30 text-slate-200 hover:bg-bun-700/60'}`}>
                {opt.label}
              </button>
            ))}
          </div>
          {picked && <p className="text-sm text-slate-400">{current.explanation}</p>}
        </div>
      )}

      {phase === 'listening' && (() => {
        const item = itemSet?.listening?.[lIdx]
        return (
        <div className="rounded-2xl glass p-6 card-glow space-y-4">
          <p className="text-xs text-slate-400">Listening {itemSet ? `${lIdx + 1} of ${itemSet.listening.length}` : ''}{item ? ` · ${item.level}` : ''} · in the real exam it plays once — here you may replay, but try once first</p>
          {poolNote && <p className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">{poolNote}</p>}
          {item ? (<>
          <div className="flex items-center gap-3"><TtsButton text={item.script} className="px-4 py-2 text-sm font-medium" /><span className="text-sm text-slate-300">{item.title} — listen, then answer{item.generated ? ' · built from a deck word' : ''}</span></div>
          <p className="text-white">{item.question.prompt}</p>
          <div className="grid gap-2">
            {item.question.options.map((opt, i) => (
              <button key={i} onClick={() => { if (opt.correct) setLCorrect((c) => c + 1); if (lIdx + 1 < itemSet.listening.length) { setLIdx(lIdx + 1) } else { setPhase('reading') } }}
                className="text-left px-4 py-3 rounded-xl border bg-bun-700/40 border-bun-600/30 text-slate-200 hover:bg-bun-700/60 transition">{opt.label}</button>
            ))}
          </div>
          </>) : (<>
          <p className="text-sm text-slate-300">No listening items could be prepared for this band on this device, so listening is skipped this run — the section score below rests on your language score alone and is marked by its smaller sample.</p>
          <button onClick={() => setPhase('reading')} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">Continue To Reading</button>
          </>)}
        </div>
        )
      })()}

      {phase === 'reading' && (() => {
        const item = itemSet?.reading?.[rIdx]
        return (
        <div className="rounded-2xl glass p-6 card-glow space-y-4">
          <p className="text-xs text-slate-400">Reading {itemSet ? `${rIdx + 1} of ${itemSet.reading.length}` : ''}{item ? ` · ${item.level}` : ''} · read once, at speed</p>
          {item ? (<>
          <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 leading-loose text-slate-100"><KanjiTapText text={item.text} /></div>
          <p className="text-white">{item.question.prompt}</p>
          <div className="grid gap-2">
            {item.question.options.map((opt, i) => (
              <button key={i} onClick={() => { const nc = rCorrect + (opt.correct ? 1 : 0); if (opt.correct) setRCorrect(nc); if (rIdx + 1 < itemSet.reading.length) { setRIdx(rIdx + 1) } else { finish(nc) } }}
                className="text-left px-4 py-3 rounded-xl border bg-bun-700/40 border-bun-600/30 text-slate-200 hover:bg-bun-700/60 transition">{opt.label}</button>
            ))}
          </div>
          </>) : (<>
          <p className="text-sm text-slate-300">No reading items could be prepared for this band on this device, so reading is skipped this run — the section score below rests on your language score alone and is marked by its smaller sample.</p>
          <button onClick={() => finish(rCorrect)} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">See My Result</button>
          </>)}
        </div>
        )
      })()}

      {phase === 'result' && result && (
        <div className="space-y-6">
          <div className="rounded-2xl glass p-6 card-glow space-y-4">
            <h3 className="text-xl font-bold text-white flex items-center gap-2"><Target size={18} className="text-emerald-300" /> Estimate: {result.jlptEstimate} · {result.total}/180</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {SECTION_KEYS.map((s) => (
                <div key={s.id} className={`rounded-xl border p-4 ${result.weakest === s.id ? 'bg-rose-500/10 border-rose-500/40' : 'bg-bun-700/40 border-bun-600/30'}`}>
                  <p className="text-xs text-slate-400">{s.label} ({s.jlpt})</p>
                  <p className="text-2xl font-bold text-white">{result.sections[s.id]}<span className="text-sm text-slate-400">/60</span></p>
                  <p className="text-xs mt-1">{result.sections[s.id] < 19 ? <span className="text-rose-300">⚠ Below the 19/60 line — this section alone would fail the exam</span> : result.weakest === s.id ? <span className="text-amber-300">Your weakest section — this is the prescription’s target</span> : <span className="text-emerald-300">Above the survival line</span>}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-slate-300">At {result.jlptEstimate}, the pass mark is <span className="text-white font-semibold">{result.passMark}/180</span> with every section ≥ 19/60. Your modeled total is {result.total} — {result.total >= (result.passMark || 0) ? 'at/above the line on paper, but sit the exam only when practice mocks clear it by 15–20 points with margin in EVERY section.' : `you need +${(result.passMark || 0) - result.total} modeled points, and the cheapest points are in ${result.weakest}.`} BJT estimate: <span className="text-white font-semibold">~{result.bjtScore} ({result.bjtBand})</span> — a rough cross-estimate; the BJT trainer measures business Japanese directly.</p>
            {result.sample && <p className="text-xs text-slate-500">This run measured with {result.sample.listeningItems} listening and {result.sample.readingItems} reading items at the {result.sample.band} band{result.sample.generatedItems ? ` — ${result.sample.generatedItems} of them built from real deck words because that band has no written items yet` : ''}. Items rotate every run.</p>}
            <p className="text-xs text-slate-500">Honest limits: this is an in-app estimate from a short adaptive sample, not an official score. JLPT publishes no official vocab lists, so level pools are community estimates. Use it to aim your study — the mock exams and the real exam are the proof.</p>
          </div>

          <PromisePanel promise={promise} />

          {(() => {
            const d = diagnosisDeltas()
            if (!d) return null
            const fmt = (n) => (n > 0 ? `+${n}` : `${n}`)
            return (
              <div className="rounded-2xl glass p-6 card-glow space-y-2">
                <h3 className="text-lg font-bold text-white">Since your last check</h3>
                <p className="text-sm text-slate-300">
                  Total {fmt(d.total)} (now {d.to.total}/180) · {SECTION_KEYS.map((s) => `${s.label.split(' (')[0]} ${fmt(d.sections[s.id] || 0)}`).join(' · ')}
                </p>
                <p className="text-xs text-slate-500">Same short check, measured the same way — the movement is the trend your Twin and your Coach letter use. Estimates, as always, not official scores.</p>
              </div>
            )
          })()}

          <div className="rounded-2xl glass p-6 card-glow space-y-3">
            <div className="flex items-center gap-3">
              <Mascot agent="saki" size={36} showName={false} />
              <div>
                <h3 className="text-lg font-bold text-white">Your next 2 weeks</h3>
                <p className="text-xs text-slate-400">Prepared by Saki, your planner — from this checkup and your problem</p>
              </div>
            </div>
            {prescription(result).map((line, i) => (
              <button key={i} onClick={() => setActive?.(line.tab)} className="w-full text-left flex items-start gap-2 rounded-xl bg-bun-700/40 border border-bun-600/30 p-3 hover:border-violet-500/40 transition">
                <ChevronRight size={15} className="text-violet-300 mt-0.5 shrink-0" /><span className="text-sm text-slate-200">{line.text}</span>
              </button>
            ))}
            <button onClick={() => setPhase('intro')} className="px-4 py-2 rounded-lg bg-bun-700 hover:bg-bun-600 text-slate-200 text-xs font-medium flex items-center gap-1.5"><RotateCcw size={13} /> Back / Re-Run Later</button>
          </div>

          <ProofLadderView diagnosis={result} profile={profile} />
          <p className="text-xs text-slate-500">Levels reference: {JLPT_LEVELS.filter((l) => l.passMark).map((l) => `${l.id} pass ${l.passMark}`).join(' · ')} — section minimum 19/60 at every level.</p>
        </div>
      )}
    </div>
  )
}
