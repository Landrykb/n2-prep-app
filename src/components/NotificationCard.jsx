import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { usePush } from '../hooks/usePush.js'

export default function NotificationCard() {
  const { supported, subscribed, permission, subscribe, unsubscribe, sendTest } = usePush()
  const [loading, setLoading] = useState(false)

  if (!supported) {
    return (
      <div className="rounded-2xl glass p-5 card-glow">
        <div className="flex items-center gap-3 text-slate-400">
          <BellOff size={20} />
          <p className="text-sm">Push notifications are not supported in this browser.</p>
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
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center text-violet-300">
            {subscribed ? <BellRing size={20} /> : <Bell size={20} />}
          </div>
          <div>
            <h3 className="font-bold text-white text-sm">Study reminders</h3>
            <p className="text-xs text-slate-400">
              {subscribed ? 'Push reminders are on.' : needsPermission ? 'Permission denied.' : 'Get a nudge to keep your streak.'}
            </p>
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={loading || needsPermission}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1 ${
            subscribed
              ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
              : 'bg-violet-600 hover:bg-violet-500 text-white'
          } disabled:opacity-50`}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          {subscribed ? 'Turn off' : needsPermission ? 'Blocked' : 'Allow'}
        </button>
      </div>
    </div>
  )
}
