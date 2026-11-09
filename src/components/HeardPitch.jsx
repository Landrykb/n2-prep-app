import { useCallback, useEffect, useState } from 'react'
import { Ear, MonitorPlay, BookOpen, ShieldCheck } from 'lucide-react'
import Mascot from './Mascot.jsx'
import { useLanguage } from '../hooks/useLanguage.js'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'
import { useAutoListen } from '../lib/useAutoListen.js'

// Heard Words (Doc 22): one panel, three states, in the fleet's
// own design language — Hori's real art, his orange, a flat
// solid panel, thin line icons, exactly one coral door per state.
//
// AUTOMATIC state (the one-tap answer): press Start once and
// the app itself listens — continuous recognition in the page,
// matched against the dictionary on the device, only counts
// kept (useAutoListen / heardMatch). Foreground only: iPhone
// pauses a page's mic when the page is left, and the panel
// says so instead of pretending otherwise. The Telegram bot
// remains the pocket route, one sent stretch at a time.
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
    <ul className="space-y-1.5">
      {words.map((r) => (
        <li key={r.item} className="text-sm text-slate-200">
          <span className="font-semibold text-white">{r.item}</span>
          {readingFor(r.item) && <span className="text-[#FFB59D]"> （{readingFor(r.item)}）</span>}
          <span className="text-slate-400"> ×{r.count}</span>
        </li>
      ))}
      {exprs.map((r) => (
        <li key={r.item} className="text-sm text-slate-200">
          <span className="font-semibold text-white">{r.item}</span>
          <span className="text-slate-400"> ×{r.count}</span>
        </li>
      ))}
    </ul>
  )
}

export default function HeardPitch({ variant = 'full' }) {
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
  const hasAny = merged.length > 0
  const readingFor = (item) => auto.readingsOf?.get(item) ?? readings[item] ?? null

  const privacy = (
    <p className="flex items-start gap-2 text-xs text-slate-400 leading-relaxed">
      <ShieldCheck size={14} className="text-emerald-300 shrink-0 mt-px" />
      <span>{t('today.heardPitchPrivacy')}</span>
    </p>
  )
  const header = (title, sub) => (
    <div className="flex items-start gap-3">
      <Mascot agent="hori" size={38} mood="happy" showName={false} />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-[#E07B39] uppercase">{t('today.heardPitchEyebrow')}</p>
        <h3 className="text-lg font-bold text-white leading-snug mt-0.5">{title}</h3>
        {sub}
      </div>
    </div>
  )
  const wordBlock = (emptyLine) => (
    <>
      {dispWords.length === 0 && dispExprs.length === 0 ? (
        <p className="text-sm text-slate-300 leading-relaxed">{emptyLine}</p>
      ) : (
        <WordList words={dispWords} exprs={dispExprs} readingFor={readingFor} />
      )}
      {onceWords > 0 && (
        <p className="text-xs text-slate-500">{t('today.heardPitchOnce', { n: onceWords })}</p>
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
              {fmtElapsed(nowTs - auto.startedAt)}
            </p>
          ) : null,
        )}
        {auto.phase === 'denied' && (
          <p className="text-sm text-slate-300 leading-relaxed">{t('today.heardPitchAutoDenied')}</p>
        )}
        {auto.phase === 'interrupted' && (
          <p className="text-sm text-slate-300 leading-relaxed">{t('today.heardPitchInterrupted')}</p>
        )}
        {auto.phase === 'listening' && (
          <>
            {auto.dictReady
              ? wordBlock(t('today.heardPitchNoWords'))
              : (dispWords.length === 0 && dispExprs.length === 0
                ? <p className="text-sm text-slate-300 leading-relaxed">{t('today.heardPitchWarming')}</p>
                : wordBlock(t('today.heardPitchNoWords')))}
            <p className="text-xs text-slate-500 leading-relaxed">{t('today.heardPitchAutoKeep')}</p>
          </>
        )}
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
  const botLinkCls = auto.supported
    ? 'inline-flex items-center gap-2 rounded-xl border border-white/15 hover:border-white/30 transition px-4 py-2.5 text-sm font-semibold text-slate-200'
    : 'inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white'

  // ---------- BOT-LIVE state: the Heard Today strip ----------
  if (live && (live.listening || hasAny)) {
    return (
      <section className="rounded-3xl bg-[#151129] border border-white/5 p-5 sm:p-6 space-y-4">
        {header(
          live.listening ? t('today.heardPitchLiveTitle') : t('today.heardPitchTodayTitle'),
          live.listening ? (
            <p className="flex items-center gap-2 text-xs text-slate-400 mt-1">
              <RecordingDot />
              {t('today.heardPitchLiveSince', { time: live.since })}
            </p>
          ) : null,
        )}
        {wordBlock(t('today.heardPitchNoWords'))}
        {privacy}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {live.listening ? (
            <>
              {autoDoor}
              <a href={BOT_CHAT_URL} target="_blank" rel="noreferrer" onClick={openLink(BOT_CHAT_URL)} className={botLinkCls}>
                {t('today.heardPitchOpenBot')}
              </a>
              <button onClick={stopBot} disabled={stopping} className="text-sm text-slate-400 hover:text-slate-200 transition disabled:opacity-40">
                {t('today.heardPitchStop')}
              </button>
            </>
          ) : (
            <>
              {autoDoor}
              <a href={BOT_URL} target="_blank" rel="noreferrer" onClick={openLink(BOT_URL)} className={botLinkCls}>
                {t('today.heardPitchCta')}
              </a>
              <button onClick={hide} className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition">{t('today.heardPitchHide')}</button>
            </>
          )}
        </div>
      </section>
    )
  }

  // ---------- PITCH state ----------
  if (hidden) return null
  const botDoor = (primary) => (
    <a href={BOT_URL} target="_blank" rel="noreferrer" onClick={openLink(BOT_URL)} className={primary
      ? 'inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white'
      : 'inline-flex items-center gap-2 rounded-xl border border-white/15 hover:border-white/30 transition px-4 py-2.5 text-sm font-semibold text-slate-200'}>
      {t('today.heardPitchCta')}
    </a>
  )
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {botDoor(true)}
      <span className="text-xs text-slate-500">{t('today.heardPitchHow')}</span>
      <button onClick={hide} className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition">{t('today.heardPitchHide')}</button>
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
