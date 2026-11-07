import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { usePush } from '../hooks/usePush.js'
import { useLanguage } from '../hooks/useLanguage.js'

export default function NotificationCard() {
  const { t } = useLanguage()
  const { supported, subscribed, permission, subscribe, unsubscribe, sendTest } = usePush()
  const [loading, setLoading] = useState(false)

  if (!supported) {
    return (
      <div className="rounded-2xl glass p-5 card-glow">
        <div className="flex items-center gap-3 text-slate-400">
          <BellOff size={20} />
          <p className="text-sm">{t('notify.unsupported')}</p>
        </div>
      </div>
    )
  }

  const toggle = async () => {
    setLoading(true)
    if (subscribed) await unsubscribe()
    else {
      const p = await subscribe()
      if (p) await sendTest()
    }
    setLoading(false)
  }

  const needsPermission = permission === 'denied'

  return (
    <div className="rounded-2xl glass p-5 card-glow space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#FF6B57]/20 flex items-center justify-center text-[#FF8A75]">
            {subscribed ? <BellRing size={20} /> : <Bell size={20} />}
          </div>
          <div>
            <h3 className="font-bold text-white text-sm">{t('notify.title')}</h3>
            <p className="text-xs text-slate-400">
              {subscribed ? t('notify.on') : needsPermission ? t('notify.denied') : t('notify.hint')}
            </p>
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={loading || needsPermission}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1 ${
            subscribed
              ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
              : 'bg-[#FF6B57] hover:bg-[#FF7F6E] text-white'
          } disabled:opacity-50`}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          {subscribed ? t('notify.turnOff') : needsPermission ? t('notify.blocked') : t('notify.allow')}
        </button>
      </div>
    </div>
  )
}
