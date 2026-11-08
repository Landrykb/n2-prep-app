import { useState } from 'react'
import { Flag, Info, ChevronDown } from 'lucide-react'
import { useLanguage } from '../hooks/useLanguage.js'
import { resolvePromiseText } from '../lib/promise.js'

// Shared display for the Day-1 Promise ("Your 60-day height") — computed by
// src/lib/promise.js from a finished diagnosis, shown in Diagnosis results
// and on Today under the Proof Ladder.
//
// I18N ROUND 2: the promise's {key, vars} mirrors resolve HERE at render
// time in the user's current language; promises stored before the mirrors
// existed (no keys) render from their stored text fields unchanged.
export default function PromisePanel({ promise }) {
  const { t } = useLanguage()
  // The reasoning folds behind one quiet tap (Landry, 2026-11-08:
  // "Why is this so long"): Today shows the height and the plan;
  // the audit trail stays one tap away, never deleted. Hooks run
  // before the null return on purpose.
  const [showWhy, setShowWhy] = useState(false)
  if (!promise) return null
  const heightText = resolvePromiseText(t, promise.heightKey, promise.height)
  const reasoningLines = (promise.reasoning || []).map((line, i) => resolvePromiseText(t, promise.reasoningKeys?.[i], line))
  const planLines = (promise.plan || []).map((line, i) => resolvePromiseText(t, promise.planKeys?.[i], line))
  const honestyText = promise.honestyKey ? t(promise.honestyKey) : promise.honesty
  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 sm:p-6 space-y-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300"><Flag size={14} /> {t('promise.eyebrow')}</p>
      <h3 className="text-lg sm:text-xl font-bold text-white">{t('promise.heightTitle', { height: heightText })}</h3>
      {planLines.length > 0 && (
        <div className="rounded-xl bg-bun-900/40 border border-emerald-500/20 p-4 space-y-1.5">
          <p className="text-xs font-bold text-emerald-200 uppercase tracking-wider">{t('promise.planTitle')}</p>
          {planLines.map((line, i) => (
            <p key={i} className="text-sm text-slate-200">{line}</p>
          ))}
        </div>
      )}
      {reasoningLines.length > 0 && (
        <div>
          <button onClick={() => setShowWhy((s) => !s)} aria-expanded={showWhy} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition">
            <ChevronDown size={13} className={showWhy ? 'rotate-180 transition-transform' : 'transition-transform'} /> {t('promise.why')}
          </button>
          {showWhy && (
            <div className="space-y-1.5 mt-2">
              {reasoningLines.map((line, i) => (
                <p key={i} className="text-sm text-emerald-100/85 leading-relaxed">{line}</p>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] text-slate-400 flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" /> {honestyText}</p>
    </section>
  )
}
