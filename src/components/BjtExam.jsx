import { useEffect, useMemo, useRef, useState } from 'react'
import { Award, ChevronRight, Clock, Headphones, Lock, Play, RotateCcw, Unlock } from 'lucide-react'
import {
  BJT_FORMS, BJT_PARTS, assemblePaper, scorePaper, practiceItemsForForm, weakestForms, itemKey,
} from '../lib/bjtExam.js'
import { bjtVocab } from '../data/bjt.js'
import { speakSenseiLine, stopNeuralSpeech, primeAudioOutput } from '../lib/neuralVoice.js'
import { addToQueue, loadQueue } from '../lib/queue.js'
import { recordQueueRating } from '../lib/twin.js'
import { recordMetric, loadMetrics } from '../lib/metrics.js'

// BJT Full Exam — the real paper's structure (80 questions, 3 parts),
// rebuilt in-app. Sealed papers (questions never practised) are the proof
// papers; mixed papers give a score estimate only. Listening audio plays
// ONCE on a sealed paper, like the real test. Scores are mock estimates
// (the real BJT is IRT-scored) and are labelled "est." everywhere.

const PANEL = 'rounded-2xl bg-[#151129] border border-white/5 p-4'
const PRIMARY = 'w-full rounded-xl bg-[#FF6B57] text-white font-semibold py-3 px-4 disabled:opacity-40'
const QUIET = 'text-sm text-slate-400 underline underline-offset-4'

/** Play a list of spoken lines once (or repeatedly when `once` is false). */
function AudioPlay({ lines, once = true, label = 'Play — plays once' }) {
  const [state, setState] = useState('idle') // idle | playing | done
  const stopRef = useRef(false)
  useEffect(() => () => { stopRef.current = true; try { stopNeuralSpeech() } catch { /* noop */ } }, [])

  const play = () => {
    if (state === 'playing' || (once && state === 'done')) return
    try { primeAudioOutput() } catch { /* noop */ }
    stopRef.current = false
    setState('playing')
    let i = 0
    const next = () => {
      if (stopRef.current) return
      if (i >= lines.length) { setState('done'); return }
      const line = lines[i]
      i += 1
      try {
        speakSenseiLine(line.text, { cast: line.cast || 'female', onEnd: next, onFallback: next })
      } catch { next() }
    }
    next()
  }

  return (
    <button
      type="button"
      onClick={play}
      disabled={state === 'playing' || (once && state === 'done')}
      className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-slate-100 disabled:opacity-40"
    >
      <Play size={16} />
      {state === 'playing' ? 'Playing…' : state === 'done' && once ? 'Played — the real test plays it once' : label}
    </button>
  )
}

function audioLinesFor(group) {
  if (group.form === 'bamen' || group.form === 'joukyou') {
    const scriptLines = (group.script || []).map((t) => ({ text: t.text, cast: t.who === 'A' ? 'male' : 'female' }))
    const statements = (group.items[0]?.options || []).map((text, i) => ({ text: `${i + 1}。${text}`, cast: 'female' }))
    return [...scriptLines, ...statements]
  }
  return (group.script || []).map((t) => ({ text: t.text, cast: t.who === 'A' ? 'male' : 'female' }))
}

function GroupBlock({ group, answers, setAnswer, once }) {
  const lines = useMemo(() => audioLinesFor(group), [group])
  const hasAudio = lines.length > 0
  return (
    <div className={PANEL}>
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
        <span>{BJT_FORMS[group.form]?.name} · {BJT_FORMS[group.form]?.en}</span>
        {group.pool === 'sealed' ? <Lock size={12} /> : <Unlock size={12} />}
      </div>
      {group.scene ? <p className="mb-3 rounded-xl bg-white/5 p-3 leading-relaxed text-slate-100">{group.scene}</p> : null}
      {group.doc ? <pre className="mb-3 whitespace-pre-wrap rounded-xl bg-white/5 p-3 font-sans leading-relaxed text-slate-100">{group.doc}</pre> : null}
      {hasAudio ? (
        <div className="mb-3">
          <AudioPlay lines={lines} once={once} label={once ? 'Play — plays once' : 'Play'} />
        </div>
      ) : null}
      <div className="space-y-4">
        {group.items.map((item, i) => {
          const key = itemKey(group, i)
          return (
            <div key={key}>
              <p className="mb-2 font-medium text-slate-100">{item.prompt}</p>
              <div className="grid gap-2">
                {item.options.map((opt, oi) => {
                  const selected = answers[key] === oi
                  return (
                    <button
                      key={oi}
                      type="button"
                      onClick={() => setAnswer(key, oi)}
                      className={`rounded-xl border px-3 py-2 text-left text-sm ${selected ? 'border-[#FF6B57] bg-[#FF6B57]/15 text-white' : 'border-white/10 bg-white/5 text-slate-200'}`}
                    >
                      {oi + 1}. {opt}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function BjtExam({ setActive }) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000) + 1)
  const [mode, setMode] = useState('sealed') // sealed | mixed
  const [phase, setPhase] = useState('intro') // intro | run | done
  const [partIdx, setPartIdx] = useState(0)
  const [answers, setAnswers] = useState({})
  const [secondsLeft, setSecondsLeft] = useState(null)
  const recordedRef = useRef(false)

  const knownWords = useMemo(() => {
    try {
      const set = new Set(loadQueue().map((i) => i.front))
      return set
    } catch { return null }
  }, [])

  const paper = useMemo(
    () => assemblePaper({ sealedOnly: mode === 'sealed', seed, knownWords }),
    [mode, seed, knownWords],
  )
  const result = useMemo(() => (phase === 'done' ? scorePaper(paper, answers) : null), [phase, paper, answers])

  const part = BJT_PARTS[partIdx]
  const partGroups = useMemo(
    () => paper.groups.filter((g) => BJT_FORMS[g.form]?.part === part.part),
    [paper, part],
  )

  // Per-part countdown, like the real sittings.
  useEffect(() => {
    if (phase !== 'run') return undefined
    setSecondsLeft(part.minutes * 60)
    const t = setInterval(() => setSecondsLeft((s) => (s === null ? s : Math.max(0, s - 1))), 1000)
    return () => clearInterval(t)
  }, [phase, partIdx, part])

  useEffect(() => {
    if (phase === 'run' && secondsLeft === 0) advance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, phase])

  // Record the sitting + feed the fleet (queue, Twin) exactly once.
  useEffect(() => {
    if (phase !== 'done' || !result || recordedRef.current) return
    recordedRef.current = true
    try {
      const sections = {}
      for (const [form, s] of Object.entries(result.perForm)) sections[form] = { acc: s.acc, correct: s.correct, total: s.total }
      recordMetric('bjt_exam_completed', {
        score: result.score, band: result.band, sealed: result.sealed,
        sections, totalQuestions: result.total, correct: result.correct,
      })
    } catch { /* never blocks */ }
    try {
      const queueItems = []
      for (const miss of result.misses) {
        queueItems.push({
          front: miss.item.prompt,
          back: miss.item.options[miss.item.answer],
          note: `BJT exam · ${BJT_FORMS[miss.form]?.name || miss.form} · you chose: ${miss.chosen !== null ? miss.item.options[miss.chosen] : '—'}`,
          source: 'bjt',
        })
        for (const w of miss.item.vocab || []) {
          const entry = bjtVocab.find((v) => v.word === w)
          if (entry) queueItems.push({ front: entry.word, back: entry.meaning, reading: entry.reading, note: 'BJT exam word', source: 'bjt' })
        }
      }
      if (queueItems.length) {
        const { added } = addToQueue(queueItems)
        for (const item of added || []) { try { recordQueueRating(item, 1) } catch { /* noop */ } }
      }
    } catch { /* never blocks */ }
  }, [phase, result])

  const setAnswer = (key, oi) => setAnswers((a) => ({ ...a, [key]: oi }))

  function advance() {
    try { stopNeuralSpeech() } catch { /* noop */ }
    if (partIdx + 1 < BJT_PARTS.length) setPartIdx(partIdx + 1)
    else setPhase('done')
  }

  function restart(newMode) {
    recordedRef.current = false
    setAnswers({})
    setPartIdx(0)
    setSeed(Math.floor(Math.random() * 100000) + 1)
    if (newMode) setMode(newMode)
    setPhase('intro')
  }

  if (phase === 'intro') {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className={PANEL}>
          <div className="mb-1 flex items-center gap-2 text-slate-100">
            <Award size={20} />
            <h1 className="text-xl font-bold">BJT Full Exam</h1>
          </div>
          <p className="text-sm text-slate-400">
            The real paper's structure: 80 questions in three sittings. Listening plays once, like the real test.
          </p>
          <div className="mt-3 space-y-2">
            {BJT_PARTS.map((p) => (
              <div key={p.part} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm">
                <span className="text-slate-100">Part {p.part} · {p.name}</span>
                <span className="text-slate-400">{p.forms.reduce((n, f) => n + BJT_FORMS[f].count, 0)} questions · {p.minutes} min</span>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl bg-white/5 p-3 text-sm leading-relaxed text-slate-300">
            {mode === 'sealed' ? (
              paper.sealed ? (
                <span><Lock size={14} className="mr-1 inline" /> Sealed paper ready — 80 questions you have <strong>never practised</strong>. Passing this is the strong evidence: it turns the BJT rungs on your Proof Ladder green.</span>
              ) : (
                <span>The sealed bank cannot fill a full paper yet ({paper.totalQuestions}/80) — this sitting gives a score estimate only, no proof.</span>
              )
            ) : (
              <span><Unlock size={14} className="mr-1 inline" /> Practice paper — mixes questions you may have seen. Score estimate only; audio can replay.</span>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Scores are mock estimates (est.) — the real BJT scores by IRT. Photo items are adapted as scene cards.
          </p>
          <button type="button" className={`${PRIMARY} mt-4`} onClick={() => setPhase('run')}>
            Start Part 1
          </button>
          <div className="mt-3 text-center">
            <button type="button" className={QUIET} onClick={() => setMode(mode === 'sealed' ? 'mixed' : 'sealed')}>
              {mode === 'sealed' ? 'Use a practice paper instead' : 'Use the sealed paper'}
            </button>
          </div>
        </div>
        <FormPractice />
      </div>
    )
  }

  if (phase === 'run') {
    const mm = secondsLeft !== null ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` : ''
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-100">Part {part.part} · {part.name}</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-sm text-slate-200">
            <Clock size={14} /> {mm}
          </span>
        </div>
        {partGroups.map((g) => (
          <GroupBlock key={g.id} group={g} answers={answers} setAnswer={setAnswer} once={paper.sealed} />
        ))}
        <button type="button" className={PRIMARY} onClick={advance}>
          {partIdx + 1 < BJT_PARTS.length ? `Finish Part ${part.part} — next part` : 'Finish the exam'}
        </button>
      </div>
    )
  }

  // results
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className={PANEL}>
        <p className="text-xs uppercase tracking-wide text-slate-400">BJT mock score (est.)</p>
        <div className="mt-1 flex items-end gap-3">
          <span className="text-5xl font-bold text-white">{result.score}</span>
          <span className="pb-1 text-slate-400">/ 800</span>
          <span className="mb-1 rounded-full bg-[#FF6B57] px-3 py-1 text-sm font-bold text-white">{result.band}</span>
        </div>
        <p className="mt-2 text-sm text-slate-300">
          {result.sealed
            ? 'Sealed paper — none of these questions were in your practice. This score counts as proof on your ladder.'
            : 'Practice/mixed paper — a score estimate only. Proof comes from a sealed paper.'}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          {result.correct}/{result.total} correct · {result.misses.length} misses were added to your review queue.
        </p>
      </div>
      <div className={PANEL}>
        <h3 className="mb-3 font-semibold text-slate-100">By section — weakest first, practise the form</h3>
        <div className="space-y-3">
          {Object.entries(result.perForm).sort((a, b) => a[1].acc - b[1].acc).map(([form, s]) => (
            <div key={form} className="rounded-xl bg-white/5 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-100">{s.name} · {BJT_FORMS[form]?.en}</span>
                <span className="text-slate-300">{s.correct}/{s.total} · rank {s.rank}/7</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-emerald-400" style={{ width: `${Math.round(s.acc * 100)}%` }} />
              </div>
              <FormPractice key={form} initialForm={form} compact />
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <button type="button" className={PRIMARY} onClick={() => restart('sealed')}>
          <RotateCcw size={16} className="mr-1 inline" /> New paper
        </button>
      </div>
      {setActive ? (
        <div className="text-center">
          <button type="button" className={QUIET} onClick={() => setActive('exams')}>Back to Exams</button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Form practice — the exam's question forms, as daily practice.
 * Variants of the same forms (never the sealed questions), opening on the
 * learner's weakest form, so the forms feel familiar before exam day.
 */
export function FormPractice({ initialForm = null, compact = false }) {
  const forms = Object.keys(BJT_FORMS)
  const [form, setForm] = useState(() => {
    if (initialForm) return initialForm
    try {
      const weak = weakestForms(loadMetrics())
      return weak[0] || 'hatsugen'
    } catch { return 'hatsugen' }
  })
  const [seed, setSeed] = useState(1)
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState(null)
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [open, setOpen] = useState(!compact)
  const doneRef = useRef(false)

  const items = useMemo(() => practiceItemsForForm(form, { seed, count: 5 }), [form, seed])
  const item = items[idx]

  const resetRun = () => { setIdx(0); setPicked(null); setScore({ correct: 0, total: 0 }); doneRef.current = false }

  useEffect(() => {
    if (idx >= items.length && items.length > 0 && !doneRef.current) {
      doneRef.current = true
      try { recordMetric('bjt_completed', { kind: `form:${form}`, correct: score.correct, total: score.total }) } catch { /* noop */ }
    }
  }, [idx, items, form, score])

  const choose = (oi) => {
    if (picked !== null || !item) return
    setPicked(oi)
    const ok = oi === item.answer
    setScore((s) => ({ correct: s.correct + (ok ? 1 : 0), total: s.total + 1 }))
    if (!ok) {
      try {
        addToQueue([{
          front: item.prompt,
          back: item.options[item.answer],
          note: `BJT form practice · ${BJT_FORMS[form]?.name || form} · you chose: ${item.options[oi]}`,
          source: 'bjt',
        }])
      } catch { /* noop */ }
    }
  }

  const lines = item ? audioLinesFor({ form, script: item.script, items: [item] }) : []

  return (
    <div className={PANEL}>
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <span className="inline-flex items-center gap-2 font-semibold text-slate-100">
          <Headphones size={18} /> Exam forms practice
        </span>
        <ChevronRight size={18} className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {!open ? (
        <p className="mt-1 text-sm text-slate-400">The exam's question forms, in variants — so the forms are familiar before you ever sit a sealed paper.</p>
      ) : (
        <div className="mt-3">
          {!compact ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {forms.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => { setForm(f); resetRun() }}
                  className={`rounded-full px-3 py-1 text-xs ${f === form ? 'bg-[#FF6B57] text-white' : 'bg-white/10 text-slate-300'}`}
                >
                  {BJT_FORMS[f].name}
                </button>
              ))}
            </div>
          ) : null}
          {items.length === 0 ? (
            <p className="text-sm text-slate-400">No practice variants for this form yet.</p>
          ) : idx >= items.length ? (
            <div>
              <p className="text-slate-100">Done — {score.correct}/{score.total} on {BJT_FORMS[form].name} forms.</p>
              <button type="button" className={`${PRIMARY} mt-3`} onClick={() => { setSeed(seed + 1); resetRun() }}>More variants</button>
            </div>
          ) : (
            <div>
              {item.scene ? <p className="mb-2 rounded-xl bg-white/5 p-3 text-slate-100">{item.scene}</p> : null}
              {item.doc ? <pre className="mb-2 whitespace-pre-wrap rounded-xl bg-white/5 p-3 font-sans text-slate-100">{item.doc}</pre> : null}
              {lines.length ? <div className="mb-2"><AudioPlay lines={lines} once={false} label="Listen" /></div> : null}
              <p className="mb-2 font-medium text-slate-100">{item.prompt}</p>
              <div className="grid gap-2">
                {item.options.map((opt, oi) => {
                  const isAnswer = oi === item.answer
                  const isPicked = picked === oi
                  const cls = picked === null
                    ? 'border-white/10 bg-white/5 text-slate-200'
                    : isAnswer
                      ? 'border-emerald-400 bg-emerald-400/15 text-white'
                      : isPicked
                        ? 'border-rose-500 bg-rose-500/15 text-white'
                        : 'border-white/10 bg-white/5 text-slate-400'
                  return (
                    <button key={oi} type="button" onClick={() => choose(oi)} className={`rounded-xl border px-3 py-2 text-left text-sm ${cls}`}>
                      {oi + 1}. {opt}
                    </button>
                  )
                })}
              </div>
              {picked !== null ? (
                <button type="button" className={`${PRIMARY} mt-3`} onClick={() => { setPicked(null); setIdx(idx + 1) }}>
                  {idx + 1 < items.length ? 'Next' : 'See result'}
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
