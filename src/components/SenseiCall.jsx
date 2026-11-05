import { useEffect, useMemo, useRef, useState } from 'react'
import { Phone, PhoneOff, Mic, MicOff, CheckCircle2, RotateCcw, Clock, Bell, Inbox, X } from 'lucide-react'
import { loadProfile } from '../lib/profile.js'
import { micErrorCopy } from '../lib/speechErrors.js'
import { speakText } from '../lib/tts.js'
import { addToQueue } from '../lib/queue.js'
import { todayStr } from '../lib/session.js'
import {
  loadCallState, saveCallState, ensureToday, pickCallScenes, registerMiss, recordHistory,
  loadInbox, markInboxDone, fmtTime, MASTERY, INCOMING_CALL_KEY,
} from '../lib/calls.js'
import { useAuth } from '../hooks/useAuth.js'
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

function freshRingChain(profile, slotIdx) {
  return pickCallScenes(profile, todayStr(), slotIdx || 0, 3)
}

export default function SenseiCall() {
  const profile = useMemo(loadProfile, [])
  const { user } = useAuth()
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
        if (overdueMs > 2 * 60000 && slot.catchupShown) continue // already offered once as a catch-up
        const isCatchup = overdueMs > 2 * 60000
        const slots = d.slots.map((x) => (x.idx === slot.idx ? { ...x, status: 'ringing', catchupShown: isCatchup ? true : x.catchupShown } : x))
        s = { ...s, days: { ...s.days, [date]: { ...d, slots } } }
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
    s = recordHistory(s, { kind: 'call', scene: chain[0]?.title || 'Practice call', status: 'missed', bestScore: null, how })
    const { state: next, outcome } = registerMiss(s, { slotIdx, wasCallback: source === 'callback', sceneTitle: chain[0]?.title })
    updateState(next)
    setInbox(loadInbox())
    if (outcome.kind === 'callback') setNotice(`No answer needed right now — ${next.settings.senseiName} will call you back once, at ${fmtTime(outcome.at)}. Nothing else is owed.`)
    else if (outcome.kind === 'inbox') setNotice('That was the callback — so instead of calling again, a short message is waiting in your inbox below, with a 60-second version for whenever you have a minute.')
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

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    recogRef.current = rec
    rec.lang = 'ja-JP'; rec.interimResults = false; rec.maxAlternatives = 1
    rec.onresult = (e) => { setInput(e.results[0][0].transcript || ''); setListening(false); setMicError(null) }
    rec.onerror = (e) => { setListening(false); setMicError(micErrorCopy(e?.error)) }
    rec.onend = () => setListening(false)
    setListening(true)
    try { rec.start() } catch { setListening(false) }
  }

  // Auto-speak (P2-4): when a new exchange opens mid-call, Koe's line is
  // spoken automatically — no hunting for a speaker icon while talking.
  const spokenForRef = useRef('')
  useEffect(() => {
    if (phase !== 'incall' || !scene) return
    const key = `${scene.id}:${exIdx}`
    if (spokenForRef.current === key) return
    spokenForRef.current = key
    speakText(scene.partner)
  }, [phase, exIdx, scene])

  const finishExchange = (finalCurrent) => {
    const done = [...results, finalCurrent]
    setResults(done)
    if (exIdx + 1 >= exchangesTotal) finishCall(done)
    else { setExIdx(exIdx + 1); setCurrent(null); setInput(''); setLastAttempt(null) }
  }

  const check = () => {
    const text = input.trim()
    if (!text || !scene) return
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
    if (score >= MASTERY) finishExchange(next)
  }

  const moveOn = () => { if (current) finishExchange(current) }

  const queueErrors = (done) => {
    const items = done.filter((r) => r.imperfect).map((r) => ({
      front: `${r.scene.title} — say it right: ${r.scene.promptEn}`,
      back: r.scene.model,
      note: `From your Yobidashi call. Your version: 「${r.firstText}」. Missing: ${r.firstMissing.join('、') || r.scene.targetPattern}. ${r.scene.commonError}`,
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
    s = recordHistory(s, { kind: 'call', scene: chain[0]?.title || 'Practice call', status: 'completed', bestScore: bestScoreVal, exchanges: done.length })
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

  const accept = () => { setPhase('incall'); setExIdx(0); setResults([]); setCurrent(null); setInput(''); setLastAttempt(null) }

  // ---------- settings ----------
  const saveSettings = () => {
    let s = { ...loadCallState(), settings }
    const date = todayStr()
    const d = s.days[date]
    const untouched = d && d.slots.every((x) => x.status === 'pending') && !d.callback
    if (untouched) { const days = { ...s.days }; delete days[date]; s = { ...s, days } }
    s = ensureToday(s)
    updateState(s)
    setSavedNote('Saved on this device. Today’s call times were re-planned from the new settings.')
    setTimeout(() => setSavedNote(''), 4000)
    // Mirror to the server scheduler when signed in (no-op signed out), so
    // the summons can also reach a closed app — including the enabled flag,
    // so switching calls off here stops the server too.
    syncCallWindows(s).then((r) => {
      if (r === 'synced') {
        setSavedNote('Saved on this device and synced to your account — calls can reach you even when the app is closed.')
        setTimeout(() => setSavedNote(''), 5000)
      }
    }).catch(() => {})
  }
  const setWindow = (i, key, val) => setSettings((st) => ({ ...st, windows: st.windows.map((w, j) => (j === i ? { ...w, [key]: val } : w)) }))
  const addWindow = () => setSettings((st) => (st.windows.length >= 3 ? st : { ...st, windows: [...st.windows, { start: '21:00', end: '22:00' }] }))
  const removeWindow = (i) => setSettings((st) => (st.windows.length <= 1 ? st : { ...st, windows: st.windows.filter((_, j) => j !== i), callsPerDay: Math.min(st.callsPerDay, st.windows.length - 1) }))

  const testCall = () => startRinging({ source: 'test', slotIdx: 7, chain: freshRingChain(profile, 7) })
  const miniCall = (msg) => startRinging({ source: 'mini', slotIdx: msg.slotIdx || 0, inboxId: msg.id, chain: pickCallScenes(profile, msg.date || todayStr(), msg.slotIdx || 0, 2) })

  const statusLabel = { pending: 'scheduled', ringing: 'calling now', completed: 'kept ✓', 'callback-scheduled': 'callback planned', missed: 'missed — moved to inbox', skipped: 'resting (day closed kindly)' }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Phone size={22} className="text-emerald-300" /> Yobidashi</h2>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">The learners who got good had a life that <em>required</em> Japanese every day — a lab, a company. If your life requires none, this manufactures a small requirement instead: a short spoken call, at a varied time inside windows you choose. Miss it, and it calls back <strong className="text-slate-200">once</strong> — then leaves a kind message, then silence. No streaks. No penalties. Ever.</p>
      </div>

      {notice && (
        <div className="rounded-2xl bg-cyan-500/10 border border-cyan-500/30 p-4 text-sm text-cyan-100 flex items-start gap-2">
          <Bell size={16} className="shrink-0 mt-0.5" /> <span>{notice}</span>
          <button onClick={() => setNotice('')} className="ml-auto text-cyan-300 hover:text-white" aria-label="Dismiss"><X size={15} /></button>
        </div>
      )}
      {day?.callback && day.callback.status === 'pending' && phase === 'idle' && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 text-sm text-amber-100 flex items-center gap-2">
          <Clock size={16} /> I’ll call you back at <strong>{fmtTime(new Date(day.callback.at))}</strong> — once. After that, a message, not another call.
        </div>
      )}

      {/* Today's plan */}
      <section className="rounded-2xl glass p-5 card-glow space-y-3">
        <h3 className="font-bold text-white">Today’s calls</h3>
        {!callState.settings.enabled ? (
          <p className="text-sm text-slate-400">The Yobidashi is off. Turn it on below and pick your windows — the first call can also be tested right now:</p>
        ) : day && day.slots.length ? (
          <ul className="space-y-2">
            {day.slots.map((slot) => (
              <li key={slot.idx} className="flex flex-wrap items-center gap-2 text-sm rounded-xl bg-bun-700/40 border border-bun-600/20 px-3.5 py-2.5">
                <Clock size={14} className="text-slate-400" />
                <span className="text-slate-100 font-medium">~{fmtTime(new Date(slot.at))}</span>
                <span className="text-slate-400 text-xs">inside {slot.windowLabel} — the exact minute varies, like a real call</span>
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-bun-800 border border-bun-600/40 text-slate-300">{statusLabel[slot.status] || slot.status}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">No windows planned for today yet.</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={testCall} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center gap-1.5"><Phone size={15} /> Call me now (test)</button>
          <span className="text-xs text-slate-500 self-center">A test call has no consequences — decline it, hang up, nothing is recorded as missed.</span>
        </div>
      </section>

      {/* Settings */}
      <section className="rounded-2xl glass p-5 card-glow space-y-4">
        <h3 className="font-bold text-white">Call settings</h3>
        <label className="flex items-center justify-between gap-3 rounded-xl bg-bun-700/40 border border-bun-600/20 px-4 py-3 cursor-pointer">
          <span className="text-sm text-slate-200">The Yobidashi is <strong>{settings.enabled ? 'on' : 'off'}</strong><span className="block text-xs text-slate-400 mt-0.5">{reachMode === 'server'
            ? 'When on, calls arrive inside your windows below. You are signed in, so a summons can also reach you while the app is closed — by push, as a doorbell (see the honest note).'
            : 'When on, calls arrive inside your windows below — on this device, they ring when you open the app. Sign in to let calls reach a closed app too (see the honest note).'}</span></span>
          <button role="switch" aria-checked={settings.enabled} onClick={() => setSettings((st) => ({ ...st, enabled: !st.enabled }))} className={`w-12 h-7 rounded-full shrink-0 transition ${settings.enabled ? 'bg-emerald-500' : 'bg-bun-600'}`}>
            <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </label>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-xs text-slate-400 space-y-1.5">Your sensei’s name
            <input value={settings.senseiName} onChange={(e) => setSettings((st) => ({ ...st, senseiName: e.target.value || 'Sensei' }))} className="w-full rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
          </label>
          <label className="text-xs text-slate-400 space-y-1.5">Calls per day
            <select value={settings.callsPerDay} onChange={(e) => setSettings((st) => ({ ...st, callsPerDay: Number(e.target.value) }))} className="w-full rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none">
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n} call{n > 1 ? 's' : ''}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400 space-y-1.5">Persistence
            <select value={settings.persistence} onChange={(e) => setSettings((st) => ({ ...st, persistence: e.target.value }))} className="w-full rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none">
              <option value="gentle">Gentle — one callback, ~40 min later</option>
              <option value="standard">Standard — one callback, 20–40 min later</option>
            </select>
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Call windows (1–3) — the call lands at a varied minute inside a window, never a fixed alarm time:</p>
          {settings.windows.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-14">Window {i + 1}</span>
              <input type="time" value={w.start} onChange={(e) => setWindow(i, 'start', e.target.value)} className="rounded-lg bg-bun-800 border border-bun-600/40 px-2.5 py-1.5 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
              <span className="text-slate-500 text-xs">to</span>
              <input type="time" value={w.end} onChange={(e) => setWindow(i, 'end', e.target.value)} className="rounded-lg bg-bun-800 border border-bun-600/40 px-2.5 py-1.5 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
              {settings.windows.length > 1 && <button onClick={() => removeWindow(i)} className="text-xs text-slate-500 hover:text-rose-300 px-1">Remove</button>}
            </div>
          ))}
          {settings.windows.length < 3 && <button onClick={addWindow} className="text-xs text-[#FF8A75] hover:text-[#FFA08D]">+ Add a window</button>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={saveSettings} className="px-4 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold">Save settings</button>
          {savedNote && <span className="text-xs text-emerald-300">{savedNote}</span>}
        </div>
        <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4 text-xs text-slate-400 leading-relaxed">
          <p className="text-slate-200 font-semibold text-sm mb-1 flex items-center gap-1.5"><Bell size={14} /> The honest note — how a web app “calls” you</p>
          While this app is closed, it cannot ring your phone like a carrier call. What it <em>can</em> do is send a <strong className="text-slate-200">push notification</strong> (turn those on in the card on the Today page) at your call time — tapping it opens this call screen. {reachMode === 'server'
            ? 'Because you are signed in, your windows are synced to a small server scheduler, so that push can be sent at your call time even while the app is closed; if a summons is ever missed, opening the app offers the call once more. Call times follow this device’s timezone — travel, and your new timezone is re-synced when the app comes back to the front.'
            : 'That only works while you are signed in — signed out, nothing leaves this device, and your call simply rings here the next time you open the app.'} While the app is open, the call arrives right here, like the test call above. No real phone number is dialled, and nothing here pretends otherwise.
        </div>
      </section>

      {/* Inbox */}
      <section className="rounded-2xl glass p-5 card-glow space-y-3">
        <h3 className="font-bold text-white flex items-center gap-2"><Inbox size={17} className="text-cyan-300" /> Inbox — messages from {callState.settings.senseiName}</h3>
        {inbox.length ? (
          <ul className="space-y-2.5">
            {inbox.slice(0, 8).map((m) => (
              <li key={m.id} className={`rounded-xl border p-4 space-y-2 ${m.done ? 'bg-bun-700/20 border-bun-600/20 opacity-70' : 'bg-cyan-500/5 border-cyan-500/20'}`}>
                <p className="text-sm font-semibold text-white">{m.title} <span className="text-[11px] font-normal text-slate-500 ml-1">{new Date(m.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></p>
                <p className="text-sm text-slate-300">{m.body}</p>
                {m.done
                  ? <p className="text-xs text-emerald-300 flex items-center gap-1"><CheckCircle2 size={13} /> 60-second version done — nicely kept.</p>
                  : <button onClick={() => miniCall(m)} className="px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5"><Phone size={13} /> Do the 60-second version</button>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">Nothing here. If a call and its one callback both miss you, the only thing that lands here is one kind message with a 60-second version — never a pile.</p>}
      </section>

      {/* History — calls kept, never a streak */}
      <section className="rounded-2xl glass p-5 card-glow space-y-3">
        <h3 className="font-bold text-white">Calls kept</h3>
        {callState.history.length ? (
          <ul className="space-y-1.5">
            {callState.history.slice(0, 10).map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 text-sm rounded-lg bg-bun-700/30 border border-bun-600/20 px-3 py-2">
                <span className="text-slate-400 text-xs">{new Date(h.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-slate-100">{h.scene}</span>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${h.status === 'completed' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-bun-800 text-slate-400 border-bun-600/40'}`}>
                  {h.status === 'completed' ? `kept · best ${h.bestScore}%` : 'missed · no penalty, ever'}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">No calls yet. This list is a record, not a scoreboard — a missed call here costs nothing and breaks nothing.</p>}
      </section>

      {/* INCOMING CALL overlay */}
      {phase === 'ringing' && ring && (
        <div className="fixed inset-0 z-[80] bg-gradient-to-b from-bun-900 via-[#141a33] to-bun-900 flex flex-col items-center justify-center p-6 text-center">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400 mb-6">{ring.source === 'callback' ? 'Calling back — once, as promised' : ring.source === 'catchup' ? 'Missed call — calling again now' : ring.source === 'test' ? 'Test call' : ring.source === 'mini' ? 'Your 60-second version' : 'Incoming practice call'}</p>
          <div className="relative mb-6">
            <span className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
            <span className="relative block">
              <Mascot agent="koe" size={96} showName={false} motion="bounce" label={`${callState.settings.senseiName} — Koe, your sensei, is calling`} />
            </span>
          </div>
          <p className="text-sm font-semibold tracking-widest text-amber-300 mb-1">呼び出しの時間</p>
          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500 mb-4">Yobidashi no Jikan — you are being summoned</p>
          <h3 className="text-3xl font-bold text-white">{callState.settings.senseiName}</h3>
          <p className="text-slate-300 mt-2">Wants to practice: <span className="text-white font-semibold">{chain[0]?.title}</span></p>
          <p className="text-xs text-slate-500 mt-1">{chain[0]?.domain} · {chain[0]?.level} · {ring.source === 'mini' ? '1 quick exchange' : `${exchangesTotal} short exchanges`} · about {ring.source === 'mini' ? '1' : '3'} minutes</p>
          {ring.source === 'catchup' && <p className="text-xs text-cyan-300 mt-3 max-w-sm">This call was scheduled earlier today while the app was closed — this is its one re-offer, not a new demand.</p>}
          <div className="flex items-center gap-10 mt-12">
            <div className="flex flex-col items-center gap-2">
              <button onClick={() => handleMissed('declined')} className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center text-white shadow-lg transition" aria-label="Decline call"><PhoneOff size={26} /></button>
              <span className="text-xs text-slate-400">{ring.source === 'test' || ring.source === 'mini' ? 'Not now' : 'Decline'}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button onClick={accept} className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center text-white shadow-lg animate-bounce transition" aria-label="Accept call"><Phone size={26} /></button>
              <span className="text-xs text-slate-400">Accept</span>
            </div>
          </div>
          {(ring.source === 'slot' || ring.source === 'callback' || ring.source === 'catchup') && <p className="text-[11px] text-slate-600 mt-10 max-w-sm">Declining is safe: one callback later, then a message — then silence. Nothing breaks.</p>}
        </div>
      )}

      {/* IN CALL */}
      {phase === 'incall' && scene && (
        <div className="fixed inset-0 z-[80] bg-bun-900 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 pt-2">
              <div>
                <p className="text-xs uppercase tracking-wider text-emerald-300 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> On a call with {callState.settings.senseiName}</p>
                <span className="mt-2 block"><Mascot agent="koe" size={30} showName={false} /></span>
                <h3 className="text-xl font-bold text-white mt-1">{scene.title}</h3>
                <p className="text-xs text-slate-400">Exchange {exIdx + 1} of {exchangesTotal} · {scene.domain} · {scene.level}</p>
              </div>
              <button onClick={hangUp} className="shrink-0 px-4 py-2.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold flex items-center gap-1.5"><PhoneOff size={15} /> Hang up</button>
            </div>
            <div className="flex gap-1.5">{chain.slice(0, exchangesTotal).map((_, i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i < results.length ? 'bg-emerald-500' : i === exIdx ? 'bg-[#FF6B57]' : 'bg-bun-700'}`} />)}</div>

            <div className="rounded-2xl bg-bun-700/40 border border-bun-600/20 p-4">
              <p className="text-xs text-slate-400 mb-1">{callState.settings.senseiName} says:</p>
              <div className="flex items-start gap-2">
                <p className="text-slate-100 leading-loose flex-1"><KanjiTapText text={scene.partner} /></p>
                <TtsButton text={scene.partner} />
              </div>
            </div>
            <p className="text-sm text-slate-200"><span className="text-[#FF8A75] font-semibold">Your turn — say this, your way:</span> {scene.promptEn}</p>
            {showMicPrompt && <MicPrompt onUseMic={confirmMic} onTypeInstead={() => setShowMicPrompt(false)} />}
            <div className="flex gap-2">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder="Speak with the mic, or type your Japanese here…"
                className="flex-1 rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
              <div className="flex flex-col gap-2">
                <button onClick={requestListening} disabled={!speechSupported || listening} className="px-3 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5">
                  {listening ? <MicOff size={14} /> : <Mic size={14} />} {listening ? 'Listening…' : 'Speak'}
                </button>
                <button onClick={check} disabled={!input.trim()} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium">Say it</button>
              </div>
            </div>
            {micError && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-sm font-semibold text-amber-200">{micError.title}</p>
                <p className="text-xs text-amber-100/80 mt-0.5">{micError.body}</p>
              </div>
            )}
            {!speechSupported && <p className="text-xs text-slate-500">Voice recognition isn’t available in this browser — typing your version works the same way on a call.</p>}

            {lastAttempt && (
              <div className={`rounded-xl border p-4 space-y-2 ${lastAttempt.score >= MASTERY ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-bun-700/40 border-bun-600/20'}`}>
                <p className="text-sm text-slate-200">「{lastAttempt.text}」 <span className={`font-bold ${lastAttempt.score >= MASTERY ? 'text-emerald-300' : 'text-amber-300'}`}>{lastAttempt.score}%</span></p>
                {lastAttempt.score >= MASTERY ? (
                  <p className="text-sm text-emerald-200 flex items-center gap-2"><CheckCircle2 size={15} /> Clean — next exchange coming up.</p>
                ) : (
                  <>
                    <div className="flex items-start gap-2">
                      <p className="text-sm text-slate-200 leading-loose flex-1">Model: <KanjiTapText text={scene.model} /></p>
                      <TtsButton text={scene.model} />
                    </div>
                    {lastAttempt.missing.length > 0 && <p className="text-sm text-amber-200">Missing: {lastAttempt.missing.join('、')}</p>}
                    <p className="text-xs text-slate-400">{scene.commonError}</p>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setInput('')} className="px-3 py-1.5 rounded-lg bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-xs font-medium flex items-center gap-1"><RotateCcw size={13} /> Say it again</button>
                      {current && current.attempts >= 2 && <button onClick={moveOn} className="px-3 py-1.5 rounded-lg bg-bun-700 hover:bg-bun-600 text-slate-200 text-xs font-medium">Move on — it joins my queue</button>}
                    </div>
                  </>
                )}
              </div>
            )}
            <p className="text-[11px] text-slate-600 text-center pb-4">Hanging up before the first exchange counts as a missed call (one callback, then a message). After that, hanging up just ends the call warmly — what you did is kept.</p>
          </div>
        </div>
      )}

      {/* WRAP-UP */}
      {phase === 'wrapup' && wrap && (
        <div className="fixed inset-0 z-[80] bg-bun-900 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-6 space-y-5 text-center pt-14">
            <CheckCircle2 size={42} className="text-emerald-400 mx-auto" />
            <div>
              <h3 className="text-2xl font-bold text-white">Call kept. よくできました。</h3>
              <p className="text-sm text-slate-300 mt-2 max-w-md mx-auto">{wrap.exchanges} exchange{wrap.exchanges === 1 ? '' : 's'} in your own voice · best-score average {wrap.bestScore}%.{wrap.queued ? ` ${wrap.queued} mistake${wrap.queued === 1 ? '' : 's'} from this call joined your review queue — spaced, in new scenes, until they stick.` : ' No mistakes needed saving from this call.'}</p>
            </div>
            {wrap.weakest && wrap.weakest.best < MASTERY && (
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5 text-left space-y-2">
                <p className="text-sm font-semibold text-amber-200 flex items-center gap-2"><Mascot agent="nao" size={26} showName={false} /> Nao, your fixer: the one correction that matters most from this call</p>
                <p className="text-sm text-slate-200">{wrap.weakest.scene.title}: <span className="text-white">「{wrap.weakest.scene.model}」</span></p>
                <p className="text-xs text-slate-400">{wrap.weakest.scene.commonError} Target: {wrap.weakest.scene.targetPattern}</p>
                <div className="flex"><TtsButton text={wrap.weakest.scene.model} className="px-3 py-1.5 text-sm" /></div>
              </div>
            )}
            <button onClick={() => { setPhase('idle'); setRing(null) }} className="px-6 py-3 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-semibold">Done — back to my day</button>
            <p className="text-[11px] text-slate-600">That’s the whole requirement for this call slot. Small, kept, finished.</p>
          </div>
        </div>
      )}
    </div>
  )
}
