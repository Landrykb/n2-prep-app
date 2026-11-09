import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { loadHeardDict, matchHeardWords } from './heardMatch.js'
import { recordMetric } from './metrics.js'

// Automatic Heard Words (Doc 22): ONE tap and the app itself
// listens. Two engines; the RECORDER is the default wherever
// it exists, the recogniser is the fallback:
//
//   'recorder' — MediaRecorder chunks (~15s) posted to the
//                reader-bot's ?webchunk=1 route, which runs
//                the BOT's own pipeline (Groq transcription,
//                the same matcher server-side, counts, drop).
//                Whisper hears a room; a dictation recogniser
//                hears a phone held to a mouth. The owner's
//                anime test (2026-11-09) proved the difference:
//                an evening of TV Japanese through the webview
//                recogniser landed exactly ONE dictionary word.
//                The recorder also leaves a server receipt per
//                chunk, so a failure is diagnosable without a
//                screenshot.
//   'sr'       — continuous SpeechRecognition in the page,
//                matched against the dictionary on the device
//                (heardMatch), counts flushed through the
//                bump_heard_words RPC. Only where no recorder
//                exists. A recognised segment lives only in
//                the onresult closure: matched, counted,
//                dropped. A recogniser that restarts six times
//                without ever answering is surfaced as
//                'interrupted' ('silent'), never fake-listening.
//
// Probes (recordMetric 'auto_listen_probe', flags and counts
// only — never audio, never text) make the next device failure
// diagnosable from the server instead of from a screenshot.
//
// "The moment I press, it should go off" (Landry, 2026-11-09):
// the press starts the engine IMMEDIATELY. For 'sr', the
// dictionary warms in the background from panel mount (shards
// fetch in parallel); segments recognised before it lands
// buffer in RAM only, capped, and are matched and dropped
// when it does.
//
// Platform honesty: this is a FOREGROUND mode. iOS lets a page
// hold the microphone only while visible, and may demand a
// fresh permission on a self-started relaunch. That mid-session
// wall is a state ('interrupted', one-tap Resume), never a
// pretend-still-listening or a silent death. The Telegram bot
// route remains the pocket option, manual sends and all.

const srAvailable = () =>
  typeof window !== 'undefined' && !!(
    window.SpeechRecognition || window.webkitSpeechRecognition
  )
const recorderAvailable = () =>
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia

export const autoListenSupported = () => srAvailable() || recorderAvailable()

const SESSION_CAP_MS = 4 * 60 * 60 * 1000
const FLUSH_EVERY_MS = 8000
const FLUSH_CHUNK = 400
const BUFFER_CHAR_CAP = 20000
const CHUNK_MS = 15000

const probe = (payload) => {
  try { recordMetric('auto_listen_probe', payload) } catch { /* telemetry never breaks listening */ }
}

export function useAutoListen({ onFlush } = {}) {
  const [phase, setPhase] = useState('idle') // idle | listening | interrupted | denied
  const [pending, setPending] = useState({}) // item -> { count, kind }, the unflushed SR delta
  const [readingsOf, setReadingsOf] = useState(null)
  const [startedAt, setStartedAt] = useState(null)
  const [dictReady, setDictReady] = useState(false)
  const [engine, setEngine] = useState(null) // 'sr' | 'recorder' | null

  const activeRef = useRef(false)
  const engineRef = useRef(null)
  const recRef = useRef(null) // SpeechRecognition instance
  const streamRef = useRef(null) // MediaStream (recorder)
  const recorderRef = useRef(null) // MediaRecorder instance
  const dictRef = useRef(null)
  const dictLoadingRef = useRef(null)
  const pendingRef = useRef(new Map())
  const bufferRef = useRef([]) // recognised segments awaiting the dictionary (RAM only)
  const bufferCharsRef = useRef(0)
  const everHeardRef = useRef(false)
  const restartsRef = useRef(0)
  const relaunchTimerRef = useRef(null)
  const flushTimerRef = useRef(null)
  const capTimerRef = useRef(null)
  const onFlushRef = useRef(onFlush)
  onFlushRef.current = onFlush

  const snapshotPending = useCallback(() => {
    const obj = {}
    for (const [item, v] of pendingRef.current) obj[item] = { ...v }
    setPending(obj)
  }, [])

  const absorb = useCallback((counts) => {
    if (!counts || counts.size === 0) return
    for (const [item, v] of counts) {
      const cur = pendingRef.current.get(item)
      if (cur) cur.count += v.count
      else pendingRef.current.set(item, { ...v })
    }
    snapshotPending()
  }, [snapshotPending])

  // Load the SR dictionary once; concurrent callers share the
  // attempt. A wordbook failure still yields the deck-only
  // dictionary — narrower, never nothing (the bot's rule).
  const ensureDict = useCallback(() => {
    if (dictRef.current) return Promise.resolve(true)
    if (!dictLoadingRef.current) {
      dictLoadingRef.current = (async () => {
        try {
          const { loadDictionary } = await import('./dictionary.js')
          const deck = await loadDictionary()
          dictRef.current = await loadHeardDict({ deckEntries: deck?.entries ?? [] })
          setReadingsOf(dictRef.current.readingsOf)
          setDictReady(true)
          const buffered = bufferRef.current
          bufferRef.current = []
          bufferCharsRef.current = 0
          for (const segment of buffered) absorb(matchHeardWords(segment, dictRef.current))
          return true
        } catch {
          bufferRef.current = []
          bufferCharsRef.current = 0
          return false
        } finally {
          dictLoadingRef.current = null
        }
      })()
    }
    return dictLoadingRef.current
  }, [absorb])

  // Warm the SR dictionary as soon as the panel exists.
  useEffect(() => {
    if (!srAvailable()) return undefined
    const id = setTimeout(() => { ensureDict() }, 1500)
    return () => clearTimeout(id)
  }, [ensureDict])

  const flush = useCallback(async () => {
    if (!isSupabaseConfigured || pendingRef.current.size === 0) return
    const items = []
    const kinds = []
    for (const [item, v] of pendingRef.current) {
      for (let n = 0; n < v.count && items.length < FLUSH_CHUNK; n++) {
        items.push(item)
        kinds.push(v.kind)
      }
    }
    if (items.length === 0) return
    const carried = new Map()
    for (const item of items) carried.set(item, (carried.get(item) ?? 0) + 1)
    try {
      const { error } = await supabase.rpc('bump_heard_words', { p_items: items, p_kinds: kinds })
      if (error) return // stays pending; the next tick retries
    } catch { return }
    for (const [item, n] of carried) {
      const cur = pendingRef.current.get(item)
      if (!cur) continue
      cur.count -= n
      if (cur.count <= 0) pendingRef.current.delete(item)
    }
    snapshotPending()
    try { onFlushRef.current?.() } catch { /* the panel refresh is best-effort */ }
  }, [snapshotPending])

  const permissionWall = useCallback((kind) => {
    probe({ event: 'error', engine: engineRef.current, kind })
    activeRef.current = false
    if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    if (capTimerRef.current) clearTimeout(capTimerRef.current)
    // A permission wall AFTER speech has flowed means the OS
    // wants a fresh gesture — resumable. Before any speech, it
    // is a real block in this browser. A recogniser that loops
    // silently without ever answering ('silent') is resumable
    // too — Resume is the honest next step, not mic settings.
    setPhase(everHeardRef.current || kind === 'silent' ? 'interrupted' : 'denied')
  }, [])

  // ---------- engine: SpeechRecognition ----------
  const launchSRRef = useRef(null)
  const launchSR = useCallback(() => {
    if (!activeRef.current || recRef.current) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { activeRef.current = false; setPhase('idle'); return }
    const rec = new SR()
    recRef.current = rec
    rec.lang = 'ja-JP'
    rec.continuous = true
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (event) => {
      restartsRef.current = 0
      if (!everHeardRef.current) probe({ event: 'first_speech', engine: 'sr' })
      everHeardRef.current = true
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result?.isFinal) continue
        const segment = result[0]?.transcript ?? ''
        if (!segment) continue
        if (dictRef.current) {
          absorb(matchHeardWords(segment, dictRef.current))
        } else {
          bufferRef.current.push(segment)
          bufferCharsRef.current += segment.length
          while (bufferCharsRef.current > BUFFER_CHAR_CAP && bufferRef.current.length > 1) {
            bufferCharsRef.current -= bufferRef.current[0].length
            bufferRef.current.shift()
          }
        }
      }
    }
    rec.onerror = (event) => {
      const err = event?.error
      if (err && err !== 'aborted' && err !== 'no-speech') probe({ event: 'error', engine: 'sr', kind: err })
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        permissionWall(err)
      }
    }
    rec.onend = () => {
      recRef.current = null
      if (!activeRef.current) return
      restartsRef.current += 1
      // The silent-loop guard: a webview recogniser can exist
      // yet never answer — relaunching forever would show
      // "listening" while nothing can ever land. After six
      // empty restarts with no result ever, say so honestly.
      if (restartsRef.current > 6 && !everHeardRef.current) {
        permissionWall('silent')
        return
      }
      const delay = Math.min(300 * restartsRef.current, 2500)
      relaunchTimerRef.current = setTimeout(() => launchSRRef.current?.(), delay)
    }
    try { rec.start() } catch { recRef.current = null }
  }, [absorb, permissionWall])
  launchSRRef.current = launchSR

  // ---------- engine: MediaRecorder → reader-bot pipeline ----------
  const sendChunk = useCallback(async (blob) => {
    if (!isSupabaseConfigured || !supabase || !blob || blob.size === 0) return
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      const base = import.meta.env.VITE_SUPABASE_URL
      if (!token || !base) return
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
      const form = new FormData()
      form.append('audio', blob, `chunk.${ext}`)
      const res = await fetch(`${base}/functions/v1/reader-bot?webchunk=1`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      const out = res.ok ? await res.json().catch(() => null) : null
      probe({ event: 'chunk', ok: !!out?.ok, hearings: typeof out?.hearings === 'number' ? out.hearings : 0 })
      if (out?.ok) {
        if (!everHeardRef.current) probe({ event: 'first_speech', engine: 'recorder' })
        everHeardRef.current = true
        try { onFlushRef.current?.() } catch { /* panel refresh is best-effort */ }
      }
    } catch { /* the next chunk is a natural retry */ }
  }, [])

  const runRecorderRef = useRef(null)
  const runRecorder = useCallback(() => {
    if (!activeRef.current || recorderRef.current || !streamRef.current) return
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      .find((m) => { try { return window.MediaRecorder.isTypeSupported(m) } catch { return false } }) ?? ''
    let rec
    try {
      rec = mime ? new window.MediaRecorder(streamRef.current, { mimeType: mime }) : new window.MediaRecorder(streamRef.current)
    } catch {
      permissionWall('recorder-construct')
      return
    }
    recorderRef.current = rec
    rec.ondataavailable = (e) => { if (e?.data && e.data.size > 0) sendChunk(e.data) }
    rec.onstop = () => {
      recorderRef.current = null
      if (activeRef.current) {
        relaunchTimerRef.current = setTimeout(() => runRecorderRef.current?.(), 300)
      }
    }
    try { rec.start(CHUNK_MS) } catch { recorderRef.current = null }
  }, [sendChunk, permissionWall])
  runRecorderRef.current = runRecorder

  const startRecorder = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!activeRef.current) {
        stream.getTracks().forEach((tr) => tr.stop())
        return
      }
      streamRef.current = stream
      runRecorder()
    } catch (err) {
      permissionWall(err?.name || 'getusermedia')
    }
  }, [runRecorder, permissionWall])

  const stop = useCallback(() => {
    activeRef.current = false
    if (relaunchTimerRef.current) clearTimeout(relaunchTimerRef.current)
    if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    if (capTimerRef.current) clearTimeout(capTimerRef.current)
    const rec = recRef.current
    recRef.current = null
    if (rec) { try { rec.onend = null; rec.stop() } catch { /* already ended */ } }
    const mr = recorderRef.current
    recorderRef.current = null
    if (mr) { try { mr.onstop = null; mr.stop() } catch { /* already ended */ } }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => { try { tr.stop() } catch { /* done */ } })
      streamRef.current = null
    }
    bufferRef.current = []
    bufferCharsRef.current = 0
    setPhase('idle')
    setStartedAt(null)
    setEngine(null)
    engineRef.current = null
    flush()
  }, [flush])

  const start = useCallback(() => {
    if (!autoListenSupported()) return
    if (activeRef.current && phase === 'listening') return
    // The press goes off NOW: live state and engine first.
    // A resume keeps the session's memory (a second permission
    // pause is still 'interrupted') and its clock.
    const resuming = phase === 'interrupted'
    // RECORDER FIRST (his anime test, 2026-11-09): the webview
    // recogniser exists but is a dictation service — near-field,
    // phone-in-hand speech. Against a TV across the room it
    // produced ONE match in an evening. Whisper (the bot lane)
    // is built for exactly that audio, and every chunk leaves a
    // server receipt. SR remains only where no recorder exists.
    const chosen = recorderAvailable() ? 'recorder' : 'sr'
    activeRef.current = true
    engineRef.current = chosen
    setEngine(chosen)
    if (!resuming) {
      everHeardRef.current = false
      setStartedAt(Date.now())
    }
    restartsRef.current = 0
    setPhase('listening')
    probe({
      event: resuming ? 'resume' : 'start',
      engine: chosen,
      sr: srAvailable(),
      rec: recorderAvailable(),
      tg: typeof window !== 'undefined' && !!window.Telegram?.WebApp?.initData,
    })
    if (chosen === 'sr') {
      ensureDict()
      launchSR()
    } else {
      startRecorder()
    }
    if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    flushTimerRef.current = setInterval(flush, FLUSH_EVERY_MS)
    if (capTimerRef.current) clearTimeout(capTimerRef.current)
    capTimerRef.current = setTimeout(() => stop(), SESSION_CAP_MS)
  }, [phase, ensureDict, launchSR, startRecorder, flush, stop])

  // Returning to the page resumes a session the OS paused
  // while the app was away.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible' || !activeRef.current) return
      if (engineRef.current === 'sr' && !recRef.current) launchSRRef.current?.()
      if (engineRef.current === 'recorder') {
        const live = streamRef.current?.getAudioTracks?.().some((tr) => tr.readyState === 'live')
        if (!live) startRecorder()
        else if (!recorderRef.current) runRecorderRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [startRecorder])

  // Unmount: silence the mic; counts already matched stay
  // pending in the ref and are lost with the page — a deliberate
  // small loss (≤8s of SR matches) rather than a send racing an
  // unmount.
  useEffect(() => () => {
    activeRef.current = false
    if (relaunchTimerRef.current) clearTimeout(relaunchTimerRef.current)
    if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    if (capTimerRef.current) clearTimeout(capTimerRef.current)
    const rec = recRef.current
    if (rec) { try { rec.onend = null; rec.stop() } catch { /* already ended */ } }
    const mr = recorderRef.current
    if (mr) { try { mr.onstop = null; mr.stop() } catch { /* already ended */ } }
    if (streamRef.current) streamRef.current.getTracks().forEach((tr) => { try { tr.stop() } catch { /* done */ } })
  }, [])

  return { phase, pending, readingsOf, startedAt, dictReady, engine, start, stop, supported: autoListenSupported() }
}
