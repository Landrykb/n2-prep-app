import { useEffect, useMemo, useState } from 'react'
import { Calendar, Target, Layers, Mic, Stethoscope, Pickaxe, ClipboardCheck, ChevronRight, RefreshCw, Flame, CheckCircle2, Play, Coffee, Phone } from 'lucide-react'
import { loadCallState } from '../lib/calls.js'
import { loadProfile, loadDiagnosis, derivePlan, daysSinceLastVisit, markVisit } from '../lib/profile.js'
import { loadQueue, todaySession, rateQueueItem } from '../lib/queue.js'
import { estimateSessionMinutes, loadSessionState, setIntent, todayStr } from '../lib/session.js'
import { loadPromise } from '../lib/promise.js'
import PromisePanel from './PromisePanel.jsx'
import { previewIntervals } from '../lib/fsrs.js'
import { OnboardingFlow, ProofLadderView } from './ProblemStart.jsx'
import ProgressCard from './ProgressCard.jsx'
import NotificationCard from './NotificationCard.jsx'

const WEEK_KEY = 'jpn:week:v1'
const MAX_NEW = 10
const MAX_DUE_DISPLAY = 20

function loadWeek() {
  try {
    const w = JSON.parse(localStorage.getItem(WEEK_KEY) || '{"days":[]}')
    return Array.isArray(w.days) ? w.days : []
  } catch { return [] }
}
function recordToday() {
  const today = new Date().toISOString().slice(0, 10)
  const days = loadWeek()
  if (!days.includes(today)) {
    const cutoff = Date.now() - 7 * 86400000
    const kept = [...days, today].filter((d) => new Date(d).getTime() >= cutoff - 86400000)
    try { localStorage.setItem(WEEK_KEY, JSON.stringify({ days: kept })) } catch { /* ignore */ }
    return kept
  }
  return days
}

// The new Today home: problem first, then a plan derived from that problem,
// then ONE capped session. Weekly rhythm (4 of 7) replaces the fragile
// streak; returning after a break shows a small winnable session, never a pile.
export default function TodayHome({ streak, daysToExam, examLabel, nextExam, setActive }) {
  const [profile, setProfile] = useState(loadProfile)
  const [showOnboarding, setShowOnboarding] = useState(() => !loadProfile())
  const [diagnosis] = useState(loadDiagnosis)
  const [queue, setQueue] = useState(loadQueue)
  const [weekDays, setWeekDays] = useState(loadWeek)
  const [gapDays] = useState(() => daysSinceLastVisit())
  const [reviewIdx, setReviewIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    setWeekDays(recordToday())
    markVisit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const plan = useMemo(() => derivePlan(profile, diagnosis), [profile, diagnosis])
  const session = useMemo(() => todaySession(queue, { maxNew: MAX_NEW, maxDue: MAX_DUE_DISPLAY }), [queue])
  const reviewList = useMemo(() => [...session.due, ...session.fresh], [session])
  const card = reviewList[Math.min(reviewIdx, Math.max(0, reviewList.length - 1))]
  const previews = useMemo(() => (card ? previewIntervals(card.fsrs) : null), [card])
  const weekCount = weekDays.filter((d) => (Date.now() - new Date(d).getTime()) < 7 * 86400000).length
  const isComeback = gapDays !== null && gapDays > 2
  // One Session is the primary action: the whole day, auto-sequenced.
  const sessionMins = estimateSessionMinutes(queue)
  const savedSession = loadSessionState()
  const sessionInProgress = savedSession && savedSession.date === todayStr() && !savedSession.done
  const promise = loadPromise()
  const startSession = (variant) => { setIntent(variant); setActive('session') }

  const rate = (rating) => {
    if (!card) return
    setQueue(rateQueueItem(card.id, rating))
    setFlipped(false)
    setReviewIdx((i) => i + 1)
  }

  const dateLabel = nextExam?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="space-y-8">
      <section className="space-y-2.5">
        <button onClick={() => startSession('full')} className="w-full relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 to-fuchsia-600 p-6 sm:p-8 text-left shadow-xl hover:from-violet-500 hover:to-fuchsia-500 transition group">
          <span className="flex items-center gap-4">
            <span className="w-14 h-14 shrink-0 rounded-2xl bg-white/20 flex items-center justify-center group-hover:scale-105 transition"><Play size={28} className="text-white ml-0.5" /></span>
            <span>
              <span className="block text-2xl sm:text-3xl font-bold text-white">Today — ~{sessionMins} minutes</span>
              <span className="block text-sm text-violet-100 mt-1">{sessionInProgress ? 'Your session is in progress — it picks up right where you left off. What you already did counts.' : 'One session, no choices: one real scene in your voice, a few of your own cards, one listening bite. You won’t feel like you studied — that’s the point.'}</span>
            </span>
          </span>
        </button>
        <button onClick={() => startSession('busy')} className="w-full rounded-2xl bg-bun-800/70 border border-bun-600/40 hover:border-violet-500/40 p-3.5 text-sm text-slate-200 flex items-center justify-center gap-2 transition">
          <Coffee size={15} className="text-amber-300" /> Busy day — 3 minutes <span className="text-slate-400">(just the voice scene — a small day still counts)</span>
        </button>
        <button onClick={() => setActive('sensei')} className="w-full rounded-2xl bg-emerald-500/10 border border-emerald-500/25 hover:border-emerald-400/40 p-3.5 text-sm text-slate-200 flex items-center justify-center gap-2 transition">
          <Phone size={15} className="text-emerald-300" /> Sensei Call {(() => { const cs = loadCallState(); return cs.settings.enabled ? <span className="text-slate-400">is on — {cs.settings.callsPerDay} call{cs.settings.callsPerDay > 1 ? 's' : ''} a day inside your windows. Set times or test a call →</span> : <span className="text-slate-400">is off — let the app call <em>you</em> for a few minutes of spoken Japanese →</span> })()}
        </button>
      </section>

      {showOnboarding ? (
        <OnboardingFlow initial={profile} onDone={(p) => { setProfile(p); setShowOnboarding(false) }} onClose={profile ? () => setShowOnboarding(false) : undefined} />
      ) : (
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 border border-violet-500/20 p-6 sm:p-8 card-glow">
          <div className="relative space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
              <span className="flex items-center gap-1.5 font-medium text-emerald-300"><Calendar size={15} /> {daysToExam} days to {examLabel} · {dateLabel}</span>
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-bun-800/60 border border-bun-600/40 text-slate-300"><Flame size={12} className="text-orange-300" /> This week: {weekCount}/7 days · rhythm goal 4 — a missed day breaks nothing</span>
              <button onClick={() => setShowOnboarding(true)} className="flex items-center gap-1 px-2 py-1 rounded-full bg-bun-800/60 border border-bun-600/40 text-slate-400 hover:text-white transition"><RefreshCw size={11} /> My problem changed</button>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Your problem → your plan today</h1>
            <p className="max-w-2xl text-slate-200 leading-relaxed text-sm sm:text-base">{plan.line}</p>
            {plan.focusNote && <p className="text-xs text-slate-400">Built from: {plan.focusNote}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {plan.actions.map((a) => (
                <button key={`${a.tab}-${a.label}`} onClick={() => setActive(a.tab)} className="text-left rounded-2xl glass p-4 border border-bun-600/30 hover:border-violet-500/40 transition group">
                  <p className="font-bold text-white text-sm flex items-center justify-between">{a.label} <ChevronRight size={15} className="text-violet-300 group-hover:translate-x-0.5 transition" /></p>
                  <p className="text-xs text-slate-400 mt-1">{a.reason}</p>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {isComeback && (
        <section className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-5">
          <h2 className="font-bold text-emerald-200 flex items-center gap-2"><CheckCircle2 size={17} /> Welcome back — {gapDays} days away changes nothing here</h2>
          <p className="text-sm text-emerald-100/80 mt-1">No pile, no reset, no guilt screen. Below is a small, capped session sized to be finished today. The queue waited quietly; your rhythm counts this week, not an unbroken chain.</p>
        </section>
      )}

      <section className="rounded-2xl glass p-5 card-glow space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Layers size={18} className="text-violet-300" /> Today’s session — one queue, capped</h2>
          <span className="text-xs text-slate-400">Due shown: {session.due.length} (cap {MAX_DUE_DISPLAY}) · New: {session.fresh.length} (cap {MAX_NEW}/day) · Total personal cards: {queue.length}</span>
        </div>
        {card ? (
          <div className="space-y-3">
            <button onClick={() => setFlipped((f) => !f)} className="w-full text-left rounded-2xl bg-bun-700/40 border border-bun-600/30 p-6 min-h-[130px] hover:border-violet-500/40 transition">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{card.fsrs?.reps ? 'Review' : 'New'} · from {card.source}{card.level ? ` · ${card.level}` : ''} · tap to flip</p>
              {!flipped ? <p className="text-lg text-white leading-loose">{card.front}</p> : (
                <span><span className="block text-lg text-emerald-200 leading-loose">{card.back}</span>{card.note && <span className="block text-xs text-slate-400 mt-2">{card.note}</span>}</span>
              )}
            </button>
            {flipped && previews && (
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((r) => (
                  <button key={r} onClick={() => rate(r)} className={`px-2 py-2.5 rounded-xl text-xs font-semibold transition ${r === 1 ? 'bg-rose-600/80 hover:bg-rose-500' : r === 2 ? 'bg-amber-600/70 hover:bg-amber-500' : r === 3 ? 'bg-emerald-600/80 hover:bg-emerald-500' : 'bg-cyan-600/80 hover:bg-cyan-500'} text-white`}>
                    {['Again', 'Hard', 'Good', 'Easy'][r - 1]}<span className="block text-[10px] opacity-80 font-normal">{previews[r].label}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500">Card {Math.min(reviewIdx + 1, reviewList.length)} of {reviewList.length} in today’s capped session. Anything beyond the cap simply is not shown today — by design.</p>
          </div>
        ) : queue.length ? (
          <p className="text-sm text-slate-300">Today’s capped session is done. <span className="text-emerald-300 font-semibold">That is a complete day.</span> Anything more is your choice, never a debt.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">Your personal queue is empty. It fills from <em>your</em> material — mistakes you master in the Voice Loop, and sentences mined from your own documents. Dictionary/Anki study continues in the Anki tab meanwhile.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setActive('voice')} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium flex items-center gap-1.5"><Mic size={15} /> Do one voice scene</button>
              <button onClick={() => setActive('mine')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5"><Pickaxe size={15} /> Mine a real document</button>
            </div>
          </div>
        )}
      </section>

      <div className="pt-2">
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">The Library — everything else, only when you want it</h2>
        <p className="text-xs text-slate-500 mt-1">The One Session above is the day. These are the shelves it draws from — dip in freely, nothing here is owed.</p>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { id: 'voice', label: 'Voice Loop', desc: 'Say your version · get corrected · repeat to mastery', icon: Mic },
          { id: 'diagnosis', label: 'Diagnosis', desc: diagnosis ? `Last: ${diagnosis.jlptEstimate} · weakest ${diagnosis.weakest}` : '10-minute health check — know your sections', icon: Stethoscope },
          { id: 'mine', label: 'Mine your documents', desc: 'Cards from your real emails & letters', icon: Pickaxe },
          { id: 'mock', label: 'Mock Exam', desc: 'Timed, with margin over the pass mark', icon: ClipboardCheck },
        ].map((a) => { const Icon = a.icon; return (
          <button key={a.id} onClick={() => setActive(a.id)} className="text-left rounded-2xl glass p-5 card-glow border border-bun-600/20 hover:border-violet-500/30 transition group">
            <Icon size={20} className="text-violet-300 mb-2" />
            <p className="font-bold text-white flex items-center justify-between">{a.label} <ChevronRight size={15} className="text-slate-500 group-hover:translate-x-0.5 transition" /></p>
            <p className="text-xs text-slate-400 mt-1">{a.desc}</p>
          </button>
        ) })}
      </section>

      <ProofLadderView diagnosis={diagnosis} profile={profile} />

      <PromisePanel promise={promise} />

      <div className="grid lg:grid-cols-2 gap-6">
        <ProgressCard setActive={setActive} daysToExam={daysToExam} />
        <NotificationCard />
      </div>
      <p className="text-[11px] text-slate-600 flex items-center gap-1.5"><Target size={12} /> Day streak kept for reference: {streak}. It no longer runs this home page — weekly rhythm does.</p>
    </div>
  )
}
