import { Bell, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { usePush } from '../hooks/usePush.js'
import { useLanguage } from '../hooks/useLanguage.js'

// The automatic ask (Landry, 2026-11-11: "This should be
// asked automatically in case it is not activated yet").
// The settings card on Today only helps someone who finds
// it; this prompt surfaces the question itself on Today
// when push is possible but not on. Manners: it asks only
// while the browser permission is untouched ('default') —
// a denied permission is the settings card's story, never
// a prompt's — and "Not now" snoozes it for a week rather
// than nagging daily. Subscribing hides it for good (the
// subscribed state is the answer).
const SNOOZE_KEY = 'jpn:push-ask:v1'
const SNOOZE_MS = 7 * 86400000

export default function PushAsk() {
  const { t } = useLanguage()
  const { supported, subscribed, permission, subscribe, sendTest } = usePush()
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState(() => {
    try {
      return Date.now() - Number(localStorage.getItem(SNOOZE_KEY) || 0) < SNOOZE_MS
    } catch {
      return false
    }
  })

  if (!supported || subscribed || permission !== 'default' || gone) return null

  const turnOn = async () => {
    setBusy(true)
    const ok = await subscribe()
    if (ok) {
      await sendTest()
      setGone(true)
    }
    setBusy(false)
  }

  const notNow = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()))
    } catch { /* private mode: the dismissal is session-only */ }
    setGone(true)
  }

  return (
    <section className="rounded-3xl bg-[#151129] border border-white/5 p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-[#FF6B57]/20 flex items-center justify-center text-[#FF8A75]">
          <Bell size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-white">{t('notify.askTitle')}</h3>
          <p className="text-sm text-slate-400 mt-0.5">{t('notify.askBody')}</p>
          <div className="flex items-center gap-4 mt-3">
            <button
              onClick={turnOn}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-bold disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              {t('notify.askTurnOn')}
            </button>
            <button onClick={notNow} className="text-xs text-slate-500">
              {t('notify.askNotNow')}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
