import { useEffect, useMemo, useRef, useState } from 'react'
import { Phone, PhoneOff, Mic, MicOff, CheckCircle2, RotateCcw, Clock, Bell, Inbox, X, Volume2, VolumeX, ChevronDown } from 'lucide-react'
import { loadProfile } from '../lib/profile.js'
import { micErrorCopy } from '../lib/speechErrors.js'
import { primeSpeech, ttsAvailable } from '../lib/tts.js'
import { speakSenseiLine, stopNeuralSpeech } from '../lib/neuralVoice.js'
import { useFurigana } from '../hooks/useFurigana.js'
import { segmentFurigana, cleanReading } from '../lib/furigana.js'
import { localDictionary, lookup } from '../lib/dictionary.js'
import { findStudyItem } from '../lib/findStudyItem.js'
import { addToQueue } from '../lib/queue.js'
import { todayStr } from '../lib/session.js'
import {
  loadCallState, saveCallState, ensureToday, pickCallScenes, registerMiss, recordHistory,
  loadInbox, markInboxDone, fmtTime, MASTERY, INCOMING_CALL_KEY,
} from '../lib/calls.js'
import { useAuth } from '../hooks/useAuth.js'
import { useLanguage } from '../hooks/useLanguage.js'
import { syncCallWindows } from '../lib/callSync.js'
import { bestScore, missingPhrases } from './VoiceLoop.jsx'
import { recordVoiceAttempt, recordCallOutcome } from '../lib/twin.js'
import Mascot from './Mascot.jsx'
import MicPrompt from './MicPrompt.jsx'
import { micExplained, markMicExplained } from '../lib/micConsent.js'
import TtsButton from './TtsButton.jsx'
import KanjiTapText from './KanjiTapText.jsx'

// SENSEI CALL — the app calls YOU.
//
// Why this exists: the learners who got good had a life that REQUIRED
// Japanese daily (a lab, a company). A life that requires none lets the
// level slip. So the app manufactures a small requirement: a short spoken
// call at a varied time inside windows you choose. Miss it and it calls
// back ONCE, then leaves a kind message with a 60-second version, then
// silence. Persistence without punishment — never a streak, never a debt.
//
// Honest limit, stated in the UI too: this is a web app. While it is closed
// it can only reach you by push notification; the call itself is this
// call-style screen inside the app. It is not a real phone call.

const RING_TIMEOUT_MS = 45000

// Spoken once when a turn meets silence, before the call falls back to
// the typed controls: "Go ahead — it's your turn."
const REPROMPT_LINE = 'どうぞ、あなたの番です。'

function shortMeaning(raw) {
  if (!raw) return ''
  const first = String(raw).split(/[;,(（]/)[0].trim()
  return first.length > 42 ? `${first.slice(0, 42)}…` : first
}

/**
 * The word-spotlight cards for a scene: dictionary words in the order
 * Sensei speaks them (segmented from her line), then the scene's key
 * phrases — the same list missingPhrases() checks the learner's answer
 * against. Readings come from the app dictionary; meanings are shortened
 * to the first gloss. Cards are a reading aid, lit in sequence while a
 * line is spoken (estimated timing — see index.css .spot-active).
 */
function buildSpotlight(scene, index) {
  if (!scene) return []
  const seen = new Set()
  const order = []
  const readings = new Map()
  const push = (word, reading) => {
    const w = (word || '').trim()
    if (!w || seen.has(w)) return
    seen.add(w)
    order.push(w)
    if (reading) readings.set(w, reading)
  }
  if (index) {
    for (const part of segmentFurigana(scene.partner || '', index)) {
      if (part.type === 'w' && part.text.length >= 2) push(part.text, part.reading)
    }
  }
  for (const p of scene.keyPhrases || []) push(p)
  return order.slice(0, 8).map((word) => {
    const entry = lookup(localDictionary, word)
    let reading = readings.get(word) || ''
    if (!reading && index) reading = segmentFurigana(word, index).map((p) => (p.type === 'w' ? p.reading : p.text)).join('')
    if (entry?.reading) reading = cleanReading(entry.reading) || reading
    return { word, reading, meaning: shortMeaning(entry?.meaning || findStudyItem(word)?.meaning || '') }
  })
}

function freshRingChain(profile, slotIdx) {
  return pickCallScenes(profile, todayStr(), slotIdx || 0, 3)
}

export default function SenseiCall() {
  const profile = useMemo(loadProfile, [])
  const { user } = useAuth()
  const { t } = useLanguage()
  // Honest reach mode (Doc 02 §3.2): signed in = the server scheduler can
  // ring a closed app by push; signed out = calls ring on this device when
  // the app opens. The settings copy below says exactly which one applies.
  const reachMode = user ? 'server' : 'device'
  const [callState, setCallState] = useState(() => {
    const s = ensureToday(loadCallState())
    // A slot left 'ringing' by a closed tab is simply pending again.
    const date = todayStr()
    const day = s.days[date]
    if (day && day.slots.some((x) => x.status === 'ringing')) {
      const fixed = { ...s, days: { ...s.days, [date]: { ...day, slots: day.slots.map((x) => (x.status === 'ringing' ? { ...x, status: 'pending' } : x)) } } }
      saveCallState(fixed)
      return fixed
    }
    saveCallState(s)
    return s
  })
  const [settings, setSettings] = useState(callState.settings)
  const [savedNote, setSavedNote] = useState('')
  const [inbox, setInbox] = useState(loadInbox)
  const [notice, setNotice] = useState('') // callback / inbox announcements

  // Call machine: idle | ringing | incall | wrapup
  const [phase, setPhase] = useState('idle')
  const [ring, setRing] = useState(null) // { source, slotIdx, chain, inboxId? }
  const [exIdx, setExIdx] = useState(0)
  const [input, setInput] = useState('')
  const [lastAttempt, setLastAttempt] = useState(null)
  const [results, setResults] = useState([]) // per finished exchange
  const [current, setCurrent] = useState(null) // running stats for the live exchange
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState(null)
  const [wrap, setWrap] = useState(null) // wrap-up summary
  const recogRef = useRef(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const updateState = (next) => { saveCallState(next); setCallState(next); return next }

  const today = todayStr()
  const day = callState.days[today]
  const chain = ring?.chain || []
  const scene = chain[Math.min(exIdx, Math.max(0, chain.length - 1))]
  const exchangesTotal = ring?.source === 'mini' ? 1 : chain.length
  const speechSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  // ---------- hands-free turn-taking (the call runs itself) ----------
  // turnState: 'sensei' (Sensei is speaking) → 'listening' (mic open,
  // your turn) → 'scoring' → 'feedback' (the model plays, then the call
  // advances on its own). 'manual' is the fallback whenever the loop
  // can't run — no speech recognition, mic muted/blocked/not yet
  // explained, or two silent turns — and hands over to the typed
  // controls, which stay one tap away the whole call.
  //
  // HALF-DUPLEX, by construction: the mic is only ever open during
  // 'listening'. speakLine() stops recognition before any speech, and
  // startListening() cancels speech before opening the mic — so the mic
  // can never again transcribe Sensei's own voice from the speaker.
  const { index: furiganaIndex } = useFurigana()
  const spotlight = useMemo(() => buildSpotlight(scene, furiganaIndex), [scene, furiganaIndex])
  const [turnState, setTurnState] = useState('sensei')
  const [micMuted, setMicMuted] = useState(false)
  const [senseiMuted, setSenseiMuted] = useState(false)
  const [interim, setInterim] = useState('')
  const [spotActive, setSpotActive] = useState(-1)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualNote, setManualNote] = useState('')
  const turnRef = useRef('sensei')
  const micMutedRef = useRef(false)
  const senseiMutedRef = useRef(false)
  const timersRef = useRef([])
  const spotTimersRef = useRef([])
  const listenSessionRef = useRef(0)
  const repromptRef = useRef(0)
  const advancedKeyRef = useRef('')
  const currentRef = useRef(null)
  currentRef.current = current

  const goTurn = (t) => { turnRef.current = t; setTurnState(t) }
  const later = (fn, ms) => {
    const id = setTimeout(() => { timersRef.current = timersRef.current.filter((x) => x !== id); fn() }, ms)
    timersRef.current.push(id)
    return id
  }
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = [] }
  const clearSpotTimers = () => { spotTimersRef.current.forEach(clearTimeout); spotTimersRef.current = [] }

  const stopSpeech = () => {
    // Both voices stop: the neural audio (if a line is playing from the
    // tts function) and the device speech engine. stopNeuralSpeech
    // completes the pending line exactly once, like a cancelled
    // utterance does, so the turn machine steps on by itself.
    stopNeuralSpeech()
    try { window.speechSynthesis?.cancel() } catch { /* no speech engine */ }
  }
  const stopRecognition = () => {
    listenSessionRef.current += 1 // invalidate any pending recognition callbacks
    const rec = recogRef.current
    if (rec) {
      try { rec.onresult = null; rec.onend = null; rec.onerror = null; rec.stop() } catch { /* already stopped */ }
      recogRef.current = null
    }
    setListening(false)
  }

  // Light the spotlight cards in the order their words occur in the
  // spoken line, spreading the utterance's estimated duration across
  // them (same estimate as the TTS safety timer — an approximation,
  // not phoneme timing).
  const runSpotlight = (text) => {
    clearSpotTimers()
    setSpotActive(-1)
    if (!text || !spotlight.length) return
    const hits = spotlight.map((c, i) => ({ i, at: text.indexOf(c.word) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at)
    if (!hits.length) return
    const estMs = 1200 + 90 * text.length
    const per = estMs / hits.length
    hits.forEach((h, k) => { spotTimersRef.current.push(setTimeout(() => setSpotActive(h.i), Math.round(k * per))) })
    spotTimersRef.current.push(setTimeout(() => setSpotActive(-1), estMs + 250))
  }

  // Every Sensei utterance in the call goes through here: mic closed
  // first (half-duplex), spotlight running, and a muted Sensei voice
  // simply steps the flow on after a beat instead of speaking.
  // Voice source order (Doc 06 §5.1, Doc 17 decision 2026-11-06):
  // speakSenseiLine tries the neural voice first (the free Edge TTS
  // `tts` function, signed-in users) and falls back to the device
  // voice (speakText) on any failure — its onEnd contract is the
  // same exactly-once one the state machine already relies on.
  const speakLine = (text, { rate = 0.95, onEnd } = {}) => {
    stopRecognition()
    if (senseiMutedRef.current) { if (onEnd) later(onEnd, 450); return }
    runSpotlight(text)
    speakSenseiLine(text, {
      rate,
      onEnd: () => { clearSpotTimers(); setSpotActive(-1); if (onEnd) onEnd() },
    })
  }

  const dropToManual = (note) => {
    stopRecognition()
    goTurn('manual')
    setManualOpen(true)
    if (note) setManualNote(note)
  }

  // A turn that heard nothing: one spoken re-prompt, then the typed
  // controls — never a loop.
  const handleSilence = () => {
    if (turnRef.current !== 'listening') return
    if (repromptRef.current >= 1) {
      dropToManual(t('call.manualNoHear'))
      return
    }
    repromptRef.current += 1
    goTurn('sensei')
    speakLine(REPROMPT_LINE, { onEnd: () => later(() => { if (turnRef.current === 'sensei') beginUserTurn() }, 700) })
  }

  const beginUserTurn = () => {
    if (phaseRef.current !== 'incall') return
    if (micMutedRef.current) { dropToManual(t('call.manualMicMutedTurn')); return }
    if (!speechSupported) { dropToManual(t('call.manualNoVoice')); return }
    if (!micExplained()) { setShowMicPrompt(true); dropToManual(); return }
    setInterim('')
    startListening({ auto: true })
  }

  const toggleMicMute = () => {
    const next = !micMutedRef.current
    micMutedRef.current = next
    setMicMuted(next)
    if (next) {
      if (turnRef.current === 'listening') dropToManual(t('call.manualMicMutedToggle'))
    } else if (phaseRef.current === 'incall' && turnRef.current === 'manual') {
      setManualNote('')
      beginUserTurn()
    }
  }

  const toggleSenseiMute = () => {
    const next = !senseiMutedRef.current
    senseiMutedRef.current = next
    setSenseiMuted(next)
    // Cancelling makes the pending utterance complete (tts.js fires its
    // onEnd exactly once), so a muted-mid-line call steps on by itself.
    if (next) stopSpeech()
  }

  // ---------- ringing triggers (checked on mount + every 20 s) ----------
  const startRinging = (ctx) => {
    setRing(ctx)
    setPhase('ringing')
    setResults([]); setCurrent(null); setExIdx(0); setInput(''); setLastAttempt(null)
  }

  useEffect(() => {
    const evaluate = () => {
      if (phaseRef.current !== 'idle') return
      let s = ensureToday(loadCallState())
      if (!s.settings.enabled) { setCallState(s); return }
      const date = todayStr()
      const d = s.days[date]
      if (!d || d.stopped) { setCallState(s); return }
      const now = new Date()
      // A scheduled callback that is due rings first.
      if (d.callback && d.callback.status === 'pending' && new Date(d.callback.at) <= now) {
        const slotIdx = d.callback.slotIdx
        const cb = { ...d.callback, status: 'ringing' }
        s = { ...s, days: { ...s.days, [date]: { ...d, callback: cb } } }
        updateState(s)
        startRinging({ source: 'callback', slotIdx, chain: freshRingChain(profile, slotIdx) })
        return
      }
      for (const slot of d.slots) {
        if (slot.status !== 'pending') continue
        const at = new Date(slot.at)
        if (at > now) continue
        const overdueMs = now - at
        const isCatchup = overdueMs > 2 * 60000
        if (isCatchup && (slot.catchupShown || d.catchupRung)) {
          // One catch-up offer per day, total (Landry,
          // 2026-11-07: after saving settings with several
          // windows already past, every slot rang in turn —
          // "it is calling me many times"). A past slot that
          // was not the day's one catch-up is quietly skipped:
          // it was never really offered, so it is not a miss.
          const slots = d.slots.map((x) => (x.idx === slot.idx ? { ...x, status: 'skipped' } : x))
          s = { ...s, days: { ...s.days, [date]: { ...d, slots } } }
          updateState(s)
          return
        }
        const slots = d.slots.map((x) => (x.idx === slot.idx ? { ...x, status: 'ringing', catchupShown: isCatchup ? true : x.catchupShown } : x))
        s = { ...s, days: { ...s.days, [date]: { ...d, ...(isCatchup ? { catchupRung: true } : {}), slots } } }
        updateState(s)
        startRinging({ source: isCatchup ? 'catchup' : 'slot', slotIdx: slot.idx, chain: freshRingChain(profile, slot.idx) })
        return
      }
      setCallState(s)
    }
    evaluate()
    const t = setInterval(evaluate, 20000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- incoming summons from a push tap (server doorbell) ----------
  // Two arrivals: (a) the app was opened by the notification — the slot is
  // in the URL hash (?call=<slotId>&date=…&slot=…); (b) the app was already
  // open — the service worker messaged App.jsx, which stashed the slot in
  // sessionStorage and routed here. Either way: if that slot is still
  // pending today, ring for it now (source 'push'). Anything stale or
  // already handled is ignored — the normal trigger/catch-up logic above
  // remains the fallback for every other case.
  const intakeDoneRef = useRef(false)
  useEffect(() => {
    if (intakeDoneRef.current) return
    intakeDoneRef.current = true
    let ctx = null
    try {
      const hash = window.location.hash || ''
      if (hash.includes('?')) {
        const q = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
        if (q.get('call')) ctx = { date: q.get('date'), slotIdx: Number(q.get('slot')) }
      }
      if (!ctx) {
        const stored = sessionStorage.getItem(INCOMING_CALL_KEY)
        if (stored) {
          sessionStorage.removeItem(INCOMING_CALL_KEY)
          const p = JSON.parse(stored)
          ctx = { date: p.date || p.slotDate, slotIdx: p.slotIdx }
        }
      }
    } catch { ctx = null }
    if (!ctx || ctx.date !== todayStr() || !Number.isFinite(ctx.slotIdx)) return
    if (phaseRef.current !== 'idle') return
    let s = ensureToday(loadCallState())
    if (!s.settings.enabled) return
    const date = todayStr()
    const d = s.days[date]
    if (!d || d.stopped) return
    const slot = d.slots.find((x) => x.idx === ctx.slotIdx)
    if (!slot || slot.status !== 'pending') return
    const slots = d.slots.map((x) => (x.idx === slot.idx ? { ...x, status: 'ringing' } : x))
    s = { ...s, days: { ...s.days, [date]: { ...d, slots } } }
    updateState(s)
    startRinging({ source: 'push', slotIdx: slot.idx, chain: freshRingChain(profile, slot.idx) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ring timeout → counts as a miss (except test/mini rings, which just close).
  useEffect(() => {
    if (phase !== 'ringing') return undefined
    const t = setTimeout(() => { handleMissedRef.current?.('rung out') }, RING_TIMEOUT_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ring])

  // ---------- miss / callback / inbox chain ----------
  const handleMissed = (how) => {
    if (!ring) { setPhase('idle'); return }
    const { source, slotIdx } = ring
    if (source === 'test' || source === 'mini') { setRing(null); setPhase('idle'); return }
    recordCallOutcome({ kept: false })
    let s = loadCallState()
    s = recordHistory(s, { kind: 'call', scene: chain[0]?.title || t('call.practiceCallFallback'), status: 'missed', bestScore: null, how })
    const { state: next, outcome } = registerMiss(s, { slotIdx, wasCallback: source === 'callback', sceneTitle: chain[0]?.title })
    updateState(next)
    setInbox(loadInbox())
    if (outcome.kind === 'callback') {
      // Landry (2026-11-07): "this can be a notification." The
      // Today's-calls card below already carries the callback
      // in-app; the announcement itself goes out as a system
      // notification when permission already exists — never a
      // prompt from here, and no duplicate banner.
      setNotice('')
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
          navigator.serviceWorker.ready
            .then((reg) => reg.showNotification(t('call.noticeCallbackTitle', { sensei: next.settings.senseiName }), { body: t('call.noticeCallback', { sensei: next.settings.senseiName, time: fmtTime(outcome.at) }), tag: 'yonde-callback' }))
            .catch(() => {})
        }
      } catch { /* notifications are an enhancement */ }
    }
    else if (outcome.kind === 'inbox') setNotice(t('call.noticeInbox'))
    else setNotice('')
    setRing(null); setPhase('idle')
  }
  const handleMissedRef = useRef(handleMissed)
  handleMissedRef.current = handleMissed

  // ---------- the call ----------
  const [showMicPrompt, setShowMicPrompt] = useState(false)
  // Same first-use microphone explanation as the Voice Loop (Doc 15).
  const requestListening = () => {
    if (micExplained()) startListening()
    else setShowMicPrompt(true)
  }
  const confirmMic = () => { markMicExplained(); setShowMicPrompt(false); startListening() }

  // How long the learner's turn stays open after the last
  // sound of speech before the answer counts as finished.
  // iOS finalises a recognition segment after a breath — well
  // under a second — so a turn must NOT end on a segment
  // boundary: segments accumulate, and only a real silence
  // gap ends the turn (Landry, 2026-11-07: the call "feels
  // rushed… I am not done reading and it goes to another
  // sentence").
  const SILENCE_GAP_MS = 2600
  const silenceTimerRef = useRef(null)
  const clearSilenceTimer = () => { if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null } }

  const startListening = ({ auto = false } = {}) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { if (auto) dropToManual(t('call.manualNoVoice')); return }
    stopSpeech() // half-duplex: Sensei is silenced before the mic opens
    stopRecognition()
    clearSilenceTimer()
    const session = listenSessionRef.current
    // Auto-turn state: accumulated final segments, whether the
    // turn has been submitted, and how many times the
    // recogniser has been relaunched inside this one turn
    // (iOS ends sessions on its own; the turn outlives them).
    const turn = { text: '', submitted: false, restarts: 0 }

    const finishAutoTurn = () => {
      if (turn.submitted) return
      turn.submitted = true
      clearSilenceTimer()
      const text = turn.text.trim()
      stopRecognition()
      setInterim('')
      if (text) {
        setInput(text)
        setMicError(null)
        runCheckRef.current(text, { auto: true })
      } else {
        handleSilence()
      }
    }
    const armSilenceTimer = () => {
      clearSilenceTimer()
      silenceTimerRef.current = setTimeout(() => {
        if (listenSessionRef.current !== session) return
        if (turnRef.current !== 'listening') return
        finishAutoTurn()
      }, SILENCE_GAP_MS)
    }

    const launch = () => {
      if (listenSessionRef.current !== session) return
      const rec = new SR()
      recogRef.current = rec
      rec.lang = 'ja-JP'; rec.interimResults = true; rec.maxAlternatives = 1
      rec.onresult = (e) => {
        if (listenSessionRef.current !== session) return
        let interimText = ''
        let finalText = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]
          if (res.isFinal) finalText += res[0]?.transcript || ''
          else interimText += res[0]?.transcript || ''
        }
        if (!auto) {
          // Manual: the first final fills the box, as before.
          if (finalText.trim()) {
            stopRecognition()
            setInterim('')
            setInput(finalText.trim())
            setMicError(null)
          } else if (interimText) setInterim(interimText)
          return
        }
        // Auto: speech activity — a segment is NEVER the whole
        // answer by itself. Accumulate and re-arm the gap.
        if (finalText) turn.text += finalText
        if (finalText || interimText) {
          setInterim(`${turn.text}${interimText}`)
          armSilenceTimer()
        }
      }
      rec.onerror = (e) => {
        if (listenSessionRef.current !== session) return
        const err = e?.error
        if (err === 'aborted' || err === 'no-speech') return // onend drives the auto path
        setListening(false)
        setMicError(micErrorCopy(err))
        if (auto) { clearSilenceTimer(); dropToManual() }
      }
      rec.onend = () => {
        if (listenSessionRef.current !== session) return
        if (!auto) { setListening(false); return }
        if (turn.submitted || turnRef.current !== 'listening') return
        // The recogniser ended mid-turn (an iOS habit): relaunch
        // and keep listening — the silence gap, not the
        // recogniser, decides when the learner is done. A cap
        // keeps a wedged recogniser from looping forever; at
        // the cap the turn finishes with whatever it holds.
        if (turn.restarts >= 10) { finishAutoTurn(); return }
        turn.restarts += 1
        setListening(true)
        try { launch() } catch { finishAutoTurn() }
      }
      setListening(true)
      try { rec.start() } catch { setListening(false); if (auto) finishAutoTurn() }
    }

    if (auto) { goTurn('listening'); armSilenceTimer() }
    else { goTurn('manual'); setManualOpen(true) }
    launch()
  }

  // The automatic exchange loop: when an exchange opens, Sensei speaks
  // her line (P2-4's auto-speak, now with turn-taking) — and when she
  // finishes, the mic opens by itself. No buttons in the loop.
  const spokenForRef = useRef('')
  useEffect(() => {
    if (phase !== 'incall' || !scene) return
    const key = `${scene.id}:${exIdx}`
    if (spokenForRef.current === key) return
    spokenForRef.current = key
    repromptRef.current = 0
    advancedKeyRef.current = ''
    clearTimers()
    clearSpotTimers()
    setSpotActive(-1)
    setInterim('')
    setManualOpen(false)
    setManualNote('')
    goTurn('sensei')
    if (senseiMutedRef.current) later(() => beginUserTurn(), 900)
    else speakLine(scene.partner, { onEnd: () => later(() => beginUserTurn(), 900) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, exIdx, scene])

  // Leaving the in-call screen (hang up, wrap-up, unmount): silence both
  // directions, so nothing talks or listens over whatever comes next.
  useEffect(() => {
    if (phase === 'incall') return
    stopRecognition()
    stopSpeech()
    clearTimers()
    clearSpotTimers()
    setSpotActive(-1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])
  useEffect(() => () => { stopRecognition(); stopSpeech(); clearTimers(); clearSpotTimers() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const finishExchange = (finalCurrent) => {
    const done = [...results, finalCurrent]
    setResults(done)
    if (exIdx + 1 >= exchangesTotal) finishCall(done)
    else { setExIdx(exIdx + 1); setCurrent(null); setInput(''); setLastAttempt(null) }
  }

  // Auto-advance out of feedback, exactly once per exchange: the model
  // has played (or the muted-voice timer ran), so the call steps on.
  const advanceNow = (key) => {
    if (advancedKeyRef.current === key) return
    if (turnRef.current !== 'feedback') return
    advancedKeyRef.current = key
    clearTimers()
    const cur = currentRef.current
    if (cur) finishExchange(cur)
  }

  const runCheck = (textRaw, { auto = false } = {}) => {
    const text = (textRaw || '').trim()
    if (!text || !scene) return
    if (auto) goTurn('scoring')
    const score = bestScore(text, scene)
    const missing = missingPhrases(text, scene)
    const attempt = { text, score, missing }
    setLastAttempt(attempt)
    recordVoiceAttempt({ scene, text, score, missing })
    const cur = current || { scene, best: 0, attempts: 0, firstText: text, firstMissing: missing, imperfect: false }
    const next = {
      ...cur, attempts: cur.attempts + 1,
      best: Math.max(cur.best, score),
      imperfect: cur.imperfect || score < MASTERY,
    }
    setCurrent(next)
    if (score >= MASTERY) { finishExchange(next); return }
    if (!auto) return
    // Feedback, hands-free: hear the model once, then the call moves on.
    // Sensei voice muted (or no speech at all) → a plain reading pause
    // on a timer instead. "Say it again" / "Move on" can still interrupt.
    goTurn('feedback')
    const key = `${scene.id}:${exIdx}`
    if (senseiMutedRef.current || !ttsAvailable()) {
      later(() => advanceNow(key), 2600)
    } else {
      later(() => {
        if (turnRef.current !== 'feedback') return
        speakLine(scene.model, { onEnd: () => later(() => advanceNow(key), 900) })
      }, 350)
    }
  }
  const runCheckRef = useRef(runCheck)
  runCheckRef.current = runCheck

  const check = () => runCheck(input)

  // "Say it again" during feedback: cancel the pending auto-advance and
  // hand the turn straight back to the learner.
  const retryAttempt = () => {
    clearTimers()
    stopSpeech()
    clearSpotTimers()
    setSpotActive(-1)
    setInput('')
    repromptRef.current = 0
    beginUserTurn()
  }

  const moveOn = () => { clearTimers(); stopSpeech(); if (current) finishExchange(current) }

  const queueErrors = (done) => {
    const items = done.filter((r) => r.imperfect).map((r) => ({
      front: t('call.queueFront', { title: r.scene.title, prompt: r.scene.promptEn }),
      back: r.scene.model,
      note: t('call.queueNote', { text: r.firstText, missing: r.firstMissing.join('、') || r.scene.targetPattern, error: r.scene.commonError }),
      source: 'voice', level: r.scene.level,
    }))
    if (items.length) addToQueue(items)
    return items.length
  }

  const finishCall = (done) => {
    const queued = queueErrors(done)
    const bestScoreVal = done.length ? Math.round(done.reduce((a, r) => a + r.best, 0) / done.length) : 0
    if (ring && ring.source !== 'test') recordCallOutcome({ kept: true, bestScore: bestScoreVal, partial: done.length < chain.length })
    const weakest = [...done].sort((a, b) => a.best - b.best)[0]
    let s = loadCallState()
    s = recordHistory(s, { kind: 'call', scene: chain[0]?.title || t('call.practiceCallFallback'), status: 'completed', bestScore: bestScoreVal, exchanges: done.length })
    if (ring && (ring.source === 'slot' || ring.source === 'callback' || ring.source === 'catchup')) {
      const date = todayStr()
      const d = s.days[date]
      if (d) {
        const slots = d.slots.map((x) => (x.idx === ring.slotIdx ? { ...x, status: 'completed' } : x))
        const callback = d.callback && d.callback.slotIdx === ring.slotIdx ? { ...d.callback, status: 'done' } : d.callback
        s = { ...s, days: { ...s.days, [date]: { ...d, slots, callback } } }
      }
    }
    updateState(s)
    if (ring?.source === 'mini' && ring.inboxId) setInbox(markInboxDone(ring.inboxId))
    setWrap({ bestScore: bestScoreVal, exchanges: done.length, queued, weakest })
    setPhase('wrapup')
  }

  const hangUp = () => {
    // Ending before the first exchange finished = a missed call.
    if (results.length === 0) { handleMissed('hung up'); return }
    finishCall(results)
  }

  const accept = () => {
    primeSpeech() // inside the tap, so iOS lets Sensei speak when her turn comes
    setPhase('incall'); setExIdx(0); setResults([]); setCurrent(null); setInput(''); setLastAttempt(null)
  }

  // ---------- settings ----------
  const saveSettings = () => {
    // An emptied name field falls back to the default HERE, at
    // save — never while typing (the old || in onChange snapped
    // the field back to 'Sensei' mid-delete, so the name could
    // not be cleared to type a new one).
    const cleaned = { ...settings, senseiName: (settings.senseiName || '').trim() || 'Sensei' }
    setSettings(cleaned)
    let s = { ...loadCallState(), settings: cleaned }
    const date = todayStr()
    const d = s.days[date]
    const untouched = d && d.slots.every((x) => x.status === 'pending') && !d.callback
    if (untouched) { const days = { ...s.days }; delete days[date]; s = { ...s, days } }
    s = ensureToday(s)
    updateState(s)
    setSavedNote(t('call.savedDevice'))
    setTimeout(() => setSavedNote(''), 4000)
    // Mirror to the server scheduler when signed in (no-op signed out), so
    // the summons can also reach a closed app — including the enabled flag,
    // so switching calls off here stops the server too.
    syncCallWindows(s).then((r) => {
      if (r === 'synced') {
        setSavedNote(t('call.savedSynced'))
        setTimeout(() => setSavedNote(''), 5000)
      }
    }).catch(() => {})
  }
  const setWindow = (i, key, val) => setSettings((st) => ({ ...st, windows: st.windows.map((w, j) => (j === i ? { ...w, [key]: val } : w)) }))
  const addWindow = () => setSettings((st) => (st.windows.length >= 3 ? st : { ...st, windows: [...st.windows, { start: '21:00', end: '22:00' }] }))
  const removeWindow = (i) => setSettings((st) => (st.windows.length <= 1 ? st : { ...st, windows: st.windows.filter((_, j) => j !== i), callsPerDay: Math.min(st.callsPerDay, st.windows.length - 1) }))

  const testCall = () => startRinging({ source: 'test', slotIdx: 7, chain: freshRingChain(profile, 7) })
  const miniCall = (msg) => startRinging({ source: 'mini', slotIdx: msg.slotIdx || 0, inboxId: msg.id, chain: pickCallScenes(profile, msg.date || todayStr(), msg.slotIdx || 0, 2) })

  const statusLabel = { pending: t('call.statusPending'), ringing: t('call.statusRinging'), completed: t('call.statusCompleted'), 'callback-scheduled': t('call.statusCallback'), missed: t('call.statusMissed'), skipped: t('call.statusSkipped') }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Phone size={22} className="text-emerald-300" /> {t('call.title')}</h2>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">{t('call.introA')}<em>{t('call.introRequired')}</em>{t('call.introB')}<strong className="text-slate-200">{t('call.introOnce')}</strong>{t('call.introC')}</p>
      </div>

      {notice && (
        <div className="rounded-2xl bg-cyan-500/10 border border-cyan-500/30 p-4 text-sm text-cyan-100 flex items-start gap-2">
          <Bell size={16} className="shrink-0 mt-0.5" /> <span>{notice}</span>
          <button onClick={() => setNotice('')} className="ml-auto text-cyan-300 hover:text-white" aria-label={t('call.dismiss')}><X size={15} /></button>
        </div>
      )}
      {day?.callback && day.callback.status === 'pending' && phase === 'idle' && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 text-sm text-amber-100 flex items-start gap-2">
          <Clock size={16} className="shrink-0 mt-0.5" /> <span>{t('call.callbackBefore')}<strong>{fmtTime(new Date(day.callback.at))}</strong>{t('call.callbackAfter')}</span>
        </div>
      )}

      {/* Today's plan */}
      <section className="rounded-2xl glass p-5 card-glow space-y-3">
        <h3 className="font-bold text-white">{t('call.todaysCalls')}</h3>
        {!callState.settings.enabled ? (
          <p className="text-sm text-slate-400">{t('call.offNote')}</p>
        ) : day && day.slots.length ? (
          <ul className="space-y-2">
            {day.slots.map((slot) => (
              <li key={slot.idx} className="flex flex-wrap items-center gap-2 text-sm rounded-xl bg-bun-700/40 border border-bun-600/20 px-3.5 py-2.5">
                <Clock size={14} className="text-slate-400" />
                <span className="text-slate-100 font-medium">~{fmtTime(new Date(slot.at))}</span>
                <span className="text-slate-400 text-xs">{t('call.slotInside', { window: slot.windowLabel })}</span>
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-bun-800 border border-bun-600/40 text-slate-300">{statusLabel[slot.status] || slot.status}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">{t('call.noWindows')}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={testCall} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center gap-1.5"><Phone size={15} /> {t('call.testCall')}</button>
          <span className="text-xs text-slate-500 self-center">{t('call.testCallNote')}</span>
        </div>
      </section>

      {/* Settings */}
      <section className="rounded-2xl glass p-5 card-glow space-y-4">
        <h3 className="font-bold text-white">{t('call.settingsTitle')}</h3>
        <label className="flex items-center justify-between gap-3 rounded-xl bg-bun-700/40 border border-bun-600/20 px-4 py-3 cursor-pointer">
          <span className="text-sm text-slate-200">{t('call.toggleIs')}<strong>{t(settings.enabled ? 'call.on' : 'call.off')}</strong><span className="block text-xs text-slate-400 mt-0.5">{reachMode === 'server'
            ? t('call.reachServer')
            : t('call.reachDevice')}</span></span>
          <button role="switch" aria-checked={settings.enabled} onClick={() => setSettings((st) => ({ ...st, enabled: !st.enabled }))} className={`w-12 h-7 rounded-full shrink-0 transition ${settings.enabled ? 'bg-emerald-500' : 'bg-bun-600'}`}>
            <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </label>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-xs text-slate-400 space-y-1.5">{t('call.senseiNameLabel')}
            <input value={settings.senseiName} onChange={(e) => setSettings((st) => ({ ...st, senseiName: e.target.value }))} className="w-full rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
          </label>
          <label className="text-xs text-slate-400 space-y-1.5">{t('call.callsPerDay')}
            <select value={settings.callsPerDay} onChange={(e) => setSettings((st) => ({ ...st, callsPerDay: Number(e.target.value) }))} className="w-full rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none">
              {[1, 2, 3].map((n) => <option key={n} value={n}>{t(n > 1 ? 'call.callCountMany' : 'call.callCountOne', { n })}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400 space-y-1.5">{t('call.persistence')}
            <select value={settings.persistence} onChange={(e) => setSettings((st) => ({ ...st, persistence: e.target.value }))} className="w-full rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none">
              <option value="gentle">{t('call.persistenceGentle')}</option>
              <option value="standard">{t('call.persistenceStandard')}</option>
            </select>
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-slate-400">{t('call.windowsHint')}</p>
          {settings.windows.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-14">{t('call.windowN', { n: i + 1 })}</span>
              <input type="time" value={w.start} onChange={(e) => setWindow(i, 'start', e.target.value)} className="rounded-lg bg-bun-800 border border-bun-600/40 px-2.5 py-1.5 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
              <span className="text-slate-500 text-xs">{t('call.to')}</span>
              <input type="time" value={w.end} onChange={(e) => setWindow(i, 'end', e.target.value)} className="rounded-lg bg-bun-800 border border-bun-600/40 px-2.5 py-1.5 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
              {settings.windows.length > 1 && <button onClick={() => removeWindow(i)} className="text-xs text-slate-500 hover:text-rose-300 px-1">{t('call.remove')}</button>}
            </div>
          ))}
          {settings.windows.length < 3 && <button onClick={addWindow} className="text-xs text-[#FF8A75] hover:text-[#FFA08D]">{t('call.addWindow')}</button>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={saveSettings} className="px-4 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold">{t('call.saveSettings')}</button>
          {savedNote && <span className="text-xs text-emerald-300">{savedNote}</span>}
        </div>
      </section>

      {/* Inbox */}
      <section className="rounded-2xl glass p-5 card-glow space-y-3">
        <h3 className="font-bold text-white flex items-center gap-2"><Inbox size={17} className="text-cyan-300" /> {t('call.inboxTitle', { sensei: callState.settings.senseiName })}</h3>
        {inbox.length ? (
          <ul className="space-y-2.5">
            {inbox.slice(0, 8).map((m) => (
              <li key={m.id} className={`rounded-xl border p-4 space-y-2 ${m.done ? 'bg-bun-700/20 border-bun-600/20 opacity-70' : 'bg-cyan-500/5 border-cyan-500/20'}`}>
                <p className="text-sm font-semibold text-white">{m.title} <span className="text-[11px] font-normal text-slate-500 ml-1">{new Date(m.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></p>
                <p className="text-sm text-slate-300">{m.body}</p>
                {m.done
                  ? <p className="text-xs text-emerald-300 flex items-center gap-1"><CheckCircle2 size={13} /> {t('call.inboxDone')}</p>
                  : <button onClick={() => miniCall(m)} className="px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5"><Phone size={13} /> {t('call.inboxDo')}</button>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">{t('call.inboxEmpty')}</p>}
      </section>

      {/* History — calls kept, never a streak */}
      <section className="rounded-2xl glass p-5 card-glow space-y-3">
        <h3 className="font-bold text-white">{t('call.historyTitle')}</h3>
        {callState.history.length ? (
          <ul className="space-y-1.5">
            {callState.history.slice(0, 10).map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 text-sm rounded-lg bg-bun-700/30 border border-bun-600/20 px-3 py-2">
                <span className="text-slate-400 text-xs">{new Date(h.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-slate-100">{h.scene}</span>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${h.status === 'completed' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-bun-800 text-slate-400 border-bun-600/40'}`}>
                  {h.status === 'completed' ? t('call.historyKept', { score: h.bestScore }) : t('call.historyMissed')}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">{t('call.historyEmpty')}</p>}
      </section>

      {/* INCOMING CALL overlay */}
      {phase === 'ringing' && ring && (
        <div className="fixed inset-0 z-[80] bg-gradient-to-b from-bun-900 via-[#141a33] to-bun-900 flex flex-col items-center justify-center p-6 text-center">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400 mb-6">{ring.source === 'callback' ? t('call.ringCallback') : ring.source === 'catchup' ? t('call.ringCatchup') : ring.source === 'test' ? t('call.ringTest') : ring.source === 'mini' ? t('call.ringMini') : t('call.ringIncoming')}</p>
          <div className="relative mb-6">
            <span className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
            <span className="absolute inset-0 rounded-full bg-[#FF6B57]/15 animate-ping [animation-duration:1.9s] [animation-delay:0.5s]" />
            <span className="absolute inset-0 rounded-full bg-[#FF6B57]/10 animate-ping [animation-duration:1.9s] [animation-delay:1.05s]" />
            <span className="relative block">
              <Mascot agent="koe" size={96} showName={false} motion="bounce" label={t('call.ringMascotLabel', { sensei: callState.settings.senseiName })} />
            </span>
          </div>
          <p className="text-sm font-semibold tracking-widest text-amber-300 mb-1">呼び出しの時間</p>
          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500 mb-4">{t('call.ringSummoned')}</p>
          <h3 className="text-3xl font-bold text-white">{callState.settings.senseiName}</h3>
          <p className="text-slate-300 mt-2">{t('call.ringWants')} <span className="text-white font-semibold">{chain[0]?.title}</span></p>
          <p className="text-xs text-slate-500 mt-1">{chain[0]?.domain} · {chain[0]?.level} · {ring.source === 'mini' ? t('call.ringQuick') : t('call.ringExchanges', { n: exchangesTotal })} · {t('call.ringAbout', { n: ring.source === 'mini' ? '1' : '3' })}</p>
          {ring.source === 'catchup' && <p className="text-xs text-cyan-300 mt-3 max-w-sm">{t('call.ringCatchupNote')}</p>}
          <div className="flex items-center gap-10 mt-12">
            <div className="flex flex-col items-center gap-2">
              <button onClick={() => handleMissed('declined')} className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center text-white shadow-lg transition" aria-label={t('call.declineCall')}><PhoneOff size={26} /></button>
              <span className="text-xs text-slate-400">{ring.source === 'test' || ring.source === 'mini' ? t('call.notNow') : t('call.decline')}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button onClick={accept} className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center text-white shadow-lg animate-bounce transition" aria-label={t('call.acceptCall')}><Phone size={26} /></button>
              <span className="text-xs text-slate-400">{t('call.accept')}</span>
            </div>
          </div>
          {(ring.source === 'slot' || ring.source === 'callback' || ring.source === 'catchup') && <p className="text-[11px] text-slate-600 mt-10 max-w-sm">{t('call.ringDeclineSafe')}</p>}
        </div>
      )}

      {/* IN CALL */}
      {phase === 'incall' && scene && (
        <div className="fixed inset-0 z-[80] bg-bun-900 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 pt-2">
              <div>
                <p className="text-xs uppercase tracking-wider text-emerald-300 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> {t('call.onCallWith', { sensei: callState.settings.senseiName })}</p>
                <span className="mt-2 block"><Mascot agent="koe" size={30} showName={false} /></span>
                <h3 className="text-xl font-bold text-white mt-1">{scene.title}</h3>
                <p className="text-xs text-slate-400">{t('call.exchangeOf', { n: exIdx + 1, total: exchangesTotal })} · {scene.domain} · {scene.level}</p>
              </div>
              <button onClick={hangUp} className="shrink-0 px-4 py-2.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold flex items-center gap-1.5"><PhoneOff size={15} /> {t('call.hangUp')}</button>
            </div>
            <div className="flex gap-1.5">{chain.slice(0, exchangesTotal).map((_, i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i < results.length ? 'bg-emerald-500' : i === exIdx ? 'bg-[#FF6B57]' : 'bg-bun-700'}`} />)}</div>

            {/* The only controls the call itself needs: two mutes. Turns,
                scoring and advancing all happen on their own. */}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={toggleMicMute} aria-pressed={micMuted} title={micMuted ? t('call.micOffTitle') : t('call.micOnTitle')} className={`px-3 py-2 rounded-full border text-xs font-semibold flex items-center gap-1.5 transition ${micMuted ? 'bg-rose-500/15 border-rose-500/40 text-rose-200' : 'bg-bun-700/60 border-bun-600/30 text-slate-200 hover:text-white'}`}>
                {micMuted ? <MicOff size={14} /> : <Mic size={14} />} {micMuted ? t('call.micOff') : t('call.micOn')}
              </button>
              <button onClick={toggleSenseiMute} aria-pressed={senseiMuted} title={senseiMuted ? t('call.senseiVoiceOffTitle') : t('call.senseiVoiceOnTitle')} className={`px-3 py-2 rounded-full border text-xs font-semibold flex items-center gap-1.5 transition ${senseiMuted ? 'bg-rose-500/15 border-rose-500/40 text-rose-200' : 'bg-bun-700/60 border-bun-600/30 text-slate-200 hover:text-white'}`}>
                {senseiMuted ? <VolumeX size={14} /> : <Volume2 size={14} />} {senseiMuted ? t('call.senseiVoiceOff') : t('call.senseiVoiceOn')}
              </button>
              <span className="text-[11px] text-slate-500">{t('call.controlsNote')}</span>
            </div>

            <div className={`rounded-2xl bg-bun-700/40 border p-4 transition ${turnState === 'sensei' ? 'border-emerald-500/40' : 'border-bun-600/20'}`}>
              <p className="text-xs text-slate-400 mb-1">{t('call.says', { sensei: callState.settings.senseiName })}</p>
              <div className="flex items-start gap-2">
                <p className="text-slate-100 leading-loose flex-1"><KanjiTapText text={scene.partner} /></p>
                <TtsButton text={scene.partner} />
              </div>
            </div>

            {spotlight.length > 0 && (
              <div>
                <div className="flex flex-wrap gap-2">
                  {spotlight.map((c, i) => {
                    const missed = !!lastAttempt && (lastAttempt.missing || []).includes(c.word)
                    const active = spotActive === i
                    return (
                      <div key={c.word} className={`rounded-xl border px-3 py-2 text-center transition-colors duration-300 ${active ? 'spot-active border-[#FF6B57]/70 bg-[#FF6B57]/15' : missed ? 'border-amber-400/60 bg-amber-400/10' : 'border-bun-600/30 bg-bun-700/40'}`}>
                        <p className="text-base font-bold text-white leading-tight">{c.word}</p>
                        {c.reading && <p className="text-[11px] text-[#FF8A75] mt-0.5">{c.reading}</p>}
                        {c.meaning && <p className="text-[11px] text-slate-400">{c.meaning}</p>}
                      </div>
                    )
                  })}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">{t('call.spotlightNote')}</p>
              </div>
            )}

            <p className="text-sm text-slate-200"><span className="text-[#FF8A75] font-semibold">{t('call.yourTurnSay')}</span> {scene.promptEn}</p>

            {turnState === 'sensei' && (
              <p className="text-xs text-emerald-300 flex items-center gap-1.5"><Volume2 size={13} /> {t('call.senseiSpeaking')}</p>
            )}
            {turnState === 'listening' && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                <p className="text-xs text-emerald-300 font-semibold flex items-center gap-1.5"><Mic size={13} /> {t('call.listening')}</p>
                <p className="text-sm text-slate-100 mt-1 min-h-[1.25rem]">{interim || '…'}</p>
              </div>
            )}
            {turnState === 'scoring' && <p className="text-xs text-slate-400">{t('call.scoring')}</p>}
            {turnState === 'feedback' && (
              <p className="text-xs text-emerald-300 flex items-center gap-1.5"><Volume2 size={13} /> {t('call.feedbackListen')}</p>
            )}
            {turnState === 'manual' && manualNote && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-100/90">{manualNote}</p>
              </div>
            )}
            {showMicPrompt && <MicPrompt onUseMic={confirmMic} onTypeInstead={() => setShowMicPrompt(false)} />}

            {lastAttempt && (
              <div className={`rounded-xl border p-4 space-y-2 ${lastAttempt.score >= MASTERY ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-bun-700/40 border-bun-600/20'}`}>
                <p className="text-sm text-slate-200">「{lastAttempt.text}」 <span className={`font-bold ${lastAttempt.score >= MASTERY ? 'text-emerald-300' : 'text-amber-300'}`}>{lastAttempt.score}%</span></p>
                {lastAttempt.score >= MASTERY ? (
                  <p className="text-sm text-emerald-200 flex items-center gap-2"><CheckCircle2 size={15} /> {t('call.cleanNext')}</p>
                ) : (
                  <>
                    <div className="flex items-start gap-2">
                      <p className="text-sm text-slate-200 leading-loose flex-1">{t('call.model')} <KanjiTapText text={scene.model} /></p>
                      <TtsButton text={scene.model} />
                    </div>
                    {lastAttempt.missing.length > 0 && <p className="text-sm text-amber-200">{t('call.missing', { words: lastAttempt.missing.join('、') })}</p>}
                    <p className="text-xs text-slate-400">{scene.commonError}</p>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={retryAttempt} className="px-3 py-1.5 rounded-lg bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-xs font-medium flex items-center gap-1"><RotateCcw size={13} /> {t('call.sayAgain')}</button>
                      {current && current.attempts >= 2 && <button onClick={moveOn} className="px-3 py-1.5 rounded-lg bg-bun-700 hover:bg-bun-600 text-slate-200 text-xs font-medium">{t('call.moveOn')}</button>}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Manual fallback: the old tap-by-tap controls, kept whole
                but folded away under the automatic flow. Opens on its
                own whenever the call drops to 'manual'. */}
            <div className="rounded-2xl border border-bun-600/20 bg-bun-800/40">
              <button onClick={() => setManualOpen((o) => !o)} aria-expanded={manualOpen || turnState === 'manual'} className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-300 hover:text-white transition">
                <span>{t('call.typeInstead')}</span>
                <ChevronDown size={16} className={`transition-transform ${(manualOpen || turnState === 'manual') ? 'rotate-180' : ''}`} />
              </button>
              {(manualOpen || turnState === 'manual') && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="flex gap-2">
                    <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder={t('call.inputPlaceholder')}
                      className="flex-1 rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
                    <div className="flex flex-col gap-2">
                      <button onClick={requestListening} disabled={!speechSupported || listening} className="px-3 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5">
                        {listening ? <MicOff size={14} /> : <Mic size={14} />} {listening ? t('call.listeningBtn') : t('call.speak')}
                      </button>
                      <button onClick={check} disabled={!input.trim()} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium">{t('call.sayIt')}</button>
                    </div>
                  </div>
                  {micError && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                      <p className="text-sm font-semibold text-amber-200">{micError.titleKey ? t(micError.titleKey) : micError.title}</p>
                      <p className="text-xs text-amber-100/80 mt-0.5">{micError.bodyKey ? t(micError.bodyKey) : micError.body}</p>
                    </div>
                  )}
                  {!speechSupported && <p className="text-xs text-slate-500">{t('call.noVoiceShort')}</p>}
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-600 text-center pb-4">{t('call.hangupNote')}</p>
          </div>
        </div>
      )}

      {/* WRAP-UP */}
      {phase === 'wrapup' && wrap && (
        <div className="fixed inset-0 z-[80] bg-bun-900 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-6 space-y-5 text-center pt-14">
            <Mascot agent="koe" size={76} showName={false} motion="hop" label={t('call.wrapMascotLabel')} />
            <CheckCircle2 size={42} className="text-emerald-400 mx-auto" />
            <div>
              <h3 className="text-2xl font-bold text-white">{t('call.wrapTitle')}</h3>
              <p className="text-sm text-slate-300 mt-2 max-w-md mx-auto">{t(wrap.exchanges === 1 ? 'call.wrapExchOne' : 'call.wrapExchMany', { n: wrap.exchanges, score: wrap.bestScore })}{wrap.queued ? t(wrap.queued === 1 ? 'call.wrapQueuedOne' : 'call.wrapQueuedMany', { n: wrap.queued }) : t('call.wrapNoQueued')}</p>
            </div>
            {wrap.weakest && wrap.weakest.best < MASTERY && (
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5 text-left space-y-2">
                <p className="text-sm font-semibold text-amber-200 flex items-center gap-2"><Mascot agent="nao" size={26} showName={false} /> {t('call.wrapFixer')}</p>
                <p className="text-sm text-slate-200">{wrap.weakest.scene.title}: <span className="text-white">「{wrap.weakest.scene.model}」</span></p>
                <p className="text-xs text-slate-400">{wrap.weakest.scene.commonError} {t('call.wrapTarget', { pattern: wrap.weakest.scene.targetPattern })}</p>
                <div className="flex"><TtsButton text={wrap.weakest.scene.model} className="px-3 py-1.5 text-sm" /></div>
              </div>
            )}
            <button onClick={() => { setPhase('idle'); setRing(null) }} className="px-6 py-3 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-semibold">{t('call.wrapDone')}</button>
            <p className="text-[11px] text-slate-600">{t('call.wrapFooter')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
