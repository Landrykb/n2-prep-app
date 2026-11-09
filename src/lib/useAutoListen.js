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
// Platform honesty: this is a FOREGROUND mode. iOS lets a page
// hold the microphone only while the page is open and visible;
// leaving the app pauses listening (the recogniser ends, and
// the relaunch loop resumes it when the page is seen again —
// iOS may still demand a fresh tap after a long absence, and
// the state says so rather than pretending). The Telegram bot
// route remains the one that works with the phone in a pocket,
// at the price of sending each stretch by hand. Automatic
// after one tap is what the platform actually offers a web app,
// and it is what this hook delivers.

export const autoListenSupported = () =>
  typeof window !== 'undefined' && !!(
    window.SpeechRecognition || window.webkitSpeechRecognition
  )

const SESSION_CAP_MS = 4 * 60 * 60 * 1000
const FLUSH_EVERY_MS = 8000
const FLUSH_CHUNK = 400

export function useAutoListen({ onFlush } = {}) {
  const [phase, setPhase] = useState('idle') // idle | loading | listening | denied
  const [pending, setPending] = useState({}) // item -> { count, kind }, the unflushed delta
  const [readingsOf, setReadingsOf] = useState(null)
  const [startedAt, setStartedAt] = useState(null)

  const activeRef = useRef(false)
  const recRef = useRef(null)
  const dictRef = useRef(null)
  const pendingRef = useRef(new Map())
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
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result?.isFinal) continue
        const segment = result[0]?.transcript ?? ''
        if (!segment || !dictRef.current) continue
        // The segment is matched here and nowhere else; it is
        // never stored, logged, or sent. Only counts survive.
        const counts = matchHeardWords(segment, dictRef.current)
        if (counts.size === 0) continue
        for (const [item, v] of counts) {
          const cur = pendingRef.current.get(item)
          if (cur) cur.count += v.count
          else pendingRef.current.set(item, { ...v })
        }
        snapshotPending()
      }
    }
    rec.onerror = (event) => {
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        activeRef.current = false
        setPhase('denied')
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
  }, [snapshotPending])
  launchRef.current = launch

  const stop = useCallback(() => {
    activeRef.current = false
    if (relaunchTimerRef.current) clearTimeout(relaunchTimerRef.current)
    if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    if (capTimerRef.current) clearTimeout(capTimerRef.current)
    const rec = recRef.current
    recRef.current = null
    if (rec) { try { rec.onend = null; rec.stop() } catch { /* already ended */ } }
    setPhase('idle')
    setStartedAt(null)
    flush()
  }, [flush])

  const start = useCallback(async () => {
    if (activeRef.current || phase === 'loading') return
    if (!autoListenSupported()) return
    setPhase('loading')
    try {
      if (!dictRef.current) {
        const { loadDictionary } = await import('./dictionary.js')
        const deck = await loadDictionary()
        dictRef.current = await loadHeardDict({ deckEntries: deck?.entries ?? [] })
        setReadingsOf(dictRef.current.readingsOf)
      }
    } catch {
      // A failed dictionary load narrows nothing — it stops the
      // start honestly; a tap retries.
      setPhase('idle')
      return
    }
    activeRef.current = true
    restartsRef.current = 0
    setStartedAt(Date.now())
    setPhase('listening')
    launch()
    flushTimerRef.current = setInterval(flush, FLUSH_EVERY_MS)
    capTimerRef.current = setTimeout(() => stop(), SESSION_CAP_MS)
  }, [phase, launch, flush, stop])

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

  return { phase, pending, readingsOf, startedAt, start, stop, supported: autoListenSupported() }
}
