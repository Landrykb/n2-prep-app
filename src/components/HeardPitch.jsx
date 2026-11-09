import { useCallback, useEffect, useRef, useState } from 'react'
import { Ear, MonitorPlay, BookOpen, ShieldCheck, ChevronDown } from 'lucide-react'
import Mascot from './Mascot.jsx'
import { useLanguage } from '../hooks/useLanguage.js'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'
import { useAutoListen } from '../lib/useAutoListen.js'

// Heard Words (Doc 22): one panel, three states, in the fleet's
// own design language — Hori's real art, his orange, a flat
// solid panel, thin line icons, exactly one coral door per state.
//
// AUTOMATIC state (the one-tap answer): press Start once and
// the app itself listens — recorder chunks through the bot's
// own pipeline by default, in-page recognition only where no
// recorder exists; only counts are ever kept (useAutoListen).
// Foreground only: iPhone pauses a page's mic when the page
// is left, and the panel says so instead of pretending
// otherwise. The Telegram bot remains the pocket route, one
// sent stretch at a time. ONE coral primary per state — the
// other routes ride as quiet text, never competing buttons.
//
// BOT-LIVE state: a bot session is open, or words landed today
// (from either route — the strip merges the database rows with
// the automatic mode's unflushed counts, so a word appears the
// moment it is matched). Migration 00021 gives the app owner
// read + a working Stop for bot sessions.
//
// PITCH state: the front door — his headline, the three beats,
// the privacy line in the open, and the doors. One dismissal
// hides the pitch on both surfaces; a live panel is never
// dismissible — a state you must never wonder about stays put.
const HEARD_PITCH_KEY = 'jpn:heard-pitch:v1'
// The deep link carries the intent: Telegram delivers
// ?start=listen to the bot as "/start listen", and the bot
// opens the session on that tap (reader-bot, Doc 22).
const BOT_URL = 'https://t.me/YondeReaderBot?start=listen'
const BOT_CHAT_URL = 'https://t.me/YondeReaderBot'
// The real browser is where automatic listening lives when the
// current view can't hold a microphone (the Telegram webview
// on iOS exposes no recogniser at all) — one tap out, not a
// dead end.
const APP_URL = 'https://jpn2easy.vercel.app'
const HEARD_FLOOR = 2

const jstToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const jstTime = (iso) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))
const fmtElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function RecordingDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF6B57] opacity-60" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#FF6B57]" />
    </span>
  )
}

function WordList({ words, exprs, readingFor }) {
  return (
    <ul className="space-y-2">
      {words.map((r) => (
        <li key={r.item} className="text-base text-slate-200">
          <span className="text-lg font-bold text-white">{r.item}</span>
          {readingFor(r.item) && <span className="text-[#FFB59D]"> （{readingFor(r.item)}）</span>}
          <span key={r.count} className="heard-pop text-sm text-slate-400"> ×{r.count}</span>
        </li>
      ))}
      {exprs.map((r) => (
        <li key={r.item} className="text-base text-slate-200">
          <span className="text-lg font-bold text-white">{r.item}</span>
          <span key={r.count} className="heard-pop text-sm text-slate-400"> ×{r.count}</span>
        </li>
      ))}
    </ul>
  )
}

// Hori, mid-meal. The fleet art is flat PNGs with four
// expressions, so the eating is motion, not a redraw: a
// nom-nom bob while a listening state is live, and a gulp
// squash (the .hori-gulp class on this same wrapper) as a
// caught word lands in his mouth. The words themselves fly —
// see the chip machinery in the component: his correction of
// the first cut (2026-11-09) was that abstract kana motes are
// not evidence; the IDENTIFIED word is the animation.
function HoriEats({ size = 38, eating = false, gulp = false }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className={gulp ? 'hori-gulp' : eating ? 'hori-nom' : ''}>
        <Mascot agent="hori" size={size} mood="happy" showName={false} />
      </div>
    </div>
  )
}

export default function HeardPitch({ variant = 'full', onReadPassage }) {
  const { t } = useLanguage()
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HEARD_PITCH_KEY) === '1' } catch { return false } })
  const [live, setLive] = useState(null)
  const [readings, setReadings] = useState({})
  const [stopping, setStopping] = useState(false)
  const [nowTs, setNowTs] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) return
    try {
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) return
      const today = jstToday()
      const [{ data: sessions }, { data: rows }] = await Promise.all([
        supabase.from('ambient_sessions').select('chat_id, day, opened_at').eq('user_id', user.id),
        supabase.from('heard_words').select('item, kind, count').eq('user_id', user.id).eq('day', today),
      ])
      const session = (sessions ?? []).find((s) => s.day === today) ?? null
      const all = rows ?? []
      setLive({
        listening: !!session,
        chatId: session?.chat_id ?? null,
        since: session ? jstTime(session.opened_at) : null,
        rowsAll: all,
        hasAny: all.length > 0,
      })
      const items = all.filter((r) => r.count >= HEARD_FLOOR && r.kind === 'word').map((r) => r.item)
      if (items.length > 0) {
        // Readings from the app's deck (the bot's card and the
        // automatic dictionary carry the wide readings; here a
        // word the deck does not know shows without one — never
        // a guessed reading).
        import('../lib/dictionary.js')
          .then(({ loadDictionary }) => loadDictionary())
          .then((dict) => {
            const map = {}
            for (const item of items) {
              const reading = dict?.byWord?.get(item)?.reading
              if (reading && reading !== item) map[item] = reading
            }
            setReadings(map)
          })
          .catch(() => {})
      }
    } catch { /* the pitch is the fallback; a failed read never breaks the page */ }
  }, [])

  const auto = useAutoListen({ onFlush: refresh })
  const autoActive = auto.phase === 'listening'

  useEffect(() => {
    refresh()
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', refresh)
    const iv = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 30000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', refresh)
      clearInterval(iv)
    }
  }, [refresh])

  useEffect(() => {
    if (!autoActive) return undefined
    const iv = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [autoActive])

  const hide = () => { try { localStorage.setItem(HEARD_PITCH_KEY, '1') } catch { /* ignore */ } setHidden(true) }
  // Inside the Telegram Mini App, a plain _blank link can bounce
  // out to a browser; Telegram's own link opener keeps the jump
  // inside Telegram, straight into the bot chat. Outside Telegram
  // (or on webviews that never expose the bridge) the plain link
  // is the behaviour.
  const openLink = (url) => (e) => {
    try {
      const wa = window.Telegram?.WebApp
      if (wa?.openTelegramLink) { e.preventDefault(); wa.openTelegramLink(url) }
    } catch { /* fall through to the href */ }
  }
  const stopBot = async () => {
    if (!live?.chatId || stopping) return
    setStopping(true)
    try { await supabase.from('ambient_sessions').delete().eq('chat_id', live.chatId) } catch { /* refresh shows the truth either way */ }
    setStopping(false)
    refresh()
  }

  // Today's rows, the database's and the automatic mode's
  // unflushed matches together — the floor applies to the merge.
  const merged = (() => {
    const map = new Map()
    for (const r of live?.rowsAll ?? []) map.set(r.item, { item: r.item, kind: r.kind, count: r.count })
    for (const [item, v] of Object.entries(auto.pending)) {
      const cur = map.get(item)
      if (cur) cur.count += v.count
      else map.set(item, { item, kind: v.kind, count: v.count })
    }
    return [...map.values()]
  })()
  const sticking = merged
    .filter((r) => r.count >= HEARD_FLOOR)
    .sort((a, b) => b.count - a.count || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0))
  const dispWords = sticking.filter((r) => r.kind === 'word').slice(0, 15)
  const dispExprs = sticking.filter((r) => r.kind === 'expr').slice(0, 8)
  const onceWords = merged.filter((r) => r.kind === 'word' && r.count < HEARD_FLOOR).length
  // The once-heard, peekable on tap (his ask, 2026-11-09):
  // they stay below the naming floor in the record, but the
  // owner can open the line and SEE them — evidence on demand,
  // in his accordion pattern (tap expands under the line).
  const [showOnce, setShowOnce] = useState(false)
  const onceWordItems = merged.filter((r) => r.kind === 'word' && r.count < HEARD_FLOOR)
  const onceExprItems = merged.filter((r) => r.kind === 'expr' && r.count < HEARD_FLOOR)
  const hasAny = merged.length > 0
  const totalHearings = merged.reduce((n, r) => n + r.count, 0)
  const readingFor = (item) => auto.readingsOf?.get(item) ?? readings[item] ?? null

  // The flight (his correction, 2026-11-09: "the words that
  // is identified or grammar should be animated into Hori's
  // mouth"). When any item's count RISES — whichever route
  // caught it — the word itself queues up, flies across the
  // header into Hori, and he gulps as it lands. The flight is
  // transient feedback on the owner's own screen; what may be
  // NAMED in the list below still obeys the floor. The first
  // load only sets the baseline — old catches never replay.
  const [gulp, setGulp] = useState(false)
  const [chipQueue, setChipQueue] = useState([])
  const [activeChip, setActiveChip] = useState(null)
  const prevRowsRef = useRef(null)
  const chipSeqRef = useRef(0)
  const chipTimersRef = useRef([])
  useEffect(() => () => { chipTimersRef.current.forEach(clearTimeout) }, [])
  useEffect(() => {
    const prev = prevRowsRef.current
    prevRowsRef.current = new Map(merged.map((r) => [r.item, r.count]))
    if (!prev) return
    const fresh = []
    for (const r of merged) {
      if (r.count > (prev.get(r.item) ?? 0)) {
        chipSeqRef.current += 1
        fresh.push({ item: r.item, kind: r.kind, seq: chipSeqRef.current })
      }
    }
    if (fresh.length > 0) setChipQueue((q) => [...q, ...fresh.slice(0, 6)].slice(0, 8))
  }, [merged])
  useEffect(() => {
    if (activeChip || chipQueue.length === 0) return
    const [next, ...rest] = chipQueue
    setChipQueue(rest)
    setActiveChip(next)
    chipTimersRef.current.push(setTimeout(() => setGulp(true), 620))
    chipTimersRef.current.push(setTimeout(() => { setActiveChip(null); setGulp(false) }, 1000))
  }, [chipQueue, activeChip])

  // "Then produce it back to me for reading" — the cook door:
  // the flag tells the Reader to go straight to a generated,
  // heard-seeded serve; the event covers already being there.
  const cook = () => {
    try { sessionStorage.setItem('jpn:reader-cook', '1') } catch { /* private mode: the event still fires */ }
    try { window.dispatchEvent(new Event('yonde:cook')) } catch { /* nothing to notify */ }
    onReadPassage?.()
  }
  const cookBlock = sticking.length > 0 ? (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/5 pt-4">
      <p className="flex items-center gap-2 text-sm text-slate-300">
        <BookOpen size={16} className="text-[#E07B39] shrink-0" />
        {t('today.heardPitchCookLine')}
      </p>
      <button onClick={cook} className="inline-flex items-center gap-2 rounded-xl border border-white/15 hover:border-white/30 transition px-4 py-2.5 text-sm font-semibold text-slate-200">
        {t('today.heardPitchCookCta')}
      </button>
    </div>
  ) : null

  const privacy = (
    <p className="flex items-start gap-2 text-xs text-slate-400 leading-relaxed">
      <ShieldCheck size={14} className="text-emerald-300 shrink-0 mt-px" />
      <span>{t('today.heardPitchPrivacy')}</span>
    </p>
  )
  const header = (title, sub, eating = false) => (
    <div className="relative flex items-start gap-3">
      <HoriEats size={38} eating={eating} gulp={gulp} />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-[#E07B39] uppercase">{t('today.heardPitchEyebrow')}</p>
        <h3 className="text-lg font-bold text-white leading-snug mt-0.5">{title}</h3>
        {sub}
      </div>
      {activeChip && (
        <span
          key={activeChip.seq}
          aria-hidden="true"
          className="heard-chip-fly pointer-events-none select-none absolute z-20 max-w-[230px] truncate rounded-full border border-white/10 bg-[#241d3f] px-3 py-1.5 text-[15px] font-bold text-white"
          style={{ left: 'min(224px, 55%)', top: 5 }}
        >
          {activeChip.item}
        </span>
      )}
    </div>
  )
  const caughtSuffix = totalHearings > 0 ? ` · ${t('today.heardPitchCaught', { n: totalHearings })}` : ''
  const wordBlock = (emptyLine) => (
    <>
      {dispWords.length === 0 && dispExprs.length === 0 ? (
        <p className="text-sm text-slate-300 leading-relaxed">{emptyLine}</p>
      ) : (
        <WordList words={dispWords} exprs={dispExprs} readingFor={readingFor} />
      )}
      {onceWords > 0 && (
        <>
          <button
            onClick={() => setShowOnce((v) => !v)}
            aria-expanded={showOnce}
            className="flex items-center gap-1.5 text-[13px] text-slate-400 hover:text-slate-200 transition"
          >
            <span>{t('today.heardPitchOnce', { n: onceWords })}</span>
            <ChevronDown size={14} className={`shrink-0 transition-transform ${showOnce ? 'rotate-180' : ''}`} />
          </button>
          {showOnce && (
            <div className="opacity-75">
              <WordList words={onceWordItems} exprs={onceExprItems} readingFor={readingFor} />
            </div>
          )}
        </>
      )}
    </>
  )

  // ---------- AUTOMATIC state ----------
  if (autoActive || auto.phase === 'interrupted' || auto.phase === 'denied') {
    return (
      <section className="rounded-3xl bg-[#151129] border border-white/5 p-5 sm:p-6 space-y-4">
        {header(
          t('today.heardPitchAutoLive'),
          auto.phase === 'listening' && auto.startedAt ? (
            <p className="flex items-center gap-2 text-xs text-slate-400 mt-1">
              <RecordingDot />
              <span>{fmtElapsed(nowTs - auto.startedAt)}{caughtSuffix}</span>
            </p>
          ) : null,
          auto.phase === 'listening',
        )}
        {auto.phase === 'denied' && (
          <p className="text-sm text-slate-300 leading-relaxed">{t('today.heardPitchAutoDenied')}</p>
        )}
        {auto.phase === 'interrupted' && (
          <p className="text-sm text-slate-300 leading-relaxed">{t('today.heardPitchInterrupted')}</p>
        )}
        {auto.phase === 'listening' && (
          <>
            {auto.engine === 'sr' && !auto.dictReady && dispWords.length === 0 && dispExprs.length === 0
              ? <p className="text-sm text-slate-300 leading-relaxed">{t('today.heardPitchWarming')}</p>
              : wordBlock(t('today.heardPitchAutoEmpty'))}
            <p className="text-xs text-slate-500 leading-relaxed">{t('today.heardPitchAutoKeep')}</p>
          </>
        )}
        {cookBlock}
        {privacy}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {auto.phase === 'listening' ? (
            <button onClick={auto.stop} className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white">
              {t('today.heardPitchStop')}
            </button>
          ) : auto.phase === 'interrupted' ? (
            <>
              <button onClick={auto.start} className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white">
                {t('today.heardPitchResume')}
              </button>
              <button onClick={auto.stop} className="text-sm text-slate-400 hover:text-slate-200 transition">
                {t('today.heardPitchStop')}
              </button>
            </>
          ) : (
            <a href={BOT_URL} target="_blank" rel="noreferrer" onClick={openLink(BOT_URL)} className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white">
              {t('today.heardPitchCta')}
            </a>
          )}
        </div>
      </section>
    )
  }

  // The automatic door rides EVERY state when the browser can
  // listen — a learner whose bot session is open must never be
  // stuck with only the manual route in front of him (that was
  // the 2026-11-09 trap: bot session open → panel showed only
  // bot doors → "make it automatic" had nowhere to tap).
  const autoDoor = auto.supported ? (
    <button onClick={auto.start} className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white">
      {t('today.heardPitchAutoCta')}
    </button>
  ) : null
  // When this view can run NO automatic engine, the door out to
  // the real browser takes the primary slot — via Telegram's
  // own external opener when inside the Mini App.
  const openExternal = (e) => {
    try {
      const wa = window.Telegram?.WebApp
      if (wa?.openLink) { e.preventDefault(); wa.openLink(APP_URL) }
    } catch { /* fall through to the href */ }
  }
  const browserDoor = (
    <a href={APP_URL} target="_blank" rel="noreferrer" onClick={openExternal} className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white">
      {t('today.heardPitchOpenBrowser')}
    </a>
  )
  const doorSlot = auto.supported ? autoDoor : browserDoor

  // ---------- BOT-LIVE state: the Heard Today strip ----------
  if (live && (live.listening || hasAny)) {
    return (
      <section className="rounded-3xl bg-[#151129] border border-white/5 p-5 sm:p-6 space-y-4">
        {header(
          live.listening ? t('today.heardPitchLiveTitle') : t('today.heardPitchTodayTitle'),
          live.listening ? (
            <p className="flex items-center gap-2 text-xs text-slate-400 mt-1">
              <RecordingDot />
              <span>{t('today.heardPitchLiveSince', { time: live.since })}{caughtSuffix}</span>
            </p>
          ) : null,
          live.listening,
        )}
        {wordBlock(live.listening ? t('today.heardPitchNoWords') : t('today.heardPitchNoneYet'))}
        {cookBlock}
        {privacy}
        {live.listening ? (
          // ONE primary per state (his question, 2026-11-09:
          // "Why do I have 2 buttons for listening?"): the bot
          // session is the live thing, so Open-the-bot is the
          // door; automatic is a quiet switch that migrates
          // the session in one tap; Stop is quiet text last.
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <a href={BOT_CHAT_URL} target="_blank" rel="noreferrer" onClick={openLink(BOT_CHAT_URL)} className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white">
                {t('today.heardPitchOpenBot')}
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {auto.supported ? (
                <button onClick={() => { void stopBot(); auto.start() }} className="text-sm text-slate-400 hover:text-slate-200 transition">
                  {t('today.heardPitchSwitchAuto')}
                </button>
              ) : (
                <a href={APP_URL} target="_blank" rel="noreferrer" onClick={openExternal} className="text-sm text-slate-400 hover:text-slate-200 transition">
                  {t('today.heardPitchOpenBrowser')}
                </a>
              )}
              <button onClick={stopBot} disabled={stopping} className="text-sm text-slate-400 hover:text-slate-200 transition disabled:opacity-40">
                {t('today.heardPitchStop')}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {doorSlot}
              <button onClick={hide} className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition">{t('today.heardPitchHide')}</button>
            </div>
            <p className="text-xs text-slate-500">
              <a href={BOT_URL} target="_blank" rel="noreferrer" onClick={openLink(BOT_URL)} className="underline decoration-slate-600 underline-offset-2 hover:text-slate-300 transition">
                {t('today.heardPitchOrBot')}
              </a>
              {' · '}{t('today.heardPitchHow')}
            </p>
          </div>
        )}
      </section>
    )
  }

  // ---------- PITCH state ----------
  if (hidden) return null
  const cta = auto.supported ? (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button onClick={auto.start} className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white">
          {t('today.heardPitchAutoCta')}
        </button>
        <button onClick={hide} className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition">{t('today.heardPitchHide')}</button>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{t('today.heardPitchAutoNote')}</p>
      <p className="text-xs text-slate-500">
        <a href={BOT_URL} target="_blank" rel="noreferrer" onClick={openLink(BOT_URL)} className="underline decoration-slate-600 underline-offset-2 hover:text-slate-300 transition">
          {t('today.heardPitchOrBot')}
        </a>
        {' · '}{t('today.heardPitchHow')}
      </p>
    </div>
  ) : (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {browserDoor}
        <button onClick={hide} className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition">{t('today.heardPitchHide')}</button>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{t('today.heardPitchAutoUnsupported')}</p>
      <p className="text-xs text-slate-500">
        <a href={BOT_URL} target="_blank" rel="noreferrer" onClick={openLink(BOT_URL)} className="underline decoration-slate-600 underline-offset-2 hover:text-slate-300 transition">
          {t('today.heardPitchOrBot')}
        </a>
        {' · '}{t('today.heardPitchHow')}
      </p>
    </div>
  )

  if (variant === 'compact') {
    return (
      <section className="rounded-3xl bg-[#151129] border border-white/5 p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Mascot agent="hori" size={38} mood="happy" showName={false} />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-[#E07B39] uppercase">{t('today.heardPitchEyebrow')}</p>
            <h3 className="text-lg font-bold text-white leading-snug mt-0.5">{t('today.heardPitchTitle')}</h3>
          </div>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">{t('today.heardPitchReaderLine')}</p>
        {privacy}
        {cta}
      </section>
    )
  }

  const beats = [
    { icon: Ear, text: t('today.heardPitchBeat1') },
    { icon: MonitorPlay, text: t('today.heardPitchBeat2') },
    { icon: BookOpen, text: t('today.heardPitchBeat3') },
  ]
  return (
    <section className="rounded-3xl bg-[#151129] border border-white/5 p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <Mascot agent="hori" size={44} mood="happy" showName={false} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[#E07B39] uppercase">{t('today.heardPitchEyebrow')}</p>
          <h2 className="text-xl sm:text-2xl font-bold text-white leading-snug mt-1">{t('today.heardPitchTitle')}</h2>
        </div>
      </div>
      <ul className="mt-5 space-y-3">
        {beats.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-sm sm:text-base text-slate-200 leading-relaxed">
            <Icon size={18} className="text-[#E07B39] shrink-0 mt-0.5" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">{privacy}</div>
      <div className="mt-5">{cta}</div>
    </section>
  )
}
