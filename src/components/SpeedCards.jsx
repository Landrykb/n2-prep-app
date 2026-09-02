import { useCallback, useEffect, useMemo, useState } from 'react'
import { studyItems } from '../lib/findStudyItem.js'
import { bjtVocab } from '../data/bjt.js'
import { Zap, Clock, Flame, Play, RotateCcw, CheckCircle2, Trophy } from 'lucide-react'

const MODES = [
  { id: 'mixed', label: 'Mixed', icon: Zap },
  { id: 'kanji', label: 'Kanji', icon: Trophy },
  { id: 'vocab', label: 'Vocab', icon: Flame },
  { id: 'grammar', label: 'Grammar', icon: CheckCircle2 },
  { id: 'bjt', label: 'BJT', icon: Flame },
]

const TIMES = [3, 4, 5, 6, 8, 10]
const ROUNDS = 25

const allItems = [
  ...studyItems,
  ...bjtVocab.map((v) => ({ ...v, _key: v.word, _type: 'BJT' })),
]

function getPrompt(item) {
  return item._key || item.word || item.pattern || item.char || ''
}

function getMeanings(item) {
  return (item.meaning || item.meaningFr || item.scene || '').toString().split(/[,;/]/).map((s) => s.trim()).filter(Boolean)
}

function getPrimaryMeaning(item) {
  return getMeanings(item)[0] || '—'
}

function getReading(item) {
  if (item._type === 'Kanji') {
    const on = item.on || ''
    const kun = item.kun || ''
    return on ? on.split(/[,・]/)[0] : (kun ? kun.split(/[,・]/)[0] : '')
  }
  return item.reading || item.on || ''
}

function buildQuestion(item, pool) {
  const hasReading = ['Kanji', 'Vocab', 'Common', 'Glossary', 'BJT'].includes(item._type) && getReading(item)
  const askReading = hasReading && Math.random() > 0.55

  const prompt = getPrompt(item)
  if (askReading) {
    const answer = getReading(item)
    const distractors = pool
      .filter((p) => p !== item)
      .map((p) => getReading(p))
      .filter((r) => r && r !== answer)
    const options = [...new Set(distractors)].slice(0, 3)
    while (options.length < 3) options.push(distractors[options.length % distractors.length] || answer)
    const all = [answer, ...options].sort(() => Math.random() - 0.5)
    return { prompt, type: 'reading', answer, options: all, item }
  }

  const answer = getPrimaryMeaning(item)
  const distractors = pool
    .filter((p) => p !== item)
    .map((p) => getPrimaryMeaning(p))
    .filter((m) => m && m !== answer)
  const options = [...new Set(distractors)].slice(0, 3)
  while (options.length < 3) options.push(options[0] || answer)
  const all = [answer, ...options].sort(() => Math.random() - 0.5)
  return { prompt, type: 'meaning', answer, options: all, item }
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5)
}

export default function SpeedCards() {
  const [mode, setMode] = useState('mixed')
  const [timeLimit, setTimeLimit] = useState(5)
  const [started, setStarted] = useState(false)
  const [gameOver, setGameOver] = useState(false)
  const [cards, setCards] = useState([])
  const [index, setIndex] = useState(0)
  const [timeLeft, setTimeLeft] = useState(timeLimit)
  const [feedback, setFeedback] = useState(null) // 'correct' | 'wrong' | null
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [wrong, setWrong] = useState(0)
  const [wrongItems, setWrongItems] = useState([])
  const [highScore, setHighScore] = useState(() => Number(localStorage.getItem('n2:speed-high') || 0))

  const pool = useMemo(() => {
    if (mode === 'mixed') return allItems
    if (mode === 'bjt') return allItems.filter((i) => i._type === 'BJT')
    return allItems.filter((i) => i._type.toLowerCase() === mode)
  }, [mode])

  const start = () => {
    const base = shuffle(pool).slice(0, ROUNDS)
    const questions = base.map((item) => buildQuestion(item, pool))
    setCards(questions)
    setIndex(0)
    setCorrect(0)
    setWrong(0)
    setStreak(0)
    setBestStreak(0)
    setWrongItems([])
    setFeedback(null)
    setTimeLeft(timeLimit)
    setStarted(true)
    setGameOver(false)
  }

  const current = cards[index]

  const finish = useCallback(() => {
    setStarted(false)
    setGameOver(true)
    const score = correct * 10 + Math.max(0, bestStreak - 3) * 5
    if (score > highScore) {
      setHighScore(score)
      localStorage.setItem('n2:speed-high', score.toString())
    }
  }, [correct, bestStreak, highScore])

  const next = useCallback((newCards, newIndex) => {
    const idx = newIndex ?? index + 1
    if (idx >= newCards.length) {
      finish()
      return
    }
    setIndex(idx)
    setCards(newCards)
    setFeedback(null)
    setTimeLeft(timeLimit)
  }, [finish, index, timeLimit])

  const handleTimeout = useCallback(() => {
    if (feedback) return
    const ci = wrongItems.findIndex((w) => w.prompt === current.prompt)
    const updatedWrong = [...wrongItems]
    if (ci === -1) updatedWrong.push({ ...current, misses: 1 })
    else updatedWrong[ci].misses = (updatedWrong[ci].misses || 0) + 1
    setWrongItems(updatedWrong)
    setWrong((w) => w + 1)
    setStreak(0)
    setFeedback('wrong')
    setTimeout(() => next(cards), 900)
  }, [feedback, current, wrongItems, cards, next])

  useEffect(() => {
    if (!started || gameOver || !current || feedback) return
    const timer = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 0.1) {
          handleTimeout()
          return 0
        }
        return +(t - 0.1).toFixed(2)
      })
    }, 100)
    return () => clearInterval(timer)
  }, [started, gameOver, current, feedback, handleTimeout])

  const choose = (option) => {
    if (feedback || !current) return
    const isCorrect = option === current.answer
    if (isCorrect) {
      setCorrect((c) => c + 1)
      setStreak((s) => {
        const ns = s + 1
        if (ns > bestStreak) setBestStreak(ns)
        return ns
      })
      setFeedback('correct')
      setTimeout(() => next(cards), 600)
    } else {
      const wrongIndex = wrongItems.findIndex((w) => w.prompt === current.prompt)
      const updatedWrong = [...wrongItems]
      if (wrongIndex === -1) updatedWrong.push({ ...current, misses: 1 })
      else updatedWrong[wrongIndex].misses = (updatedWrong[wrongIndex].misses || 0) + 1
      setWrongItems(updatedWrong)
      setWrong((w) => w + 1)
      setStreak(0)
      setFeedback('wrong')

      // Re-insert missed card two cards ahead to repeat it
      const reinsert = { ...current, answer: current.answer }
      const pos = Math.min(index + 3, cards.length)
      const newCards = [...cards.slice(0, pos), reinsert, ...cards.slice(pos)]
      setTimeout(() => next(newCards, index + 1), 1100)
    }
  }

  const progress = timeLimit ? ((timeLeft / timeLimit) * 100) : 0
  const score = correct * 10 + Math.max(0, bestStreak - 3) * 5

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Zap className="text-violet-400" size={26} />
          <div>
            <h2 className="text-2xl font-bold text-white">Speed Cards</h2>
            <p className="text-xs text-slate-400">Blitz through kanji, vocab and grammar</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-amber-300 text-sm font-medium">
          <Trophy size={16} /> {highScore}
        </div>
      </div>

      {!started && !gameOver && (
        <div className="rounded-2xl glass p-6 card-glow space-y-6 text-center">
          <div>
            <p className="text-sm text-slate-300 mb-4">Choose a mode and timer, then tap as fast as you can.</p>
            <div className="flex flex-wrap justify-center gap-2 mb-4">
              {MODES.map((m) => {
                const Icon = m.icon
                return (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition ${
                      mode === m.id ? 'bg-violet-600 text-white' : 'bg-bun-800 text-slate-300 hover:text-white border border-bun-600/40'
                    }`}
                  >
                    <Icon size={16} /> {m.label}
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap justify-center gap-2 mb-2">
              {TIMES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTimeLimit(t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                    timeLimit === t ? 'bg-cyan-600 text-white' : 'bg-bun-800 text-slate-300 border border-bun-600/40'
                  }`}
                >
                  <Clock size={14} /> {t}s
                </button>
              ))}
            </div>
          </div>
          <button onClick={start} className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold transition animate-pop">
            <Play size={20} /> Start Blitz
          </button>
        </div>
      )}

      {started && current && (
        <div className={`rounded-2xl glass p-6 card-glow space-y-5 text-center ${feedback === 'wrong' ? 'animate-shake' : ''} ${feedback === 'correct' ? 'animate-pop' : ''}`}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">{index + 1}/{cards.length}</span>
            <span className="flex items-center gap-1 text-amber-300 font-medium"><Flame size={14} /> {streak}</span>
            <span className="text-emerald-300 font-medium">{correct} ✓</span>
          </div>

          <div className="h-2 w-full bg-bun-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="animate-slide-up">
            <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">{current.type === 'reading' ? 'Reading' : 'Meaning'}</p>
            <h3 className="text-5xl sm:text-7xl font-bold text-white mb-2 break-all">{current.prompt}</h3>
            {current.item._type === 'Kanji' && current.type === 'reading' && (
              <p className="text-xs text-slate-500">Choose the <span className="text-cyan-300">on</span> or <span className="text-cyan-300">kun</span> reading</p>
            )}
          </div>

          <div className="grid gap-3">
            {current.options.map((opt, i) => {
              const isAnswer = opt === current.answer
              const selected = feedback !== null
              const base = 'w-full text-left px-4 py-4 rounded-xl border-2 font-medium transition flex items-center gap-2'
              const state = selected
                ? isAnswer
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200 animate-pulse-glow'
                  : 'bg-bun-800 border-bun-600/40 text-slate-400 opacity-60'
                : 'bg-bun-800 border-bun-600/40 text-slate-200 hover:border-violet-500/60 hover:bg-bun-700'
              return (
                <button
                  key={i}
                  onClick={() => choose(opt)}
                  disabled={selected}
                  className={`${base} ${state}`}
                >
                  <span className="text-slate-500 text-sm">{String.fromCharCode(65 + i)}.</span>
                  {opt}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {gameOver && (
        <div className="rounded-2xl glass p-6 card-glow space-y-5 text-center">
          <h3 className="text-2xl font-bold text-white">Round Complete</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-bun-800 p-3">
              <p className="text-xs text-slate-400">Score</p>
              <p className="text-2xl font-bold text-violet-300">{score}</p>
            </div>
            <div className="rounded-xl bg-bun-800 p-3">
              <p className="text-xs text-slate-400">Correct</p>
              <p className="text-2xl font-bold text-emerald-300">{correct}</p>
            </div>
            <div className="rounded-xl bg-bun-800 p-3">
              <p className="text-xs text-slate-400">Wrong / Missed</p>
              <p className="text-2xl font-bold text-rose-300">{wrong}</p>
            </div>
            <div className="rounded-xl bg-bun-800 p-3">
              <p className="text-xs text-slate-400">Best Streak</p>
              <p className="text-2xl font-bold text-amber-300">{bestStreak}</p>
            </div>
          </div>

          {wrongItems.length > 0 && (
            <div className="text-left space-y-2">
              <p className="text-sm text-slate-300 font-medium">Items to review:</p>
              <div className="max-h-48 overflow-y-auto rounded-xl bg-bun-900 p-3 space-y-2 text-sm">
                {wrongItems.map((w, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-bun-700/40 pb-1 last:border-0">
                    <span className="text-white font-medium">{w.prompt}</span>
                    <span className="text-slate-400">{w.answer}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={start} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold transition">
            <RotateCcw size={18} /> Play Again
          </button>
        </div>
      )}
    </div>
  )
}
