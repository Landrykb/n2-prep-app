import { useState } from 'react'
import { Ear, MonitorPlay, BookOpen, ShieldCheck } from 'lucide-react'
import Mascot from './Mascot.jsx'
import { useLanguage } from '../hooks/useLanguage.js'

// Heard Words pitch (Doc 22): the feature's front door, in the
// fleet's own design language — Hori's real art, his orange, a
// flat solid panel, thin line icons, exactly one coral door.
// The pitch IS the contract: the privacy line is stated in the
// open. Two variants: 'full' (Today — the whole story) and
// 'compact' (the Reader page — Hori's other home, and the page
// the Telegram Mini App opens on). One dismissal hides both;
// the live Heard Today strip (Doc 22 A5) takes these spots
// once the learner has heard words of their own.
const HEARD_PITCH_KEY = 'jpn:heard-pitch:v1'
const BOT_URL = 'https://t.me/YondeReaderBot'

export default function HeardPitch({ variant = 'full' }) {
  const { t } = useLanguage()
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HEARD_PITCH_KEY) === '1' } catch { return false } })
  if (hidden) return null
  const hide = () => { try { localStorage.setItem(HEARD_PITCH_KEY, '1') } catch { /* ignore */ } setHidden(true) }
  // Inside the Telegram Mini App, a plain _blank link can bounce
  // out to a browser; Telegram's own link opener keeps the jump
  // inside Telegram, straight into the bot chat. Outside Telegram
  // (or on webviews that never expose the bridge) the plain link
  // is the behaviour.
  const openBot = (e) => {
    try {
      const wa = window.Telegram?.WebApp
      if (wa?.openTelegramLink) { e.preventDefault(); wa.openTelegramLink(BOT_URL) }
    } catch { /* fall through to the href */ }
  }
  const privacy = (
    <p className="flex items-start gap-2 text-xs text-slate-400 leading-relaxed">
      <ShieldCheck size={14} className="text-emerald-300 shrink-0 mt-px" />
      <span>{t('today.heardPitchPrivacy')}</span>
    </p>
  )
  const cta = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <a href={BOT_URL} target="_blank" rel="noreferrer" onClick={openBot} className="inline-flex items-center gap-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] transition px-4 py-2.5 text-sm font-semibold text-white">
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
