import { useEffect, useMemo, useState } from 'react'
import {
  ClipboardCheck, Clock, Flag, ChevronRight, ChevronLeft, Coffee,
  CheckCircle2, XCircle, RotateCcw, Bot, AlertTriangle, Headphones, Timer,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth.js'
import { buildMockExam, flattenSection, scoreExam, TYPE_LABEL, MOCK_LENGTHS } from '../lib/mockExam.js'
import { loadDictionary } from '../lib/dictionary.js'
import { loadDiagnosis } from '../lib/profile.js'

const MOCK_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1']
import { loadMockHistory, saveMockAttempt } from '../lib/mockStore.js'
import { setAiPrefill } from '../lib/aiPrefill.js'
import { addErrorLog } from '../lib/supabaseApi.js'
import { recordMetric } from '../lib/metrics.js'
import { userKey } from '../lib/userKey.js'
import KanjiTapText from './KanjiTapText.jsx'
import TtsButton from './TtsButton.jsx'

const SESSION_KEY = 'n2:mock-session'

// Module-scope wrappers: the React purity lint only allows Date.now() /
// Math.random() outside render scope.
const nowMs = () => Date.now()
const newSeed = () => Math.floor(Math.random() * 2147483647)
const secLeft = (deadline) => Math.max(0, Math.round((deadline - nowMs()) / 1000))

// Where "Practice this" sends each weak question type.
const PRACTICE_TAB = {
  '漢字読み': 'drills',
  '表記': 'drills',
  '文脈規定・言い換え': 'drills',
  '文法形式': 'lessons',
  '文の組み立て': 'drills',
  '読解': 'reading',
  '聴解': 'n2listening',
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s?.exam?.sections) return null
    return s
  } catch {
    return null
  }
}

function fmtClock(sec) {
  const m = Math.floor(Math.max(0, sec) / 60)
  const s = Math.max(0, sec) % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function MockExam({ setActive }) {
  const { user } = useAuth()
  const [session, setSession] = useState(loadSession)
  const [result, setResult] = useState(null)
  // P1-3: the paper is built at the learner's diagnosed level (changeable
  // here), with the level-tagged deck loaded for its word banks.
  const [level, setLevel] = useState(() => loadDiagnosis()?.jlptEstimate || 'N2')
  const [dict, setDict] = useState(null)
  useEffect(() => { let cancelled = false; loadDictionary().then((d) => { if (!cancelled) setDict(d) }).catch(() => {}); return () => { cancelled = true } }, [])
  const [history, setHistory] = useState([])
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [remaining, setRemaining] = useState(() => {
    const s = loadSession()
    return s?.deadline ? secLeft(s.deadline) : 0
  })

  useEffect(() => {
    let cancelled = false
    loadMockHistory(user).then((h) => { if (!cancelled) setHistory(h) })
    return () => { cancelled = true }
  }, [user])

  // Persist the in-progress attempt so a refresh resumes instead of losing it.
  useEffect(() => {
    try {
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
      else sessionStorage.removeItem(SESSION_KEY)
    } catch { /* storage unavailable */ }
  }, [session])

  const section = session?.phase === 'section' ? session.exam.sections[session.sectionIndex] : null
  const flat = useMemo(() => (section ? flattenSection(section) : []), [section])

  const submitSection = (auto = false) => {
    if (!session) return
    setConfirmSubmit(false)
    if (session.sectionIndex < session.exam.sections.length - 1) {
      setSession((s) => ({ ...s, phase: 'break', deadline: null }))
      return
    }
    finish(auto)
  }

  const finish = (auto) => {
    const scored = scoreExam(session.exam, session.answers)
    const attempt = {
      id: `mock-${nowMs()}`,
      date: new Date().toISOString(),
      length: session.length,
      level: session.exam.level || 'N2',
      scaled: scored.scaled,
      passed: scored.passed,
      byType: scored.byType,
      durationSec: Math.round((nowMs() - session.startedAt) / 1000),
      auto,
    }
    saveMockAttempt(user, attempt).then(setHistory)
    // The promise's Day-30/Day-55 mock gates can only be checked if
    // a finished mock leaves a trace outside its own local history
    // (integration audit #12): one metric, the same shape the other
    // gate events use.
    recordMetric('mock_completed', { level: attempt.level, scaled: attempt.scaled, passed: attempt.passed, length: attempt.length })
    logWrongAnswers(scored.wrong)
    setResult({ ...scored, exam: session.exam, answers: session.answers, attempt })
    setSession(null)
  }

  // Wrong answers feed the same error log as Drills, keyed by 問題 name.
  const logWrongAnswers = (wrong) => {
    const localRaw = !user ? localStorage.getItem(userKey(user, 'error-log')) : null
    const localLogs = localRaw ? JSON.parse(localRaw) : []
    for (const { question: q, group, selected } of wrong) {
      const correct = q.options.find((o) => o.correct)
      const entry = {
        section: group.name,
        mistake: q.target ? `${q.target} — ${q.prompt}` : q.prompt,
        cause: selected !== undefined ? `Chose: ${q.options[selected]?.label}` : 'Unanswered',
        fix: `Correct: ${correct?.label || ''}${q.explanation ? `. ${q.explanation}` : ''}`.trim(),
        created_at: new Date().toISOString(),
        review_count: 0,
        next_review: (() => { const t = new Date(); t.setDate(t.getDate() + 1); return t.toISOString() })(),
      }
      if (user) {
        addErrorLog(user.id, entry)
      } else {
        localLogs.unshift({ id: nowMs() + localLogs.length, ...entry })
      }
    }
    if (!user) localStorage.setItem(userKey(user, 'error-log'), JSON.stringify(localLogs))
  }

  // Countdown driven off an absolute deadline so refresh keeps the real time.
  useEffect(() => {
    if (session?.phase !== 'section' || !session.deadline) return
    const t = setInterval(() => {
      const left = secLeft(session.deadline)
      setRemaining(left)
      if (left <= 0) submitSection(true)
    }, 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const startExam = (length) => {
    const seed = newSeed()
    const exam = buildMockExam(length, seed, { level, dict })
    setResult(null)
    const deadline = nowMs() + exam.sections[0].timeMin * 60000
    setRemaining(secLeft(deadline))
    setSession({
      exam, length,
      phase: 'section',
      sectionIndex: 0,
      qIndex: 0,
      answers: {},
      marks: [],
      startedAt: nowMs(),
      deadline,
    })
  }

  const startListening = () => {
    const next = session.sectionIndex + 1
    const deadline = nowMs() + session.exam.sections[next].timeMin * 60000
    setRemaining(secLeft(deadline))
    setSession((s) => ({
      ...s,
      phase: 'section',
      sectionIndex: next,
      qIndex: 0,
      deadline,
    }))
  }

  const abandon = () => {
    setSession(null)
    setConfirmSubmit(false)
  }

  const askAi = (q, group, selected) => {
    const correct = q.options.find((o) => o.correct)
    const lines = [
      'I just took a JLPT mock exam. Please explain this question.',
      `Section: ${group.name}`,
      `Question: ${q.prompt}`,
      q.target ? `Target: ${q.target}` : null,
      `Options: ${q.options.map((o, i) => `${i + 1}. ${o.label}`).join(' / ')}`,
      selected !== undefined ? `I chose: ${q.options[selected]?.label}` : 'I left it unanswered',
      `Correct answer: ${correct?.label}`,
      'Why is the correct answer right, and why is mine wrong? Keep it concise.',
    ].filter(Boolean)
    setAiPrefill(lines.join('\n'))
    setActive('ai')
  }

  // ---------- start screen ----------
  if (!session && !result) {
    const last = history[0]
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Mock Exam</h2>
          <p className="text-sm text-slate-400 mt-1">
            A timed, JLPT-format paper at your level, built from your study bank. No feedback until the end — just like the real thing.
          </p>
        </div>
        <div className="rounded-2xl glass p-5 card-glow space-y-3">
          <p className="text-xs text-slate-400 uppercase tracking-wider">Paper level {loadDiagnosis() ? '— from your diagnosis, change it if you are training up' : '— run Diagnosis and this starts at your level'}</p>
          <div className="flex flex-wrap gap-2">
            {MOCK_LEVELS.map((l) => (
              <button key={l} onClick={() => setLevel(l)} className={`px-4 py-2 rounded-xl text-sm font-semibold border transition ${level === l ? 'bg-[#FF6B57] text-white border-[#FF6B57]' : 'bg-bun-700/50 text-slate-300 border-bun-600/30 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          {!dict && <p className="text-xs text-slate-500">Loading the level word banks… a paper started now would fall back to the built-in bank and say so on the paper.</p>}
          {level !== 'N2' && <p className="text-xs text-amber-200/90">Honest note for {level}: vocabulary, kanji and listening come from the {level} banks. Grammar, sentence structure and reading passages are estimated from the N2 bank — the only written grammar/passage bank in the app — and the paper labels them as estimates. Nothing is silently faked.</p>}
        </div>
        {last && (
          <div className="rounded-2xl glass p-5 card-glow flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider">Last attempt · {new Date(last.date).toLocaleDateString()}</p>
              <p className="text-2xl font-bold text-white mt-1">{last.scaled?.total ?? '—'}<span className="text-sm text-slate-400 font-normal"> / 180 est.</span></p>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${last.passed ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border-rose-500/30'}`}>
              {last.passed ? 'Pass estimate' : 'Below pass line'}
            </span>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-5">
          {Object.entries(MOCK_LENGTHS).map(([key, m]) => (
            <button key={key} onClick={() => startExam(key)} className="text-left rounded-3xl glass p-6 card-glow hover:border-[#FF6B57]/40 transition group">
              <div className="w-11 h-11 rounded-xl bg-[#71368A]/15 text-[#C39BD3] border border-[#71368A]/30 flex items-center justify-center mb-4">
                <ClipboardCheck size={22} />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">{m.label}</h3>
              <p className="text-sm text-slate-400 mb-4">{m.desc}</p>
              <ul className="text-xs text-slate-400 space-y-1.5 mb-4">
                <li className="flex items-center gap-2"><Timer size={12} className="text-[#FF8A75]" /> Section A 言語知識・読解 — {m.timeA} min</li>
                <li className="flex items-center gap-2"><Headphones size={12} className="text-[#FF8A75]" /> Section B 聴解 — {m.timeB} min</li>
              </ul>
              <span className="inline-flex items-center gap-1 text-sm font-medium text-[#FF8A75] group-hover:translate-x-0.5 transition">
                Start <ChevronRight size={16} />
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 text-center">Progress is saved in this tab — a refresh will not lose your attempt.</p>
        <p className="text-xs text-slate-500 text-center">Furigana and kanji lookup are disabled during the test, like the real exam.</p>
      </div>
    )
  }

  // ---------- break between sections ----------
  if (session?.phase === 'break') {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 animate-fade-in">
        <div className="w-20 h-20 mx-auto rounded-full bg-bun-700 flex items-center justify-center mb-6"><Coffee size={32} className="text-amber-300" /></div>
        <h2 className="text-2xl font-bold text-white mb-2">Section A complete</h2>
        <p className="text-slate-400 mb-8">Take a breath. Section B is 聴解 (listening) — {session.exam.sections[session.sectionIndex + 1].timeMin} minutes. Audio can be replayed in this practice mock.</p>
        <div className="flex justify-center gap-4">
          <button onClick={startListening} className="px-6 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium transition">Start Listening Section</button>
          <button onClick={abandon} className="px-6 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-300 font-medium transition">Abandon</button>
        </div>
      </div>
    )
  }

  // ---------- results ----------
  if (result) {
    return <ResultsView result={result} setActive={setActive} askAi={askAi} onRetake={() => setResult(null)} />
  }

  // ---------- section runner ----------
  const q = flat[session.qIndex]
  const group = q?._group
  const answeredCount = flat.filter((x) => session.answers[x.id] !== undefined).length
  const timerCls = remaining < 60 ? 'text-rose-300 border-rose-500/40 bg-rose-500/10' : remaining < 300 ? 'text-amber-300 border-amber-500/40 bg-amber-500/10' : 'text-slate-200 border-bun-600/40 bg-bun-700/50'

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Section {section.id} · {section.name}</h2>
          <p className="text-xs text-slate-500">{answeredCount} / {flat.length} answered</p>
        </div>
        <div className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border font-mono font-bold ${timerCls}`}>
          <Clock size={16} /> {fmtClock(remaining)}
        </div>
      </div>

      <div className="h-2 w-full rounded-full bg-bun-700 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-[#71368A] to-cyan-500 transition-all" style={{ width: `${(answeredCount / flat.length) * 100}%` }} />
      </div>

      {/* question grid */}
      <div className="flex flex-wrap gap-1.5">
        {flat.map((x, i) => {
          const answered = session.answers[x.id] !== undefined
          const marked = session.marks.includes(x.id)
          return (
            <button
              key={x.id}
              onClick={() => setSession((s) => ({ ...s, qIndex: i }))}
              className={`w-8 h-8 rounded-lg text-xs font-semibold border transition relative ${
                i === session.qIndex ? 'bg-[#FF6B57] text-white border-[#FF6B57]'
                : answered ? 'bg-bun-700 text-slate-200 border-bun-600/40'
                : 'bg-bun-800 text-slate-500 border-bun-600/30 hover:border-[#FF6B57]/40'
              }`}
            >
              {i + 1}
              {marked && <Flag size={8} className="absolute -top-1 -right-1 text-amber-400" fill="currentColor" />}
            </button>
          )
        })}
      </div>

      <div className="rounded-3xl glass p-6 sm:p-8 card-glow">
        <div className="flex items-center justify-between mb-1 gap-3">
          <span className="text-sm font-semibold text-[#FF8A75]">{group.name}</span>
          <span className="text-xs text-slate-500">{session.qIndex + 1} / {flat.length}</span>
        </div>
        {group.intro && <p lang="ja" className="text-xs text-slate-500 mb-4">{group.intro}</p>}

        {group.passage && (
          <div className="rounded-2xl bg-bun-700/40 border border-bun-600/20 p-5 mb-5 leading-loose text-slate-100">
            <p className="text-xs text-slate-400 mb-2">{group.passage.title}</p>
            <p lang="ja" className="leading-loose whitespace-pre-wrap">{group.passage.text}</p>
          </div>
        )}
        {group.listening && (
          <div className="rounded-2xl bg-bun-700/40 border border-bun-600/20 p-5 mb-5">
            <div className="flex items-center gap-3 flex-wrap">
              <TtsButton text={group.listening.script} audioSrc={group.listening.audio || null} className="px-3 py-2 text-sm font-medium" />
              <div>
                <p className="text-sm font-medium text-slate-200">{group.listening.title}</p>
                <p className="text-[11px] text-slate-500">Replays allowed in this practice mock — the real exam plays audio only once or twice.</p>
              </div>
            </div>
          </div>
        )}

        {/* Plain text during the exam — no furigana or kanji lookup, matching the real test. */}
        <div className="rounded-2xl bg-bun-700/40 border border-bun-600/20 p-5 mb-5">
          <p lang="ja" className="text-lg text-slate-100 leading-relaxed whitespace-pre-wrap">{q.prompt}</p>
          {q.target && <p lang="ja" className="text-sm text-[#FF8A75] mt-3">Target: 「{q.target}」</p>}
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-5">
          {q.options.map((opt, i) => {
            const chosen = session.answers[q.id] === i
            return (
              <button
                key={i}
                onClick={() => setSession((s) => ({ ...s, answers: { ...s.answers, [q.id]: i } }))}
                className={`w-full text-left px-4 py-3.5 rounded-xl border transition font-medium ${
                  chosen ? 'bg-[#FF6B57]/20 border-[#FF6B57]/60 text-[#FFD9D2]' : 'bg-bun-700/50 border-bun-600/30 text-slate-100 hover:border-[#FF6B57]/50 hover:bg-bun-700'
                }`}
              >
                <span className="text-slate-500 mr-2">{i + 1}.</span><span lang="ja">{opt.label}</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={() => setSession((s) => ({ ...s, marks: s.marks.includes(q.id) ? s.marks.filter((m) => m !== q.id) : [...s.marks, q.id] }))}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition ${session.marks.includes(q.id) ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-bun-700/40 border-bun-600/30 text-slate-400 hover:text-white'}`}
          >
            <Flag size={13} /> {session.marks.includes(q.id) ? 'Marked for review' : 'Mark for review'}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSession((s) => ({ ...s, qIndex: Math.max(0, s.qIndex - 1) }))}
              disabled={session.qIndex === 0}
              className="px-4 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 text-sm font-medium transition disabled:opacity-40 flex items-center gap-1"
            >
              <ChevronLeft size={15} /> Prev
            </button>
            <button
              onClick={() => setSession((s) => ({ ...s, qIndex: Math.min(flat.length - 1, s.qIndex + 1) }))}
              disabled={session.qIndex >= flat.length - 1}
              className="px-4 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 text-sm font-medium transition disabled:opacity-40 flex items-center gap-1"
            >
              Next <ChevronRight size={15} />
            </button>
            <button onClick={() => setConfirmSubmit(true)} className="px-4 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-medium transition">
              Submit section
            </button>
          </div>
        </div>
      </div>

      {confirmSubmit && (
        <div className="fixed inset-0 z-50 bg-bun-900/90 flex items-center justify-center p-4" onClick={() => setConfirmSubmit(false)}>
          <div className="rounded-3xl glass p-6 card-glow max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Submit Section {section.id}?</h3>
            <p className="text-sm text-slate-400 mb-5">
              {flat.length - answeredCount > 0
                ? `${flat.length - answeredCount} question${flat.length - answeredCount === 1 ? ' is' : 's are'} still unanswered. You cannot return after submitting.`
                : 'All questions answered. You cannot return after submitting.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => submitSection(false)} className="flex-1 px-4 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-medium transition">Submit</button>
              <button onClick={() => setConfirmSubmit(false)} className="flex-1 px-4 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 text-sm font-medium transition">Keep Working</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ScoreBar({ label, value, max = 60 }) {
  const pct = Math.round((value / max) * 100)
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-200 font-semibold">{value} / {max}</span>
      </div>
      <div className="h-2.5 rounded-full bg-bun-700 overflow-hidden">
        <div className={`h-full rounded-full ${value >= 19 ? 'bg-gradient-to-r from-[#71368A] to-cyan-500' : 'bg-rose-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function ResultsView({ result, setActive, askAi, onRetake }) {
  const { scaled, passed, byType, wrong, exam, answers, attempt } = result
  const weak = Object.entries(byType)
    .map(([type, t]) => ({ type, ...t, pct: t.total ? Math.round((t.correct / t.total) * 100) : 0 }))
    .sort((a, b) => a.pct - b.pct)
  const worst = new Set(weak.slice(0, 2).map((w) => w.type))

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="rounded-3xl glass p-6 sm:p-8 card-glow text-center">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Estimated score — real JLPT uses IRT scaling</p>
        <p className="text-5xl font-bold text-white">{scaled.total}<span className="text-lg text-slate-400 font-normal"> / 180</span></p>
        <span className={`inline-block mt-3 text-xs font-semibold px-3 py-1 rounded-full border ${passed ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border-rose-500/30'}`}>
          {passed ? `Pass estimate (≥${result.passMark ?? 90} for ${exam.level || 'N2'} and ≥19 per section)` : `Below the pass line (need ≥${result.passMark ?? 90} for ${exam.level || 'N2'} and ≥19 per section)`}
        </span>
        <div className="grid sm:grid-cols-3 gap-5 mt-7 text-left">
          <ScoreBar label="Language Knowledge" value={scaled.lk} />
          <ScoreBar label="Reading" value={scaled.reading} />
          <ScoreBar label="Listening" value={scaled.listening} />
        </div>
        <p className="text-xs text-slate-500 mt-5">
          {MOCK_LENGTHS[attempt.length]?.label} · {exam.level || 'N2'} paper · {Math.floor(attempt.durationSec / 60)} min {attempt.durationSec % 60}s
        </p>
        {exam.meta?.estimated?.length > 0 && (
          <p className="text-xs text-amber-200/90 mt-3">Estimated sections in this paper: {exam.meta.estimated.map((e) => `${e.section} (from ${e.from})`).join(' · ')}</p>
        )}
        {exam.meta?.thin?.map((note, i) => <p key={i} className="text-xs text-amber-200/90 mt-1">{note}</p>)}
      </div>

      <div className="rounded-3xl glass p-6 card-glow">
        <h3 className="text-lg font-bold text-white mb-4">Weakness by question type</h3>
        <div className="space-y-4">
          {weak.map((w) => (
            <div key={w.type} className={worst.has(w.type) ? 'rounded-xl ring-1 ring-rose-500/40 p-3 -m-3 mb-1' : ''}>
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="text-sm text-slate-200">{w.type}{worst.has(w.type) && <AlertTriangle size={13} className="inline ml-1.5 text-rose-400" />}</span>
                <span className="text-xs text-slate-400">{w.correct}/{w.total} · {w.pct}%</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 rounded-full bg-bun-700 overflow-hidden">
                  <div className={`h-full rounded-full ${w.pct >= 70 ? 'bg-emerald-500' : w.pct >= 40 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${w.pct}%` }} />
                </div>
                {worst.has(w.type) && PRACTICE_TAB[w.type] && (
                  <button onClick={() => setActive(PRACTICE_TAB[w.type])} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium transition">
                    Practice this
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl glass p-6 card-glow">
        <h3 className="text-lg font-bold text-white mb-1">Review</h3>
        <p className="text-xs text-slate-500 mb-4">{wrong.length} missed or unanswered · wrong answers were added to your Error Log.</p>
        <div className="space-y-5">
          {exam.sections.map((section) => section.groups.map((group) => group.questions.map((q) => {
            const sel = answers[q.id]
            const ok = sel !== undefined && q.options[sel]?.correct
            const correct = q.options.find((o) => o.correct)
            return (
              <div key={q.id} className={`rounded-2xl border p-5 ${ok ? 'bg-bun-700/20 border-bun-600/20' : 'bg-rose-500/5 border-rose-500/20'}`}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {ok ? <CheckCircle2 size={15} className="text-emerald-400" /> : <XCircle size={15} className="text-rose-400" />}
                  <span className="text-xs font-semibold text-slate-400">{group.name} · {TYPE_LABEL[q.type]}</span>
                </div>
                {group.passage && <p className="text-[11px] text-slate-500 mb-1">Passage: {group.passage.title}</p>}
                {group.listening && (
                  <details className="mb-2">
                    <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-300">Transcript · {group.listening.title}</summary>
                    <div className="mt-1 rounded-lg bg-bun-700/40 p-3 text-xs leading-relaxed text-slate-300"><KanjiTapText text={group.listening.script} /></div>
                  </details>
                )}
                <p className="text-sm text-slate-100 mb-2"><KanjiTapText text={q.prompt} /></p>
                {q.target && <p className="text-xs text-[#FF8A75] mb-2">Target: 「<KanjiTapText text={q.target} />」</p>}
                <p className="text-xs mb-1">
                  <span className={ok ? 'text-emerald-300' : 'text-rose-300'}>
                    You: {sel !== undefined ? q.options[sel]?.label : '—'}
                  </span>
                  {!ok && <span className="text-slate-400"> · Correct: {correct?.label}</span>}
                </p>
                {q.explanation && <p className="text-xs text-slate-400 mb-2"><KanjiTapText text={q.explanation} /></p>}
                {!ok && (
                  <button onClick={() => askAi(q, group, sel)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#FF6B57]/20 text-[#FF8A75] hover:bg-[#FF6B57]/30 transition">
                    <Bot size={13} /> Ask AI to explain
                  </button>
                )}
              </div>
            )
          })))}
        </div>
      </div>

      <div className="flex justify-center gap-4">
        <button onClick={onRetake} className="px-6 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium transition flex items-center gap-2">
          <RotateCcw size={16} /> New mock
        </button>
        <button onClick={() => setActive('dashboard')} className="px-6 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 font-medium transition">
          Today
        </button>
        {/* The wrong answers just landed in the Error Log — the
            results page says so and gives it a door (audit P1-6). */}
        <button onClick={() => setActive('errors')} className="px-6 py-2.5 rounded-xl text-slate-400 hover:text-slate-200 font-medium transition">
          Review in Error Log
        </button>
      </div>
    </div>
  )
}
