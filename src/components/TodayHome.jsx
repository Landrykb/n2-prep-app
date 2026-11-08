import { useEffect, useMemo, useState } from 'react'
import { Calendar, Target, Layers, Mic, Stethoscope, Pickaxe, RefreshCw, Flame, CheckCircle2, Play, Coffee, Phone, Mail } from 'lucide-react'
import { brand } from '../lib/brand.js'
import { detectMode, modeLabel, modeLine } from '../lib/modes.js'
import { getPlanFor, tomorrowStr } from '../lib/planner.js'
import { loadDiagnosisHistory } from '../lib/twin.js'
import {
  loadFirstWeekFeedbackStamp, saveFirstWeekFeedbackStamp, firstWeekFeedbackStatus,
  recordFirstWeekAnswer, recordFirstWeekDismissal,
} from '../lib/day30.js'
import { saveFeedback } from '../lib/feedback.js'
import { loadMetrics, summariseMetrics } from '../lib/metrics.js'
import { bjtBookable, bandForScore } from '../lib/bjtExam.js'

// The BJT clock, designed (Landry, 2026-11-08): not a sentence in the
// pill row — a band gauge. Six segments at their real widths on the
// 0–800 scale; the fill is the learner's best evidence (emerald when it
// is a sealed score, sky while it is only the diagnosis estimate), and
// the one action on the right is the next honest step: take the sealed
// paper, or book the real thing on the official site.
const BJT_SEGMENTS = [
  { band: 'J5', min: 0, max: 200 }, { band: 'J4', min: 200, max: 320 },
  { band: 'J3', min: 320, max: 420 }, { band: 'J2', min: 420, max: 530 },
  { band: 'J1', min: 530, max: 600 }, { band: 'J1+', min: 600, max: 800 },
]

function BjtClockRow({ t, setActive }) {
  const b = bjtBookable(loadMetrics())
  let estimate = null
  try { estimate = loadDiagnosis()?.bjtScore ?? null } catch { estimate = null }
  const sealed = b.bestSealed !== null
  const pos = sealed ? b.bestSealed : estimate
  const title = sealed
    ? t('today.bjtWithinReach', { band: b.claimable })
    : pos !== null
      ? t('today.bjtEstRange', { band: bandForScore(pos) })
      : 'BJT'
  const sub = sealed
    ? (b.nextBand ? t('today.bjtToNext', { points: b.pointsToNext, next: b.nextBand }) : t('today.bjtTopBand'))
    : t('today.bjtSealedHint')
  return (
    <div className="w-full rounded-xl bg-white/[0.03] border border-white/5 px-3 py-3">
      {/* Stacked layout (Landry's screenshot, 2026-11-08): the
          one-line header collided on phones — title ran into the
          button and the explanation was truncated away. Now:
          title line, explanation line, gauge, then the action as
          a full-width button under the gauge. */}
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-[#FF6B57]/15 border border-[#FF6B57]/30 px-1.5 py-0.5 text-[11px] font-bold text-[#FFB4A6]">BJT</span>
        <span className="text-sm font-semibold text-white">{title}</span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">{sub}</p>
      <div className="mt-2.5 flex gap-[3px]" aria-hidden="true">
        {BJT_SEGMENTS.map((s) => {
          const frac = pos === null ? 0 : Math.max(0, Math.min(1, (pos - s.min) / (s.max - s.min)))
          return (
            <div key={s.band} className="h-2 rounded-full bg-white/10 overflow-hidden" style={{ flexGrow: s.max - s.min }}>
              <div className={`h-full rounded-full ${sealed ? 'bg-emerald-400' : 'bg-sky-400'}`} style={{ width: `${Math.round(frac * 100)}%` }} />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-[3px]" aria-hidden="true">
        {BJT_SEGMENTS.map((s) => (
          <div key={s.band} className="text-center text-[9px] font-medium text-slate-500" style={{ flexGrow: s.max - s.min }}>{s.band}</div>
        ))}
      </div>
      {sealed ? (
        <a href="https://www.kanken.or.jp/bjt/" target="_blank" rel="noreferrer" className="mt-3 block rounded-lg bg-[#FF6B57] px-3 py-2 text-center text-xs font-semibold text-white">{t('today.bjtBook')}</a>
      ) : (
        <button type="button" onClick={() => setActive && setActive('bjtexam')} className="mt-3 block w-full rounded-lg bg-white/10 px-3 py-2 text-center text-xs font-semibold text-slate-100">{t('today.bjtTakePaper')}</button>
      )}
    </div>
  )
}
import FeedbackBox from './FeedbackBox.jsx'
import Mascot from './Mascot.jsx'
import { loadProfile, loadDiagnosis, derivePlan, daysSinceLastVisit, markVisit } from '../lib/profile.js'
import { loadQueue, todaySession } from '../lib/queue.js'
import { estimateSessionMinutes, loadSessionState, setIntent, todayStr } from '../lib/session.js'
import { loadPromise } from '../lib/promise.js'
import PromisePanel from './PromisePanel.jsx'
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

// First-week feedback (cohort readiness, day30.js, Doc 11 §7): ONE
// question, days 7–10 after the first diagnosis, wording fixed in the
// catalogs so cohort answers compare. The answer rides the existing
// feedback path with category 'first-week'; the stamp is local, and
// once answered — or dismissed twice — the card never returns.
const FIRST_WEEK_CHIPS = [
  { id: 'no-time', key: 'today.firstWeek.chipNoTime' },
  { id: 'too-hard', key: 'today.firstWeek.chipTooHard' },
  { id: 'forgot', key: 'today.firstWeek.chipForgot' },
  { id: 'the-call', key: 'today.firstWeek.chipTheCall' },
]

function FirstWeekCard() {
  const { t } = useLanguage()
  const [stamp, setStamp] = useState(loadFirstWeekFeedbackStamp)
  const [chip, setChip] = useState(null)
  const [text, setText] = useState('')
  const [done, setDone] = useState(null) // 'sent' | 'local'
  const status = firstWeekFeedbackStatus({ diagnosisHistory: loadDiagnosisHistory(), stamp })

  if (done) {
    return (
      <section className="rounded-2xl bg-[#151129] border border-white/5 p-5">
        <p className="text-sm text-slate-200">{done === 'sent' ? t('today.firstWeek.thanks') : t('today.firstWeek.localNote')}</p>
      </section>
    )
  }
  if (!status.show) return null

  const send = async () => {
    const parts = []
    if (chip) parts.push(`chip=${chip}`)
    if (text.trim()) parts.push(text.trim())
    const res = await saveFeedback(parts.join(' — ') || 'chip=none', 'today', 'first-week')
    saveFirstWeekFeedbackStamp(recordFirstWeekAnswer(stamp, chip))
    setDone(res.sent ? 'sent' : 'local')
  }
  const dismiss = () => {
    const next = recordFirstWeekDismissal(stamp)
    saveFirstWeekFeedbackStamp(next)
    setStamp(next)
  }

  return (
    <section className="rounded-2xl bg-[#151129] border border-white/5 p-5 space-y-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5"><Mascot agent="michi" size={28} showName={false} /></span>
        <div>
          <h2 className="font-bold text-white">{t('today.firstWeek.title')}</h2>
          <p className="text-xs text-slate-400 mt-0.5">{t('today.firstWeek.hint')}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {FIRST_WEEK_CHIPS.map((c) => (
          <button
            key={c.id}
            onClick={() => setChip(chip === c.id ? null : c.id)}
            aria-pressed={chip === c.id}
            className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${chip === c.id
              ? 'bg-[#FF6B57]/15 border-[#FF6B57] text-white'
              : 'bg-bun-700 hover:bg-bun-600 border-white/10 text-slate-200'}`}
          >
            {t(c.key)}
          </button>
        ))}
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('today.firstWeek.placeholder')}
        className="w-full rounded-xl bg-bun-900 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-[#FF6B57] focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={send} disabled={!chip && !text.trim()} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] disabled:opacity-40 text-white text-sm font-semibold">{t('today.firstWeek.send')}</button>
        <button onClick={dismiss} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">{t('today.firstWeek.notNow')}</button>
      </div>
    </section>
  )
}

// The new Today home: problem first, then a plan derived from that problem,
// then ONE capped session. Weekly rhythm (4 of 7) replaces the fragile
// streak; returning after a break shows a small winnable session, never a pile.
export default function TodayHome({ streak, daysToExam, examLabel, nextExam, setActive }) {
  const { t } = useLanguage()
  const [profile, setProfile] = useState(loadProfile)
  const [showOnboarding, setShowOnboarding] = useState(() => !loadProfile())
  const [diagnosis] = useState(loadDiagnosis)
  const [queue] = useState(loadQueue)
  const [weekDays, setWeekDays] = useState(loadWeek)
  const [gapDays] = useState(() => daysSinceLastVisit())

  useEffect(() => {
    setWeekDays(recordToday())
    markVisit()
    // TwinView's "my problem changed" door lands here with a flag
    // (audit P1-3): open the problem form on arrival instead of
    // dropping the learner on Today to hunt for the pill.
    try {
      if (sessionStorage.getItem('yonde:open-problem') === '1') {
        sessionStorage.removeItem('yonde:open-problem')
        setShowOnboarding(true)
      }
    } catch { /* storage unavailable — the pill below still works */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const plan = useMemo(() => derivePlan(profile, diagnosis, t), [profile, diagnosis, t])
  // The fleet's read of the week (Doc 05 §7 modes — detected by code from
  // Twin signals) and Saki's plan for tomorrow, shown before the day starts.
  const modeInfo = useMemo(() => { try { return detectMode() } catch { return null } }, [])
  const tomorrowPlan = useMemo(() => { try { return getPlanFor(tomorrowStr()) } catch { return null } }, [])
  const session = useMemo(() => todaySession(queue, { maxNew: MAX_NEW, maxDue: MAX_DUE_DISPLAY }), [queue])
  // The old in-page flashcard flow is gone (Hick pass): this card is
  // only the status line's existence check — reviews live in the
  // session, step 2.
  const card = [...session.due, ...session.fresh][0] || null
  const weekCount = weekDays.filter((d) => (Date.now() - new Date(d).getTime()) < 7 * 86400000).length
  const isComeback = gapDays !== null && gapDays > 2
  // One Session is the primary action: the whole day, auto-sequenced.
  const sessionMins = estimateSessionMinutes(queue)
  const savedSession = loadSessionState()
  const sessionInProgress = savedSession && savedSession.date === todayStr() && !savedSession.done
  const sessionDoneToday = savedSession && savedSession.date === todayStr() && savedSession.done
  const promise = loadPromise()
  const startSession = (variant) => { setIntent(variant); setActive('session') }

  const dateLabel = nextExam?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="space-y-8">
      {/* First run (audit P0-2): with no profile there is no plan and
          no fitted session yet, so the problem form IS the top of the
          page — the hero waits until there is something to start. */}
      {!profile && showOnboarding && (
        <OnboardingFlow initial={profile} setActive={setActive} onDone={(p) => { setProfile(p); setShowOnboarding(false) }} />
      )}
      {profile && (
      <section className="space-y-2.5">
        <button onClick={() => startSession('full')} className="w-full relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#71368A] to-[#FF6B57] p-6 sm:p-8 text-left shadow-xl hover:from-[#71368A] hover:to-[#FF7F6E] transition group">
          <span className="flex items-center gap-4">
            <span className="w-14 h-14 shrink-0 rounded-2xl bg-white/20 flex items-center justify-center group-hover:scale-105 transition">{sessionDoneToday ? <CheckCircle2 size={28} className="text-white" /> : <Play size={28} className="text-white ml-0.5" />}</span>
            <span>
              <span className="block text-2xl sm:text-3xl font-bold text-white">{sessionDoneToday ? t('today.doneTitle') : t('today.heroTitle', { mins: sessionMins })}</span>
              <span className="block text-sm text-white mt-1">{sessionDoneToday ? t('today.doneSubtitle') : sessionInProgress ? t('today.heroInProgress') : t('today.heroSubtitle')}</span>
            </span>
          </span>
        </button>
        {/* The same decision at a smaller size — a quiet text
            row, not a competing card (Hick pass, 2026-11-08). The
            Yobidashi card-button that also sat here moved to the
            quiet link row at the page bottom: the call has its
            own bottom-bar tab, it does not compete with today's
            session on the home screen. */}
        <button onClick={() => startSession('busy')} className="w-full text-center text-xs text-slate-400 hover:text-slate-200 py-1.5 flex items-center justify-center gap-1.5 transition">
          <Coffee size={13} className="text-amber-300" /> {t('today.busyTitle')} · {t('today.busyHint')}
        </button>
      </section>
      )}

      {modeInfo && (
        <section className="rounded-2xl bg-[#151129] border border-white/5 p-4 flex items-start gap-3">
          <Mascot agent="michi" size={38} mood={modeInfo.mode === 'badweek' ? 'resting' : 'happy'} />
          <div>
            <p className="text-sm text-slate-200"><span className="font-semibold text-white">{t('today.michiCoach')}</span> {modeLine(modeInfo.mode, t)}</p>
            <p className="text-[11px] text-slate-500 mt-1">{t('today.modeWeek', { brand: brand.name, tagline: brand.tagline, label: modeLabel(modeInfo.mode, t) })}</p>
          </div>
        </section>
      )}

      {profile && showOnboarding ? (
        <OnboardingFlow initial={profile} setActive={setActive} onDone={(p) => { setProfile(p); setShowOnboarding(false) }} onClose={() => setShowOnboarding(false)} />
      ) : profile ? (
        <section className="rounded-3xl bg-[#151129] border border-white/5 p-6 sm:p-8">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
              <span className="flex items-center gap-1.5 font-medium text-emerald-300"><Calendar size={15} /> {t('today.daysToExam', { days: daysToExam, exam: examLabel, date: dateLabel })}</span>
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-bun-800/60 border border-bun-600/40 text-slate-300"><Flame size={12} className="text-orange-300" /> {t('today.thisWeek', { count: weekCount })}</span>
              {(() => { const m = summariseMetrics(loadMetrics()); return (
                <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-bun-800/60 border border-bun-600/40 text-slate-300" title={t('today.metricsTitle')}>
                  <Target size={12} className="text-[#FF8A75]" /> {m.minutesPerProofPoint !== null ? t(m.sessions === 1 ? 'today.metricsPaceSingular' : 'today.metricsPacePlural', { minutes: m.minutesPerProofPoint, sessions: m.sessions }) : t('today.metricsEmpty')}
                </span>) })()}
            </div>
            <BjtClockRow t={t} setActive={setActive} />
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('today.problemPlanTitle')}</h1>
            <p className="max-w-2xl text-slate-200 leading-relaxed text-sm sm:text-base">{plan.line}</p>
            {plan.focusNote && <p className="text-xs text-slate-400">{t('today.builtFrom', { note: plan.focusNote })}</p>}
            {/* Tier 4 (Doc 06 §10a): the change-problem door is a
                quiet text link at the card's end — no action hides
                inside the info pills at the top. */}
            <button onClick={() => setShowOnboarding(true)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-200 transition"><RefreshCw size={11} /> {t('today.problemChanged')}</button>
            {/* The card's action tiles are gone (Hick pass):
                they were four more doors competing with the one
                hero above. The card states the plan; the hero
                starts it. */}
          </div>
        </section>
      ) : null}

      {tomorrowPlan && (
        <section className="rounded-2xl bg-[#151129] border border-white/5 p-4 flex items-start gap-3">
          <Mascot agent="saki" size={38} mood={modeInfo?.mode === 'badweek' ? 'resting' : 'happy'} />
          <div className="flex-1">
            <p className="text-sm text-slate-200"><span className="font-semibold text-white">{t('today.tomorrowBySaki')}</span> {tomorrowPlan.noteKey
              ? t(tomorrowPlan.noteKey, { title: tomorrowPlan.sceneTitle, cards: tomorrowPlan.cardBudget, minutes: tomorrowPlan.minutes, reason: t(tomorrowPlan.noteVars?.reasonKey || 'planner.reasonMatched', tomorrowPlan.noteVars?.reasonVars || {}) })
              : tomorrowPlan.note}</p>
            {tomorrowPlan.experiment && <p className="text-xs text-slate-400 mt-1">{t('today.tomorrowExperiment', { variant: tomorrowPlan.experiment.variantLabel })}</p>}
            <p className="text-[11px] text-slate-500 mt-1">{t('today.tomorrowFooter')}</p>
          </div>
        </section>
      )}

      <FirstWeekCard />

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

      <section className="rounded-2xl bg-[#151129] border border-white/5 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Layers size={18} className="text-[#FF8A75]" /> {t('today.sessionTitle')}</h2>
          <span className="text-xs text-slate-400">{t('today.sessionCounts', { due: session.due.length, dueCap: MAX_DUE_DISPLAY, fresh: session.fresh.length, newCap: MAX_NEW, total: queue.length })}</span>
        </div>
        {card ? (
          <p className="text-sm text-slate-300">{t('today.cardsInSession')}</p>
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

      <ProofLadderView diagnosis={diagnosis} profile={profile} />

      <PromisePanel promise={promise} />

      <div className="grid lg:grid-cols-2 gap-6">
        <ProgressCard setActive={setActive} daysToExam={daysToExam} />
        <NotificationCard />
      </div>
      <div className="flex justify-center gap-8 text-xs text-slate-400">
        <button onClick={() => setActive('sensei')} className="flex items-center gap-1.5 hover:text-slate-200 transition"><Phone size={13} className="text-emerald-300" /> Yobidashi</button>
        <button onClick={() => setActive('coach')} className="flex items-center gap-1.5 hover:text-slate-200 transition"><Mail size={13} className="text-[#FF8A75]" /> {t('today.weeklyLetter')}</button>
      </div>
      <p className="text-[11px] text-slate-600 flex items-center gap-1.5"><Target size={12} /> {t('today.streakFooter', { streak })}</p>
      <FeedbackBox context="today" />
    </div>
  )
}
