import { useContext, useEffect, useMemo, useRef, useState, createContext } from 'react'
import {
  LayoutDashboard,
  BookOpen,
  Dumbbell,
  Map,
  AlertCircle,
  Flame,
  Brain,
  Eye,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Menu,
  Sparkles,
  BarChart3,
  Filter,
  Search,
  Layers,
  Library,
  Download,
  ExternalLink,
  User,
  LogOut,
  Bot,
  Loader2,
} from 'lucide-react'
import { useAuth } from './hooks/useAuth.js'
import AuthModal from './components/AuthModal.jsx'
import AiTutor from './components/AiTutor.jsx'
import { userKey } from './lib/userKey.js'
import { getErrorLogs, addErrorLog, deleteErrorLog, getUserProgress, setUserProgress } from './lib/supabaseApi.js'
import {
  scores,
  plan,
  readingTips,
  resources,
  kanjiLessons,
  grammarLessons,
  vocabLessons,
  passages,
  questions,
  ankiCards,
  commonWords,
} from './data.js'

const nav = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'lessons', label: 'Memory Lessons', icon: BookOpen },
  { id: 'drills', label: 'Drills', icon: Dumbbell },
  { id: 'anki', label: 'Anki Cards', icon: Layers },
  { id: 'reading', label: 'Daily Reading', icon: Eye },
  { id: 'ai', label: 'AI Tutor', icon: Bot },
  { id: 'plan', label: 'Study Plan', icon: Map },
  { id: 'resources', label: 'Resources', icon: Library },
  { id: 'errors', label: 'Error Log', icon: AlertCircle },
]

const ModeContext = createContext('beginner')

function Furigana({ text, glossary = [] }) {
  const mode = useContext(ModeContext)
  const all = useMemo(() => [...commonWords, ...glossary], [glossary])
  if (mode === 'mastery' || all.length === 0) return <span className="leading-loose">{text}</span>
  const sorted = [...all].sort((a, b) => b.word.length - a.word.length)
  const parts = []
  let rest = text
  while (rest.length > 0) {
    const match = sorted.find((g) => rest.startsWith(g.word))
    if (match) {
      parts.push({ type: 'g', ...match })
      rest = rest.slice(match.word.length)
    } else {
      let nextIndex = -1
      let nextMatch = null
      for (let i = 1; i < rest.length; i++) {
        const m = sorted.find((g) => rest.slice(i).startsWith(g.word))
        if (m) {
          nextIndex = i
          nextMatch = m
          break
        }
      }
      if (nextMatch) {
        if (nextIndex > 0) parts.push({ type: 't', text: rest.slice(0, nextIndex) })
        parts.push({ type: 'g', ...nextMatch })
        rest = rest.slice(nextIndex + nextMatch.word.length)
      } else {
        parts.push({ type: 't', text: rest })
        rest = ''
      }
    }
  }
  return (
    <span className="leading-loose">
      {parts.map((p, i) =>
        p.type === 't' ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span
            key={i}
            className="group relative inline-block cursor-help border-b border-dashed border-violet-500/40"
          >
            {p.word}
            <span className="absolute -top-16 left-1/2 -translate-x-1/2 bg-bun-800 border border-violet-500/30 rounded-lg px-3 py-2 text-xs text-slate-200 opacity-0 group-hover:opacity-100 transition pointer-events-none z-20 shadow-xl whitespace-nowrap">
              <span className="block text-cyan-300 font-medium text-sm">{p.reading}</span>
              <span className="block text-slate-300">{p.meaning}</span>
            </span>
          </span>
        )
      )}
    </span>
  )
}

function SelectionPopup({ dictionary }) {
  const [selected, setSelected] = useState(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const popupRef = useRef(null)

  useEffect(() => {
    const handle = (e) => {
      if (popupRef.current && popupRef.current.contains(e.target)) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setSelected(null)
        return
      }
      const text = selection.toString().trim()
      if (!text) {
        setSelected(null)
        return
      }
      const sortedDict = [...dictionary].sort((a, b) => b.word.length - a.word.length)
      const match =
        sortedDict.find((d) => d.word === text) ||
        sortedDict.find((d) => text.includes(d.word)) ||
        sortedDict.find((d) => d.word.includes(text)) ||
        null
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      setPos({ x: rect.left + rect.width / 2, y: rect.top })
      setSelected({ text, match })
    }
    document.addEventListener('mouseup', handle)
    return () => document.removeEventListener('mouseup', handle)
  }, [dictionary])

  if (!selected) return null

  return (
    <div
      ref={popupRef}
      className="fixed z-50 -translate-x-1/2 -translate-y-full bg-bun-800 border border-violet-500/40 rounded-2xl shadow-2xl p-4 min-w-[220px] max-w-[320px]"
      style={{ left: pos.x, top: pos.y - 8 }}
    >
      <div className="text-right">
        <button onClick={() => setSelected(null)} className="text-xs text-slate-500 hover:text-slate-300">Close</button>
      </div>
      {selected.match ? (
        <div className="flex items-start gap-3">
          <span className="text-3xl">{selected.match.image}</span>
          <div>
            <p className="text-lg font-bold text-white">{selected.match.word}</p>
            <p className="text-sm text-cyan-300">{selected.match.reading}</p>
            <p className="text-sm text-slate-300 mt-1">{selected.match.meaning}</p>
            <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded bg-bun-700 text-slate-400">{selected.match.type}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-300">
          No match found for “{selected.text}”.
          <br />
          <span className="text-slate-500">Select a single word, kanji, or phrase from the lessons.</span>
        </p>
      )}
    </div>
  )
}

function Gauge({ value }) {
  const r = 52
  const c = 2 * Math.PI * r
  const pct = Math.min(100, Math.max(0, value))
  const dash = c * (pct / 100)
  return (
    <div className="relative w-28 h-28 flex items-center justify-center">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="10" fill="none" />
        <circle
          cx="60"
          cy="60"
          r={r}
          stroke="url(#gaugeGradient)"
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <defs>
          <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute text-2xl font-bold text-white">{value}%</span>
    </div>
  )
}

function ProgressRing({ value, color }) {
  const r = 42
  const c = 2 * Math.PI * r
  const dash = c * (value / 100)
  const stroke =
    color === 'emerald' ? '#34d399' : color === 'rose' ? '#f87171' : color === 'amber' ? '#fbbf24' : '#a78bfa'
  return (
    <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} stroke="rgba(255,255,255,0.06)" strokeWidth="8" fill="none" />
        <circle cx="50" cy="50" r={r} stroke={stroke} strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} />
      </svg>
      <span className="absolute text-sm font-bold text-slate-100">{value}%</span>
    </div>
  )
}

function Badge({ children, color = 'violet' }) {
  const map = {
    rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    violet: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  }
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${map[color] || map.violet}`}>
      {children}
    </span>
  )
}

function Header({ active, setMobileOpen, streak, mode, setMode, user, onSignOut, isSupabaseConfigured }) {
  return (
    <header className="sticky top-0 z-10 bg-bun-900/80 backdrop-blur border-b border-bun-600/30 px-4 sm:px-8 py-4 flex items-center justify-between">
      <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 rounded-lg bg-bun-700 text-slate-200">
        <Menu size={20} />
      </button>
      <h2 className="text-lg font-semibold hidden sm:block">{nav.find((n) => n.id === active)?.label}</h2>
      <div className="flex items-center gap-4">
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium text-slate-100">N2 Candidate</p>
          <p className="text-xs text-slate-400">Next mock in 2 days</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-bun-700/50 border border-bun-600/30">
          <Flame size={16} className="text-orange-400" />
          <span className="text-sm font-bold text-orange-200">{streak}</span>
        </div>
        <div className="hidden sm:flex p-1 rounded-xl bg-bun-700/60 border border-bun-600/40">
          {['beginner', 'mastery'].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition capitalize ${mode === m ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {m}
            </button>
          ))}
        </div>
        {isSupabaseConfigured && (
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300" title={user?.email ?? ''}>
              <User size={14} />
              <span className="max-w-[120px] truncate">{user?.email ?? 'Guest'}</span>
            </div>
            {user && (
              <button
                onClick={onSignOut}
                className="p-2 rounded-lg bg-bun-700 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 transition"
                title="Sign out"
              >
                <LogOut size={18} />
              </button>
            )}
          </div>
        )}
        {!isSupabaseConfigured && (
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-500 to-violet-500 flex items-center justify-center text-sm font-bold shadow-md">
            N2
          </div>
        )}
      </div>
    </header>
  )
}

function Sidebar({ active, setActive, mobileOpen, setMobileOpen, streak }) {
  return (
    <>
      <aside className={`fixed z-30 top-0 left-0 h-full w-64 bg-bun-800 border-r border-bun-600/30 transform transition-transform lg:translate-x-0 lg:static flex flex-col ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 shrink-0">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-lg shadow-lg">🦝</div>
            <div>
              <h1 className="font-bold text-lg leading-tight">N2 Path</h1>
              <p className="text-xs text-slate-400">Bunpro-style mastery</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-6 pb-4 space-y-1.5">
          {nav.map((n) => {
            const Icon = n.icon
            return (
              <button
                key={n.id}
                onClick={() => { setActive(n.id); setMobileOpen(false) }}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium transition ${active === n.id ? 'bg-violet-500/15 text-violet-200 border border-violet-500/30' : 'text-slate-400 hover:text-slate-100 hover:bg-bun-700/60'}`}
              >
                <Icon size={18} /> {n.label}
              </button>
            )
          })}
        </nav>
        <div className="shrink-0 p-6 border-t border-bun-600/30">
          <div className="rounded-xl bg-bun-700/60 p-4 border border-bun-600/30">
            <div className="flex items-center gap-2 mb-2">
              <Flame size={16} className="text-orange-400" />
              <span className="text-sm font-semibold text-orange-200">{streak} day streak</span>
            </div>
            <p className="text-xs text-slate-400">Consistency beats intensity.</p>
          </div>
        </div>
      </aside>
      {mobileOpen && <div onClick={() => setMobileOpen(false)} className="fixed inset-0 bg-black/50 z-20 lg:hidden" />}
    </>
  )
}

function Dashboard({ streak, setActive }) {
  const total = 64
  const goal = 100
  const totalPct = Math.round((total / goal) * 100)

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 border border-violet-500/20 p-6 sm:p-10 card-glow">
        <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-3xl">🦝</span>
            <Badge color="emerald">Study session active</Badge>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">Crack the N2 pass wall.</h2>
          <p className="max-w-2xl text-slate-300 leading-relaxed mb-6">
            Your listening is solid. The mission now is to rebuild Vocabulary, Grammar, and Reading into a single, fast recognition engine. Visual memory + deliberate drills will carry you over the cutoff.
          </p>
          <div className="flex flex-wrap gap-4">
            <button onClick={() => setActive('lessons')} className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition shadow-lg shadow-violet-600/25">Continue Memory Lesson</button>
            <button onClick={() => setActive('drills')} className="px-5 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 font-medium transition">Start Drill</button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><BarChart3 size={20} className="text-violet-400" /> Performance Diagnostic</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {scores.map((s) => (
            <div key={s.id} className="rounded-2xl glass p-5 card-glow flex flex-col items-center text-center">
              <Gauge value={s.pct} color={s.color} />
              <p className="mt-3 text-sm font-medium text-slate-200">{s.name}</p>
              <p className="text-xs text-slate-400 mt-1">{s.raw} · cutoff {s.cutoff}</p>
              <div className="mt-3 flex items-center gap-2">
                <Badge color={s.status === 'passed' ? 'emerald' : s.id === 'total' ? 'amber' : 'rose'}>{s.status}</Badge>
                <span className="text-xs text-slate-400">Target: {s.target}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl glass p-6 card-glow">
          <h3 className="text-lg font-bold text-white mb-4">Total Progress to 100+ Points</h3>
          <div className="flex items-center gap-6">
            <ProgressRing value={totalPct} color="violet" />
            <div>
              <p className="text-2xl font-bold text-white">{total} / {goal}</p>
              <p className="text-sm text-slate-400 mt-1">You need ~{goal - total} more points for a safe cushion.</p>
              <div className="mt-3 h-2 w-48 rounded-full bg-bun-700 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: totalPct + '%' }} />
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl glass p-6 card-glow">
          <h3 className="text-lg font-bold text-white mb-4">Daily Goal</h3>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-3 text-slate-300"><CheckCircle2 size={16} className="text-emerald-400" /> 25 SRS cards reviewed</li>
            <li className="flex items-center gap-3 text-slate-300"><CheckCircle2 size={16} className="text-emerald-400" /> 1 grammar pattern mastered</li>
            <li className="flex items-center gap-3 text-slate-300"><div className="w-4 h-4 rounded-full border border-slate-500" /> 1 daily reading passage</li>
            <li className="flex items-center gap-3 text-slate-300"><div className="w-4 h-4 rounded-full border border-slate-500" /> Log 3 errors</li>
          </ul>
          <div className="mt-5 h-2 rounded-full bg-bun-700 overflow-hidden">
            <div className="h-full w-1/2 bg-gradient-to-r from-cyan-500 to-emerald-500" />
          </div>
          <p className="text-xs text-slate-400 mt-2">50% · {streak} day streak</p>
        </div>
      </section>

      <section>
        <h3 className="text-xl font-bold text-white mb-4">Stage Roadmap</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          {plan.map((p, i) => (
            <div key={i} className="rounded-2xl glass p-5 card-glow relative overflow-hidden">
              <div className={`absolute top-0 left-0 w-1.5 h-full ${p.stage === 1 ? 'bg-gradient-to-b from-cyan-400 to-blue-500' : 'bg-gradient-to-b from-violet-400 to-fuchsia-500'}`} />
              <div className="ml-4">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Stage {p.stage}</span>
                <h4 className="text-lg font-bold text-white mt-1">{p.phase}</h4>
                <p className="text-sm text-slate-400 mt-1 mb-3">{p.focus}</p>
                <ul className="space-y-1.5">
                  {p.actions.slice(0, 3).map((a, j) => (
                    <li key={j} className="text-sm text-slate-300 flex items-start gap-2"><ChevronRight size={14} className="mt-1 text-violet-400 shrink-0" />{a}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xl font-bold text-white mb-4">Recommended Resources</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {resources.slice(0, 4).map((r) => (
            <div key={r.name} className="rounded-2xl glass p-4 card-glow hover:border-violet-500/30 transition cursor-pointer">
              <div className="w-10 h-10 rounded-xl bg-bun-700 flex items-center justify-center text-lg mb-3">{r.category === 'SRS' ? '⚡' : '📚'}</div>
              <p className="font-semibold text-white text-sm">{r.name}</p>
              <p className="text-xs text-slate-400 mt-1">{r.use}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Lessons() {
  const [mode, setMode] = useState('kanji')
  const [activeItem, setActiveItem] = useState(null)
  const [showBack, setShowBack] = useState(false)

  const list = mode === 'kanji' ? kanjiLessons : mode === 'grammar' ? grammarLessons : vocabLessons

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-white">Memory Lessons</h2>
        <div className="flex p-1 rounded-xl bg-bun-700/60 border border-bun-600/40">
          {['kanji', 'grammar', 'vocab'].map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setActiveItem(null); setShowBack(false) }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition capitalize ${mode === m ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
            >
              {m} {mode === m && <Sparkles size={12} className="inline ml-1" />}
            </button>
          ))}
        </div>
      </div>

      {activeItem ? (
        <div className="animate-slide-up">
          <button onClick={() => { setActiveItem(null); setShowBack(false) }} className="text-sm text-slate-400 hover:text-white mb-4 flex items-center gap-1">
            <ChevronRight size={14} className="rotate-180" /> Back to {mode} library
          </button>
          {mode === 'kanji' && <KanjiDetail item={activeItem} showBack={showBack} setShowBack={setShowBack} />}
          {mode === 'grammar' && <GrammarDetail item={activeItem} showBack={showBack} setShowBack={setShowBack} />}
          {mode === 'vocab' && <VocabDetail item={activeItem} showBack={showBack} setShowBack={setShowBack} />}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((item, i) => (
            <button key={i} onClick={() => { setActiveItem(item); setShowBack(false) }} className="text-left rounded-2xl glass p-5 card-glow hover:border-violet-500/30 transition group">
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${item.gradient} flex items-center justify-center text-2xl shadow-lg mb-4 group-hover:scale-105 transition`}>
                {item.emoji || item.image}
              </div>
              <p className="text-2xl font-bold text-white mb-1">{item.char || item.pattern || item.word}</p>
              <p className="text-sm text-slate-300 font-medium">{item.meaning}</p>
              <p className="text-xs text-slate-500 mt-2 line-clamp-2">{mode === 'kanji' ? item.story : item.scene || item.story}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function KanjiDetail({ item, showBack, setShowBack }) {
  return (
    <div className="rounded-3xl glass p-6 sm:p-10 card-glow">
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className={`w-40 h-40 shrink-0 rounded-3xl bg-gradient-to-br ${item.gradient} flex items-center justify-center text-7xl font-bold text-white shadow-2xl`}>{item.char}</div>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-4xl font-bold text-white">{item.char}</h2>
            <Badge color="cyan">{item.on} · {item.kun}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="text-xl text-slate-200">{item.meaning}</p>
            {item.meaningFr && <span className="text-sm text-slate-500">/ {item.meaningFr}</span>}
          </div>
          <p className="text-sm text-slate-400 mb-4">{item.word}</p>

          <div className="flex items-center gap-3 mb-6 p-3 rounded-xl bg-bun-700/40 border border-bun-600/20">
            <span className="text-3xl" aria-label="drawing">{item.doodle}</span>
            <span className="text-xs text-slate-500">Scene drawing</span>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            {item.radicals.map((r, i) => (
              <div key={i} className="rounded-xl bg-bun-700/50 border border-bun-600/30 p-4 flex items-center gap-3">
                <span className="text-2xl">{r.icon}</span>
                <div><p className="text-sm font-bold text-white">{r.part} · {r.name}</p><p className="text-xs text-slate-400">Component {i + 1}</p></div>
              </div>
            ))}
          </div>

          <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 mb-4">
            <h3 className="text-sm font-bold text-violet-300 mb-2 flex items-center gap-2"><Brain size={16} /> Visual Story</h3>
            <p className="text-slate-300 leading-relaxed">{item.story}</p>
          </div>

          {item.storyFr && (
            <div className="rounded-xl bg-bun-700/30 border border-bun-600/20 p-4 mb-6">
              <h3 className="text-sm font-bold text-cyan-300 mb-2">Histoire (FR)</h3>
              <p className="text-slate-300 leading-relaxed text-sm">{item.storyFr}</p>
            </div>
          )}

          <button onClick={() => setShowBack((s) => !s)} className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition">{showBack ? 'Hide example' : 'Show example sentence'}</button>
          {showBack && (
            <div className="mt-4 rounded-xl bg-gradient-to-r from-violet-900/30 to-fuchsia-900/30 border border-violet-500/20 p-4 animate-fade-in">
              <div className="text-slate-100 font-medium text-lg leading-loose mb-2">
                <Furigana text={item.example} glossary={item.exampleGlossary} />
              </div>
              <p className="text-sm text-slate-400">Hover or click any word for reading and meaning.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function GrammarDetail({ item, showBack, setShowBack }) {
  return (
    <div className="rounded-3xl glass p-6 sm:p-10 card-glow">
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className={`w-32 h-32 shrink-0 rounded-3xl bg-gradient-to-br ${item.gradient} flex items-center justify-center text-5xl shadow-2xl`}>{item.image}</div>
        <div className="flex-1">
          <h2 className="text-3xl font-bold text-white mb-2">{item.pattern}</h2>
          <Badge color="violet">{item.form}</Badge>
          <div className="flex flex-wrap items-center gap-2 mt-4 mb-2">
            <p className="text-lg text-slate-200">{item.meaning}</p>
            {item.meaningFr && <span className="text-sm text-slate-500">/ {item.meaningFr}</span>}
          </div>
          <p className="text-sm text-slate-400 mb-6">{item.nuance}</p>

          <div className="flex items-center gap-3 mb-6 p-3 rounded-xl bg-bun-700/40 border border-bun-600/20">
            <span className="text-3xl" aria-label="drawing">{item.doodle}</span>
            <span className="text-xs text-slate-500">Scene drawing</span>
          </div>

          <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 mb-4">
            <h3 className="text-sm font-bold text-cyan-300 mb-2 flex items-center gap-2"><Eye size={16} /> Visual Scenario</h3>
            <p className="text-slate-300 leading-relaxed">{item.scene}</p>
          </div>

          {item.sceneFr && (
            <div className="rounded-xl bg-bun-700/30 border border-bun-600/20 p-4 mb-6">
              <h3 className="text-sm font-bold text-cyan-300 mb-2">Scénario (FR)</h3>
              <p className="text-slate-300 leading-relaxed text-sm">{item.sceneFr}</p>
            </div>
          )}

          <button onClick={() => setShowBack((s) => !s)} className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition">{showBack ? 'Hide example' : 'Show example sentence'}</button>
          {showBack && (
            <div className="mt-4 rounded-xl bg-gradient-to-r from-cyan-900/30 to-blue-900/30 border border-cyan-500/20 p-4 animate-fade-in">
              <div className="text-slate-100 font-medium text-lg leading-loose mb-2">
                <Furigana text={item.example} glossary={item.exampleGlossary} />
              </div>
              <p className="text-sm text-slate-400">Hover or click any word for reading and meaning.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function VocabDetail({ item, showBack, setShowBack }) {
  return (
    <div className="rounded-3xl glass p-6 sm:p-10 card-glow">
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className={`w-32 h-32 shrink-0 rounded-3xl bg-gradient-to-br ${item.gradient} flex items-center justify-center text-5xl shadow-2xl`}>{item.image}</div>
        <div className="flex-1">
          <h2 className="text-4xl font-bold text-white mb-2">{item.word}</h2>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Badge color="cyan">{item.reading}</Badge>
            <Badge color="emerald">{item.meaning}</Badge>
            {item.meaningFr && <Badge color="sky">{item.meaningFr}</Badge>}
          </div>

          <div className="flex items-center gap-3 mb-6 p-3 rounded-xl bg-bun-700/40 border border-bun-600/20">
            <span className="text-3xl" aria-label="drawing">{item.doodle}</span>
            <span className="text-xs text-slate-500">Scene drawing</span>
          </div>

          <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 mb-4">
            <h3 className="text-sm font-bold text-violet-300 mb-2 flex items-center gap-2"><Brain size={16} /> Memory Image</h3>
            <p className="text-slate-300 leading-relaxed">{item.story}</p>
          </div>

          {item.storyFr && (
            <div className="rounded-xl bg-bun-700/30 border border-bun-600/20 p-4 mb-6">
              <h3 className="text-sm font-bold text-cyan-300 mb-2">Image mémorielle (FR)</h3>
              <p className="text-slate-300 leading-relaxed text-sm">{item.storyFr}</p>
            </div>
          )}

          <p className="text-sm text-slate-400 mb-2">Collocation: <span className="text-slate-200">{item.collocation}</span></p>
          <button onClick={() => setShowBack((s) => !s)} className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition">{showBack ? 'Hide example' : 'Show example sentence'}</button>
          {showBack && (
            <div className="mt-4 rounded-xl bg-gradient-to-r from-emerald-900/30 to-teal-900/30 border border-emerald-500/20 p-4 animate-fade-in">
              <div className="text-slate-100 font-medium text-lg leading-loose mb-2">
                <Furigana text={item.example} glossary={item.exampleGlossary} />
              </div>
              <p className="text-sm text-slate-400">Say the whole phrase, then hover words you are unsure about.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Drills() {
  const { user } = useAuth()
  const [mode, setMode] = useState('daily')
  const [filter, setFilter] = useState('all')
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answered, setAnswered] = useState(false)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)

  const [daily, setDaily] = useState(() => {
    const today = new Date().toDateString()
    const shuffled = [...questions].map((_, i) => i).sort(() => Math.random() - 0.5)
    const picked = shuffled.slice(0, Math.min(20, questions.length))
    return { date: today, indices: picked, completed: false, score: 0 }
  })

  useEffect(() => {
    const today = new Date().toDateString()
    const load = async () => {
      let d = null
      if (user) {
        const data = await getUserProgress(user.id)
        d = data?.daily
      } else {
        const raw = localStorage.getItem(userKey(user, 'daily'))
        d = raw ? JSON.parse(raw) : null
      }
      if (d?.date === today) setDaily(d)
      else if (user) await setUserProgress(user.id, { daily })
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    if (user) setUserProgress(user.id, { daily })
    else localStorage.setItem(userKey(user, 'daily'), JSON.stringify(daily))
  }, [daily, user])

  const dailyQuestions = useMemo(() => daily.indices.map((i) => questions[i]), [daily])

  const pool = useMemo(() => {
    if (mode === 'daily') return dailyQuestions
    return filter === 'all' ? questions : questions.filter((q) => q.type.toLowerCase() === filter)
  }, [mode, filter, dailyQuestions])

  useEffect(() => { setIndex(0); setSelected(null); setAnswered(false); setScore(0); setFinished(false) }, [mode, filter])

  if (pool.length === 0) return <div className="text-center py-20 text-slate-400"><p>No questions in this filter yet.</p></div>
  const question = pool[index]

  const handleSelect = (i) => {
    if (answered) return
    setSelected(i)
    setAnswered(true)
    if (question.options[i].correct) setScore((s) => s + 1)
  }

  const next = () => {
    if (index + 1 >= pool.length) {
      setFinished(true)
      if (mode === 'daily') setDaily((d) => ({ ...d, completed: true, score }))
    } else { setIndex((x) => x + 1); setSelected(null); setAnswered(false) }
  }

  const restart = () => {
    if (mode === 'daily') {
      const today = new Date().toDateString()
      const shuffled = [...questions].map((_, i) => i).sort(() => Math.random() - 0.5)
      const picked = shuffled.slice(0, Math.min(20, questions.length))
      setDaily({ date: today, indices: picked, completed: false, score: 0 })
    }
    setIndex(0); setSelected(null); setAnswered(false); setScore(0); setFinished(false)
  }

  if (mode === 'daily' && daily.completed) {
    const pct = Math.round(((daily.score || 0) / pool.length) * 100)
    return (
      <div className='max-w-2xl mx-auto text-center py-12 animate-fade-in'>
        <div className='w-20 h-20 mx-auto rounded-full bg-bun-700 flex items-center justify-center text-4xl mb-6'>{pct >= 70 ? '🎉' : '🔥'}</div>
        <h2 className='text-3xl font-bold text-white mb-2'>Daily 20 Complete</h2>
        <p className='text-lg text-slate-300 mb-6'>{daily.score || 0} / {pool.length} correct · {pct}%</p>
        <div className='h-3 w-64 mx-auto rounded-full bg-bun-700 overflow-hidden mb-8'><div className={`h-full ${pct >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: pct + '%' }} /></div>
        <div className='flex justify-center gap-4'>
          <button onClick={() => { setMode('free'); setFilter('all') }} className='px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition'>Free practice</button>
        </div>
      </div>
    )
  }

  if (finished) {
    const pct = Math.round((score / pool.length) * 100)
    return (
      <div className="max-w-2xl mx-auto text-center py-12 animate-fade-in">
        <div className="w-20 h-20 mx-auto rounded-full bg-bun-700 flex items-center justify-center text-4xl mb-6">{pct >= 70 ? '🎉' : '🔥'}</div>
        <h2 className='text-3xl font-bold text-white mb-2'>{mode === 'daily' ? 'Daily 20 Complete' : 'Drill Complete'}</h2>
        <p className="text-lg text-slate-300 mb-6">{score} / {pool.length} correct · {pct}%</p>
        <div className="h-3 w-64 mx-auto rounded-full bg-bun-700 overflow-hidden mb-8"><div className={`h-full ${pct >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: pct + '%' }} /></div>
        <div className="flex justify-center gap-4">
          <button onClick={restart} className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition"><RotateCcw size={16} className="inline mr-2" /> Retry</button>
          {mode === 'free' ? (
            <button onClick={() => setFilter('all')} className='px-6 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-white font-medium transition'>All questions</button>
          ) : (
            <button onClick={() => setMode('free')} className='px-6 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-white font-medium transition'>Free practice</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className='flex items-center gap-3 flex-wrap'>
          <h2 className='text-2xl font-bold text-white'>Drills</h2>
          <span className='text-xs text-slate-500 hidden sm:inline'>{mode === 'daily' ? 'Daily 20' : 'Free practice'}</span>
          <div className='flex p-1 rounded-lg bg-bun-700/40 border border-bun-600/30'>
            {['daily', 'free'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition ${mode === m ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Filter size={16} className="text-slate-400" />
          {['all', 'vocabulary', 'grammar'].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-lg border transition capitalize ${filter === f ? 'bg-violet-600/20 border-violet-500/50 text-violet-200' : 'bg-bun-700/40 border-bun-600/30 text-slate-400 hover:text-white'}`}>{f}</button>
          ))}
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-bun-700 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 transition-all" style={{ width: ((index + (answered ? 1 : 0)) / pool.length) * 100 + '%' }} /></div>
      <div className="rounded-3xl glass p-6 sm:p-8 card-glow">
        <div className='flex items-center justify-between mb-4'><span className='text-sm text-slate-400'>{question.type} · {question.format}</span><span className='text-sm text-slate-400'>{mode === 'daily' ? 'Daily 20 · ' : ''}{index + 1} / {pool.length}</span></div>
        <div className="rounded-2xl bg-bun-700/40 border border-bun-600/20 p-5 mb-6"><p className="text-lg text-slate-100 leading-relaxed">{question.prompt}</p>{question.target && <p className="text-sm text-violet-300 mt-3">Target: 「{question.target}」</p>}</div>
        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          {question.options.map((opt, i) => {
            const show = answered, correct = opt.correct, chosen = selected === i
            let cls = 'w-full text-left px-4 py-3.5 rounded-xl border transition font-medium text-slate-100 '
            if (show) { if (correct) cls += 'bg-emerald-500/15 border-emerald-500/50'; else if (chosen) cls += 'bg-rose-500/15 border-rose-500/50'; else cls += 'bg-bun-700/30 border-bun-600/30 opacity-60' }
            else cls += 'bg-bun-700/50 border-bun-600/30 hover:border-violet-500/50 hover:bg-bun-700'
            return (
              <button key={i} onClick={() => handleSelect(i)} disabled={answered} className={cls}>
                <span className="text-slate-500 mr-2">{String.fromCharCode(65 + i)}.</span>{opt.label}
                {show && correct && <CheckCircle2 size={16} className="inline ml-auto text-emerald-400 float-right" />}
                {show && chosen && !correct && <XCircle size={16} className="inline ml-auto text-rose-400 float-right" />}
              </button>
            )
          })}
        </div>
        {answered && (
          <div className="rounded-2xl bg-gradient-to-r from-violet-900/30 to-fuchsia-900/30 border border-violet-500/20 p-5 mb-6 animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              {question.options[selected].correct ? <CheckCircle2 size={18} className="text-emerald-400" /> : <XCircle size={18} className="text-rose-400" />}
              <span className="font-bold text-white">{question.options[selected].correct ? 'Correct' : 'Not quite'}</span>
            </div>
            <p className="text-slate-300 leading-relaxed">{question.explanation}</p>
            <p className="text-sm text-slate-400 mt-2">{question.hint}</p>
          </div>
        )}
        {answered && <div className="text-right"><button onClick={next} className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition">{index + 1 === pool.length ? 'Finish' : 'Next'}</button></div>}
      </div>
      <p className="text-center text-sm text-slate-500">Score: {score} / {index + (answered ? 1 : 0)}</p>
    </div>
  )
}

function Anki() {
  const [queue, setQueue] = useState([...ankiCards])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(0)

  const current = queue[index]

  const rate = (again) => {
    if (again) {
      setQueue((q) => [...q, current])
    } else {
      setDone((d) => d + 1)
    }
    setFlipped(false)
    if (index + 1 >= queue.length) {
      if (!again) setQueue((q) => q.filter((_, i) => i !== index))
      else setIndex((x) => x + 1)
    } else {
      setIndex((x) => x + 1)
    }
  }

  const exportCSV = () => {
    const rows = ankiCards.map((c) => ({ front: c.front, back: c.back, tag: c.tag }))
    const csv = ['front,back,tags', ...rows.map((r) => `${r.front},${r.back},${r.tag}`)].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'n2-anki-cards.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!current) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="w-20 h-20 mx-auto rounded-full bg-bun-700 flex items-center justify-center text-4xl mb-6">🎉</div>
        <h2 className="text-2xl font-bold text-white mb-2">Session done</h2>
        <p className="text-slate-300 mb-6">Reviewed {done} cards. The cards will keep cycling until you mark them good.</p>
        <button onClick={exportCSV} className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition"><Download size={16} className="inline mr-2" /> Export CSV for Anki</button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Anki Cards</h2>
        <div className="flex gap-2">
          <a href="https://apps.ankiweb.net/" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-sm bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 flex items-center gap-1"><ExternalLink size={14} /> Anki</a>
          <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg text-sm bg-violet-600 hover:bg-violet-500 text-white flex items-center gap-1"><Download size={14} /> CSV</button>
        </div>
      </div>

      <div className="h-2 w-full rounded-full bg-bun-700 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-500" style={{ width: ((done / ankiCards.length) * 100) + '%' }} /></div>

      <div className="rounded-3xl glass p-8 sm:p-12 card-glow text-center min-h-[360px] flex flex-col items-center justify-center">
        <div className={`w-24 h-24 rounded-2xl bg-gradient-to-br ${current.tag === 'Kanji' ? 'from-amber-500 to-orange-600' : current.tag === 'Grammar' ? 'from-violet-500 to-fuchsia-600' : current.tag === 'Vocab' ? 'from-cyan-500 to-blue-600' : 'from-emerald-500 to-teal-600'} flex items-center justify-center text-4xl shadow-xl mb-6`}>
          {current.image}
        </div>
        <p className="text-sm text-slate-400 mb-2 uppercase tracking-wide">{current.tag}</p>
        <h3 className="text-4xl font-bold text-white mb-6">{current.front}</h3>
        {flipped && (
          <div className="w-full animate-fade-in border-t border-bun-600/30 pt-6">
            <p className="text-2xl text-slate-200 font-medium">{current.back}</p>
          </div>
        )}
      </div>

      {!flipped ? (
        <button onClick={() => setFlipped(true)} className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition">Show answer</button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => rate(true)} className="py-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-sm font-medium hover:bg-rose-500/30 transition">Again</button>
          <button onClick={() => rate(false)} className="py-2.5 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-200 text-sm font-medium hover:bg-orange-500/30 transition">Hard</button>
          <button onClick={() => rate(false)} className="py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm font-medium hover:bg-emerald-500/30 transition">Good</button>
          <button onClick={() => rate(false)} className="py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-medium hover:bg-cyan-500/30 transition">Easy</button>
        </div>
      )}
    </div>
  )
}

function Resources() {
  const byCategory = {
    SRS: resources.filter((r) => r.category === 'SRS'),
    Web: resources.filter((r) => r.category === 'Web'),
    Textbook: resources.filter((r) => r.category === 'Textbook'),
    Reading: resources.filter((r) => r.category === 'Reading'),
    Mock: resources.filter((r) => r.category === 'Mock'),
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">N2 Resource Library</h2>
      {Object.entries(byCategory).map(([cat, list]) => (
        <div key={cat}>
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">{cat}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((r) => (
              <div key={r.name} className="rounded-2xl glass p-5 card-glow hover:border-violet-500/30 transition">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-bun-700 flex items-center justify-center text-lg">
                    {cat === 'SRS' ? '⚡' : cat === 'Web' ? '🌐' : cat === 'Textbook' ? '📖' : cat === 'Reading' ? '📰' : '📝'}
                  </div>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" className="p-2 rounded-lg bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 transition">
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
                <p className="font-semibold text-white">{r.name}</p>
                <p className="text-sm text-slate-400 mt-1">{r.use}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ReadingView() {
  const [sub, setSub] = useState('passages')
  const [active, setActive] = useState(0)
  const [answered, setAnswered] = useState([])
  const [query, setQuery] = useState('')

  const passage = passages[active]

  const allGlossary = useMemo(() => {
    const flat = passages.flatMap((p) => p.glossary)
    const vocab = vocabLessons.map((v) => ({ word: v.word, reading: v.reading, meaning: v.meaning, image: v.image, mnemonic: v.story }))
    const kanji = kanjiLessons.map((k) => ({ word: k.char, reading: k.on + ' · ' + k.kun, meaning: k.meaning, image: k.emoji, mnemonic: k.story }))
    const gram = grammarLessons.map((g) => ({ word: g.pattern, reading: '', meaning: g.meaning, image: g.image, mnemonic: g.scene }))
    return [...flat, ...vocab, ...kanji, ...gram]
  }, [])

  const results = useMemo(() => {
    if (!query.trim()) return []
    return allGlossary.filter((g) =>
      g.word.includes(query) || g.reading.includes(query) || g.meaning.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 8)
  }, [query, allGlossary])

  const toggleAnswer = (qi, oi) => {
    setAnswered((prev) => {
      const next = [...prev]
      next[active] = next[active] || []
      next[active][qi] = oi
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-white">Daily Reading</h2>
        <div className="flex p-1 rounded-xl bg-bun-700/60 border border-bun-600/40">
          {['passages', 'strategy'].map((s) => (
            <button key={s} onClick={() => setSub(s)} className={`px-4 py-2 rounded-lg text-sm font-medium transition capitalize ${sub === s ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>{s}</button>
          ))}
        </div>
      </div>

      {sub === 'passages' && (
        <>
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a kanji, reading, or meaning to see its image..."
              className="w-full rounded-xl bg-bun-800 border border-bun-600/40 pl-10 pr-4 py-3 text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none"
            />
            {query && results.length > 0 && (
              <div className="absolute z-20 w-full mt-2 rounded-xl bg-bun-800 border border-bun-600/40 p-3 space-y-2 shadow-2xl">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-bun-700/40">
                    <span className="text-2xl">{r.image}</span>
                    <div>
                      <p className="font-bold text-white">{r.word} <span className="text-slate-400 font-normal text-sm">{r.reading}</span></p>
                      <p className="text-sm text-slate-400">{r.meaning}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            {passages.map((p, i) => (
              <button
                key={i}
                onClick={() => { setActive(i); setAnswered([]) }}
                className={`text-left rounded-2xl p-4 border transition ${active === i ? 'bg-violet-600/15 border-violet-500/40' : 'bg-bun-800/60 border-bun-600/30 hover:border-bun-500/40'}`}
              >
                <p className="font-semibold text-white text-sm">{p.title}</p>
                <p className="text-xs text-slate-400 mt-1">{p.level} · {p.time} min</p>
              </button>
            ))}
          </div>

          <div className="rounded-3xl glass p-6 sm:p-8 card-glow">
            <h3 className="text-xl font-bold text-white mb-2">{passage.title}</h3>
            <p className="text-xs text-slate-400 mb-6">{passage.level} · target time {passage.time} min</p>

            <div className="rounded-2xl bg-bun-700/40 border border-bun-600/20 p-6 mb-8 leading-loose text-lg text-slate-100">
              <Furigana text={passage.text} glossary={passage.glossary} />
            </div>

            <h4 className="text-sm font-bold text-violet-300 mb-3 flex items-center gap-2"><Brain size={16} /> Visual Glossary — click a word to see its image</h4>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
              {passage.glossary.map((g, i) => (
                <div key={i} className="group rounded-xl bg-bun-700/40 border border-bun-600/30 p-4 hover:border-violet-500/40 transition">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl group-hover:scale-110 transition">{g.image}</span>
                    <div>
                      <p className="font-bold text-white">{g.word}</p>
                      <p className="text-xs text-slate-400">{g.reading}</p>
                    </div>
                  </div>
                  <p className="text-sm text-slate-300">{g.meaning}</p>
                  <p className="text-xs text-slate-500 mt-2 line-clamp-2">{g.mnemonic}</p>
                </div>
              ))}
            </div>

            <h4 className="text-sm font-bold text-cyan-300 mb-3">Passage Questions</h4>
            <div className="space-y-5">
              {passage.questions.map((q, qi) => (
                <div key={qi} className="rounded-2xl bg-bun-700/30 border border-bun-600/20 p-5">
                  <p className="text-slate-100 font-medium mb-3">{qi + 1}. {q.prompt}</p>
                  <div className="space-y-2">
                    {q.options.map((opt, oi) => {
                      const chosen = answered[active]?.[qi] === oi
                      const show = answered[active]?.[qi] !== undefined
                      const cls = `w-full text-left px-4 py-2.5 rounded-lg border text-sm transition ${
                        show
                          ? opt.correct ? 'bg-emerald-500/15 border-emerald-500/50' : chosen ? 'bg-rose-500/15 border-rose-500/50' : 'bg-bun-700/30 border-bun-600/30 opacity-60'
                          : 'bg-bun-700/40 border-bun-600/30 hover:border-violet-500/50 hover:bg-bun-700'
                      }`
                      return (
                        <button key={oi} onClick={() => !show && toggleAnswer(qi, oi)} disabled={show} className={cls}>
                          <span className="text-slate-500 mr-2">{String.fromCharCode(65 + oi)}.</span>{opt.label}
                          {show && opt.correct && <CheckCircle2 size={14} className="inline ml-auto text-emerald-400 float-right" />}
                          {show && chosen && !opt.correct && <XCircle size={14} className="inline ml-auto text-rose-400 float-right" />}
                        </button>
                      )
                    })}
                  </div>
                  {answered[active]?.[qi] !== undefined && (
                    <p className="mt-3 text-sm text-slate-300">{q.explanation}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {sub === 'strategy' && (
        <div className="space-y-6">
          <div className="grid md:grid-cols-3 gap-5">
            {readingTips.map((t, i) => (
              <div key={i} className="rounded-3xl glass p-6 card-glow">
                <div className="w-12 h-12 rounded-2xl bg-bun-700 flex items-center justify-center text-2xl mb-4">{i === 0 ? '🧠' : i === 1 ? '👁️' : '🔄'}</div>
                <h3 className="text-lg font-bold text-white mb-3">{t.title}</h3>
                <ul className="space-y-2">
                  {t.items.map((item, j) => (
                    <li key={j} className="text-sm text-slate-300 flex items-start gap-2"><ChevronRight size={14} className="mt-0.5 text-cyan-400 shrink-0" />{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="rounded-3xl glass p-6 card-glow">
            <h3 className="text-lg font-bold text-white mb-4">Suggested Timing Targets</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-slate-500 border-b border-bun-600/30"><tr><th className="py-2 pr-6">Passage</th><th className="py-2 pr-6">Questions</th><th className="py-2 pr-6">Time</th><th className="py-2">Focus</th></tr></thead>
                <tbody className="text-slate-300">
                  {[
                    ['Short', '2', '3 min total', 'Question stem first'],
                    ['Medium', '3', '9 min total', 'Thematic shifts'],
                    ['Long', '2', '9 min total', 'Intro & conclusion'],
                  ].map((row, i) => (
                    <tr key={i} className="border-b border-bun-600/20 last:border-0">{row.map((cell, j) => <td key={j} className="py-2 pr-6">{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StudyPlan() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Two-Stage Study Plan</h2>
      <div className="grid lg:grid-cols-2 gap-5">
        {plan.map((p, i) => (
          <div key={i} className="rounded-3xl glass p-6 card-glow relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-1.5 h-full ${p.stage === 1 ? 'bg-gradient-to-b from-cyan-400 to-blue-500' : 'bg-gradient-to-b from-violet-400 to-fuchsia-500'}`} />
            <div className="ml-4">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Stage {p.stage}</span>
              <h3 className="text-lg font-bold text-white mt-1">{p.phase}</h3>
              <p className="text-sm text-slate-400 mt-2 mb-4">{p.focus}</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {p.actions.map((a, j) => (
                  <div key={j} className="flex items-start gap-2 bg-bun-700/40 rounded-xl p-3 text-sm text-slate-300"><span className="text-violet-400 font-bold shrink-0">{j + 1}.</span>{a}</div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ErrorLog() {
  const { user, isSupabaseConfigured } = useAuth()
  const [logs, setLogs] = useState([])
  const [section, setSection] = useState('Vocabulary')
  const [mistake, setMistake] = useState('')
  const [cause, setCause] = useState('')
  const [fix, setFix] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      let data = []
      if (user) {
        data = await getErrorLogs(user.id)
      } else {
        const raw = localStorage.getItem(userKey(user, 'error-log'))
        data = raw ? JSON.parse(raw) : []
      }
      if (!cancelled) {
        setLogs(data)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [user])

  const add = async (e) => {
    e.preventDefault()
    if (!mistake.trim() || saving) return
    setSaving(true)
    const entry = { section, mistake: mistake.trim(), cause, fix, created_at: new Date().toISOString() }
    let log = null
    if (user) {
      log = await addErrorLog(user.id, entry)
    }
    if (!log) {
      log = { id: Date.now(), ...entry }
    }
    const next = [log, ...logs]
    setLogs(next)
    if (!user || !isSupabaseConfigured) {
      localStorage.setItem(userKey(user, 'error-log'), JSON.stringify(next))
    }
    setMistake(''); setCause(''); setFix('')
    setSaving(false)
  }

  const remove = async (id) => {
    if (user) await deleteErrorLog(user.id, id)
    const next = logs.filter((l) => l.id !== id)
    setLogs(next)
    if (!user || !isSupabaseConfigured) {
      localStorage.setItem(userKey(user, 'error-log'), JSON.stringify(next))
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Error Log</h2>
        <span className="text-xs text-slate-500">{isSupabaseConfigured ? 'Synced to your account' : 'Stored locally'}</span>
      </div>
      <form onSubmit={add} className="rounded-3xl glass p-6 card-glow space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Section</label>
          <select value={section} onChange={(e) => setSection(e.target.value)} className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none">
            <option>Vocabulary</option><option>Grammar</option><option>Reading</option><option>Listening</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">What did you miss?</label>
          <input value={mistake} onChange={(e) => setMistake(e.target.value)} placeholder="e.g. 延期 → えんき" className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Why?</label>
          <input value={cause} onChange={(e) => setCause(e.target.value)} placeholder="e.g. Confused えんき with えんぎ" className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Fix / rule</label>
          <input value={fix} onChange={(e) => setFix(e.target.value)} placeholder="e.g. 延 stretches = en, 期 = ki" className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
        </div>
        <button type="submit" disabled={saving} className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-medium transition flex items-center justify-center gap-2">
          {saving ? <Loader2 size={16} className="animate-spin" /> : null}
          Add Entry
        </button>
      </form>

      {loading ? (
        <p className="text-center text-slate-500 py-8 flex items-center justify-center gap-2"><Loader2 size={18} className="animate-spin" /> Loading...</p>
      ) : logs.length === 0 ? (
        <p className="text-center text-slate-500 py-8">No errors logged yet. Review this 30 min before each mock.</p>
      ) : (
        <div className="space-y-3">
          {logs.map((l) => (
            <div key={l.id} className="rounded-2xl glass p-4 card-glow flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge color={l.section === 'Vocabulary' ? 'emerald' : l.section === 'Grammar' ? 'violet' : 'amber'}>{l.section}</Badge>
                  <span className="text-xs text-slate-400">{new Date(l.created_at).toLocaleDateString()}</span>
                </div>
                <p className="font-semibold text-slate-100">{l.mistake}</p>
                {l.cause && <p className="text-sm text-rose-300 mt-1">Cause: {l.cause}</p>}
                {l.fix && <p className="text-sm text-emerald-300 mt-1">Fix: {l.fix}</p>}
              </div>
              <button onClick={() => remove(l.id)} className="text-xs text-slate-500 hover:text-rose-400 shrink-0">Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function App() {
  const { user, loading, isSupabaseConfigured, signOut } = useAuth()
  const [active, setActive] = useState('dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [streak, setStreak] = useState(0)
  const [mode, setMode] = useState('beginner')

  const dictionary = useMemo(() => [
    ...kanjiLessons.map((k) => ({ word: k.char, reading: `${k.on} · ${k.kun}`, meaning: k.meaning, image: k.emoji, type: 'Kanji' })),
    ...vocabLessons.map((v) => ({ word: v.word, reading: v.reading, meaning: v.meaning, image: v.image, type: 'Vocab' })),
    ...grammarLessons.map((g) => ({ word: g.pattern.replace(/^〜/, ''), reading: g.form, meaning: g.meaning, image: g.image, type: 'Grammar' })),
    ...ankiCards.map((a) => ({ word: a.front, reading: a.back.split(' — ')[0] || '', meaning: a.back.split(' — ')[1] || a.back, image: a.image, type: a.tag })),
    ...passages.flatMap((p) => p.glossary.map((g) => ({ word: g.word, reading: g.reading, meaning: g.meaning, image: g.image, type: 'Reading' }))),
    ...commonWords.map((c) => ({ word: c.word, reading: c.reading, meaning: c.meaning, image: '📘', type: 'Common' })),
  ], [])

  useEffect(() => {
    let cancelled = false
    const update = async () => {
      const today = new Date().toDateString()
      let s = { count: 0, last: '' }

      if (user) {
        const data = await getUserProgress(user.id)
        s = data?.streak ?? { count: 0, last: '' }
      } else {
        const raw = localStorage.getItem(userKey(user, 'streak'))
        s = raw ? JSON.parse(raw) : s
      }

      if (s.last !== today) {
        const y = new Date()
        y.setDate(y.getDate() - 1)
        s.count = s.last === y.toDateString() ? s.count + 1 : 1
        s.last = today
      }

      if (user) {
        await setUserProgress(user.id, { streak: s })
      } else {
        localStorage.setItem(userKey(user, 'streak'), JSON.stringify(s))
      }

      if (!cancelled) setStreak(s.count)
    }
    update()
    return () => { cancelled = true }
  }, [user])

  useEffect(() => { document.documentElement.classList.add('dark') }, [])

  const content = {
    dashboard: <Dashboard streak={streak} setActive={setActive} />,
    lessons: <Lessons />,
    drills: <Drills />,
    anki: <Anki />,
    reading: <ReadingView />,
    ai: <AiTutor />,
    plan: <StudyPlan />,
    resources: <Resources />,
    errors: <ErrorLog />,
  }

  if (isSupabaseConfigured && loading) {
    return (
      <div className="min-h-screen bg-bun-900 flex items-center justify-center text-slate-300">
        <p className="flex items-center gap-2"><Loader2 className="animate-spin" size={20} /> Loading...</p>
      </div>
    )
  }

  if (isSupabaseConfigured && !user) {
    return <AuthModal />
  }

  return (
    <ModeContext.Provider value={mode}>
      <div className="min-h-screen bg-bun-900 text-slate-100 flex">
        <Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} streak={streak} />
        <main className="flex-1 min-w-0 flex flex-col">
          <Header active={active} setMobileOpen={setMobileOpen} streak={streak} mode={mode} setMode={setMode} user={user} onSignOut={signOut} isSupabaseConfigured={isSupabaseConfigured} />
          <div className="flex-1 p-4 sm:p-8 overflow-y-auto">
            <div className="max-w-6xl mx-auto animate-fade-in">
              {content[active]}
            </div>
          </div>
        </main>
        <SelectionPopup dictionary={dictionary} />
      </div>
    </ModeContext.Provider>
  )
}

export default App
