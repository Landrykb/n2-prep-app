import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import Mascot from './Mascot.jsx'
import { useLanguage } from '../hooks/useLanguage.js'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'
import { aggregateHeardRows, masteredSetFrom, vaultSummary, sortVaultEntries, VAULT_FLOOR } from '../lib/heardVault.js'
import { loadQueue } from '../lib/queue.js'
import { collectEncounterWords } from '../lib/encounters.js'

// The Word Vault (Doc 22, Landry's ask 2026-11-11): the Heard
// panel answers for TODAY and resets at midnight — he asked
// where the words went. They were always kept; they just had
// no home. The vault is that home: every word Hori has ever
// kept, visible every time the Reader opens, with the size of
// the collection and the mastered count up front, and each
// word's details one tap down (his accordion pattern).
//
// It records nothing new — a pure view over the per-day
// heard_words rows the owner can already read (migration
// 00021), plus the queue/encounters the app already holds for
// the mastery join. Dictionary readings/meanings resolve
// WIDE via heardInfo (deck → WordsDB index → the full
// wordbook the matcher uses), so a word matched from the
// wide book still shows its reading; a word no layer knows
// shows without one — never a guessed reading or meaning.
const INITIAL_ROWS = 60

export default function HeardVault() {
  const { t, language } = useLanguage()
  const [entries, setEntries] = useState(null)
  const [mastered, setMastered] = useState(() => new Set())
  const [info, setInfo] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [sortMode, setSortMode] = useState('heard')
  const [openItem, setOpenItem] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [showOnce, setShowOnce] = useState(false)

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) return
    try {
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) { setEntries([]); return }
      const { data } = await supabase
        .from('heard_words')
        .select('item, kind, count, day')
        .eq('user_id', user.id)
        .order('day', { ascending: false })
        .limit(10000)
      setEntries(aggregateHeardRows(data ?? []).entries)
      try { setMastered(masteredSetFrom(loadQueue(), collectEncounterWords())) } catch { /* mastery just reads empty */ }
    } catch { /* an unread vault shows its empty state, never an error */ }
  }, [])

  useEffect(() => {
    refresh()
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  useEffect(() => {
    if (!entries || entries.length === 0 || info) return
    let live = true
    Promise.all([
      import('../lib/dictionary.js').then(({ loadDictionary }) => loadDictionary()).catch(() => null),
      import('../lib/heardInfo.js'),
    ])
      .then(([deck, { resolveHeardInfo }]) => resolveHeardInfo(entries.map((e) => e.item), deck))
      .then((map) => { if (live) setInfo(map) })
      .catch(() => {})
    return () => { live = false }
  }, [entries, info])

  const summary = useMemo(() => vaultSummary(entries ?? [], mastered), [entries, mastered])
  const named = useMemo(
    () => sortVaultEntries((entries ?? []).filter((e) => e.total >= VAULT_FLOOR), sortMode),
    [entries, sortMode],
  )
  const once = useMemo(
    () => sortVaultEntries((entries ?? []).filter((e) => e.total < VAULT_FLOOR), 'recent'),
    [entries],
  )
  const visibleNamed = showAll ? named : named.slice(0, INITIAL_ROWS)

  if (entries === null) return null // first read in flight — no flash of an empty vault

  const fmtDay = (day) => {
    try {
      return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : language === 'fr' ? 'fr-FR' : 'en-US', {
        month: 'short', day: 'numeric', timeZone: 'Asia/Tokyo',
      }).format(new Date(`${day}T12:00:00+09:00`))
    } catch { return day }
  }
  const dictFor = (item) => info?.get(item) ?? null

  const stat = (value, label) => (
    <div className="min-w-0">
      <p className="text-2xl font-extrabold text-white tabular-nums leading-none">{value}</p>
      <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase mt-1.5">{label}</p>
    </div>
  )

  const row = (e, muted = false) => {
    const d = dictFor(e.item)
    const isOpen = openItem === e.item
    const isMastered = mastered.has(e.item)
    return (
      <li key={e.item} className={muted ? 'opacity-70' : ''}>
        <button
          onClick={() => setOpenItem(isOpen ? null : e.item)}
          aria-expanded={isOpen}
          className="flex w-full items-baseline gap-2 py-1.5 text-left"
        >
          <span className="text-lg font-bold text-white">{e.item}</span>
          {d?.reading && d.reading !== e.item && <span className="text-sm text-[#FFB59D]">（{d.reading}）</span>}
          <span className="text-sm text-slate-400 tabular-nums">×{e.total}</span>
          {isMastered && (
            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
              {t('today.vaultMasteredChip')}
            </span>
          )}
          <span className="ml-auto shrink-0 text-slate-500">
            {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </button>
        {isOpen && (
          <div className="pb-2.5 pl-0.5 space-y-1">
            {d?.meaning && <p className="text-sm text-slate-300 leading-relaxed">{d.meaning}</p>}
            <p className="text-[13px] text-slate-400 tabular-nums">
              {t('today.vaultDetail', { n: e.total, d: e.dayCount })} · {t('today.vaultLast', { date: fmtDay(e.lastDay) })}
            </p>
            {!isMastered && <p className="text-[13px] text-slate-500 leading-relaxed">{t('today.vaultLearning')}</p>}
          </div>
        )}
      </li>
    )
  }

  return (
    <section className="rounded-3xl bg-[#151129] border border-white/5 p-4 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Mascot agent="hori" size={38} mood="happy" showName={false} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[#E07B39] uppercase">{t('today.heardPitchEyebrow')}</p>
          <h3 className="text-lg font-bold text-white leading-snug mt-0.5">{t('today.vaultTitle')}</h3>
        </div>
      </div>

      {summary.kept === 0 ? (
        <p className="text-sm text-slate-300 leading-relaxed">{t('today.vaultEmpty')}</p>
      ) : (
        <>
          <div className="flex items-start gap-6 sm:gap-8">
            {stat(summary.kept, t('today.vaultKeptLabel'))}
            {stat(summary.mastered, t('today.vaultMasteredLabel'))}
            {stat(summary.hearings, t('today.vaultHearingsLabel'))}
          </div>
          {!expanded ? (
            <button
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 hover:text-white transition"
            >
              {t('today.vaultSee')} <ChevronDown size={15} />
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                {['heard', 'recent'].map((m) => (
                  <button
                    key={m}
                    onClick={() => setSortMode(m)}
                    className={`text-[13px] transition ${sortMode === m ? 'font-bold text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {t(m === 'heard' ? 'today.vaultSortHeard' : 'today.vaultSortRecent')}
                  </button>
                ))}
                <button onClick={() => setExpanded(false)} className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition">
                  <ChevronUp size={14} /> {t('today.heardPitchCollapse')}
                </button>
              </div>
              <ul className="divide-y divide-white/5">
                {visibleNamed.map((e) => row(e))}
              </ul>
              {!showAll && named.length > INITIAL_ROWS && (
                <button onClick={() => setShowAll(true)} className="text-sm text-slate-400 hover:text-slate-200 transition">
                  {t('today.vaultShowAll', { n: named.length })}
                </button>
              )}
              {once.length > 0 && (
                <div className="border-t border-white/5 pt-3">
                  <button
                    onClick={() => setShowOnce((v) => !v)}
                    aria-expanded={showOnce}
                    className="flex items-center gap-1.5 text-[13px] text-slate-400 hover:text-slate-200 transition"
                  >
                    <span>{t('today.vaultOnceLine', { n: once.length })}</span>
                    <ChevronDown size={14} className={`shrink-0 transition-transform ${showOnce ? 'rotate-180' : ''}`} />
                  </button>
                  {showOnce && (
                    <ul className="divide-y divide-white/5 mt-1">
                      {once.map((e) => row(e, true))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
