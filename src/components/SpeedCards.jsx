import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { localDictionary, loadDictionary, quizPool, LEVELS } from '../lib/dictionary.js'
import { loadStats, saveStats, recordResult, weightedSample, weakCount } from '../lib/speedStats.js'
import { Zap, Clock, Flame, Play, RotateCcw, Trophy, Target, Loader2 } from 'lucide-react'

const TIMES = [3, 5, 8, 12]
const ROUND_SIZE = 20
const TYPES = [
  { id: 'all', label: 'Everything', types: null },
  { id: 'vocab', label: 'Vocab', types: ['Vocab', 'Common', 'Reading'] },
  { id: 'kanji', label: 'Kanji', types: ['Kanji'] },
  { id: 'grammar', label: 'Grammar', types: ['Grammar'] },
  { id: 'bjt', label: 'BJT', types: ['BJT'] },
]

const keyOf = (entry) => `${entry.word}|${entry.reading}`
const firstSense = (meaning) => (meaning || '').split(/[,;/]/)[0].trim()

/** Build a question with unique distractors that are never equal to the answer. */
function buildQuestion(entry, pool) {
  const canAskReading = entry.reading && entry.reading !== entry.word && !/[·\s]/.test(entry.reading)
  const askReading = canAskReading && Math.random() > 0.5

  const answer = askReading ? entry.reading : firstSense(entry.meaning)
  if (!answer) return null

  const seen = new Set([answer])
  const options = []
  // Sample distractors randomly from the pool, skipping duplicates/answer matches.
  for (let guard = 0; guard < 200 && options.length < 3; guard++) {
    const cand = pool[(Math.random() * pool.length) | 0]
    if (!cand || cand === entry) continue
    const value = askReading ? cand.reading : firstSense(cand.meaning)
    if (!value || seen.has(value)) continue
    seen.add(value)
    options.push(value)
  }
  if (options.length < 3) return null

  return {
    key: keyOf(entry),
    prompt: entry.word,
    hint: askReading ? 'Reading' : 'Meaning',
    level: entry.level,
    answer,
    options: [answer, ...options].sort(() => Math.random() - 0.5),
    entry,
  }
}

export default function SpeedCards() {
  const [dict, setDict] = useState(localDictionary)
  const [loading, setLoading] = useState(true)
  const [levels, setLevels] = useState(['N2'])
  const [typeId, setTypeId] = useState('all')
  const [timeLimit, setTimeLimit] = useState(5)

  const [phase, setPhase] = useState('setup') // setup | playing | done
  const [cards, setCards] = useState([])
  const [index, setIndex] = useState(0)
  const [timeLeft, setTimeLeft] = useState(timeLimit)
  const [picked, setPicked] = useState(null)
  const [feedback, setFeedback] = useState(null) // correct | wrong

  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [missed, setMissed] = useState([])

  const initialStats = useMemo(() => loadStats(), [])
  const statsRef = useRef(initialStats)
  const [weak, setWeak] = useState(() => weakCount(initialStats))
  const [highScore, setHighScore] = useState(() => Number(localStorage.getItem('n2:speed-high') || 0))

  useEffect(() => {
    let cancelled = false
    loadDictionary().then((d) => {
      if (cancelled) return
      setDict(d)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const pool = useMemo(() => {
    const types = TYPES.find((t) => t.id === typeId)?.types
    // Kanji/Grammar/BJT only exist in the hand-written content, so ignore JLPT
    // level filtering for them (their level tags use a different scale).
    const useLevels = types && types.some((t) => t !== 'Vocab' && t !== 'Common' && t !== 'Reading') ? null : levels
    return quizPool(dict, { levels: useLevels, types })
  }, [dict, levels, typeId])

  const toggleLevel = (lv) => {
    setLevels((cur) => (cur.includes(lv) ? (cur.length === 1 ? cur : cur.filter((l) => l !== lv)) : [...cur, lv]))
  }

  const start = () => {
    const sample = weightedSample(pool, ROUND_SIZE * 2, statsRef.current, keyOf)
    const built = []
    for (const entry of sample) {
      if (built.length >= ROUND_SIZE) break
      const q = buildQuestion(entry, pool)
      if (q) built.push(q)
    }
    if (!built.length) return
    setCards(built)
    setIndex(0)
    setCorrect(0)
    setStreak(0)
    setBest(0)
    setMissed([])
    setPicked(null)
    setFeedback(null)
    setTimeLeft(timeLimit)
    setPhase('playing')
  }

  const current = cards[index]
  const score = correct * 10 + Math.max(0, best - 2) * 5

  const finish = useCallback((finalCorrect, finalBest) => {
    saveStats(statsRef.current)
    setWeak(weakCount(statsRef.current))
    const final = finalCorrect * 10 + Math.max(0, finalBest - 2) * 5
    setHighScore((hs) => {
      if (final > hs) {
        localStorage.setItem('n2:speed-high', String(final))
        return final
      }
      return hs
    })
    setPhase('done')
  }, [])

  const advance = useCallback((nextCards, nextIndex, finalCorrect, finalBest) => {
    if (nextIndex >= nextCards.length) {
      finish(finalCorrect, finalBest)
      return
    }
    setCards(nextCards)
    setIndex(nextIndex)
    setPicked(null)
    setFeedback(null)
    setTimeLeft(timeLimit)
  }, [finish, timeLimit])

  const resolve = useCallback((option) => {
    if (!current || feedback) return
    const isCorrect = option === current.answer
    recordResult(statsRef.current, current.key, isCorrect)

    setPicked(option)
    setFeedback(isCorrect ? 'correct' : 'wrong')

    const nextCorrect = isCorrect ? correct + 1 : correct
    const nextStreak = isCorrect ? streak + 1 : 0
    const nextBest = Math.max(best, nextStreak)
    setCorrect(nextCorrect)
    setStreak(nextStreak)
    setBest(nextBest)

    let nextCards = cards
    if (!isCorrect) {
      setMissed((m) => (m.some((x) => x.key === current.key) ? m : [...m, current]))
      // Requeue the missed card a few positions later so it is retried in-round.
      const at = Math.min(index + 3, cards.length)
      nextCards = [...cards.slice(0, at), current, ...cards.slice(at)]
    }

    const delay = isCorrect ? 550 : 1000
    setTimeout(() => advance(nextCards, index + 1, nextCorrect, nextBest), delay)
  }, [current, feedback, correct, streak, best, cards, index, advance])

  // Countdown; a timeout counts as a miss.
  useEffect(() => {
    if (phase !== 'playing' || !current || feedback) return
    const id = setInterval(() => {
      setTimeLeft((t) => {
        const next = +(t - 0.1).toFixed(1)
        if (next <= 0) { resolve('\u0000__timeout__'); return 0 }
        return next
      })
    }, 100)
    return () => clearInterval(id)
  }, [phase, current, feedback, resolve])

  const pct = timeLimit ? Math.max(0, (timeLeft / timeLimit) * 100) : 0
  const urgent = timeLeft <= timeLimit * 0.3

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Zap className="text-violet-400 shrink-0" size={26} />
          <div>
            <h2 className="text-2xl font-bold text-white leading-tight">Speed Cards</h2>
            <p className="text-xs text-slate-400">Recognition drills that adapt to your misses</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="flex items-center justify-end gap-1.5 text-amber-300 text-sm font-semibold"><Trophy size={15} /> {highScore}</p>
          {weak > 0 && <p className="text-[11px] text-rose-300">{weak} weak {weak === 1 ? 'item' : 'items'}</p>}
        </div>
      </header>

      {phase === 'setup' && (
        <div className="rounded-2xl glass p-5 sm:p-6 card-glow space-y-6">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Deck</p>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTypeId(t.id)}
                  aria-pressed={typeId === t.id}
                  className={`px-3.5 py-2 rounded-full text-sm font-medium transition ${typeId === t.id ? 'bg-violet-600 text-white' : 'bg-bun-800 text-slate-300 hover:text-white border border-bun-600/40'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">JLPT level</p>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  onClick={() => toggleLevel(lv)}
                  aria-pressed={levels.includes(lv)}
                  className={`px-3.5 py-2 rounded-full text-sm font-medium transition ${levels.includes(lv) ? 'bg-cyan-600 text-white' : 'bg-bun-800 text-slate-300 hover:text-white border border-bun-600/40'}`}
                >
                  {lv}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Seconds per card</p>
            <div className="flex flex-wrap gap-2">
              {TIMES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTimeLimit(t)}
                  aria-pressed={timeLimit === t}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition ${timeLimit === t ? 'bg-cyan-600 text-white' : 'bg-bun-800 text-slate-300 border border-bun-600/40'}`}
                >
                  <Clock size={14} /> {t}s
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              {loading ? <><Loader2 size={13} className="animate-spin" /> loading deck…</> : <><Target size={13} /> {pool.length.toLocaleString()} cards available</>}
            </p>
            <button
              onClick={start}
              disabled={pool.length < 4}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold transition"
            >
              <Play size={18} /> Start
            </button>
          </div>
          {pool.length > 0 && pool.length < 4 && <p className="text-xs text-rose-300">Not enough cards in this selection — pick another deck or level.</p>}
        </div>
      )}

      {phase === 'playing' && current && (
        <div className={`rounded-2xl glass p-5 sm:p-6 card-glow space-y-5 ${feedback === 'wrong' ? 'animate-shake' : ''} ${feedback === 'correct' ? 'animate-pop' : ''}`}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">{index + 1} / {cards.length}</span>
            <span className="flex items-center gap-1 text-amber-300 font-semibold"><Flame size={14} /> {streak}</span>
            <span className="text-emerald-300 font-semibold">{score}</span>
          </div>

          <div className="h-2 w-full bg-bun-900 rounded-full overflow-hidden" role="timer" aria-label="Time remaining">
            <div
              className={`h-full rounded-full transition-[width] duration-100 ease-linear ${urgent ? 'bg-rose-500' : 'bg-gradient-to-r from-violet-500 to-cyan-400'}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="text-center animate-slide-up py-2">
            <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">
              {current.hint}{current.level ? ` · ${current.level}` : ''}
            </p>
            <h3 className="text-5xl sm:text-6xl font-bold text-white break-all leading-tight">{current.prompt}</h3>
          </div>

          <div className="grid gap-2.5">
            {current.options.map((opt, i) => {
              const revealed = feedback !== null
              const isAnswer = opt === current.answer
              const isPicked = opt === picked
              let state = 'bg-bun-800 border-bun-600/40 text-slate-200 hover:border-violet-500/60 hover:bg-bun-700'
              if (revealed && isAnswer) state = 'bg-emerald-500/20 border-emerald-500 text-emerald-100 animate-pulse-glow'
              else if (revealed && isPicked) state = 'bg-rose-500/20 border-rose-500 text-rose-100'
              else if (revealed) state = 'bg-bun-800 border-bun-600/30 text-slate-500'
              return (
                <button
                  key={`${current.key}-${i}`}
                  onClick={() => resolve(opt)}
                  disabled={revealed}
                  className={`w-full text-left px-4 py-3.5 rounded-xl border-2 font-medium transition flex items-center gap-2.5 min-h-[52px] ${state}`}
                >
                  <span className="text-xs text-slate-500 shrink-0">{String.fromCharCode(65 + i)}</span>
                  <span className="break-words">{opt}</span>
                </button>
              )
            })}
          </div>

          {feedback === 'wrong' && (
            <p className="text-center text-sm text-slate-300 animate-slide-up">
              <span className="text-white font-semibold">{current.prompt}</span>
              {current.entry.reading && current.entry.reading !== current.prompt && <span className="text-cyan-300"> ({current.entry.reading})</span>}
              {' — '}{current.entry.meaning}
            </p>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="rounded-2xl glass p-5 sm:p-6 card-glow space-y-5 animate-slide-up">
          <h3 className="text-2xl font-bold text-white text-center">Round complete</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
            {[
              { label: 'Score', value: score, cls: 'text-violet-300' },
              { label: 'Correct', value: `${correct}/${cards.length}`, cls: 'text-emerald-300' },
              { label: 'Missed', value: missed.length, cls: 'text-rose-300' },
              { label: 'Best streak', value: best, cls: 'text-amber-300' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-bun-800 p-3">
                <p className="text-[11px] text-slate-400">{s.label}</p>
                <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {missed.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-300">Review these — they will come back sooner:</p>
              <ul className="max-h-56 overflow-y-auto rounded-xl bg-bun-900/70 divide-y divide-bun-700/40">
                {missed.map((m) => (
                  <li key={m.key} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-white font-semibold shrink-0">{m.prompt}</span>
                    <span className="text-slate-400 text-right">
                      {m.entry.reading && m.entry.reading !== m.prompt && <span className="text-cyan-300">{m.entry.reading} · </span>}
                      {m.entry.meaning}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 justify-center">
            <button onClick={start} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold transition">
              <RotateCcw size={17} /> Play again
            </button>
            <button onClick={() => setPhase('setup')} className="px-6 py-3 rounded-xl bg-bun-800 border border-bun-600/40 text-slate-300 hover:text-white font-medium transition">
              Change deck
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
