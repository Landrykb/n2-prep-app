import { useEffect, useMemo, useRef, useState } from 'react'
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
  X,
  XCircle,
  Menu,
  Sparkles,
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
  Calendar,
  Play,
} from 'lucide-react'
import { useAuth } from './hooks/useAuth.js'
import { useKanjiModal } from './hooks/useKanjiModal.js'
import { supabase } from './lib/supabaseClient.js'
import { findStudyItem } from './lib/findStudyItem.js'
import { daysToJLPT, nextJLPTDate } from './lib/nextJLPT.js'
import AuthModal from './components/AuthModal.jsx'
import AiTutor from './components/AiTutor.jsx'
import ChatBubble from './components/ChatBubble.jsx'
import TtsButton from './components/TtsButton.jsx'
import Skeleton, { SkeletonText } from './components/Skeleton.jsx'
import { userKey } from './lib/userKey.js'
import { getErrorLogs, addErrorLog, reviewErrorLog, deleteErrorLog, getUserProgress, setUserProgress } from './lib/supabaseApi.js'
import {
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
  { id: 'videos', label: 'Videos', icon: Play },
  { id: 'errors', label: 'Error Log', icon: AlertCircle },
]

function Furigana({ text, glossary = [] }) {
  const { open } = useKanjiModal()
  const all = useMemo(() => [...commonWords, ...glossary], [glossary])
  if (all.length === 0) return <span className="leading-loose">{text}</span>
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
          <FuriganaWord key={i} p={p} onOpen={open} />
        )
      )}
    </span>
  )
}

function FuriganaWord({ p, onOpen }) {
  const found = p.reading ? findStudyItem(p.word) : null
  const handle = (e) => {
    e.stopPropagation()
    if (found) onOpen(found)
  }
  return (
    <span
      onClick={handle}
      className={`group relative inline-block border-b border-dashed border-violet-500/40 ${found ? 'cursor-pointer hover:text-violet-300' : 'cursor-help'}`}
    >
      {p.word}
      <span className="absolute -top-16 left-1/2 -translate-x-1/2 bg-bun-800 border border-violet-500/30 rounded-lg px-3 py-2 text-xs text-slate-200 opacity-0 group-hover:opacity-100 transition pointer-events-none z-20 shadow-xl whitespace-nowrap">
        <span className="block text-cyan-300 font-medium text-sm">{p.reading}</span>
        <span className="block text-slate-300">{p.meaning}</span>
      </span>
    </span>
  )
}

function SelectionPopup({ dictionary }) {
  const [selected, setSelected] = useState(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const popupRef = useRef(null)
  const { open } = useKanjiModal()

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
      <div className="flex items-center justify-between mb-2">
        <TtsButton text={selected.text} />
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
      {(() => {
        const found = findStudyItem(selected.match?.word || selected.text)
        return found ? (
          <button
            onClick={() => { open(found); setSelected(null) }}
            className="mt-3 w-full py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-violet-200 text-sm font-medium transition"
          >
            Open visual breakdown
          </button>
        ) : null
      })()}
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

function Header({ active, setMobileOpen, streak, daysToExam, user, onSignOut, isSupabaseConfigured }) {
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
        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300">
          <Calendar size={14} className="text-violet-300" />
          <span className="font-medium">{daysToExam} days to JLPT</span>
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
              <h1 className="font-bold text-lg leading-tight">JPN2easy</h1>
              <p className="text-xs text-slate-400">Learn &middot; Master &middot; Pass</p>
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

function Dashboard({ streak, daysToExam, nextExam, setActive }) {
  const dateLabel = nextExam?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const focus = daysToExam > 120 ? 'foundation' : daysToExam > 60 ? 'patterns' : daysToExam > 30 ? 'speed' : 'sprint'
  const focusText = {
    foundation: 'You have time. Build vocabulary + kanji recognition first.',
    patterns: 'Focus on grammar patterns and reading strategy.',
    speed: 'Pick up the pace. Drill past questions and review errors.',
    sprint: 'Final sprint. Mock tests, error log, and weak points only.',
  }[focus]

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 border border-violet-500/20 p-6 sm:p-10 card-glow">
        <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={18} className="text-violet-300" />
            <Badge color="emerald">{daysToExam} days to JLPT · {dateLabel}</Badge>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">Crack the N2 pass wall.</h2>
          <p className="max-w-2xl text-slate-300 leading-relaxed mb-6">
            {focusText} Every day matters. Use the drills, the AI tutor, and the error log to stay on track.
          </p>
          <div className="flex flex-wrap gap-4">
            <button onClick={() => setActive('plan')} className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition shadow-lg shadow-violet-600/25">View Plan</button>
            <button onClick={() => setActive('drills')} className="px-5 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 font-medium transition">Start Drill</button>
          </div>
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl glass p-6 card-glow">
          <h3 className="text-lg font-bold text-white mb-4">Your Progress</h3>
          <p className="text-slate-300 text-sm leading-relaxed mb-4">
            {daysToExam} days left until the next exam. Stay consistent, and the streak will carry you.
          </p>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-orange-500/20 text-orange-300 flex items-center justify-center text-xl">🔥</div>
            <div>
              <p className="text-2xl font-bold text-white">{streak}</p>
              <p className="text-xs text-slate-400">day streak</p>
            </div>
            <div className="w-px h-10 bg-bun-600/40" />
            <div className="w-12 h-12 rounded-xl bg-violet-500/20 text-violet-300 flex items-center justify-center text-xl">🎯</div>
            <div>
              <p className="text-2xl font-bold text-white">{daysToExam}</p>
              <p className="text-xs text-slate-400">days to JLPT</p>
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            <button onClick={() => setActive('drills')} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition">Start daily drill</button>
            <button onClick={() => setActive('errors')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 text-sm font-medium transition">Review errors</button>
          </div>
        </div>
        <div className="rounded-2xl glass p-6 card-glow">
          <h3 className="text-lg font-bold text-white mb-4">Daily Goal</h3>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-3 text-slate-300"><div className="w-4 h-4 rounded-full border border-slate-500" /> 25 SRS cards reviewed</li>
            <li className="flex items-center gap-3 text-slate-300"><div className="w-4 h-4 rounded-full border border-slate-500" /> 1 grammar pattern mastered</li>
            <li className="flex items-center gap-3 text-slate-300"><div className="w-4 h-4 rounded-full border border-slate-500" /> 1 daily reading passage</li>
            <li className="flex items-center gap-3 text-slate-300"><div className="w-4 h-4 rounded-full border border-slate-500" /> Log 3 errors</li>
          </ul>
          <p className="text-xs text-slate-400 mt-5">{streak} day streak · check these off as you go</p>
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
              <div className="w-10 h-10 rounded-xl bg-bun-700 flex items-center justify-center text-lg mb-3">{resourceIcon[r.category] || '📚'}</div>
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
      if (d?.date === today) {
        setDaily(d)
        setScore(d.score || 0)
        setIndex(d.index || 0)
        setAnswered(d.answered || false)
        setSelected(d.selected ?? null)
        setFinished(d.completed || false)
      } else if (user) await setUserProgress(user.id, { daily })
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
    const isCorrect = question.options[i].correct
    const nextScore = isCorrect ? score + 1 : score
    setSelected(i)
    setAnswered(true)
    setScore(nextScore)
    setDaily((d) => ({ ...d, index, selected: i, answered: true, score: nextScore, completed: false }))
    if (!isCorrect && user) {
      const correct = question.options.find((o) => o.correct)
      addErrorLog(user.id, {
        section: question.type,
        mistake: question.target ? `${question.target} — ${question.prompt}` : question.prompt,
        cause: `Chose: ${question.options[i].label}`,
        fix: `Correct: ${correct?.label || ''}${question.explanation ? `. ${question.explanation}` : ''}`.trim(),
      })
    }
  }

  const next = () => {
    const nextIndex = index + 1
    if (nextIndex >= pool.length) {
      setFinished(true)
      if (mode === 'daily') setDaily((d) => ({ ...d, completed: true, score, selected: null, answered: false }))
    } else {
      setIndex(nextIndex)
      setSelected(null)
      setAnswered(false)
      setDaily((d) => ({ ...d, index: nextIndex, selected: null, answered: false }))
    }
  }

  const restart = () => {
    if (mode === 'daily') {
      const today = new Date().toDateString()
      const shuffled = [...questions].map((_, i) => i).sort(() => Math.random() - 0.5)
      const picked = shuffled.slice(0, Math.min(20, questions.length))
      setDaily({ date: today, indices: picked, completed: false, score: 0, index: 0, selected: null, answered: false })
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

const resourceIcon = {
  Web: '🌐',
  Video: '▶️',
  Reading: '📰',
  Mock: '📝',
}

function Resources() {
  const [playing, setPlaying] = useState(null)
  const byCategory = resources.reduce((acc, r) => {
    acc[r.category] = [...(acc[r.category] || []), r]
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">N2 Resource Library</h2>
      {Object.entries(byCategory).map(([cat, list]) => (
        <div key={cat}>
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">{cat}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((r) => (
              <div key={r.name} className="rounded-2xl glass p-5 card-glow hover:border-violet-500/30 transition">
                {r.video && (
                  <button
                    onClick={() => setPlaying({ title: r.name, channel: r.use, embed: r.video })}
                    className="group w-full aspect-video rounded-xl overflow-hidden border border-bun-600/30 mb-4 relative bg-bun-800"
                  >
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition">
                      <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white">
                        <Play size={28} className="ml-1" />
                      </div>
                    </div>
                    <p className="absolute bottom-0 inset-x-0 p-2 text-[10px] text-slate-300 bg-gradient-to-t from-black/70 to-transparent">Click to watch in focus</p>
                  </button>
                )}
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-bun-700 flex items-center justify-center text-lg">
                    {resourceIcon[cat] || '📚'}
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
      {playing && <VideoModal video={playing} onClose={() => setPlaying(null)} />}
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

function StudyPlan({ daysToExam }) {
  const activeStage = daysToExam > 120 ? 1 : daysToExam > 60 ? 2 : 2
  const weekFocus = daysToExam > 120
    ? 'Learn 20 new kanji/vocab + 5 grammar patterns per week. Do not worry about speed yet.'
    : daysToExam > 90
    ? 'Shift to pattern recognition. Drill 30 questions a day and review every wrong answer.'
    : daysToExam > 45
    ? 'Timed reading + mock drills. Turn weak areas into cards and ask the AI tutor daily.'
    : 'Only mock tests, error log, and audio shadowing. Sleep > new content at this point.'

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">JLPT Study Plan</h2>
      <div className="rounded-3xl glass p-6 card-glow border-l-4 border-violet-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider">Current focus · {daysToExam} days left</p>
            <h3 className="text-lg font-bold text-white mt-1">{weekFocus}</h3>
          </div>
          <div className="px-4 py-2 rounded-xl bg-bun-700/50 text-center">
            <p className="text-2xl font-bold text-white">{daysToExam}</p>
            <p className="text-xs text-slate-400">days to N2</p>
          </div>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        {plan.map((p, i) => (
          <div key={i} className={`rounded-3xl glass p-6 card-glow relative overflow-hidden ${p.stage === activeStage ? 'ring-2 ring-violet-500/40' : ''}`}>
            <div className={`absolute top-0 left-0 w-1.5 h-full ${p.stage === 1 ? 'bg-gradient-to-b from-cyan-400 to-blue-500' : 'bg-gradient-to-b from-violet-400 to-fuchsia-500'}`} />
            <div className="ml-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Stage {p.stage}</span>
                {p.stage === activeStage && <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-600/20 text-violet-300">active</span>}
              </div>
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

function VideoModal({ video, onClose }) {
  if (!video) return null
  return (
    <div className="fixed inset-0 z-50 bg-bun-900/95 p-4 sm:p-8 flex items-center justify-center" onClick={onClose}>
      <div className="w-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4 gap-3">
          <h3 className="text-lg sm:text-xl font-bold text-white line-clamp-1">{video.title}</h3>
          <button onClick={onClose} className="p-2 rounded-lg bg-bun-700 text-slate-300 hover:text-white shrink-0">
            <X size={20} />
          </button>
        </div>
        <div className="aspect-video w-full rounded-2xl overflow-hidden border border-bun-600/30 shadow-2xl">
          <iframe
            className="w-full h-full"
            src={video.embed}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        <p className="text-sm text-slate-400 mt-4">{video.channel}</p>
      </div>
    </div>
  )
}

const FALLBACK_VIDEOS = [
  { id: 'sBXdW7NmwiQ', title: 'JLPT N2 Grammar (21/22)', channel: '日本語の森', embed: 'https://www.youtube-nocookie.com/embed/sBXdW7NmwiQ?modestbranding=1&rel=0&iv_load_policy=3', thumb: 'https://img.youtube.com/vi/sBXdW7NmwiQ/0.jpg' },
  { id: 'WmIdm9GZQR4', title: 'JLPT N2 Vocab Practice', channel: '日本語の森', embed: 'https://www.youtube-nocookie.com/embed/WmIdm9GZQR4?modestbranding=1&rel=0&iv_load_policy=3', thumb: 'https://img.youtube.com/vi/WmIdm9GZQR4/0.jpg' },
  { id: 'tWIN1DEgU98', title: 'JLPT N2 Kanji Full List', channel: 'N2 Kanji Study', embed: 'https://www.youtube-nocookie.com/embed/tWIN1DEgU98?modestbranding=1&rel=0&iv_load_policy=3', thumb: 'https://img.youtube.com/vi/tWIN1DEgU98/0.jpg' },
]

function Videos() {
  const { isSupabaseConfigured } = useAuth()
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(!isSupabaseConfigured)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(null)

  const byCategory = useMemo(() => {
    const groups = {}
    videos.forEach((v) => {
      const c = v.category || 'Other'
      groups[c] = [...(groups[c] || []), v]
    })
    return groups
  }, [videos])

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) return
    let cancelled = false
    const queries = [
      { q: 'JLPT N2 grammar', category: 'Grammar' },
      { q: 'JLPT N2 vocabulary', category: 'Vocabulary' },
      { q: 'JLPT N2 kanji', category: 'Kanji' },
    ]
    const fetchAll = async () => {
      try {
        const all = []
        for (const { q, category } of queries) {
          const { data, error } = await supabase.functions.invoke('videos', { body: { q } })
          if (error) throw error
          all.push(...(data?.videos || []).map((v) => ({ ...v, category })))
        }
        const unique = all.filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
        if (!cancelled) setVideos(unique)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load videos.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchAll()
    return () => { cancelled = true }
  }, [isSupabaseConfigured])

  if (!isSupabaseConfigured) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <p className="text-slate-400">Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to see videos.</p>
      </div>
    )
  }

  const renderCard = (v) => (
    <button
      key={v.id}
      onClick={() => setPlaying(v)}
      className="text-left rounded-2xl glass p-4 card-glow hover:border-violet-500/40 transition group"
    >
      <div className="aspect-video rounded-xl overflow-hidden border border-bun-600/30 mb-3 relative bg-bun-800">
        {v.thumb ? (
          <img src={v.thumb} alt="" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none' }} />
        ) : null}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition">
          <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white">
            <Play size={28} className="ml-1" />
          </div>
        </div>
      </div>
      <h3 className="font-semibold text-white text-sm line-clamp-2">{v.title}</h3>
      <p className="text-[10px] text-slate-400 mt-1">{v.channel}</p>
    </button>
  )

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white">N2 Video Dojo</h2>
        <p className="text-sm text-slate-400 mt-1">Click any video to open a focused player. Use the fullscreen button inside the player to go full screen.</p>
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 size={20} className="animate-spin" /> Finding the best N2 videos…
        </div>
      )}
      {error && <p className="text-rose-300">{error}</p>}
      {!loading && !error && videos.length === 0 && (
        <div className="space-y-6">
          <p className="text-amber-300 text-sm bg-amber-900/20 rounded-xl p-4">
            YouTube search came back empty. The curated fallback below is shown while you check the YouTube Data API.
          </p>
          <h3 className="text-lg font-bold text-white">Featured N2 videos</h3>
          <div className="grid md:grid-cols-2 gap-6">
            {FALLBACK_VIDEOS.map(renderCard)}
          </div>
        </div>
      )}
      {!loading && !error && videos.length > 0 && (
        <div className="space-y-8">
          {Object.entries(byCategory).map(([cat, list]) => (
            <div key={cat}>
              <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                <Badge color={cat === 'Grammar' ? 'violet' : cat === 'Vocabulary' ? 'emerald' : cat === 'Kanji' ? 'amber' : 'slate'}>{cat}</Badge>
              </h3>
              <div className="grid md:grid-cols-2 gap-6">
                {list.map(renderCard)}
              </div>
            </div>
          ))}
        </div>
      )}
      {playing && <VideoModal video={playing} onClose={() => setPlaying(null)} />}
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

  const srs = [1, 1, 2, 4, 7, 14, 30]

  const add = async (e) => {
    e.preventDefault()
    if (!mistake.trim() || saving) return
    setSaving(true)
    const entry = {
      section,
      mistake: mistake.trim(),
      cause,
      fix,
      created_at: new Date().toISOString(),
      review_count: 0,
      next_review: (() => { const t = new Date(); t.setDate(t.getDate() + 1); return t.toISOString() })(),
    }
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

  const markReview = async (l) => {
    const nextCount = (l.review_count || 0) + 1
    const days = srs[Math.min(nextCount, srs.length - 1)]
    const nextDate = new Date()
    nextDate.setDate(nextDate.getDate() + days)
    const nextReview = nextDate.toISOString()
    if (user) await reviewErrorLog(user.id, l.id, l.review_count || 0)
    const updated = logs.map((x) => (x.id === l.id ? { ...x, review_count: nextCount, next_review: nextReview } : x))
    setLogs(updated)
    if (!user || !isSupabaseConfigured) {
      localStorage.setItem(userKey(user, 'error-log'), JSON.stringify(updated))
    }
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
        <div className="space-y-3 py-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : logs.length === 0 ? (
        <p className="text-center text-slate-500 py-8">No errors logged yet. Review this 30 min before each mock.</p>
      ) : (
        <div className="space-y-3">
          {logs.map((l) => {
            const isDue = l.next_review && new Date(l.next_review) <= new Date()
            return (
              <div key={l.id} className={`rounded-2xl glass p-4 card-glow flex items-start justify-between gap-3 ${isDue ? 'ring-1 ring-rose-500/40' : ''}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <Badge color={l.section === 'Vocabulary' ? 'emerald' : l.section === 'Grammar' ? 'violet' : 'amber'}>{l.section}</Badge>
                    <span className="text-xs text-slate-400">{new Date(l.created_at).toLocaleDateString()}</span>
                    {isDue && <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-600/20 text-rose-300">due</span>}
                  </div>
                  <p className="font-semibold text-slate-100">{l.mistake}</p>
                  {l.cause && <p className="text-sm text-rose-300 mt-1">Cause: {l.cause}</p>}
                  {l.fix && <p className="text-sm text-emerald-300 mt-1">Fix: {l.fix}</p>}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <button onClick={() => markReview(l)} className="text-xs px-2.5 py-1 rounded-lg bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 transition">Review +{srs[Math.min((l.review_count || 0) + 1, srs.length - 1)]}d</button>
                  <button onClick={() => remove(l.id)} className="text-xs text-slate-500 hover:text-rose-400">Delete</button>
                </div>
              </div>
            )
          })}
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
  const nextExam = nextJLPTDate()
  const daysToExam = daysToJLPT(nextExam)

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
    dashboard: <Dashboard streak={streak} daysToExam={daysToExam} nextExam={nextExam} setActive={setActive} />,
    lessons: <Lessons />,
    drills: <Drills />,
    anki: <Anki />,
    reading: <ReadingView />,
    ai: <AiTutor context={active} />,
    plan: <StudyPlan daysToExam={daysToExam} />,
    resources: <Resources />,
    videos: <Videos />,
    errors: <ErrorLog />,
  }

  if (isSupabaseConfigured && loading) {
    return (
      <div className="min-h-screen bg-bun-900 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl glass p-8 card-glow space-y-5">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <SkeletonText lines={3} />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    )
  }

  if (isSupabaseConfigured && !user) {
    return <AuthModal />
  }

  return (
    <div className="min-h-screen bg-bun-900 text-slate-100 flex">
      <Sidebar active={active} setActive={setActive} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} streak={streak} />
      <main className="flex-1 min-w-0 flex flex-col">
        <Header active={active} setMobileOpen={setMobileOpen} streak={streak} daysToExam={daysToExam} user={user} onSignOut={signOut} isSupabaseConfigured={isSupabaseConfigured} />
        <div className="flex-1 p-4 sm:p-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto animate-fade-in">
            {content[active]}
          </div>
        </div>
      </main>
      <SelectionPopup dictionary={dictionary} />
      <ChatBubble context={active} />
    </div>
  )
}

export default App
