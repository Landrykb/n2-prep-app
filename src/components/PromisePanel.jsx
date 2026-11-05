import { Flag, Info } from 'lucide-react'

// Shared display for the Day-1 Promise ("Your 60-day height") — computed by
// src/lib/promise.js from a finished diagnosis, shown in Diagnosis results
// and on Today under the Proof Ladder.
export default function PromisePanel({ promise }) {
  if (!promise) return null
  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 sm:p-6 space-y-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300"><Flag size={14} /> Day-1 Promise</p>
      <h3 className="text-lg sm:text-xl font-bold text-white">Your 60-day height: {promise.height}</h3>
      <div className="space-y-1.5">
        {(promise.reasoning || []).map((line, i) => (
          <p key={i} className="text-sm text-emerald-100/85 leading-relaxed">{line}</p>
        ))}
      </div>
      {promise.plan?.length > 0 && (
        <div className="rounded-xl bg-bun-900/40 border border-emerald-500/20 p-4 space-y-1.5">
          <p className="text-xs font-bold text-emerald-200 uppercase tracking-wider">The plan, in short</p>
          {promise.plan.map((line, i) => (
            <p key={i} className="text-sm text-slate-200">{line}</p>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-400 flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" /> {promise.honesty}</p>
    </section>
  )
}
