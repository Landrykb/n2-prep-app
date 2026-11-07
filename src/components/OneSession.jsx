import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Mic, MicOff, CheckCircle2, RotateCcw, Headphones, Sparkles, ChevronRight, Coffee } from 'lucide-react'
import { loadProfile, loadDiagnosis, ladderWithStatus } from '../lib/profile.js'
import { micErrorCopy } from '../lib/speechErrors.js'
import { loadQueue, addToQueue, rateQueueItem } from '../lib/queue.js'
import { previewIntervals, Rating } from '../lib/fsrs.js'
import {
  SESSION_KEY, MASTERY, todayStr, pickSceneForProfile, pickListeningForDiagnosis,
  buildSessionCards, loadSessionState, saveSessionState, loadIntent, saveEffort,
} from '../lib/session.js'
import { bestScore, missingPhrases } from './VoiceLoop.jsx'
import { scenes as allScenes } from '../data/scenes.js'
import { recordVoiceAttempt, recordQueueRating, recordSessionSummary } from '../lib/twin.js'
import { recordMetric } from '../lib/metrics.js'
import { getPlanFor, markPlanConsumed, noteSessionForExperiment } from '../lib/planner.js'
import Mascot from './Mascot.jsx'
import TtsButton from './TtsButton.jsx'
import { speakSenseiLine } from '../lib/neuralVoice.js'
import { modelCast } from '../lib/voicePreference.js'
import KanjiTapText from './KanjiTapText.jsx'
import { useLanguage } from '../hooks/useLanguage.js'

// ONE SESSION — the North Star made literal. Press start and the app runs
// the whole day for you: one voice scene for your problem, up to five of
// your queue cards, one listening bite for your weakest section. No menus,
// no choices. Leaving mid-session saves your place (jpn:session:v1) and
// coming back continues right there — a paused session is saved progress,
// never an unfinished one.
// Step labels resolve through the catalogs at render (session.step*).
const STEP_KEYS = ['session.stepScene', 'session.stepCards', 'session.stepListening']

// The effort answers are STORED values (lib/session.js saveEffort, Twin
// effort signals) — display maps the stored value to a catalog key; the
// stored values themselves never change.
const EFFORT_KEYS = { 'Not really': 'session.effortNotReally', 'A bit': 'session.effortABit', 'Yes': 'session.effortYes' }

function freshState(profile, diagnosis, queue, variant) {
  const date = todayStr()
  // Saki's plan for today (lib/planner.js) chooses the scene and cards when
  // one exists — the session consumes it, it does not re-decide. Mode
  // adjustments (Slump re-wins, Event narrowing…) are already inside it.
  let plan = null
  try { plan = getPlanFor(date) } catch { plan = null }
  const planScene = plan?.opener?.sceneId ? allScenes.find((s) => s.id === plan.opener.sceneId) : null
  const scene = planScene || pickSceneForProfile(profile, date)
  const listening = pickListeningForDiagnosis(diagnosis, date)
  const planCards = (plan?.cardIds || []).filter((id) => queue.some((c) => c.id === id))
  const cardIds = planCards.length ? planCards : buildSessionCards(queue).map((c) => c.id)
  if (plan) markPlanConsumed(date)
  return {
    date, variant, step: 0, sceneId: scene.id, listeningTitle: plan?.listeningTitle || listening.title,
    cardIds, ratedIds: [], cardResults: [], startedAt: new Date().toISOString(), elapsedBaseSec: 0,
    segmentStartAt: new Date().toISOString(),
    sceneBest: 0, sceneAttempts: 0, sceneDone: false, listeningPicked: null, done: false,
    planMode: plan?.mode || null, planNote: plan?.note || null,
    planNoteKey: plan?.noteKey || null, planNoteVars: plan?.noteVars || null,
    planSceneTitle: plan?.sceneTitle || null, planCardBudget: plan?.cardBudget ?? null, planMinutes: plan?.minutes ?? null,
    planExperiment: plan?.experiment || null, recorded: false, bonus: false,
  }
}

export default function OneSession({ setActive }) {
  const { t } = useLanguage()
  const profile = useMemo(loadProfile, [])
  const diagnosis = useMemo(loadDiagnosis, [])
  const [queue, setQueue] = useState(loadQueue)
  const [state, setState] = useState(() => {
    const saved = loadSessionState()
    if (saved && saved.date === todayStr()) return saved
    return freshState(loadProfile(), loadDiagnosis(), loadQueue(), loadIntent())
  })
  const [input, setInput] = useState('')
  const [lastAttempt, setLastAttempt] = useState(null) // { text, score, missing }
  const [flipped, setFlipped] = useState(false)
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState(null)
  const [effort, setEffort] = useState('')
  const [nowTick, setNowTick] = useState(Date.now())
  const recogRef = useRef(null)
  const queueRef = useRef(queue)
  queueRef.current = queue

  // Persist a brand-new state immediately, so even closing the tab on the
  // first screen leaves a resumable session behind.
  useEffect(() => { saveSessionState(state) }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tick once a second for the elapsed-time display while not done.
  useEffect(() => {
    if (state.done) return undefined
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [state.done])

  const elapsedSec = Math.max(0, Math.round((state.elapsedBaseSec || 0) + (state.done ? 0 : (nowTick - new Date(state.segmentStartAt || state.startedAt).getTime()) / 1000)))
  const minutesSpent = Math.max(1, Math.round(elapsedSec / 60))

  const patch = (p) => setState((s) => ({ ...s, ...p }))
  const advanceTo = (step) => patch({
    step,
    elapsedBaseSec: elapsedSec,
    segmentStartAt: new Date().toISOString(),
  })

  // --- Scene (Step 1) ---
  const scene = useMemo(() => allScenes.find((s) => s.id === state.sceneId) || pickSceneForProfile(profile, state.date), [profile, state.date, state.sceneId])
  const speechSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    recogRef.current = rec
    rec.lang = 'ja-JP'; rec.interimResults = false; rec.maxAlternatives = 1
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript || ''
      setInput(transcript)
      setListening(false)
      setMicError(null)
      // More automatic (Landry, 2026-11-07: "too much taps"): a
      // spoken attempt checks ITSELF the moment the transcript
      // lands — no separate Check Me tap after speaking. The
      // button stays for typed text.
      if (transcript.trim()) checkScene(transcript)
    }
    rec.onerror = (e) => { setListening(false); setMicError(micErrorCopy(e?.error)) }
    rec.onend = () => setListening(false)
    setListening(true)
    try { rec.start() } catch { setListening(false) }
  }
  const checkScene = (textOverride) => {
    const text = (typeof textOverride === 'string' ? textOverride : input).trim()
    if (!text) return
    const score = bestScore(text, scene)
    const missing = missingPhrases(text, scene)
    const attempts = (state.sceneAttempts || 0) + 1
    const best = Math.max(state.sceneBest || 0, score)
    recordVoiceAttempt({ scene, text, score, missing })
    setLastAttempt({ text, score, missing })
    // And the fix speaks itself: below mastery, Nao's model line
    // plays on its own (the neural chain; a refused autoplay just
    // stays silent and the speaker button is still there).
    if (score < MASTERY && scene.model) {
      try { speakSenseiLine(scene.model, { cast: modelCast() }) } catch { /* best effort */ }
    }
    patch({ sceneAttempts: attempts, sceneBest: best, sceneDone: state.sceneDone || score >= MASTERY })
    if (score >= MASTERY && attempts > 1 && !(state.sceneBest >= MASTERY)) {
      // Mastered after getting it wrong first: the mistake joins the queue.
      addToQueue([{
        front: `${scene.title} — say it right: ${scene.promptEn}`,
        back: scene.model,
        note: `In your daily session you needed ${attempts} tries. Target: ${scene.targetPattern}. ${scene.commonError}`,
        source: 'voice', level: scene.level,
      }])
      setQueue(loadQueue())
    }
  }

  // --- Cards (Step 2) ---
  const sessionCards = useMemo(() => {
    const byId = new Map(queue.map((c) => [c.id, c]))
    return (state.cardIds || []).map((id) => byId.get(id)).filter(Boolean)
  }, [queue, state.cardIds])
  const remainingCards = sessionCards.filter((c) => !(state.ratedIds || []).includes(c.id))
  const card = remainingCards[0]
  const previews = useMemo(() => (card ? previewIntervals(card.fsrs) : null), [card])
  const rateCard = (rating) => {
    if (!card) return
    recordQueueRating(card, rating)
    setQueue(rateQueueItem(card.id, rating))
    setFlipped(false)
    patch({
      ratedIds: [...(state.ratedIds || []), card.id],
      cardResults: [...(state.cardResults || []), { id: card.id, rating }],
    })
  }

  // --- Listening (Step 3) ---
  const bite = useMemo(() => pickListeningForDiagnosis(diagnosis, state.date), [diagnosis, state.date])
  const biteQuestion = bite.questions[0]

  // --- End ---
  const ladder = useMemo(() => ladderWithStatus(diagnosis), [diagnosis])
  const nextRung = ladder.find((h) => h.status === 'next')
  const reachedRung = [...ladder].reverse().find((h) => h.status === 'reached')
  const finish = () => {
    if (!state.recorded) {
      // The Twin learns from every finished session (Doc 04 §5): rhythm,
      // accuracy trend, per-method proof — all proxies, all labelled.
      const results = state.cardResults || []
      const again = results.filter((r) => r.rating === 1).length
      const good = results.filter((r) => r.rating >= 3).length
      const proof = ((state.sceneBest || 0) >= MASTERY ? 1 : 0) + good
      const cardAcc = results.length ? good / results.length : null
      const sceneAcc = (state.sceneBest || 0) / 100
      const accuracy01 = cardAcc === null ? sceneAcc : Math.round(((sceneAcc + cardAcc) / 2) * 100) / 100
      const listeningCorrect = state.listeningPicked !== null && state.listeningPicked !== undefined
        ? !!biteQuestion.options[state.listeningPicked]?.correct
        : null
      recordSessionSummary({
        minutes: minutesSpent,
        accuracy01,
        lapseRate: results.length ? Math.round((again / results.length) * 100) / 100 : 0,
        proof,
        listeningCorrect: isBusy ? null : listeningCorrect,
        listeningScript: bite.script,
      })
      recordMetric('session_completed', { minutes: minutesSpent, proof }) // gate metric (Doc 11)
      if (state.planExperiment) noteSessionForExperiment({ experiment: state.planExperiment }, { proof })
    }
    patch({ step: 3, done: true, recorded: true, elapsedBaseSec: elapsedSec, segmentStartAt: new Date().toISOString() })
  }

  // Surge offer (Doc 05 §7): more is OFFERED on a climbing week, never
  // forced — a few extra cards, only if the learner taps for them.
  const startBonus = () => {
    const extra = buildSessionCards(queueRef.current)
      .filter((c) => !(state.cardIds || []).includes(c.id))
      .slice(0, 3)
    if (!extra.length) return
    setFlipped(false)
    setState((s) => ({
      ...s, done: false, step: 1, bonus: true,
      cardIds: [...(s.cardIds || []), ...extra.map((c) => c.id)],
      segmentStartAt: new Date().toISOString(),
    }))
  }
  const chooseEffort = (answer) => { setEffort(answer); saveEffort(answer, state.variant) }

  const switchVariant = (variant) => {
    if (variant === state.variant) return
    const fresh = freshState(profile, diagnosis, queueRef.current, variant)
    // Keep today's accumulated time — switching size is not restarting.
    fresh.elapsedBaseSec = state.elapsedBaseSec || 0
    setInput(''); setLastAttempt(null); setFlipped(false)
    setState(fresh)
  }

  const isBusy = state.variant === 'busy'
  const sceneCleared = state.sceneDone || (state.sceneBest || 0) >= MASTERY || (state.sceneAttempts || 0) >= 3
  const bonusAvailable = state.planMode === 'surge'
    ? buildSessionCards(queue).filter((c) => !(state.cardIds || []).includes(c.id)).length
    : 0

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center space-y-2 pt-2">
        <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#FF8A75]"><Sparkles size={14} /> {t('session.eyebrow')}</p>
        {state.done && <div className="mb-3"><Mascot agent="michi" size={64} showName={false} motion="hop" label={t('session.mascotDoneLabel', { name: 'Michi' })} /></div>}
        <h2 className="text-2xl sm:text-3xl font-bold text-white">{state.done ? t('session.titleDone') : isBusy ? t('session.titleBusy') : t('session.titleStart')}</h2>
        <p className="text-sm text-slate-400 max-w-xl mx-auto">
          {state.step > 0 && !state.done
            ? t('session.resumeLine')
            : t('session.introLine')}
        </p>
        {!state.done && (
          <button onClick={() => switchVariant(isBusy ? 'full' : 'busy')} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-bun-800/70 border border-bun-600/40 text-slate-300 hover:text-white transition">
            <Coffee size={12} /> {isBusy ? t('session.toFull') : t('session.toBusy')}
          </button>
        )}
      </div>

      {!state.done && (
        <div className="flex items-center gap-2">
          {(isBusy ? [0] : [0, 1, 2]).map((s) => (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full ${state.step >= s ? 'bg-gradient-to-r from-[#71368A] to-cyan-500' : 'bg-bun-700'}`} />
              <p className={`text-[10px] mt-1.5 text-center ${state.step === s ? 'text-[#FF8A75] font-semibold' : 'text-slate-500'}`}>{t(STEP_KEYS[s])}</p>
            </div>
          ))}
          <span className="text-xs text-slate-500 shrink-0 pl-2">{Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')}</span>
        </div>
      )}

      {!state.done && state.planNote && state.step === 0 && (
        <div className="rounded-2xl bg-sky-500/10 border border-sky-500/25 p-4 flex items-start gap-3">
          <Mascot agent="saki" size={32} showName={false} />
          <p className="text-sm text-slate-200"><span className="font-semibold text-white">{t('session.planPrefix', { name: 'Saki' })}</span> {state.planNoteKey
            ? t(state.planNoteKey, { title: state.planSceneTitle, cards: state.planCardBudget, minutes: state.planMinutes, reason: t(state.planNoteVars?.reasonKey || 'planner.reasonMatched', state.planNoteVars?.reasonVars || {}) })
            : state.planNote}</p>
        </div>
      )}

      {/* STEP 1 — the scene */}
      {!state.done && state.step === 0 && (
        <section className="rounded-2xl glass p-5 sm:p-6 card-glow space-y-4">
          <div>
            <h3 className="text-lg font-bold text-white">{scene.title}</h3>
            <p className="text-xs text-slate-400">{t('session.sceneMeta', { domain: scene.domain, level: scene.level })}</p>
          </div>
          <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
            <p className="text-xs text-slate-400 mb-1">{t('voice.partnerSays')}</p>
            <div className="flex items-start gap-2">
              <p className="text-slate-100 leading-loose flex-1"><KanjiTapText text={scene.partner} /></p>
              <TtsButton text={scene.partner} cast={scene.partnerVoice || undefined} />
            </div>
          </div>
          <p className="text-sm text-slate-200"><span className="text-[#FF8A75] font-semibold">{t('voice.yourTurn')}</span> {scene.promptEn}</p>
          {(scene.keyPhrases || []).length > 0 && (
            <p className="text-xs text-slate-400 flex flex-wrap items-center gap-1.5">
              {scene.keyPhrases.map((kp) => (
                <span key={kp} className="px-2 py-0.5 rounded-full bg-bun-700/70 border border-bun-600/30 text-slate-200">{kp}</span>
              ))}
            </p>
          )}
          <div className="flex gap-2">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder={t('call.inputPlaceholder')}
              className="flex-1 rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
            <div className="flex flex-col gap-2">
              <button onClick={startListening} disabled={!speechSupported || listening} className="px-3 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5">
                {listening ? <MicOff size={14} /> : <Mic size={14} />} {listening ? t('call.listeningBtn') : t('voice.speak')}
              </button>
              <button onClick={() => checkScene()} disabled={!input.trim()} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium">{t('voice.checkMe')}</button>
            </div>
          </div>
          {micError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm font-semibold text-amber-200">{micError.titleKey ? t(micError.titleKey) : micError.title}</p>
            <p className="text-xs text-amber-100/80 mt-0.5">{micError.bodyKey ? t(micError.bodyKey) : micError.body}</p>
          </div>
            )}
            {!speechSupported && <p className="text-xs text-slate-500">{t('voice.noVoice')}</p>}

          {lastAttempt && (
            <div className={`rounded-xl border p-4 space-y-2 ${lastAttempt.score >= MASTERY ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-bun-700/40 border-bun-600/20'}`}>
              <p className="text-sm text-slate-200">「{lastAttempt.text}」 <span className={`font-bold ${lastAttempt.score >= MASTERY ? 'text-emerald-300' : 'text-amber-300'}`}>{lastAttempt.score}%</span></p>
              {lastAttempt.score >= MASTERY ? (
                <p className="text-sm text-emerald-200 flex items-center gap-2"><CheckCircle2 size={15} /> {t('session.attemptClean')}</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Mascot agent="nao" size={26} showName={false} />
                    <p className="text-xs text-slate-300"><span className="font-semibold text-white">{t('session.naoPrefix', { name: 'Nao' })}</span> {t('session.naoBody')}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <p className="text-sm text-slate-200 leading-loose flex-1">{t('call.model')} <KanjiTapText text={scene.model} /></p>
                    <TtsButton text={scene.model} />
                  </div>
                  {(scene.keyPhrases || []).length > 0 && (
                    <p className="flex flex-wrap gap-1.5">
                      {scene.keyPhrases.map((kp) => lastAttempt.missing.includes(kp)
                        ? <span key={kp} className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/50 text-amber-200 text-xs">{kp}</span>
                        : <span key={kp} className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/50 text-emerald-200 text-xs">{kp}</span>)}
                    </p>
                  )}
                  <p className="text-xs text-slate-400">{scene.commonError}</p>
                  <button onClick={() => { setInput(''); setLastAttempt(null); startListening() }} className="px-3 py-1.5 rounded-lg bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-xs font-medium flex items-center gap-1"><RotateCcw size={13} /> {t('voice.sayAgain')}</button>
                </>
              )}
            </div>
          )}
          {state.sceneAttempts > 0 && !sceneCleared && <p className="text-xs text-slate-500">{t('session.bestSoFar', { best: state.sceneBest, mastery: MASTERY })}</p>}

          {sceneCleared && (
            <button onClick={() => (isBusy ? finish() : advanceTo(1))} className="w-full py-3 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-semibold flex items-center justify-center gap-2 transition">
              {isBusy ? t('session.finishBusy') : t('session.toCards')} <ChevronRight size={17} />
            </button>
          )}
          {!sceneCleared && state.sceneAttempts > 0 && (
            <button onClick={() => (isBusy ? finish() : advanceTo(1))} className="w-full py-2 text-xs text-slate-400 hover:text-slate-200 transition">{t('session.moveOn')}</button>
          )}
          {state.sceneAttempts === 0 && (
            <p className="text-[11px] text-slate-600 text-center">{t('session.leavingNote')}</p>
          )}
        </section>
      )}

      {/* STEP 2 — up to 5 queue cards */}
      {!state.done && state.step === 1 && (
        <section className="rounded-2xl glass p-5 sm:p-6 card-glow space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-white">{t('session.cardsTitle')}</h3>
            <span className="text-xs text-slate-400">{t('session.cardsProgress', { done: (state.ratedIds || []).length, total: sessionCards.length })}</span>
          </div>
          {card ? (
            <div className="space-y-3">
              <button onClick={() => setFlipped((f) => !f)} className="w-full text-left rounded-2xl bg-bun-700/40 border border-bun-600/30 p-6 min-h-[130px] hover:border-[#FF6B57]/40 transition">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{t('session.cardsFrom', { source: card.source })}{card.level ? t('session.cardsLevelBit', { level: card.level }) : ''}{t('session.cardsTapFlip')}</p>
                {!flipped ? <p className="text-lg text-white leading-loose">{card.front}</p> : (
                  <span><span className="block text-lg text-emerald-200 leading-loose">{card.back}</span>{card.note && <span className="block text-xs text-slate-400 mt-2">{card.note}</span>}</span>
                )}
              </button>
              {flipped && previews ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => rateCard(Rating.Again)} className="px-3 py-3 rounded-xl bg-rose-600/80 hover:bg-rose-500 text-white text-sm font-semibold">{t('queue.rateAgain')}<span className="block text-[10px] opacity-80 font-normal">{previews[Rating.Again].label}</span></button>
                  <button onClick={() => rateCard(Rating.Good)} className="px-3 py-3 rounded-xl bg-emerald-600/80 hover:bg-emerald-500 text-white text-sm font-semibold">{t('queue.rateGood')}<span className="block text-[10px] opacity-80 font-normal">{previews[Rating.Good].label}</span></button>
                </div>
              ) : (
                <p className="text-xs text-slate-500 text-center">{t('session.cardsHint')}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-300">{sessionCards.length ? t('session.cardsAllDone') : t('session.cardsEmpty')}</p>
              <button onClick={() => advanceTo(2)} className="w-full py-3 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-semibold flex items-center justify-center gap-2 transition">{t('session.toListening')} <ChevronRight size={17} /></button>
            </div>
          )}
        </section>
      )}

      {/* STEP 3 — one listening bite */}
      {!state.done && state.step === 2 && (
        <section className="rounded-2xl glass p-5 sm:p-6 card-glow space-y-4">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Headphones size={18} className="text-teal-300" /> {t('session.listeningTitle')}</h3>
            <p className="text-xs text-slate-400">{t('session.listeningMeta', { title: bite.title, level: bite.level })}{diagnosis?.weakest === 'listening' ? t('session.listeningWeakest') : diagnosis ? t('session.listeningLevel', { estimate: diagnosis.jlptEstimate }) : ''}{t('session.listeningSuffix')}</p>
          </div>
          <div className="flex items-center gap-3">
            <TtsButton text={bite.script} className="px-4 py-2 text-sm font-medium" />
            <span className="text-sm text-slate-300">{t('session.listeningHint')}</span>
          </div>
          <p className="text-white">{biteQuestion.prompt}</p>
          <div className="grid gap-2">
            {biteQuestion.options.map((opt, i) => {
              const picked = state.listeningPicked
              const chosen = picked === i
              return (
                <button key={i} onClick={() => { if (picked === null || picked === undefined) patch({ listeningPicked: i }) }}
                  className={`text-left px-4 py-3 rounded-xl border transition ${picked !== null && picked !== undefined && opt.correct ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200' : chosen ? 'bg-rose-500/15 border-rose-500/50 text-rose-200' : 'bg-bun-700/40 border-bun-600/30 text-slate-200 hover:bg-bun-700/60'}`}>
                  {opt.label}
                </button>
              )
            })}
          </div>
          {(state.listeningPicked !== null && state.listeningPicked !== undefined) && (
            <div className="space-y-3">
              <p className="text-sm text-slate-300">{biteQuestion.explanation}</p>
              <button onClick={finish} className="w-full py-3 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-semibold flex items-center justify-center gap-2 transition">{t('session.finish')} <ChevronRight size={17} /></button>
            </div>
          )}
        </section>
      )}

      {/* END — saved, complete, and the one honest question */}
      {state.done && (
        <section className="rounded-2xl glass p-6 sm:p-8 card-glow space-y-5 text-center">
          <CheckCircle2 size={40} className="text-emerald-400 mx-auto" />
          <div>
            <h3 className="text-2xl font-bold text-white">{isBusy ? t('session.endTitleBusy') : t('session.endTitle')}</h3>
            <p className="text-sm text-slate-300 mt-2 max-w-lg mx-auto">
              {t(minutesSpent === 1 ? 'session.endAboutOne' : 'session.endAboutMany', { minutes: minutesSpent })}{t('session.endSceneBit')}{!isBusy && (state.ratedIds || []).length ? t('session.endCardsBit', { count: (state.ratedIds || []).length }) : ''}{!isBusy ? t('session.endBiteBit') : ''}{t('session.endTail')}
            </p>
          </div>
          <div className="rounded-xl bg-bun-700/40 border border-bun-600/30 p-4 text-left">
            <p className="text-sm text-slate-200">
              {diagnosis
                ? <>{t('session.endStand')}<span className="text-white font-semibold">{diagnosis.jlptEstimate}</span>{reachedRung ? <>{t('session.endReached')}<span className="text-white font-semibold">{reachedRung.labelKey ? t(reachedRung.labelKey) : reachedRung.label}</span></> : ''}{nextRung ? <>{t('session.endNext')}<span className="text-[#FF8A75] font-semibold">{nextRung.labelKey ? t(nextRung.labelKey) : nextRung.label}</span>{t('session.endNextProof', { proof: nextRung.proofKey ? t(nextRung.proofKey) : nextRung.proof })}</> : ''}</>
                : t('session.endNoDiagnosis')}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-white">{t('session.effortQuestion')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {['Not really', 'A bit', 'Yes'].map((a) => (
                <button key={a} onClick={() => chooseEffort(a)} className={`px-4 py-2 rounded-full text-sm font-medium border transition ${effort === a ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-bun-700/60 text-slate-200 border-bun-600/40 hover:text-white'}`}>{t(EFFORT_KEYS[a])}</button>
              ))}
            </div>
            {effort && <p className="text-xs text-emerald-300">{effort === 'Not really' ? t('session.effortReplyNotReally') : t('session.effortReplyOther')}</p>}
          </div>
          {bonusAvailable > 0 && (
            <div className="rounded-xl bg-[#FF6B57]/10 border border-[#FF6B57]/30 p-4 space-y-2">
              <p className="text-sm text-slate-200">{t('session.surgeText')}</p>
              <button onClick={startBonus} className="px-5 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 text-white text-sm font-semibold">{t('session.surgeButton')}</button>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <button onClick={() => setActive?.('dashboard')} className="px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold flex items-center gap-1.5"><Play size={15} /> {t('session.backToday')}</button>
            <button onClick={() => setActive?.('diagnosis')} className="px-5 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">{t('session.seeDiagnosis')}</button>
          </div>
        </section>
      )}

    </div>
  )
}
