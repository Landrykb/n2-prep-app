import { useEffect, useMemo, useState } from 'react'
import { Calendar, Target, Layers, Mic, Stethoscope, Pickaxe, ClipboardCheck, ChevronRight, RefreshCw, Flame, CheckCircle2, Play, Coffee, Phone, Mail } from 'lucide-react'
import { brand } from '../lib/brand.js'
import { loadCallState } from '../lib/calls.js'
import { detectMode } from '../lib/modes.js'
import { getPlanFor, tomorrowStr } from '../lib/planner.js'
import { recordQueueRating } from '../lib/twin.js'
import { loadMetrics, summariseMetrics } from '../lib/metrics.js'
import FeedbackBox from './FeedbackBox.jsx'
import Mascot from './Mascot.jsx'
import { loadProfile, loadDiagnosis, derivePlan, daysSinceLastVisit, markVisit } from '../lib/profile.js'
import { loadQueue, todaySession, rateQueueItem } from '../lib/queue.js'
import { estimateSessionMinutes, loadSessionState, setIntent, todayStr } from '../lib/session.js'
import { loadPromise } from '../lib/promise.js'
import PromisePanel from './PromisePanel.jsx'
import { previewIntervals } from '../lib/fsrs.js'
import { OnboardingFlow, ProofLadderView } from './ProblemStart.jsx'
import ProgressCard from './ProgressCard.jsx'
import { useLanguage } from '../hooks/useLanguage.js'
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
  // P2-2: local calendar day, not UTC — toISOString() rolled the date at
  // 09:00 JST, so a morning visit could be recorded as yesterday.
  const today = todayStr()
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
  const { t } = useLanguage()
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
  // The fleet's read of the week (Doc 05 §7 modes — detected by code from
  // Twin signals) and Saki's plan for tomorrow, shown before the day starts.
  const modeInfo = useMemo(() => { try { return detectMode() } catch { return null } }, [])
  const tomorrowPlan = useMemo(() => { try { return getPlanFor(tomorrowStr()) } catch { return null } }, [])
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
    recordQueueRating(card, rating)
    setQueue(rateQueueItem(card.id, rating))
    setFlipped(false)
    setReviewIdx((i) => i + 1)
  }

  const dateLabel = nextExam?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="space-y-8">
      <section className="space-y-2.5">
        <button onClick={() => startSession('full')} className="w-full relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#71368A] to-[#FF6B57] p-6 sm:p-8 text-left shadow-xl hover:from-[#71368A] hover:to-[#FF7F6E] transition group">
          <span className="flex items-center gap-4">
            <span className="w-14 h-14 shrink-0 rounded-2xl bg-white/20 flex items-center justify-center group-hover:scale-105 transition"><Play size={28} className="text-white ml-0.5" /></span>
            <span>
              <span className="block text-2xl sm:text-3xl font-bold text-white">{t('today.heroTitle', { mins: sessionMins })}</span>
              <span className="block text-sm text-white mt-1">{sessionInProgress ? t('today.heroInProgress') : t('today.heroSubtitle')}</span>
            </span>
          </span>
        </button>
        <button onClick={() => startSession('busy')} className="w-full rounded-2xl bg-bun-800/70 border border-bun-600/40 hover:border-[#FF6B57]/40 p-3.5 text-sm text-slate-200 flex items-center justify-center gap-2 transition">
          <Coffee size={15} className="text-amber-300" /> {t('today.busyTitle')} <span className="text-slate-400">{t('today.busyHint')}</span>
        </button>
        <button onClick={() => setActive('sensei')} className="w-full rounded-2xl bg-emerald-500/10 border border-emerald-500/25 hover:border-emerald-400/40 p-3.5 text-sm text-slate-200 flex items-center justify-center gap-2 transition">
          <Phone size={15} className="text-emerald-300" /> Yobidashi {(() => { const cs = loadCallState(); return cs.settings.enabled ? <span className="text-slate-400">{t(cs.settings.callsPerDay > 1 ? 'today.yobidashiOnPlural' : 'today.yobidashiOnSingular', { count: cs.settings.callsPerDay })}</span> : <span className="text-slate-400">{t('today.yobidashiOffBefore')}<em>{t('today.yobidashiOffYou')}</em>{t('today.yobidashiOffAfter')}</span> })()}
        </button>
      </section>

      {modeInfo && (
        <section className="rounded-2xl glass p-4 card-glow flex items-start gap-3">
          <Mascot agent="michi" size={38} mood={modeInfo.mode === 'badweek' ? 'resting' : 'happy'} />
          <div>
            <p className="text-sm text-slate-200"><span className="font-semibold text-white">{t('today.michiCoach')}</span> {modeInfo.meta.michiLine}</p>
            <p className="text-[11px] text-slate-500 mt-1">{t('today.modeWeek', { brand: brand.name, tagline: brand.tagline, label: modeInfo.meta.label })}</p>
          </div>
        </section>
      )}

      {showOnboarding ? (
        <OnboardingFlow initial={profile} onDone={(p) => { setProfile(p); setShowOnboarding(false) }} onClose={profile ? () => setShowOnboarding(false) : undefined} />
      ) : (
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#71368A]/20 to-[#FF6B57]/20 border border-[#FF6B57]/20 p-6 sm:p-8 card-glow">
          <div className="relative space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
              <span className="flex items-center gap-1.5 font-medium text-emerald-300"><Calendar size={15} /> {t('today.daysToExam', { days: daysToExam, exam: examLabel, date: dateLabel })}</span>
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-bun-800/60 border border-bun-600/40 text-slate-300"><Flame size={12} className="text-orange-300" /> {t('today.thisWeek', { count: weekCount })}</span>
              <button onClick={() => setShowOnboarding(true)} className="flex items-center gap-1 px-2 py-1 rounded-full bg-bun-800/60 border border-bun-600/40 text-slate-400 hover:text-white transition"><RefreshCw size={11} /> {t('today.problemChanged')}</button>
              {(() => { const m = summariseMetrics(loadMetrics()); return (
                <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-bun-800/60 border border-bun-600/40 text-slate-300" title={t('today.metricsTitle')}>
                  <Target size={12} className="text-[#FF8A75]" /> {m.minutesPerProofPoint !== null ? t(m.sessions === 1 ? 'today.metricsPaceSingular' : 'today.metricsPacePlural', { minutes: m.minutesPerProofPoint, sessions: m.sessions }) : t('today.metricsEmpty')}
                </span>) })()}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('today.problemPlanTitle')}</h1>
            <p className="max-w-2xl text-slate-200 leading-relaxed text-sm sm:text-base">{plan.line}</p>
            {plan.focusNote && <p className="text-xs text-slate-400">{t('today.builtFrom', { note: plan.focusNote })}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {plan.actions.map((a) => (
                <button key={`${a.tab}-${a.label}`} onClick={() => setActive(a.tab)} className="text-left rounded-2xl glass p-4 border border-bun-600/30 hover:border-[#FF6B57]/40 transition group">
                  <p className="font-bold text-white text-sm flex items-center justify-between">{a.label} <ChevronRight size={15} className="text-[#FF8A75] group-hover:translate-x-0.5 transition" /></p>
                  <p className="text-xs text-slate-400 mt-1">{a.reason}</p>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {tomorrowPlan && (
        <section className="rounded-2xl glass p-4 card-glow flex items-start gap-3">
          <Mascot agent="saki" size={38} mood={modeInfo?.mode === 'badweek' ? 'resting' : 'happy'} />
          <div className="flex-1">
            <p className="text-sm text-slate-200"><span className="font-semibold text-white">{t('today.tomorrowBySaki')}</span> {tomorrowPlan.note}</p>
            {tomorrowPlan.experiment && <p className="text-xs text-slate-400 mt-1">{t('today.tomorrowExperiment', { variant: tomorrowPlan.experiment.variantLabel })}</p>}
            <p className="text-[11px] text-slate-500 mt-1">{t('today.tomorrowFooter')}</p>
          </div>
        </section>
      )}

      <button onClick={() => setActive('coach')} className="w-full rounded-2xl bg-bun-800/70 border border-bun-600/40 hover:border-[#FF6B57]/40 p-3.5 text-sm text-slate-200 flex items-center justify-center gap-2 transition">
        <Mail size={15} className="text-[#FF8A75]" /> {t('today.weeklyLetter')} <span className="text-slate-400">{t('today.weeklyLetterHint')}</span>
      </button>

      {isComeback && (
        <section className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-5">
          <div className="flex items-start gap-3">
            <Mascot agent="michi" size={38} showName={false} />
            <div className="space-y-2">
              <h2 className="font-bold text-emerald-200 flex items-center gap-2"><CheckCircle2 size={17} /> {t('today.comebackTitle', { days: gapDays })}</h2>
              <p className="text-sm text-emerald-100/80">{t('today.comebackBody1')}</p>
              <p className="text-sm text-emerald-100/80">{t('today.comebackBody2')}</p>
              <button onClick={() => setActive('diagnosis')} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center gap-1.5"><Stethoscope size={15} /> {t('today.comebackCta')}</button>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl glass p-5 card-glow space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Layers size={18} className="text-[#FF8A75]" /> {t('today.sessionTitle')}</h2>
          <span className="text-xs text-slate-400">{t('today.sessionCounts', { due: session.due.length, dueCap: MAX_DUE_DISPLAY, fresh: session.fresh.length, newCap: MAX_NEW, total: queue.length })}</span>
        </div>
        {card ? (
          <div className="space-y-3">
            <button onClick={() => setFlipped((f) => !f)} className="w-full text-left rounded-2xl bg-bun-700/40 border border-bun-600/30 p-6 min-h-[130px] hover:border-[#FF6B57]/40 transition">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{t('today.cardMetaStart', { kind: t(card.fsrs?.reps ? 'today.cardReview' : 'today.cardNew'), source: card.source })}{card.level ? t('today.cardMetaLevel', { level: card.level }) : ''}{t('today.cardTapFlip')}</p>
              {!flipped ? <p className="text-lg text-white leading-loose">{card.front}</p> : (
                <span><span className="block text-lg text-emerald-200 leading-loose">{card.back}</span>{card.note && <span className="block text-xs text-slate-400 mt-2">{card.note}</span>}</span>
              )}
            </button>
            {flipped && previews && (
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((r) => (
                  <button key={r} onClick={() => rate(r)} className={`px-2 py-2.5 rounded-xl text-xs font-semibold transition ${r === 1 ? 'bg-rose-600/80 hover:bg-rose-500' : r === 2 ? 'bg-amber-600/70 hover:bg-amber-500' : r === 3 ? 'bg-emerald-600/80 hover:bg-emerald-500' : 'bg-cyan-600/80 hover:bg-cyan-500'} text-white`}>
                    {[t('today.rateAgain'), t('today.rateHard'), t('today.rateGood'), t('today.rateEasy')][r - 1]}<span className="block text-[10px] opacity-80 font-normal">{previews[r].label}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500">{t('today.cardPosition', { current: Math.min(reviewIdx + 1, reviewList.length), total: reviewList.length })}</p>
          </div>
        ) : queue.length ? (
          <p className="text-sm text-slate-300">{t('today.sessionDoneStart')}<span className="text-emerald-300 font-semibold">{t('today.sessionDoneEmphasis')}</span>{t('today.sessionDoneEnd')}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">{t('today.queueEmptyStart')}<em>{t('today.queueEmptyYour')}</em>{t('today.queueEmptyEnd')}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setActive('voice')} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-medium flex items-center gap-1.5"><Mic size={15} /> {t('today.queueVoiceCta')}</button>
              <button onClick={() => setActive('mine')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5"><Pickaxe size={15} /> {t('today.queueMineCta')}</button>
            </div>
          </div>
        )}
      </section>

      <div className="pt-2">
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">{t('today.libraryTitle')}</h2>
        <p className="text-xs text-slate-500 mt-1">{t('today.libraryHint')}</p>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { id: 'voice', label: t('today.shelfVoiceLabel'), desc: t('today.shelfVoiceDesc'), icon: Mic },
          { id: 'diagnosis', label: t('today.shelfDiagnosisLabel'), desc: diagnosis ? t('today.shelfDiagnosisLast', { level: diagnosis.jlptEstimate, weakest: diagnosis.weakest }) : t('today.shelfDiagnosisDesc'), icon: Stethoscope },
          { id: 'mine', label: t('today.shelfMineLabel'), desc: t('today.shelfMineDesc'), icon: Pickaxe },
          { id: 'mock', label: t('today.shelfMockLabel'), desc: t('today.shelfMockDesc'), icon: ClipboardCheck },
        ].map((a) => { const Icon = a.icon; return (
          <button key={a.id} onClick={() => setActive(a.id)} className="text-left rounded-2xl glass p-5 card-glow border border-bun-600/20 hover:border-[#FF6B57]/30 transition group">
            <Icon size={20} className="text-[#FF8A75] mb-2" />
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
      <p className="text-[11px] text-slate-600 flex items-center gap-1.5"><Target size={12} /> {t('today.streakFooter', { streak })}</p>
      <FeedbackBox context="today" />
    </div>
  )
}
