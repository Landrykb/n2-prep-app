import { useEffect, useState } from 'react'
import { ClipboardCheck, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth.js'
import { loadMockHistory } from '../lib/mockStore.js'
import { useLanguage } from '../hooks/useLanguage.js'

// Module-scope wrapper — Date.now() is not allowed in render scope (purity lint).
const daysSinceDate = (d) => Math.floor((Date.now() - new Date(d)) / 86400000)

const PRACTICE_TAB = {
  '漢字読み': 'drills',
  '表記': 'drills',
  '文脈規定・言い換え': 'drills',
  '文法形式': 'lessons',
  '文の組み立て': 'drills',
  '読解': 'reading',
  '聴解': 'n2listening',
}

function MiniBar({ label, value, max = 60 }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-slate-500 truncate">{label}</span>
        <span className="text-slate-300 font-semibold">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-bun-700 overflow-hidden">
        <div className={`h-full rounded-full ${value >= 19 ? 'bg-emerald-400' : 'bg-rose-500'}`} style={{ width: `${Math.round((value / max) * 100)}%` }} />
      </div>
    </div>
  )
}

export default function ProgressCard({ setActive, daysToExam }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const [history, setHistory] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadMockHistory(user).then((h) => { if (!cancelled) setHistory(h) })
    return () => { cancelled = true }
  }, [user])

  const last = history?.[0]
  const prev = history?.[1]

  // Suggested mock cadence tightens as the exam approaches.
  const cadence = daysToExam > 60 ? 14 : daysToExam > 30 ? 7 : 3
  const daysSince = last ? daysSinceDate(last.date) : null

  const weak = (() => {
    if (!history?.length) return []
    const agg = {}
    for (const a of history.slice(0, 5)) {
      for (const [type, t] of Object.entries(a.byType || {})) {
        agg[type] = agg[type] || { correct: 0, total: 0 }
        agg[type].correct += t.correct
        agg[type].total += t.total
      }
    }
    return Object.entries(agg)
      .map(([type, t]) => ({ type, pct: t.total ? Math.round((t.correct / t.total) * 100) : 0 }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 2)
  })()

  return (
    <section className="rounded-3xl bg-[#151129] border border-white/5 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <ClipboardCheck size={18} className="text-[#C39BD3]" /> {t('progress.title')}
        </h2>
        {history === null ? null : last ? (
          <button onClick={() => setActive('mock')} className="text-xs px-3 py-1.5 rounded-lg bg-[#FF6B57]/20 text-[#FF8A75] hover:bg-[#FF6B57]/30 transition font-medium">
            {t('progress.takeAnother')}
          </button>
        ) : null}
      </div>

      {history === null ? null : !last ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-slate-400">{t('progress.emptyText')}</p>
          <button onClick={() => setActive('mock')} className="shrink-0 px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-medium transition">
            {t('progress.emptyCta')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white">{last.scaled?.total}</span>
              <span className="text-xs text-slate-400">{t('progress.scoreSuffix')}</span>
              {prev && (
                <span className={`flex items-center gap-0.5 text-xs font-semibold ${last.scaled.total > prev.scaled.total ? 'text-emerald-300' : last.scaled.total < prev.scaled.total ? 'text-rose-300' : 'text-slate-400'}`}>
                  {last.scaled.total > prev.scaled.total ? <TrendingUp size={13} /> : last.scaled.total < prev.scaled.total ? <TrendingDown size={13} /> : <Minus size={13} />}
                  {t('progress.vsLast', { diff: Math.abs(last.scaled.total - prev.scaled.total) })}
                </span>
              )}
            </div>
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${last.passed ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border-rose-500/30'}`}>
              {last.passed ? t('progress.passEstimate') : t('progress.belowPass')}
            </span>
          </div>
          <div className="flex gap-4">
            <MiniBar label={t('progress.sectionLanguage')} value={last.scaled?.lk ?? 0} />
            <MiniBar label={t('progress.sectionReading')} value={last.scaled?.reading ?? 0} />
            <MiniBar label={t('progress.sectionListening')} value={last.scaled?.listening ?? 0} />
          </div>
          {weak.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500 flex items-center gap-1"><AlertTriangle size={12} className="text-rose-400" /> {t('progress.weakest', { count: Math.min(history.length, 5) })}</span>
              {weak.map((w) => (
                <button
                  key={w.type}
                  onClick={() => PRACTICE_TAB[w.type] && setActive(PRACTICE_TAB[w.type])}
                  className="px-2.5 py-1 rounded-full bg-bun-700/60 border border-bun-600/40 text-slate-300 hover:text-white hover:border-[#FF6B57]/40 transition"
                >
                  {w.type} · {w.pct}%
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500">
            {t('progress.nextMock', { cadence })}{daysSince !== null && <>{t('progress.lastOne')}{daysSince === 0 ? t('progress.lastToday') : t('progress.lastDaysAgo', { days: daysSince })}{daysSince >= cadence ? t('progress.dueNow') : ''}</>}
          </p>
        </div>
      )}
    </section>
  )
}
