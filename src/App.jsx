import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense, useSyncExternalStore } from 'react'
import {
  LayoutDashboard,
  BookOpen,
  BookOpenText,
  Dumbbell,
  Map,
  AlertCircle,
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
  ScrollText,
  Layers,
  Library,
  ExternalLink,
  User,
  LogOut,
  Bot,
  Loader2,
  Calendar,
  Play,
  Building2,
  Headphones,
  Zap,
  Baseline,
  ClipboardCheck,
  Mic,
  Stethoscope,
  Pickaxe,
  Phone,
  Plus,
  Repeat,
  Users,
  Mail,
} from 'lucide-react'
import { brand } from './lib/brand.js'
import { subscribeStateSync, isFirstSyncPending } from './lib/stateSync.js'
import { useAuth } from './hooks/useAuth.js'
import { useKanjiModal } from './hooks/useKanjiModal.js'
import { useFurigana } from './hooks/useFurigana.js'
import { cleanReading } from './lib/furigana.js'
import { supabase } from './lib/supabaseClient.js'
import { findStudyItem } from './lib/findStudyItem.js'
import { localDictionary, loadDictionary, lookup } from './lib/dictionary.js'
import { PageSkeleton } from './components/Skeleton.jsx'
import { loadDiagnosis } from './lib/profile.js'
import { loadPromise } from './lib/promise.js'
import { addToQueue, loadQueue } from './lib/queue.js'
import { recordQueueRating, recordReading } from './lib/twin.js'
import { recordMetric } from './lib/metrics.js'
import { recordEncounters } from './lib/encounters.js'
import { KANJI_LEVELS, loadKanjiLevel, loadAllKanji } from './lib/kanjiData.js'
import { getKanjiMeta, getKanjiStrokes } from './lib/kanjiDb.js'
import { wordsForKanji, wordDisplayForm } from './lib/wordsDb.js'
import ComponentSearch from './components/ComponentSearch.jsx'
import { useHashRoute } from './hooks/useHashRoute.js'
import { useLanguage } from './hooks/useLanguage.js'
import { useSwipeNav } from './hooks/useSwipeNav.js'
import { useExamDate } from './hooks/useExamDate.js'
import AuthModal from './components/AuthModal.jsx'
import Mascot from './components/Mascot.jsx'
import ChatBubble from './components/ChatBubble.jsx'
import TodayHome from './components/TodayHome.jsx'
import KanjiTapText from './components/KanjiTapText.jsx'
import TtsButton from './components/TtsButton.jsx'
import Skeleton, { SkeletonText } from './components/Skeleton.jsx'

// Heavy, tab-scoped views are split out so the initial bundle only carries the
// shell, the dashboard, and the shared text/lookup helpers.
// Lazy views with a stale-chunk rescue. After a deploy, an app
// left open on the old bundle asks for chunk files that no
// longer exist; the import fails and the error boundary shows
// "Something broke" for a perfectly healthy screen (Landry hit
// it twice on 2026-11-07, e.g. Speed Cards right after a
// deploy — a reload fixed it). On a chunk-load failure, reload
// ONCE (rate-limited via sessionStorage so a genuinely broken
// build cannot loop) to pick up the fresh bundle, then let the
// boundary have any error that survives that.
const lazyView = (factory) => lazy(() => factory()
  .then((m) => { try { sessionStorage.removeItem('yonde:chunkReloadAt') } catch { /* private mode */ } return m })
  .catch((err) => {
    try {
      const last = Number(sessionStorage.getItem('yonde:chunkReloadAt') || 0)
      if (Date.now() - last > 30000) {
        sessionStorage.setItem('yonde:chunkReloadAt', String(Date.now()))
        window.location.reload()
      }
    } catch { /* storage unavailable — the boundary takes it */ }
    throw err
  }))

const Anki = lazyView(() => import('./components/Anki.jsx'))
const AiTutor = lazyView(() => import('./components/AiTutor.jsx'))
const BJT = lazyView(() => import('./components/BJT.jsx'))
const BjtExam = lazyView(() => import('./components/BjtExam.jsx'))
const N2Listening = lazyView(() => import('./components/N2Listening.jsx'))
const SpeedCards = lazyView(() => import('./components/SpeedCards.jsx'))
const DictionaryView = lazyView(() => import('./components/DictionaryView.jsx'))
const MockExam = lazyView(() => import('./components/MockExam.jsx'))
const VoiceLoop = lazyView(() => import('./components/VoiceLoop.jsx'))
const Diagnosis = lazyView(() => import('./components/Diagnosis.jsx'))
const Mining = lazyView(() => import('./components/Mining.jsx'))
const OneSession = lazyView(() => import('./components/OneSession.jsx'))
const SenseiCall = lazyView(() => import('./components/SenseiCall.jsx'))
const TwinView = lazyView(() => import('./components/TwinView.jsx'))
const GrowthLoop = lazyView(() => import('./components/GrowthLoop.jsx'))
const Reader = lazyView(() => import('./components/Reader.jsx'))
const SourcesView = lazyView(() => import('./components/SourcesView.jsx'))
const CoachLetter = lazyView(() => import('./components/CoachLetter.jsx'))
const PrivacyPolicy = lazyView(() => import('./components/PrivacyPolicy.jsx'))
const Terms = lazyView(() => import('./components/Terms.jsx'))
import { userKey } from './lib/userKey.js'
import { INCOMING_CALL_KEY } from './lib/calls.js'
import { getErrorLogs, addErrorLog, deleteErrorLog, getUserProgress, setUserProgress } from './lib/supabaseApi.js'
import {
  plan,
  readingTips,
  resources,
  kanjiLessons,
  grammarLessons,
  vocabLessons,
  passages,
  questions,
  commonWords,
} from './data.js'

const nav = [
  // Menu organisation (Landry, 2026-11-07): the old app and the
  // new Yonde system grew into one long drawer — the daily loop
  // first, then the fleet, then ALL the training tools in one
  // Practice group, and reference material last in Library.
  // --- Today: the daily loop ---
  { id: 'session', labelKey: 'shell.nav.session', shortKey: 'shell.navShort.session', icon: Play , group: 'today' },
  { id: 'dashboard', labelKey: 'shell.nav.dashboard', icon: LayoutDashboard , group: 'today' },
  { id: 'sensei', labelKey: 'shell.nav.sensei', shortKey: 'shell.navShort.sensei', icon: Phone , group: 'today' },
  { id: 'reader', labelKey: 'shell.nav.reader', shortKey: 'shell.navShort.reader', icon: BookOpenText , group: 'today' },
  // --- Your Fleet: you, measured ---
  { id: 'twin', labelKey: 'shell.nav.twin', shortKey: 'shell.navShort.twin', icon: Users , group: 'fleet' },
  // Diagnosis and the Coach Letter keep their routes but leave the
  // menu (fleet coherence, Landry 2026-11-08): the checkup is
  // summoned from My Twin, the letter from Today and the Loop.
  { id: 'diagnosis', labelKey: 'shell.nav.diagnosis', icon: Stethoscope , group: 'fleet', menu: false },
  { id: 'loop', labelKey: 'shell.nav.loop', shortKey: 'shell.navShort.loop', icon: Repeat , group: 'fleet' },
  { id: 'coach', labelKey: 'shell.nav.coach', shortKey: 'shell.navShort.coach', icon: Mail , group: 'fleet', menu: false },
  // --- Practice: one hub door, every mode inside (Landry,
  // 2026-11-08: the menu was long because everything sat separate
  // and unconnected). The views keep their ids and routes; the
  // hub is their glanceable map. The AI Tutor leaves the menu —
  // its floating button is on every screen. The Error Log leaves
  // the menu — it is reached from What Trips You Up in My Twin,
  // and its slips live in the one queue now.
  { id: 'practice', labelKey: 'shell.nav.practiceHub', icon: Dumbbell , group: 'practice' },
  { id: 'exams', labelKey: 'shell.nav.exams', icon: ClipboardCheck , group: 'practice' },
  { id: 'voice', labelKey: 'shell.nav.voice', icon: Mic , group: 'practice', menu: false },
  { id: 'mine', labelKey: 'shell.nav.mine', icon: Pickaxe , group: 'practice', menu: false },
  { id: 'drills', labelKey: 'shell.nav.drills', icon: Dumbbell , group: 'practice', menu: false },
  { id: 'speed', labelKey: 'shell.nav.speed', icon: Zap , group: 'practice', menu: false },
  { id: 'anki', labelKey: 'shell.nav.anki', icon: Layers , group: 'practice', menu: false },
  { id: 'n2listening', labelKey: 'shell.nav.n2listening', icon: Headphones , group: 'practice', menu: false },
  { id: 'mock', labelKey: 'shell.nav.mock', icon: ClipboardCheck , group: 'practice', menu: false },
  { id: 'bjt', labelKey: 'shell.nav.bjt', icon: Building2 , group: 'practice', menu: false },
  { id: 'bjtexam', labelKey: 'shell.nav.bjtExam', icon: ClipboardCheck , group: 'practice', menu: false },
  { id: 'ai', labelKey: 'shell.nav.ai', icon: Bot , group: 'practice', menu: false },
  { id: 'errors', labelKey: 'shell.nav.errors', icon: AlertCircle , group: 'practice', menu: false },
  // --- Library: one hub door, every shelf inside ---
  { id: 'library', labelKey: 'shell.nav.libraryHub', icon: Library , group: 'library' },
  { id: 'lessons', labelKey: 'shell.nav.lessons', icon: BookOpen , group: 'library', menu: false },
  { id: 'dictionary', labelKey: 'shell.nav.dictionary', icon: Search , group: 'library', menu: false },
  { id: 'reading', labelKey: 'shell.nav.reading', icon: Eye , group: 'library', menu: false },
  { id: 'plan', labelKey: 'shell.nav.plan', icon: Map , group: 'library', menu: false },
  { id: 'resources', labelKey: 'shell.nav.resources', icon: Library , group: 'library', menu: false },
  { id: 'videos', labelKey: 'shell.nav.videos', icon: Play , group: 'library', menu: false },
  { id: 'sources', labelKey: 'shell.nav.sources', shortKey: 'shell.navShort.sources', icon: ScrollText , group: 'library', menu: false },
]

const navIds = nav.map((n) => n.id)
const NAV_GROUPS = [
  { id: 'today', labelKey: 'shell.group.today' },
  { id: 'fleet', labelKey: 'shell.group.fleet' },
  { id: 'practice', labelKey: 'shell.group.practice' },
  { id: 'library', labelKey: 'shell.group.library' },
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
          <KanjiTapText key={i} text={p.text} />
        ) : (
          <FuriganaWord key={i} p={p} onOpen={open} />
        )
      )}
    </span>
  )
}

function FuriganaWord({ p, onOpen }) {
  const { enabled: furiganaOn } = useFurigana()
  const found = findStudyItem(p.word)
  const handle = (e) => {
    e.stopPropagation()
    if (found) onOpen(found)
  }
  const keyHandle = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handle(e) }
  }
  return (
    <span
      onClick={handle}
      onKeyDown={keyHandle}
      role={found ? 'button' : undefined}
      tabIndex={found ? 0 : -1}
      className={`group relative inline-block border-b border-dashed border-[#FF6B57]/40 touch-manipulation ${found ? 'cursor-pointer hover:text-[#FF8A75]' : 'cursor-help'}`}
    >
      {furiganaOn ? (
        <ruby>
          {p.word}
          <rt className="text-[0.6em] font-normal text-[#FF8A75] select-none">{cleanReading(p.reading)}</rt>
        </ruby>
      ) : (
        p.word
      )}
      <span className="absolute -top-16 left-1/2 -translate-x-1/2 bg-bun-800 border border-[#FF6B57]/30 rounded-lg px-3 py-2 text-xs text-slate-200 opacity-0 group-hover:opacity-100 transition pointer-events-none z-20 shadow-xl whitespace-nowrap">
        <span className="block text-cyan-300 font-medium text-sm">{p.reading}</span>
        <span className="block text-slate-300">{p.meaning}</span>
      </span>
    </span>
  )
}

function SelectionPopup({ dictionary, onNeedDictionary }) {
  const { t } = useLanguage()
  const [selected, setSelected] = useState(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const popupRef = useRef(null)
  const { open } = useKanjiModal()

  useEffect(() => {
    const handle = (e) => {
      if (e?.target) {
        if (popupRef.current && popupRef.current.contains(e.target)) return
        if (e.target.closest?.('[role="button"], button, a')) return
      }
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
      onNeedDictionary?.() // P1-5: the full deck loads on first real use, not on mount
      const match = lookup(dictionary, text)
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      setPos({ x: rect.left + rect.width / 2, y: rect.top })
      setSelected({ text, match })
    }
    document.addEventListener('mouseup', handle)
    const touchEnd = (e) => setTimeout(() => handle(e), 80)
    document.addEventListener('touchend', touchEnd)
    return () => {
      document.removeEventListener('mouseup', handle)
      document.removeEventListener('touchend', touchEnd)
    }
  }, [dictionary]) // eslint-disable-line react-hooks/exhaustive-deps -- onNeedDictionary is a stable lazy-load trigger

  if (!selected) return null

  return (
    <div
      ref={popupRef}
      className="fixed z-50 -translate-x-1/2 -translate-y-full bg-bun-800 border border-[#FF6B57]/40 rounded-2xl shadow-2xl p-4 min-w-[220px] max-w-[320px]"
      style={{ left: pos.x, top: pos.y - 8 }}
    >
      <div className="flex items-center justify-between mb-2">
        <TtsButton text={selected.text} />
        <button onClick={() => setSelected(null)} className="text-xs text-slate-500 hover:text-slate-300">{t('shell.popup.close')}</button>
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
          {t('shell.popup.noMatch', { text: selected.text })}
          <br />
          <span className="text-slate-500">{t('shell.popup.noMatchHint')}</span>
        </p>
      )}
      {(() => {
        const found = findStudyItem(selected.match?.word || selected.text)
        return found ? (
          <button
            onClick={() => { open(found); setSelected(null) }}
            className="mt-3 w-full py-2 rounded-xl bg-[#FF6B57]/20 hover:bg-[#FF6B57]/30 text-[#FFA08D] text-sm font-medium transition"
          >
            {t('shell.popup.openBreakdown')}
          </button>
        ) : null
      })()}
    </div>
  )
}

function Badge({ children, color = 'plum' }) {
  const map = {
    rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    plum: 'bg-[#71368A]/25 text-[#C39BD3] border-[#71368A]/50',
    cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  }
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${map[color] || map.plum}`}>
      {children}
    </span>
  )
}

function Header({ active, daysToExam, user, onSignOut, isSupabaseConfigured, onToggleMenu, menuOpen }) {
  const { t } = useLanguage()
  // P0-4: the header used to show invented stats ("N2 Candidate / Next
  // mock in 2 days") and a streak flame. It now shows only what the
  // learner's own record holds: the diagnosed estimate, and the next
  // mock gate derived from the Promise's own Day-30/Day-55 plan.
  const readRecord = () => {
    const diagnosis = loadDiagnosis()
    const promise = loadPromise()
    let mockGate = null
    const at = promise?.at ? new Date(promise.at).getTime() : null
    if (at) {
      mockGate = t('shell.header.mockGatesPassed')
      for (const day of [30, 55]) {
        const when = at + day * 86400000
        if (Date.now() < when) { mockGate = t('shell.header.nextMockGate', { day, date: new Date(when).toLocaleDateString() }); break }
      }
    }
    return { diagnosis, promise, mockGate }
  }
  const [record, setRecord] = useState(readRecord)
  useEffect(() => {
    const read = () => setRecord(readRecord())
    read()
    window.addEventListener('jpn:state-synced', read)
    window.addEventListener('focus', read)
    return () => { window.removeEventListener('jpn:state-synced', read); window.removeEventListener('focus', read) }
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps
  const { enabled: furiganaOn, toggle: toggleFurigana } = useFurigana()
  return (
    <header className="border-b border-bun-600/30 page-gutter py-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onToggleMenu}
          aria-label={menuOpen ? t('shell.menu.close') : t('shell.menu.open')}
          aria-expanded={menuOpen}
          className="lg:hidden p-2.5 rounded-lg bg-bun-700 text-slate-200 min-w-[42px] min-h-[42px] flex items-center justify-center"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <h2 className="text-base sm:text-lg font-semibold truncate">{(() => { const item = nav.find((n) => n.id === active); return item ? t(item.labelKey) : null })()}</h2>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-4 shrink-0">
        <button
          onClick={toggleFurigana}
          aria-pressed={furiganaOn}
          title={furiganaOn ? t('shell.furigana.onTitle') : t('shell.furigana.offTitle')}
          className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-full border text-xs sm:text-sm font-medium transition whitespace-nowrap shrink-0 ${
            furiganaOn ? 'bg-[#FF6B57]/20 border-[#FF6B57]/50 text-[#FFA08D]' : 'bg-bun-700/50 border-bun-600/30 text-slate-300 hover:text-white'
          }`}
        >
          <Baseline size={16} />
          <span className="whitespace-nowrap">ふりがな</span>
          <span className={`text-[10px] font-bold uppercase tracking-wide ${furiganaOn ? 'text-[#FFA08D]' : 'text-slate-500'}`}>{furiganaOn ? t('shell.furigana.on') : t('shell.furigana.off')}</span>
        </button>
        <div className="text-right hidden lg:block">
          {record.diagnosis ? (<>
            <p className="text-sm font-medium text-slate-100">{t('shell.header.estimate', { estimate: record.diagnosis.jlptEstimate, total: record.diagnosis.total })}</p>
            <p className="text-xs text-slate-400">{record.mockGate || t('shell.header.fromDiagnosis')}</p>
          </>) : (<>
            <p className="text-sm font-medium text-slate-100">{t('shell.header.noDiagnosis')}</p>
            <p className="text-xs text-slate-400">{t('shell.header.noDiagnosisHint')}</p>
          </>)}
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300">
          <Calendar size={14} className="text-[#FF8A75]" />
          <span className="font-medium">{t('shell.header.daysToJlpt', { days: daysToExam })}</span>
        </div>
        {isSupabaseConfigured && (
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300" title={user?.email ?? ''}>
              <User size={14} />
              <span className="max-w-[120px] truncate">{user?.email ?? t('shell.header.guest')}</span>
            </div>
            {user && (
              <button
                onClick={onSignOut}
                aria-label={t('shell.header.signOut')}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-full border border-bun-600/30 bg-bun-700/50 hover:bg-rose-500/20 hover:border-rose-500/30 text-slate-300 hover:text-rose-300 transition text-xs sm:text-sm font-medium min-h-[42px] whitespace-nowrap shrink-0"
                title={t('shell.header.signOut')}
              >
                <LogOut size={16} />
                <span className="whitespace-nowrap">{t('shell.header.logOut')}</span>
              </button>
            )}
          </div>
        )}
        {!isSupabaseConfigured && (
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-500 to-[#71368A] flex items-center justify-center text-sm font-bold shadow-md" title="Yonde">
            よ
          </div>
        )}
      </div>
    </header>
  )
}

function Sidebar({ active, setActive, mobileOpen, setMobileOpen, guest = false, onCreateAccount }) {
  const { t } = useLanguage()
  return (
    <>
      <aside className={`fixed z-40 top-0 left-0 h-full w-64 bg-bun-800 border-r border-bun-600/30 transform transition-transform lg:translate-x-0 lg:static flex flex-col pt-safe pb-safe ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 shrink-0">
          <div className="flex items-center gap-3 mb-6">
            <Mascot agent="koe" size={40} mood="happy" showName={false} />
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-lg leading-tight">{brand.name}</h1>
              <p className="text-xs text-slate-400">{brand.tagline}</p>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              aria-label={t('shell.menu.close')}
              className="lg:hidden p-2.5 rounded-lg bg-bun-700 text-slate-200 min-w-[42px] min-h-[42px] flex items-center justify-center shrink-0"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-6 pb-4 space-y-1.5">
          {NAV_GROUPS.map((g) => (
            <div key={g.id} className="pt-3 first:pt-0">
              <p className="px-3.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">{t(g.labelKey)}</p>
              {nav.filter((n) => (n.group || 'library') === g.id && n.menu !== false).map((n) => {
            const Icon = n.icon
            return (
              <button
                key={n.id}
                onClick={() => { setActive(n.id); setMobileOpen(false) }}
                aria-current={active === n.id ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium transition ${active === n.id ? 'bg-[#FF6B57]/15 text-[#FFA08D] border border-[#FF6B57]/30' : 'text-slate-400 hover:text-slate-100 hover:bg-bun-700/60'}`}
              >
                <Icon size={18} /> {t(n.labelKey)}
              </button>
            )
          })}
            </div>
          ))}
        </nav>
        <div className="shrink-0 p-6 border-t border-bun-600/30 space-y-3">
          {guest && onCreateAccount && (
            <div className="rounded-xl bg-bun-700/60 p-4 border border-[#FF6B57]/30">
              <p className="text-sm font-semibold text-slate-100">{t('shell.guestCardTitle')}</p>
              <p className="text-xs text-slate-400 mt-1">{t('shell.guestCardBody')}</p>
              <button onClick={onCreateAccount} className="mt-3 w-full px-3 py-2 rounded-lg bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold transition">
                {t('auth.createAccountTitle')}
              </button>
            </div>
          )}
        </div>
      </aside>
      {mobileOpen && <div onClick={() => setMobileOpen(false)} className="fixed inset-0 bg-black/50 z-20 lg:hidden" />}
    </>
  )
}

// The handful of sections that deserve one-tap access on a phone
// (P1-9): the daily loop first — Session, Today, Yobidashi, Fleet —
// and Menu opens the full grouped sidebar for everything else.
const quickNav = ['session', 'dashboard', 'sensei', 'twin']

/** Fixed bottom tab bar so the PWA always has visible navigation on mobile. */
function BottomNav({ active, setActive, onMenu, menuOpen }) {
  const { t } = useLanguage()
  const items = quickNav.map((id) => nav.find((n) => n.id === id)).filter(Boolean)
  return (
    <nav
      aria-label={t('shell.bottomNav.label')}
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-bun-800/95 backdrop-blur border-t border-bun-600/30 pb-safe inset-x-safe"
    >
      <div className="flex items-stretch justify-around">
        {items.map((n) => {
          const Icon = n.icon
          const isActive = active === n.id
          return (
            <button
              key={n.id}
              onClick={() => setActive(n.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 min-h-[56px] justify-center transition ${isActive ? 'text-[#FF8A75]' : 'text-slate-400'}`}
            >
              <Icon size={20} />
              <span className="text-[10px] font-medium leading-none">{n.shortKey ? t(n.shortKey) : t(n.labelKey)}</span>
            </button>
          )
        })}
        <button
          onClick={onMenu}
          aria-label={menuOpen ? t('shell.menu.close') : t('shell.menu.openFull')}
          aria-expanded={menuOpen}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 min-h-[56px] justify-center transition ${menuOpen ? 'text-[#FF8A75]' : 'text-slate-400'}`}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
          <span className="text-[10px] font-medium leading-none">{menuOpen ? t('shell.bottomNav.close') : t('shell.bottomNav.menu')}</span>
        </button>
      </div>
    </nav>
  )
}

// Card gradients, mirroring scripts/build-kanji.mjs so an item built from
// KanjiDB for a kanji outside the JLPT lists looks like a generated entry.
const KANJI_CARD_GRADIENTS = [
  'from-violet-500 to-fuchsia-600', 'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600', 'from-indigo-500 to-violet-600',
  'from-sky-500 to-cyan-600', 'from-teal-500 to-emerald-600',
  'from-orange-500 to-red-600', 'from-fuchsia-500 to-purple-600',
]

/**
 * Build a KanjiDetail item for a kanji that has no JLPT level entry, from
 * KanjiDB v2 + the Words Layer only — the same fields scripts/build-kanji
 * .mjs assembles for level entries (component names = each component's own
 * KANJIDIC2 meaning; examples = JMdict common words). Nothing is invented:
 * fields with no source stay empty and their blocks simply do not render.
 */
async function buildDbKanjiItem(char, t) {
  const [meta, strokes] = await Promise.all([getKanjiMeta(char), getKanjiStrokes(char)])
  if (!meta) return null
  const topParts = [...new Set((strokes?.tree?.children || []).map((c) => c.element).filter((el) => el && el !== char))]
  const radicals = []
  for (const part of topParts) {
    const partMeta = await getKanjiMeta(part).catch(() => null)
    const name = partMeta?.meanings?.[0] || ''
    if (name) radicals.push({ part, name, icon: part })
  }
  const named = radicals.map((r) => `${r.part} (${r.name})`).join(' + ')
  const story = named
    ? t('lessons.storyBuilt', { char, parts: named })
    : t('lessons.storyNoParts', { char })
  const wordEntries = await wordsForKanji(char, 5).catch(() => [])
  const examples = wordEntries.map((e) => ({
    word: wordDisplayForm(e, char),
    reading: e.kana,
    meaning: e.gloss[0] || '',
  }))
  const formatKun = (raw) => {
    if (raw.startsWith('-') || raw.endsWith('-')) return null
    const [stem, tail] = raw.split('.')
    return tail ? `${stem}(${tail})` : stem
  }
  return {
    char,
    level: meta.level || '',
    on: (meta.on || []).join('・'),
    kun: (meta.kun || []).map(formatKun).filter(Boolean).join('・'),
    meaning: (meta.meanings || []).slice(0, 4).join(', ') || t('lessons.noGloss'),
    meaningFr: (meta.meaningsFr || []).slice(0, 3).join(', ') || '',
    strokes: meta.strokes,
    freq: meta.freq,
    grade: meta.grade,
    radicals,
    story,
    storyFr: '',
    word: examples[0] ? (examples[0].reading ? `${examples[0].word}（${examples[0].reading}）` : examples[0].word) : '',
    examples,
    emoji: '',
    doodle: topParts.join(''),
    gradient: KANJI_CARD_GRADIENTS[char.codePointAt(0) % KANJI_CARD_GRADIENTS.length],
    source: 'KANJIDIC2 / KanjiVG / JMdict',
  }
}

function Lessons() {
  const { t } = useLanguage()
  const [mode, setMode] = useState('kanji')
  const [kanjiBrowse, setKanjiBrowse] = useState('level')
  const [activeItem, setActiveItem] = useState(null)
  const [showBack, setShowBack] = useState(false)
  const [kanjiLevel, setKanjiLevel] = useState('N2')
  const [kanjiByLevel, setKanjiByLevel] = useState({})
  const [kanjiLoading, setKanjiLoading] = useState(false)

  useEffect(() => {
    if (mode !== 'kanji' || kanjiByLevel[kanjiLevel]) return
    let cancelled = false
    setKanjiLoading(true)
    loadKanjiLevel(kanjiLevel).then((rows) => {
      if (cancelled) return
      setKanjiByLevel((cur) => ({ ...cur, [kanjiLevel]: rows }))
      setKanjiLoading(false)
    })
    return () => { cancelled = true }
  }, [mode, kanjiLevel, kanjiByLevel])

  const kanjiList = kanjiByLevel[kanjiLevel] || []
  const list = mode === 'kanji' ? kanjiList : mode === 'grammar' ? grammarLessons : vocabLessons

  // Find By Parts results open exactly like level-list cards: the level
  // entry itself when the kanji has one, otherwise an item built from
  // KanjiDB + the Words Layer (buildDbKanjiItem above).
  const openFromParts = async (char) => {
    const all = await loadAllKanji().catch(() => [])
    const found = all.find((k) => k.char === char)
    if (found) { setActiveItem(found); setShowBack(false); return }
    const built = await buildDbKanjiItem(char, t).catch(() => null)
    if (built) { setActiveItem(built); setShowBack(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-white">{t('lessons.title')}</h2>
        <div className="flex p-1 rounded-xl bg-bun-700/60 border border-bun-600/40">
          {['kanji', 'grammar', 'vocab'].map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setActiveItem(null); setShowBack(false) }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition capitalize ${mode === m ? 'bg-[#FF6B57] text-white shadow' : 'text-slate-400 hover:text-white'}`}
            >
              {t(`lessons.mode.${m}`)} {mode === m && <Sparkles size={12} className="inline ml-1" />}
            </button>
          ))}
        </div>
      </div>

      {mode === 'kanji' && !activeItem && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{t('lessons.browse')}</span>
          <div className="flex gap-1.5">
            {[['level', 'lessons.browseLevel'], ['parts', 'lessons.browseParts']].map(([b, labelKey]) => (
              <button
                key={b}
                onClick={() => setKanjiBrowse(b)}
                aria-pressed={kanjiBrowse === b}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                  kanjiBrowse === b ? 'bg-[#FF6B57] text-white border-[#FF6B57]' : 'bg-bun-800 text-slate-400 border-bun-600/40 hover:text-white'
                }`}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'kanji' && !activeItem && kanjiBrowse === 'level' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{t('lessons.level')}</span>
          <div className="flex flex-wrap gap-1.5">
            {KANJI_LEVELS.map((lv) => (
              <button
                key={lv}
                onClick={() => setKanjiLevel(lv)}
                aria-pressed={kanjiLevel === lv}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                  kanjiLevel === lv ? 'bg-[#FF6B57] text-white border-[#FF6B57]' : 'bg-bun-800 text-slate-400 border-bun-600/40 hover:text-white'
                }`}
              >
                {lv}
              </button>
            ))}
          </div>
          {kanjiLoading && <Loader2 size={14} className="animate-spin text-slate-500" />}
          {!kanjiLoading && <span className="text-xs text-slate-500">{t('lessons.kanjiCount', { count: kanjiList.length })}</span>}
        </div>
      )}

      {activeItem ? (
        <div className="animate-slide-up">
          <button onClick={() => { setActiveItem(null); setShowBack(false) }} className="text-sm text-slate-400 hover:text-white mb-4 flex items-center gap-1">
            <ChevronRight size={14} className="rotate-180" /> {t('lessons.backToLibrary', { mode: t(`lessons.mode.${mode}`) })}
          </button>
          {mode === 'kanji' && <KanjiDetail item={activeItem} showBack={showBack} setShowBack={setShowBack} />}
          {mode === 'grammar' && <GrammarDetail item={activeItem} showBack={showBack} setShowBack={setShowBack} />}
          {mode === 'vocab' && <VocabDetail item={activeItem} showBack={showBack} setShowBack={setShowBack} />}
        </div>
      ) : mode === 'kanji' && kanjiBrowse === 'parts' ? (
        <ComponentSearch onOpenKanji={openFromParts} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((item, i) => (
            <button key={i} onClick={() => { setActiveItem(item); setShowBack(false) }} className="text-left rounded-2xl bg-[#151129] border border-white/5 p-5 hover:border-[#FF6B57]/30 transition group">
              <div className="w-14 h-14 rounded-2xl bg-bun-700 border border-bun-600/40 flex items-center justify-center text-2xl shadow-lg mb-4 group-hover:scale-105 transition">
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
  const { t } = useLanguage()
  const { open: openKanji } = useKanjiModal()
  // Fleet integration (2026-11-08): studying this kanji counts
  // its example word as genuinely met, and the word (or the
  // kanji itself) can be kept in the one queue from here.
  const exampleWord = (item.word || '').split('（')[0].split('(')[0].trim()
  useEffect(() => {
    if (exampleWord) { try { recordEncounters([exampleWord]) } catch { /* never blocks */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item])
  return (
    <div className="rounded-3xl bg-[#151129] border border-white/5 p-6 sm:p-10">
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className="w-40 h-40 shrink-0 rounded-3xl bg-[#71368A]/15 border border-[#71368A]/30 flex items-center justify-center text-7xl font-bold text-white shadow-2xl">{item.char}</div>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-4xl font-bold text-white">{item.char}</h2>
            <Badge color="plum">{item.on} · {item.kun}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="text-xl text-slate-200">{item.meaning}</p>
            {item.meaningFr && <span className="text-sm text-slate-500">/ {item.meaningFr}</span>}
          </div>
          <p className="text-sm text-slate-400 mb-4">{item.word}</p>

          {/* The old emoji "scene drawing" strip is gone: the
              Kanji Lens is where this kanji is taken apart now
              (stroke order, build-up, draw it, sound family) —
              one quiet door instead of a deprecated doodle. */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <button onClick={() => openKanji(item)} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium transition">
              {t('lessons.openLens')}
            </button>
            <AddToQueueButton front={exampleWord || item.char} back={item.meaning} reading={item.on && item.kun ? `${item.on} · ${item.kun}` : undefined} source="lessons" />
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            {item.radicals.map((r, i) => (
              <div key={i} className="rounded-xl bg-bun-700/50 border border-bun-600/30 p-4 flex items-center gap-3">
                <span className="text-2xl font-bold text-white">{r.part}</span>
                <div><p className="text-sm font-bold text-white">{r.part} · {r.name}</p><p className="text-xs text-slate-400">{t('lessons.component', { n: i + 1 })}</p></div>
              </div>
            ))}
          </div>

          <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 mb-4">
            <h3 className="text-sm font-bold text-[#FF8A75] mb-2 flex items-center gap-2"><Brain size={16} /> {t('lessons.visualStory')}</h3>
            <KanjiTapText text={item.story} className="text-slate-300" />
          </div>

          {item.storyFr && (
            <div className="rounded-xl bg-bun-700/30 border border-bun-600/20 p-4 mb-6">
              <h3 className="text-sm font-bold text-slate-400 mb-2">{t('lessons.storyFrTitle')}</h3>
              <KanjiTapText text={item.storyFr} className="text-slate-300 text-sm" />
            </div>
          )}

          {item.example ? (
            <>
              <button onClick={() => setShowBack((s) => !s)} className="px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-medium transition">{showBack ? t('lessons.hideExample') : t('lessons.showExample')}</button>
              {showBack && (
                <div className="mt-4 rounded-xl bg-bun-700/40 border border-bun-600/20 p-4 animate-fade-in">
                  <div className="text-slate-100 font-medium text-lg leading-loose mb-2">
                    <Furigana text={item.example} glossary={item.exampleGlossary} />
                  </div>
                  <p className="text-sm text-slate-400">{t('lessons.exampleHintTap')}</p>
                </div>
              )}
            </>
          ) : item.examples?.length > 0 && (
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
              <h3 className="text-sm font-bold text-[#FF8A75] mb-3">{t('lessons.realWords', { char: item.char })}</h3>
              <div className="flex flex-wrap gap-2">
                {item.examples.map((w, i) => (
                  <span key={i} className="text-sm px-3 py-1.5 rounded-full bg-bun-700/60 border border-bun-600/30 text-slate-200">
                    {w.word}{w.reading && <span className="text-slate-400"> ({w.reading})</span>} <span className="text-slate-500">· {w.meaning}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function GrammarDetail({ item, showBack, setShowBack }) {
  const { t } = useLanguage()
  return (
    <div className="rounded-3xl bg-[#151129] border border-white/5 p-6 sm:p-10">
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className="w-32 h-32 shrink-0 rounded-3xl bg-[#71368A]/15 border border-[#71368A]/30 flex items-center justify-center text-5xl shadow-2xl">{item.image}</div>
        <div className="flex-1">
          <h2 className="text-3xl font-bold text-white mb-2">{item.pattern}</h2>
          <Badge color="plum">{item.form}</Badge>
          <div className="flex flex-wrap items-center gap-2 mt-4 mb-2">
            <p className="text-lg text-slate-200">{item.meaning}</p>
            {item.meaningFr && <span className="text-sm text-slate-500">/ {item.meaningFr}</span>}
          </div>
          <p className="text-sm text-slate-400 mb-6">{item.nuance}</p>

          <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 mb-4">
            <h3 className="text-sm font-bold text-[#FF8A75] mb-2 flex items-center gap-2"><Eye size={16} /> {t('lessons.visualScenario')}</h3>
            <KanjiTapText text={item.scene} className="text-slate-300" />
          </div>

          {item.sceneFr && (
            <div className="rounded-xl bg-bun-700/30 border border-bun-600/20 p-4 mb-6">
              <h3 className="text-sm font-bold text-slate-400 mb-2">{t('lessons.sceneFrTitle')}</h3>
              <KanjiTapText text={item.sceneFr} className="text-slate-300 text-sm" />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowBack((s) => !s)} className="px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-medium transition">{showBack ? t('lessons.hideExample') : t('lessons.showExample')}</button>
            <AddToQueueButton front={item.pattern} back={item.meaning} source="lessons" />
          </div>
          {showBack && (
            <div className="mt-4 rounded-xl bg-bun-700/40 border border-bun-600/20 p-4 animate-fade-in">
              <div className="text-slate-100 font-medium text-lg leading-loose mb-2">
                <Furigana text={item.example} glossary={item.exampleGlossary} />
              </div>
              <p className="text-sm text-slate-400">{t('lessons.exampleHintTap')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function VocabDetail({ item, showBack, setShowBack }) {
  const { t } = useLanguage()
  // Fleet integration (2026-11-08): opening this word counts it
  // as genuinely met; it can be kept in the one queue from here.
  useEffect(() => {
    if (item.word) { try { recordEncounters([item.word]) } catch { /* never blocks */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item])
  return (
    <div className="rounded-3xl bg-[#151129] border border-white/5 p-6 sm:p-10">
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className="w-32 h-32 shrink-0 rounded-3xl bg-[#71368A]/15 border border-[#71368A]/30 flex items-center justify-center text-5xl shadow-2xl">{item.image}</div>
        <div className="flex-1">
          <h2 className="text-4xl font-bold text-white mb-2">{item.word}</h2>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Badge color="plum">{item.reading}</Badge>
            <Badge color="emerald">{item.meaning}</Badge>
            {item.meaningFr && <Badge color="plum">{item.meaningFr}</Badge>}
          </div>

          <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 mb-4">
            <h3 className="text-sm font-bold text-[#FF8A75] mb-2 flex items-center gap-2"><Brain size={16} /> {t('lessons.memoryImage')}</h3>
            <KanjiTapText text={item.story} className="text-slate-300" />
          </div>

          {item.storyFr && (
            <div className="rounded-xl bg-bun-700/30 border border-bun-600/20 p-4 mb-6">
              <h3 className="text-sm font-bold text-slate-400 mb-2">{t('lessons.memoryFrTitle')}</h3>
              <KanjiTapText text={item.storyFr} className="text-slate-300 text-sm" />
            </div>
          )}

          <p className="text-sm text-slate-400 mb-2">{t('lessons.collocation')}{' '}<KanjiTapText text={item.collocation} className="text-slate-200" /></p>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowBack((s) => !s)} className="px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-medium transition">{showBack ? t('lessons.hideExample') : t('lessons.showExample')}</button>
            <AddToQueueButton front={item.word} back={item.meaning} reading={item.reading} source="lessons" />
          </div>
          {showBack && (
            <div className="mt-4 rounded-xl bg-bun-700/40 border border-bun-600/20 p-4 animate-fade-in">
              <div className="text-slate-100 font-medium text-lg leading-loose mb-2">
                <Furigana text={item.example} glossary={item.exampleGlossary} />
              </div>
              <p className="text-sm text-slate-400">{t('lessons.exampleHintSay')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Drills() {
  const { t } = useLanguage()
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
    const picked = shuffled.slice(0, Math.min(10, questions.length))
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

  if (pool.length === 0) return <div className="text-center py-20 text-slate-400"><p>{t('legacy.drills.emptyFilter')}</p></div>
  const question = pool[index]

  const handleSelect = (i) => {
    if (answered) return
    const isCorrect = question.options[i].correct
    const nextScore = isCorrect ? score + 1 : score
    setSelected(i)
    setAnswered(true)
    setScore(nextScore)
    setDaily((d) => ({ ...d, index, selected: i, answered: true, score: nextScore, completed: false }))
    if (!isCorrect) {
      const correct = question.options.find((o) => o.correct)
      const entry = {
        section: question.type,
        mistake: question.target ? `${question.target} — ${question.prompt}` : question.prompt,
        cause: `Chose: ${question.options[i].label}`,
        fix: `Correct: ${correct?.label || ''}${question.explanation ? `. ${question.explanation}` : ''}`.trim(),
        created_at: new Date().toISOString(),
        review_count: 0,
        next_review: (() => { const t = new Date(); t.setDate(t.getDate() + 1); return t.toISOString() })(),
      }
      if (user) {
        addErrorLog(user.id, entry)
      } else {
        const raw = localStorage.getItem(userKey(user, 'error-log'))
        const logs = raw ? JSON.parse(raw) : []
        logs.unshift({ id: Date.now(), ...entry })
        localStorage.setItem(userKey(user, 'error-log'), JSON.stringify(logs))
      }
      // Drills joins the system (Landry, 2026-11-08: "Does it
      // contribute to your level?" — it did not; a miss evaporated
      // into the legacy error log only). Same mirror as Speed
      // Cards: the missed item joins the ONE queue (source
      // 'drills', deduped by addToQueue) and the lapse is
      // classified into the Twin fingerprint. Recognition is not
      // recall, so the card's FSRS is not rated here.
      try {
        const added = addToQueue([{
          front: entry.mistake,
          back: entry.fix,
          note: `Drill · ${question.type || ''} · you chose: ${question.options[i].label}`,
          source: 'drills',
          level: question.level || '',
        }])
        const item = added.queue.find((x) => x.front === entry.mistake && x.source === 'drills')
        if (item) recordQueueRating(item, 1)
      } catch { /* the queue mirror never blocks the drill */ }
    }
  }

  const next = () => {
    let requeued = 0
    if (mode === 'daily' && question && selected !== null && !question.options[selected].correct) {
      setDaily((d) => ({ ...d, indices: [...d.indices, d.indices[index]] }))
      requeued = 1
    }
    const nextIndex = index + 1
    if (nextIndex >= pool.length + requeued) {
      setFinished(true)
      // A finished run lands in the metrics ledger like every
      // other surface's work (mocks, BJT, sessions) — drills used
      // to leave no trace outside their own score counter.
      try { recordMetric('drills_completed', { mode, score, total: pool.length }) } catch { /* never blocks */ }
      if (mode === 'daily') setDaily((d) => ({ ...d, completed: true, score, selected: null, answered: false }))
    } else {
      setIndex(nextIndex)
      setSelected(null)
      setAnswered(false)
      setDaily((d) => ({ ...d, index: nextIndex, selected: null, answered: false }))
    }
  }

  const tryAgain = () => {
    setSelected(null)
    setAnswered(false)
    setDaily((d) => ({ ...d, selected: null, answered: false }))
  }

  const restart = () => {
    if (mode === 'daily') {
      const today = new Date().toDateString()
      const shuffled = [...questions].map((_, i) => i).sort(() => Math.random() - 0.5)
      const picked = shuffled.slice(0, Math.min(10, questions.length))
      setDaily({ date: today, indices: picked, completed: false, score: 0, index: 0, selected: null, answered: false })
    }
    setIndex(0); setSelected(null); setAnswered(false); setScore(0); setFinished(false)
  }

  if (mode === 'daily' && daily.completed) {
    const pct = Math.round(((daily.score || 0) / pool.length) * 100)
    return (
      <div className='max-w-2xl mx-auto text-center py-12 animate-fade-in'>
        <div className='w-20 h-20 mx-auto rounded-full bg-bun-700 flex items-center justify-center text-4xl mb-6'>{pct >= 70 ? '🎉' : '🔥'}</div>
        <h2 className='text-3xl font-bold text-white mb-2'>{t('legacy.drills.completeDaily')}</h2>
        <p className='text-lg text-slate-300 mb-6'>{t('legacy.drills.scoreLine', { score: daily.score || 0, total: pool.length, pct })}</p>
        <div className='h-3 w-64 mx-auto rounded-full bg-bun-700 overflow-hidden mb-8'><div className={`h-full ${pct >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: pct + '%' }} /></div>
        <div className='flex justify-center gap-4'>
          <button onClick={() => { setMode('free'); setFilter('all') }} className='px-6 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium transition'>{t('legacy.drills.freePractice')}</button>
        </div>
      </div>
    )
  }

  if (finished) {
    const pct = Math.round((score / pool.length) * 100)
    return (
      <div className="max-w-2xl mx-auto text-center py-12 animate-fade-in">
        <div className="w-20 h-20 mx-auto rounded-full bg-bun-700 flex items-center justify-center text-4xl mb-6">{pct >= 70 ? '🎉' : '🔥'}</div>
        <h2 className='text-3xl font-bold text-white mb-2'>{mode === 'daily' ? t('legacy.drills.completeDaily') : t('legacy.drills.completeDrill')}</h2>
        <p className="text-lg text-slate-300 mb-6">{t('legacy.drills.scoreLine', { score, total: pool.length, pct })}</p>
        <div className="h-3 w-64 mx-auto rounded-full bg-bun-700 overflow-hidden mb-8"><div className={`h-full ${pct >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: pct + '%' }} /></div>
        <div className="flex justify-center gap-4">
          <button onClick={restart} className="px-6 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium transition"><RotateCcw size={16} className="inline mr-2" /> {t('legacy.drills.retry')}</button>
          {mode === 'free' ? (
            <button onClick={() => setFilter('all')} className='px-6 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-white font-medium transition'>{t('legacy.drills.allQuestions')}</button>
          ) : (
            <button onClick={() => setMode('free')} className='px-6 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-white font-medium transition'>{t('legacy.drills.freePractice')}</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className='flex items-center gap-3 flex-wrap'>
          <h2 className='text-2xl font-bold text-white'>{t('legacy.drills.title')}</h2>
          <span className='text-xs text-slate-500 hidden sm:inline'>{mode === 'daily' ? t('legacy.drills.daily10') : t('legacy.drills.freePractice')}</span>
          <div className='flex p-1 rounded-lg bg-bun-700/40 border border-bun-600/30'>
            {['daily', 'free'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition ${mode === m ? 'bg-[#FF6B57] text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {m === 'daily' ? t('legacy.drills.modeDaily') : t('legacy.drills.modeFree')}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Filter size={16} className="text-slate-400" />
          {['all', 'vocabulary', 'grammar'].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-lg border transition ${filter === f ? 'bg-[#FF6B57]/20 border-[#FF6B57]/50 text-[#FFA08D]' : 'bg-bun-700/40 border-bun-600/30 text-slate-400 hover:text-white'}`}>{f === 'all' ? t('legacy.drills.filterAll') : f === 'vocabulary' ? t('legacy.drills.filterVocabulary') : t('legacy.drills.filterGrammar')}</button>
          ))}
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-bun-700 overflow-hidden"><div className="h-full bg-gradient-to-r from-[#71368A] to-cyan-500 transition-all" style={{ width: ((index + (answered ? 1 : 0)) / pool.length) * 100 + '%' }} /></div>
      <div className="rounded-3xl glass p-6 sm:p-8 card-glow">
        <div className='flex items-center justify-between mb-4'><span className='text-sm text-slate-400'>{question.type} · {question.format}</span><span className='text-sm text-slate-400'>{mode === 'daily' ? t('legacy.drills.dailyPrefix') : ''}{index + 1} / {pool.length}</span></div>
        <div className="rounded-2xl bg-bun-700/40 border border-bun-600/20 p-5 mb-6">
          <KanjiTapText text={question.prompt} className="text-lg text-slate-100" />
          {question.target && <p className="text-sm text-[#FF8A75] mt-3">{t('legacy.drills.targetLabel')} 「<KanjiTapText text={question.target} className="text-[#FF8A75]" />」</p>}
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          {question.options.map((opt, i) => {
            const show = answered, correct = opt.correct, chosen = selected === i
            let cls = 'w-full text-left px-4 py-3.5 rounded-xl border transition font-medium text-slate-100 '
            if (show) { if (correct) cls += 'bg-emerald-500/15 border-emerald-500/50'; else if (chosen) cls += 'bg-rose-500/15 border-rose-500/50'; else cls += 'bg-bun-700/30 border-bun-600/30 opacity-60' }
            else cls += 'bg-bun-700/50 border-bun-600/30 hover:border-[#FF6B57]/50 hover:bg-bun-700'
            return (
              <button key={i} onClick={() => handleSelect(i)} disabled={answered} className={cls}>
                <span className="text-slate-500 mr-2">{String.fromCharCode(65 + i)}.</span><KanjiTapText text={opt.label} className="text-slate-100" />
                {show && correct && <CheckCircle2 size={16} className="inline ml-auto text-emerald-400 float-right" />}
                {show && chosen && !correct && <XCircle size={16} className="inline ml-auto text-rose-400 float-right" />}
              </button>
            )
          })}
        </div>
        {answered && (
          <div className="rounded-2xl bg-gradient-to-r from-[#71368A]/30 to-[#FF6B57]/20 border border-[#FF6B57]/20 p-5 mb-6 animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              {question.options[selected].correct ? <CheckCircle2 size={18} className="text-emerald-400" /> : <XCircle size={18} className="text-rose-400" />}
              <span className="font-bold text-white">{question.options[selected].correct ? t('legacy.drills.correct') : t('legacy.drills.notQuite')}</span>
            </div>
            <KanjiTapText text={question.explanation} className="text-slate-300" />
            <p className="text-sm text-slate-400 mt-2"><KanjiTapText text={question.hint} className="text-slate-400" /></p>
          </div>
        )}
        {answered && (
          <div className="flex items-center justify-between">
            {!question.options[selected].correct && (
              <button onClick={tryAgain} className="px-6 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 font-medium transition flex items-center gap-2">
                <RotateCcw size={16} /> {t('legacy.drills.tryAgain')}
              </button>
            )}
            <button onClick={next} className="ml-auto px-6 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium transition">{index + 1 === pool.length ? t('legacy.drills.finish') : t('legacy.drills.next')}</button>
          </div>
        )}
      </div>
      <p className="text-center text-sm text-slate-500">{t('legacy.drills.scoreFooter', { score, answered: index + (answered ? 1 : 0) })}</p>
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
  const { t } = useLanguage()
  const [playing, setPlaying] = useState(null)
  const byCategory = resources.reduce((acc, r) => {
    acc[r.category] = [...(acc[r.category] || []), r]
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('legacy.resources.title')}</h2>
      {Object.entries(byCategory).map(([cat, list]) => (
        <div key={cat}>
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">{cat}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((r) => (
              <div key={r.name} className="rounded-2xl glass p-5 card-glow hover:border-[#FF6B57]/30 transition">
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
                    <p className="absolute bottom-0 inset-x-0 p-2 text-[10px] text-slate-300 bg-gradient-to-t from-black/70 to-transparent">{t('legacy.resources.watchHint')}</p>
                  </button>
                )}
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-bun-700 flex items-center justify-center text-lg">
                    {resourceIcon[cat] || '📚'}
                  </div>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" className="p-2 rounded-lg bg-[#FF6B57]/20 text-[#FF8A75] hover:bg-[#FF6B57]/30 transition">
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

// Fleet coherence (Landry, 2026-11-08): a hub is the glanceable
// map for a whole family of views — one menu door, every mode one
// tap inside, each card carrying the same label the menu used.
function HubView({ titleKey, itemIds, setActive }) {
  const { t } = useLanguage()
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-bold text-white">{t(titleKey)}</h2>
      <div className="grid grid-cols-2 gap-3">
        {itemIds.map((id) => {
          const item = nav.find((n) => n.id === id)
          if (!item) return null
          const Icon = item.icon
          return (
            <button key={id} onClick={() => setActive?.(id)} className="text-left rounded-2xl bg-[#151129] border border-white/5 p-4 hover:border-[#FF6B57]/40 transition">
              <Icon size={20} className="text-[#FF8A75]" />
              <p className="font-semibold text-white text-sm mt-2.5">{t(item.labelKey)}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// One door from any content surface into the ONE review queue —
// a looked-up or studied item can always be kept, and the button
// says so once it is in.
function AddToQueueButton({ front, back, reading, level, source = 'lessons' }) {
  const { t } = useLanguage()
  const [added, setAdded] = useState(() => { try { return loadQueue().some((i) => i.front === front) } catch { return false } })
  if (!front) return null
  if (added) return <p className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle2 size={13} /> {t('lessons.inQueue')}</p>
  return (
    <button
      onClick={() => { try { addToQueue([{ front, back, reading, level, source }]); setAdded(true) } catch { /* never blocks */ } }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bun-700 hover:bg-bun-600 text-slate-200 text-xs font-medium transition"
    >
      <Plus size={13} /> {t('lessons.addToQueue')}
    </button>
  )
}

function ReadingView({ setActive: goView }) {
  const { t } = useLanguage()
  const [sub, setSub] = useState('passages')
  const [active, setActive] = useState(0)
  const [answered, setAnswered] = useState([])
  const [query, setQuery] = useState('')

  const passage = passages[active]

  // Fleet integration (Landry, 2026-11-08): these essays used to
  // sit outside everything. Now opening one counts its glossary
  // as words genuinely met (the Reader's fit can credit them),
  // finishing its questions lands in the Twin's reading trail,
  // and every glossary word can be kept in the one queue.
  useEffect(() => {
    try { recordEncounters((passage.glossary || []).map((g) => g.word)) } catch { /* never blocks */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const readingDoneRef = useRef(new Set())
  useEffect(() => {
    const ans = answered[active]
    if (!ans || !passage.questions?.length) return
    if (!passage.questions.every((_, qi) => ans[qi] !== undefined)) return
    if (readingDoneRef.current.has(active)) return
    readingDoneRef.current.add(active)
    const correct = passage.questions.reduce((a, q, qi) => a + (q.options[ans[qi]]?.correct ? 1 : 0), 0)
    try { recordReading({ correct: correct === passage.questions.length }) } catch { /* never blocks */ }
    try { recordMetric('reading_completed', { title: passage.title, correct, total: passage.questions.length }) } catch { /* never blocks */ }
  }, [answered, active, passage])

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
        <h2 className="text-2xl font-bold text-white">{t('legacy.reading.title')}</h2>
        <div className="flex p-1 rounded-xl bg-bun-700/60 border border-bun-600/40">
          {['passages', 'strategy'].map((s) => (
            <button key={s} onClick={() => setSub(s)} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${sub === s ? 'bg-[#FF6B57] text-white shadow' : 'text-slate-400 hover:text-white'}`}>{s === 'passages' ? t('legacy.reading.tabPassages') : t('legacy.reading.tabStrategy')}</button>
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
              placeholder={t('legacy.reading.searchPlaceholder')}
              className="w-full rounded-xl bg-bun-800 border border-bun-600/40 pl-10 pr-4 py-3 text-slate-100 placeholder-slate-500 focus:border-[#FF6B57] focus:outline-none"
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
                className={`text-left rounded-2xl p-4 border transition ${active === i ? 'bg-[#FF6B57]/15 border-[#FF6B57]/40' : 'bg-bun-800/60 border-bun-600/30 hover:border-bun-500/40'}`}
              >
                <p className="font-semibold text-white text-sm">{p.title}</p>
                <p className="text-xs text-slate-400 mt-1">{t('legacy.reading.cardMeta', { level: p.level, time: p.time })}</p>
              </button>
            ))}
          </div>

          <div className="rounded-3xl bg-[#151129] border border-white/5 p-6 sm:p-8">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-xl font-bold text-white mb-2">{passage.title}</h3>
              <button onClick={() => goView?.('reader')} className="shrink-0 text-xs text-[#FF8A75] hover:text-[#FF6B57] transition">{t('twin.reader.openHere')} →</button>
            </div>
            <p className="text-xs text-slate-400 mb-6">{t('legacy.reading.targetTime', { level: passage.level, time: passage.time })}</p>

            <div className="rounded-2xl bg-bun-700/40 border border-bun-600/20 p-6 mb-8 leading-loose text-lg text-slate-100">
              <Furigana text={passage.text} glossary={passage.glossary} />
            </div>

            <h4 className="text-sm font-bold text-[#FF8A75] mb-3 flex items-center gap-2"><Brain size={16} /> {t('legacy.reading.glossaryTitle')}</h4>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
              {passage.glossary.map((g, i) => (
                <div key={i} className="group rounded-xl bg-bun-700/40 border border-bun-600/30 p-4 hover:border-[#FF6B57]/40 transition">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl group-hover:scale-110 transition">{g.image}</span>
                    <div>
                      <p className="font-bold text-white">{g.word}</p>
                      <p className="text-xs text-slate-400">{g.reading}</p>
                    </div>
                  </div>
                  <p className="text-sm text-slate-300">{g.meaning}</p>
                  <p className="text-xs text-slate-500 mt-2 line-clamp-2">{g.mnemonic}</p>
                  <div className="mt-3"><AddToQueueButton front={g.word} back={g.meaning} reading={g.reading} source="reading" /></div>
                </div>
              ))}
            </div>

            <h4 className="text-sm font-bold text-cyan-300 mb-3">{t('legacy.reading.questionsTitle')}</h4>
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
                          : 'bg-bun-700/40 border-bun-600/30 hover:border-[#FF6B57]/50 hover:bg-bun-700'
                      }`
                      return (
                        <button key={oi} onClick={() => !show && toggleAnswer(qi, oi)} disabled={show} className={cls}>
                          <span className="text-slate-500 mr-2">{String.fromCharCode(65 + oi)}.</span><KanjiTapText text={opt.label} className="text-slate-100" />
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
              <div key={i} className="rounded-3xl bg-[#151129] border border-white/5 p-6">
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
          <div className="rounded-3xl bg-[#151129] border border-white/5 p-6">
            <h3 className="text-lg font-bold text-white mb-4">{t('legacy.reading.timingTitle')}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-slate-500 border-b border-bun-600/30"><tr><th className="py-2 pr-6">{t('legacy.reading.thPassage')}</th><th className="py-2 pr-6">{t('legacy.reading.thQuestions')}</th><th className="py-2 pr-6">{t('legacy.reading.thTime')}</th><th className="py-2">{t('legacy.reading.thFocus')}</th></tr></thead>
                <tbody className="text-slate-300">
                  {['short', 'medium', 'long'].map((rowId) => (
                    <tr key={rowId} className="border-b border-bun-600/20 last:border-0">{[1, 2, 3, 4].map((j) => <td key={j} className="py-2 pr-6">{t(`legacy.reading.cell.${rowId}.${j}`)}</td>)}</tr>
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
  const { t } = useLanguage()
  const activeStage = daysToExam > 120 ? 1 : daysToExam > 60 ? 2 : 3
  const weekFocus = daysToExam > 120
    ? t('legacy.plan.focus1')
    : daysToExam > 90
    ? t('legacy.plan.focus2')
    : daysToExam > 45
    ? t('legacy.plan.focus3')
    : t('legacy.plan.focus4')

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">{t('legacy.plan.title')}</h2>
      <div className="rounded-3xl glass p-6 card-glow border-l-4 border-[#FF6B57]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider">{t('legacy.plan.currentFocus', { days: daysToExam })}</p>
            <h3 className="text-lg font-bold text-white mt-1">{weekFocus}</h3>
          </div>
          <div className="px-4 py-2 rounded-xl bg-bun-700/50 text-center">
            <p className="text-2xl font-bold text-white">{daysToExam}</p>
            <p className="text-xs text-slate-400">{t('legacy.plan.daysTo', { level: 'N2' })}</p>
          </div>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        {plan.map((p, i) => (
          <div key={i} className={`rounded-3xl glass p-6 card-glow relative overflow-hidden ${p.stage === activeStage ? 'ring-2 ring-[#FF6B57]/40' : ''}`}>
            <div className={`absolute top-0 left-0 w-1.5 h-full ${p.stage === 1 ? 'bg-gradient-to-b from-cyan-400 to-blue-500' : 'bg-gradient-to-b from-[#71368A] to-[#FF6B57]'}`} />
            <div className="ml-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('legacy.plan.stage', { n: p.stage })}</span>
                {p.stage === activeStage && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#FF6B57]/20 text-[#FF8A75]">{t('legacy.plan.active')}</span>}
              </div>
              <h3 className="text-lg font-bold text-white mt-1">{p.phase}</h3>
              <p className="text-sm text-slate-400 mt-2 mb-4">{p.focus}</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {p.actions.map((a, j) => (
                  <div key={j} className="flex items-start gap-2 bg-bun-700/40 rounded-xl p-3 text-sm text-slate-300"><span className="text-[#FF8A75] font-bold shrink-0">{j + 1}.</span>{a}</div>
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
  const { t } = useLanguage()
  const { isSupabaseConfigured } = useAuth()
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(!isSupabaseConfigured)
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
      } catch {
        // Silent by design: the curated shelf below is the fallback.
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
        <p className="text-slate-400">{t('legacy.videos.notConfigured')}</p>
      </div>
    )
  }

  const renderCard = (v) => (
    <button
      key={v.id}
      onClick={() => setPlaying(v)}
      className="text-left rounded-2xl bg-[#151129] border border-white/5 p-4 hover:border-[#FF6B57]/40 transition group"
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
        <h2 className="text-2xl font-bold text-white">{t('legacy.videos.title')}</h2>
        <p className="text-sm text-slate-400 mt-1">{t('legacy.videos.subtitle')}</p>
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 size={20} className="animate-spin" /> {t('legacy.videos.loading')}
        </div>
      )}
      {/* No API talk on screen (fleet coherence, 2026-11-08): if
          the live search fails or comes back empty, the curated
          shelf simply shows — the learner never sees plumbing. */}
      {!loading && videos.length === 0 && (
        <div className="space-y-6">
          <h3 className="text-lg font-bold text-white">{t('legacy.videos.featured')}</h3>
          <div className="grid md:grid-cols-2 gap-6">
            {FALLBACK_VIDEOS.map(renderCard)}
          </div>
        </div>
      )}
      {!loading && videos.length > 0 && (
        <div className="space-y-8">
          {Object.entries(byCategory).map(([cat, list]) => (
            <div key={cat}>
              <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                <Badge color={cat === 'Grammar' ? 'plum' : cat === 'Vocabulary' ? 'emerald' : cat === 'Kanji' ? 'amber' : 'slate'}>{cat}</Badge>
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
  const { t } = useLanguage()
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

  // Fleet integration (Landry, 2026-11-08): the log is no longer
  // a second review queue. Every slip in it also lives in the ONE
  // FSRS queue — that is where reviewing happens — so any entry
  // without a queue twin gets one, silently, on load. The server
  // rows stay: the AI Tutor's review mode reads them.
  const backfilledRef = useRef(false)
  useEffect(() => {
    if (loading || backfilledRef.current) return
    backfilledRef.current = true
    try {
      const fronts = new Set(loadQueue().map((i) => i.front))
      const missing = logs.filter((l) => l.mistake && !fronts.has(l.mistake))
      if (missing.length) {
        addToQueue(missing.map((l) => ({ front: l.mistake, back: l.fix || '', note: l.section || '', source: 'errors' })))
      }
    } catch { /* never blocks */ }
  }, [loading, logs])

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
    // A hand-logged slip joins the one queue in the same act.
    try { addToQueue([{ front: entry.mistake, back: entry.fix || '', note: entry.section, source: 'errors' }]) } catch { /* never blocks */ }
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
        <h2 className="text-2xl font-bold text-white">{t('legacy.errors.title')}</h2>
        <span className="text-xs text-slate-500">{isSupabaseConfigured ? t('legacy.errors.synced') : t('legacy.errors.local')}</span>
      </div>
      <form onSubmit={add} className="rounded-3xl bg-[#151129] border border-white/5 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('legacy.errors.sectionLabel')}</label>
          <select value={section} onChange={(e) => setSection(e.target.value)} className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none">
            <option value="Vocabulary">{t('legacy.errors.section.vocabulary')}</option><option value="Grammar">{t('legacy.errors.section.grammar')}</option><option value="Reading">{t('legacy.errors.section.reading')}</option><option value="Listening">{t('legacy.errors.section.listening')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('legacy.errors.mistakeLabel')}</label>
          <input value={mistake} onChange={(e) => setMistake(e.target.value)} placeholder={t('legacy.errors.mistakePlaceholder')} className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-[#FF6B57] focus:outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('legacy.errors.causeLabel')}</label>
          <input value={cause} onChange={(e) => setCause(e.target.value)} placeholder={t('legacy.errors.causePlaceholder')} className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-[#FF6B57] focus:outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('legacy.errors.fixLabel')}</label>
          <input value={fix} onChange={(e) => setFix(e.target.value)} placeholder={t('legacy.errors.fixPlaceholder')} className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-[#FF6B57] focus:outline-none" />
        </div>
        <button type="submit" disabled={saving} className="px-6 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] disabled:opacity-60 text-white text-sm font-medium transition flex items-center justify-center gap-2">
          {saving ? <Loader2 size={16} className="animate-spin" /> : null}
          {t('legacy.errors.addEntry')}
        </button>
      </form>

      {loading ? (
        <div className="space-y-3 py-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : logs.length === 0 ? (
        <p className="text-center text-slate-500 py-8">{t('legacy.errors.empty')}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">{t('legacy.errors.queueNote')}</p>
          {logs.map((l) => (
              <div key={l.id} className="rounded-2xl bg-[#151129] border border-white/5 p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <Badge color={l.section === 'Vocabulary' ? 'emerald' : l.section === 'Grammar' ? 'plum' : 'amber'}>{{ Vocabulary: t('legacy.errors.section.vocabulary'), Grammar: t('legacy.errors.section.grammar'), Reading: t('legacy.errors.section.reading'), Listening: t('legacy.errors.section.listening') }[l.section] || l.section}</Badge>
                    <span className="text-xs text-slate-400">{new Date(l.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="font-semibold text-slate-100"><KanjiTapText text={l.mistake} className="text-slate-100 font-semibold" /></p>
                  {l.cause && <p className="text-sm text-rose-300 mt-1">{t('legacy.errors.causePrefix')} <KanjiTapText text={l.cause} className="text-rose-300" /></p>}
                  {l.fix && <p className="text-sm text-emerald-300 mt-1">{t('legacy.errors.fixPrefix')} <KanjiTapText text={l.fix} className="text-emerald-300" /></p>}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <button onClick={() => remove(l.id)} className="text-xs text-slate-500 hover:text-rose-400">{t('legacy.errors.delete')}</button>
                </div>
              </div>
          ))}
        </div>
      )}
    </div>
  )
}

function App() {
  const { t } = useLanguage()
  const { user, loading, isSupabaseConfigured, signOut, guest } = useAuth()
  // First-sync gate: auth resolving is not data resolving — while
  // the account's first state pull is in flight, the shell stays
  // a skeleton instead of painting factory defaults (an N4, an
  // empty queue, the welcome questionnaire) as if they were the
  // learner's real state (Landry, 2026-11-11).
  const syncPending = useSyncExternalStore(subscribeStateSync, isFirstSyncPending, () => false)
  // Privacy/Terms are real routes (TwinView + the legal pages link to
  // them) but not menu items — the router's valid list must still
  // know them, or #/privacy silently falls back to Today (audit P0-1).
  const [active, setActive] = useHashRoute('dashboard', [...navIds, 'privacy', 'terms'])
  const [mobileOpen, setMobileOpen] = useState(false)
  // Guest → account door (Doc 12 audit #1): the AuthModal as a
  // dismissible overlay, opened deliberately (sidebar Create Your
  // Account). It closes itself the moment a session lands.
  const [authOverlay, setAuthOverlay] = useState(false)
  useEffect(() => { if (user) setAuthOverlay(false) }, [user])
  const [streak, setStreak] = useState(0)
  const [dictionary, setDictionary] = useState(localDictionary)
  const { nextExam, daysToExam, examLabel, setting: examSetting, setSetting: setExamSetting } = useExamDate()

  // The literal /reader path (Doc 16 §2): the Telegram "Open in
  // Reader" button points at https://jpn2easy.vercel.app/reader, and
  // vercel.json's SPA fallback serves this app there — open on the
  // Reader view when we land on that path. /session is the same
  // door for the bot's no-fit replies: their copy names a study
  // session as the way forward, so the button lands on the session
  // itself, not the app root (integration audit, exact doors).
  useEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, '')
    if (path === '/reader') setActive('reader')
    else if (path === '/session') setActive('session')
  }, [setActive])

  // P1-5: the ~1 MB deck used to download on every cold start for the
  // selection popup alone. It now loads lazily — the first time the
  // learner actually selects text (localDictionary covers lesson words
  // instantly; the full deck lands a moment later).
  const dictRequestedRef = useRef(false)
  const ensureDictionary = () => {
    if (dictRequestedRef.current) return
    dictRequestedRef.current = true
    loadDictionary().then((dict) => setDictionary(dict)).catch(() => {})
  }

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

  // A tapped Yobidashi push while the app is already open: the service
  // worker messages us the slot (public/sw.js notificationclick). Stash it
  // for SenseiCall's intake and route to the call screen — the push is a
  // doorbell; the ring itself happens there (Doc 02 §3.2).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined
    const onMessage = (e) => {
      const d = e.data || {}
      if (d.type !== 'yobidashi-call') return
      try {
        sessionStorage.setItem(INCOMING_CALL_KEY, JSON.stringify({ date: d.slotDate, slotIdx: d.slotIdx, slotId: d.slotId, at: Date.now() }))
      } catch { /* ignore */ }
      setActive('sensei')
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [setActive])

  // Swipe left/right (touch) and Alt+Arrow (desktop) move between the
  // bottom-bar sections ONLY (audit P1-5): cycling all 25 menu views
  // in menu order contradicted the map the learner can see — a swipe
  // from Today landed on screens they had never heard of. The four
  // quickNav views are the swipe world; everything else is the menu.
  const step = useCallback((delta) => {
    const i = quickNav.indexOf(active)
    if (i === -1) return
    const next = quickNav[(i + delta + quickNav.length) % quickNav.length]
    setActive(next)
  }, [active, setActive])

  useSwipeNav({
    enabled: !mobileOpen,
    onNext: () => step(1),
    onPrev: () => step(-1),
  })

  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  const content = {
    session: <OneSession setActive={setActive} />,
    dashboard: <TodayHome streak={streak} daysToExam={daysToExam} nextExam={nextExam} examLabel={examLabel} setActive={setActive} />,
    voice: <VoiceLoop />,
    sensei: <SenseiCall setActive={setActive} />,
    diagnosis: <Diagnosis setActive={setActive} />,
    twin: <TwinView setActive={setActive} />,
    loop: <GrowthLoop setActive={setActive} />,
    privacy: <PrivacyPolicy setActive={setActive} />,
    terms: <Terms setActive={setActive} />,
    coach: <CoachLetter />,
    mine: <Mining />,
    lessons: <Lessons />,
    drills: <Drills />,
    mock: <MockExam setActive={setActive} />,
    anki: <Anki />,
    speed: <SpeedCards />,
    dictionary: <DictionaryView />,
    reading: <ReadingView setActive={setActive} />,
    practice: <HubView titleKey="shell.nav.practiceHub" itemIds={['voice', 'mine', 'drills', 'speed', 'anki', 'n2listening']} setActive={setActive} />,
    exams: <HubView titleKey="shell.nav.exams" itemIds={['mock', 'bjt', 'bjtexam']} setActive={setActive} />,
    library: <HubView titleKey="shell.nav.libraryHub" itemIds={['lessons', 'dictionary', 'reading', 'plan', 'resources', 'videos', 'sources']} setActive={setActive} />,
    reader: <Reader setActive={setActive} onSignIn={() => setAuthOverlay(true)} />,
    ai: <AiTutor context={active} />,
    plan: <StudyPlan daysToExam={daysToExam} />,
    resources: <Resources />,
    sources: <SourcesView />,
    videos: <Videos />,
    n2listening: <N2Listening />,
    bjt: <BJT setActive={setActive} />,
    bjtexam: <BjtExam setActive={setActive} />,
    errors: <ErrorLog />,
  }

  if (isSupabaseConfigured && (loading || (user && syncPending))) {
    // Page-shaped skeleton: a header strip and stacked cards in
    // the real layout's proportions, so the app reads as "your
    // page, loading" — never as somebody else's empty account.
    return (
      <div className="min-h-screen bg-bun-900 p-5 sm:p-6" aria-busy="true" aria-label={t('shell.loading')}>
        <div className="max-w-6xl mx-auto space-y-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-2xl shrink-0" />
            <Skeleton className="h-6 w-40" />
            <div className="flex-1" />
            <Skeleton className="h-9 w-28 rounded-full" />
          </div>
          <div className="rounded-3xl glass p-6 space-y-4">
            <Skeleton className="h-7 w-56" />
            <SkeletonText lines={2} />
            <Skeleton className="h-11 w-44 rounded-xl" />
          </div>
          <div className="rounded-3xl glass p-6 space-y-4">
            <Skeleton className="h-6 w-36" />
            <SkeletonText lines={3} />
          </div>
          <div className="rounded-3xl glass p-6 space-y-4">
            <Skeleton className="h-6 w-44" />
            <SkeletonText lines={2} />
          </div>
        </div>
      </div>
    )
  }

  // The sign-in gate stands only until the learner chooses a door:
  // an account, or guest (remembered on this device — the gate never
  // reappears on load for a guest; Doc 12 audit #1).
  if (isSupabaseConfigured && !user && !guest) {
    return <AuthModal />
  }

  return (
    <div className="min-h-screen bg-bun-900 text-slate-100 flex">
      {/* Paints the notch strip so the translucent status bar is not a gap. */}
      <div className="status-bar-scrim lg:hidden" aria-hidden="true" />
      <Sidebar
        active={active}
        setActive={setActive}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        guest={isSupabaseConfigured && !user && guest}
        onCreateAccount={() => setAuthOverlay(true)}
      />
      {authOverlay && !user && (
        <AuthModal variant="overlay" initialMode="signup" onClose={() => setAuthOverlay(false)} />
      )}
      <main className="flex-1 min-w-0 flex flex-col">
        <div className="pt-safe bg-bun-900/80 backdrop-blur sticky top-0 z-30">
          <Header
            active={active}
            daysToExam={daysToExam}
            user={user}
            onSignOut={signOut}
            isSupabaseConfigured={isSupabaseConfigured}
            onToggleMenu={() => setMobileOpen((o) => !o)}
            menuOpen={mobileOpen}
          />
        </div>
        <div className="flex-1 page-gutter py-5 sm:py-6 lg:py-8 overflow-y-auto swipe-area pb-28 lg:pb-8">
          <div className="max-w-6xl mx-auto animate-fade-in">
            <Suspense fallback={<PageSkeleton label={t('shell.loading')} />}>
              {content[active]}
            </Suspense>
          </div>
        </div>
      </main>
      <BottomNav active={active} setActive={setActive} onMenu={() => setMobileOpen((o) => !o)} menuOpen={mobileOpen} />
      <SelectionPopup dictionary={dictionary} onNeedDictionary={ensureDictionary} />
      <ChatBubble context={active} />
    </div>
  )
}

export default App
