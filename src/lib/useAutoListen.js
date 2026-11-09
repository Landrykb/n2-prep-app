import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { loadHeardDict, matchHeardWords } from './heardMatch.js'

// Automatic Heard Words (Doc 22): ONE tap and the app itself
// listens — continuous speech recognition in the page, matched
// against the dictionary on the device, counts flushed to
// heard_words through the bump_heard_words RPC. A recognised
// segment lives only in the onresult closure: matched, counted,
// dropped. Nothing is recorded, stored, or sent but counts.
//
// "The moment I press, it should go off" (Landry, 2026-11-09):
// the press starts recognition IMMEDIATELY — the permission ask
// and the live state are the feedback, not a loading screen.
// The dictionary warms in the background from the moment the
// panel mounts (and its shards fetch in parallel), so by press
// time it is normally ready; if a press outruns it, segments
// buffer in RAM for those seconds — memory only, never stored
// or sent — and are matched and dropped the moment the
// dictionary lands. If the load fails, the buffer is dropped
// with it.
//
// Platform honesty: this is a FOREGROUND mode. iOS lets a page
// hold the microphone only while the page is open and visible,
// and it may demand a fresh permission on a relaunch the page
// starts by itself. When that happens mid-session the state is
// 'interrupted' — a Resume tap (a real gesture, which iOS
// accepts) restarts it — rather than a pretend-still-listening
// or a hard failure. The Telegram bot route remains the one
// that works with the phone in a pocket, at the price of
// sending each stretch by hand.

export const autoListenSupported = () =>
  typeof window !== 'undefined' && !!(
    window.SpeechRecognition || window.webkitSpeechRecognition
  )

const SESSION_CAP_MS = 4 * 60 * 60 * 1000
const FLUSH_EVERY_MS = 8000
const FLUSH_CHUNK = 400
const BUFFER_CHAR_CAP = 20000

export function useAutoListen({ onFlush } = {}) {
  const [phase, setPhase] = useState('idle') // idle | listening | interrupted | denied
  const [pending, setPending] = useState({}) // item -> { count, kind }, the unflushed delta
  const [readingsOf, setReadingsOf] = useState(null)
  const [startedAt, setStartedAt] = useState(null)
  const [dictReady, setDictReady] = useState(false)

  const activeRef = useRef(false)
  const recRef = useRef(null)
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

  // Load the dictionary once; concurrent callers share the
  // attempt. Resolves true when a dictionary is in hand (a
  // wordbook failure still yields the deck-only dictionary —
  // narrower, never nothing, the bot's rule mirrored).
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
          // Match whatever the press-first buffer caught.
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

  // Warm the dictionary as soon as the panel exists, so the
  // press usually meets it ready. Delayed slightly so it never
  // competes with the page's own first paint.
  useEffect(() => {
    if (!autoListenSupported()) return undefined
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
    // Count what this flush actually carries per item, so a
    // success subtracts exactly that — matches that land during
    // the await stay pending for the next flush.
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

  const launchRef = useRef(null)
  const launch = useCallback(() => {
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
      everHeardRef.current = true
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result?.isFinal) continue
        const segment = result[0]?.transcript ?? ''
        if (!segment) continue
        if (dictRef.current) {
          // Matched here and nowhere else; the segment is never
          // stored, logged, or sent. Only counts survive.
          absorb(matchHeardWords(segment, dictRef.current))
        } else {
          // The press outran the dictionary: hold the segment
          // in RAM (capped) until the dictionary lands, then it
          // is matched and dropped like any other.
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
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        activeRef.current = false
        if (flushTimerRef.current) clearInterval(flushTimerRef.current)
        if (capTimerRef.current) clearTimeout(capTimerRef.current)
        // A permission wall AFTER speech has flowed means iOS
        // wants a fresh gesture — resumable. Before any speech,
        // it is a real block in this browser.
        setPhase(everHeardRef.current ? 'interrupted' : 'denied')
      }
      // 'no-speech', 'aborted', 'network': the session simply
      // ends and onend relaunches — silence is the normal state
      // of a listening room, not an error worth a face.
    }
    rec.onend = () => {
      recRef.current = null
      if (!activeRef.current) return
      restartsRef.current += 1
      const delay = Math.min(300 * restartsRef.current, 2500)
      relaunchTimerRef.current = setTimeout(() => launchRef.current?.(), delay)
    }
    try { rec.start() } catch { recRef.current = null }
  }, [absorb])
  launchRef.current = launch

  const stop = useCallback(() => {
    activeRef.current = false
    if (relaunchTimerRef.current) clearTimeout(relaunchTimerRef.current)
    if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    if (capTimerRef.current) clearTimeout(capTimerRef.current)
    const rec = recRef.current
    recRef.current = null
    if (rec) { try { rec.onend = null; rec.stop() } catch { /* already ended */ } }
    bufferRef.current = []
    bufferCharsRef.current = 0
    setPhase('idle')
    setStartedAt(null)
    flush()
  }, [flush])

  const start = useCallback(() => {
    if (!autoListenSupported()) return
    if (activeRef.current && phase === 'listening') return
    // The press goes off NOW: live state and recognition first,
    // the dictionary catches up in the background. A resume
    // keeps the session's memory (a second permission pause is
    // still 'interrupted', never a fresh 'denied') and its clock.
    const resuming = phase === 'interrupted'
    activeRef.current = true
    if (!resuming) {
      everHeardRef.current = false
      setStartedAt(Date.now())
    }
    restartsRef.current = 0
    setPhase('listening')
    ensureDict()
    launch()
    if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    flushTimerRef.current = setInterval(flush, FLUSH_EVERY_MS)
    if (capTimerRef.current) clearTimeout(capTimerRef.current)
    capTimerRef.current = setTimeout(() => stop(), SESSION_CAP_MS)
  }, [phase, ensureDict, launch, flush, stop])

  // Returning to the page resumes a session iOS paused while
  // the app was away (the recogniser ended; the loop relaunches).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && activeRef.current && !recRef.current) {
        launchRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Unmount: silence the mic; counts already matched stay
  // pending in the ref and are lost with the page — a deliberate
  // small loss (≤8s of matches) rather than a send racing an
  // unmount.
  useEffect(() => () => {
    activeRef.current = false
    if (relaunchTimerRef.current) clearTimeout(relaunchTimerRef.current)
    if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    if (capTimerRef.current) clearTimeout(capTimerRef.current)
    const rec = recRef.current
    if (rec) { try { rec.onend = null; rec.stop() } catch { /* already ended */ } }
  }, [])

  return { phase, pending, readingsOf, startedAt, dictReady, start, stop, supported: autoListenSupported() }
}
