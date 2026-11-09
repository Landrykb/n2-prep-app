import { useCallback, useEffect, useState } from 'react'
import { Ear, MonitorPlay, BookOpen, ShieldCheck } from 'lucide-react'
import Mascot from './Mascot.jsx'
import { useLanguage } from '../hooks/useLanguage.js'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'

// Heard Words (Doc 22): one panel, two states, in the fleet's
// own design language — Hori's real art, his orange, a flat
// solid panel, thin line icons, exactly one coral door.
//
// PITCH state (nobody listening, nothing heard today): the
// front door — his headline, the three beats, the privacy line
// stated in the open, and the one-tap Start listening door
// (the deep link opens the session in the bot; nobody types a
// command). One dismissal hides the pitch on both surfaces.
//
// LIVE state (a session is open, or words landed today): the
// same panel becomes the Heard Today strip — the live state
// with a recording dot, today's sticking words with readings
// (the floor law holds here too: a word is named only at 2+
// hearings; below-floor words appear as a count, never a
// name), a door back to the bot, and a Stop that works from
// the app (the owner may delete their own session row,
// migration 00021). A live panel cannot be hidden — a state
// you must never wonder about is not dismissible. Refresh:
// on mount, on return to the app (focus / visibility), and
// every 30s while visible. The Telegram card remains the
// full surface; this strip is its mirror in the app.
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

export default function HeardPitch({ variant = 'full' }) {
  const { t } = useLanguage()
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HEARD_PITCH_KEY) === '1' } catch { return false } })
  const [live, setLive] = useState(null)
  const [readings, setReadings] = useState({})
  const [stopping, setStopping] = useState(false)

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
      const sticking = all
        .filter((r) => r.count >= HEARD_FLOOR)
        .sort((a, b) => b.count - a.count || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0))
      const next = {
        listening: !!session,
        chatId: session?.chat_id ?? null,
        since: session ? jstTime(session.opened_at) : null,
        words: sticking.filter((r) => r.kind === 'word').slice(0, 15),
        exprs: sticking.filter((r) => r.kind === 'expr').slice(0, 8),
        onceWords: all.filter((r) => r.kind === 'word' && r.count < HEARD_FLOOR).length,
        hasAny: all.length > 0,
      }
      setLive(next)
      const items = next.words.map((r) => r.item)
      if (items.length > 0) {
        // Readings from the app's deck (the bot's card carries
        // the wide dictionary's readings; here a word the deck
        // does not know simply shows without one — never a
        // guessed reading).
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
  const stop = async () => {
    if (!live?.chatId || stopping) return
    setStopping(true)
    try { await supabase.from('ambient_sessions').delete().eq('chat_id', live.chatId) } catch { /* refresh shows the truth either way */ }
    setStopping(false)
    refresh()
  }

  const privacy = (
    <p className="flex items-start gap-2 text-xs text-slate-400 leading-relaxed">
      <ShieldCheck size={14} className="text-emerald-300 shrink-0 mt-px" />
      <span>{t('today.heardPitchPrivacy')}</span>
    </p>
  )

  // ---------- LIVE state: the Heard Today strip ----------
  if (live && (live.listening || live.hasAny)) {
    return (
      <section className="rounded-3xl bg-[#151129] border border-white/5 p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Mascot agent="hori" size={38} mood="happy" showName={false} />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-[#E07B39] uppercase">{t('today.heardPitchEyebrow')}</p>
            <h3 className="text-lg font-bold text-white leading-snug mt-0.5">
              {live.listening ? t('today.heardPitchLiveTitle') : t('today.heardPitchTodayTitle')}
            </h3>
            {live.listening && (
              <p className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF6B57] opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#FF6B57]" />
                </span>
                {t('today.heardPitchLiveSince', { time: live.since })}
              </p>
            )}
          </div>
        </div>

        {live.words.length === 0 && live.exprs.length === 0 ? (
          <p className="text-sm text-slate-300 leading-relaxed">{t('today.heardPitchNoWords')}</p>
        ) : (
          <ul className="space-y-1.5">
            {live.words.map((r) => (
              <li key={r.item} className="text-sm text-slate-200">
                <span className="font-semibold text-white">{r.item}</span>
                {readings[r.item] && <span className="text-[#FFB59D]"> （{readings[r.item]}）</span>}
                <span className="text-slate-400"> ×{r.count}</span>
              </li>
            ))}
            {live.exprs.map((r) => (
              <li key={r.item} className="text-sm text-slate-200">
                <span className="font-semibold text-white">{r.item}</span>
                <span className="text-slate-400"> ×{r.count}</span>
              </li>
            ))}
          </ul>
        )}
        {live.onceWords > 0 && (
          <p className="text-xs text-slate-500">{t('today.heardPitchOnce', { n: live.onceWords })}</p>
        )}

        {privacy}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {live.listening ? (
            <>
              <a href={BOT_CHAT_URL} target="_blank" rel="noreferrer" onClick={openLink(BOT_CHAT_URL)} className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white">
                {t('today.heardPitchOpenBot')}
              </a>
              <button onClick={stop} disabled={stopping} className="text-sm text-slate-400 hover:text-slate-200 transition disabled:opacity-40">
                {t('today.heardPitchStop')}
              </button>
            </>
          ) : (
            <>
              <a href={BOT_URL} target="_blank" rel="noreferrer" onClick={openLink(BOT_URL)} className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white">
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
  const cta = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <a href={BOT_URL} target="_blank" rel="noreferrer" onClick={openLink(BOT_URL)} className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white">
        {t('today.heardPitchCta')}
      </a>
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
