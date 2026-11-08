import { useEffect, useState, useMemo, useRef } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { useLanguage } from '../hooks/useLanguage.js'
import { getUserProgress, setUserProgress } from '../lib/supabaseApi.js'
import { deliverTextFile } from '../lib/fileDeliver.js'
import { addToQueue, loadQueue, saveQueue, queueItemId, rateQueueItem } from '../lib/queue.js'
import { recordQueueRating } from '../lib/twin.js'
import { userKey } from '../lib/userKey.js'
import { mergeAnkiProgress } from '../lib/stateMerge.js'
import { recordEncounters, ankiEncounterWords } from '../lib/encounters.js'
import KanjiTapText from './KanjiTapText.jsx'
import { Download, ExternalLink, RotateCcw, Search, Settings, Shuffle, CheckCircle2, XCircle } from 'lucide-react'
import { CardSkeleton } from './Skeleton.jsx'

const SRS = [1, 3, 7, 14, 30, 90, 180]
// P1-4: progress used to live under one global key ('n2:anki-progress'),
// so accounts sharing a browser overwrote each other. It now lives under
// userKey(user, 'anki-progress') — 'n2:anon:anki-progress' signed out,
// 'n2:<userId>:anki-progress' signed in. The global key is migrated once
// (moved, not copied — moving is what stops the leak) by
// migrateLegacyAnkiKey() inside the component, the only place that knows
// the current user.
const LEGACY_GLOBAL_PROGRESS_KEY = 'n2:anki-progress'
const progressKeyFor = (user) => userKey(user, 'anki-progress')

function migrateLegacyAnkiKey(user) {
  try {
    const target = progressKeyFor(user)
    if (localStorage.getItem(target) !== null) return
    const legacy = localStorage.getItem(LEGACY_GLOBAL_PROGRESS_KEY)
    if (legacy !== null) {
      localStorage.setItem(target, legacy)
      localStorage.removeItem(LEGACY_GLOBAL_PROGRESS_KEY)
      return
    }
    // Signed in and this user's key is still empty: adopt the guest
    // (anon) copy directly too — AuthContext's anonMerge pass also does
    // this for every n2:anon:* key, but this view must not depend on
    // which of the two effects happens to run first.
    if (user?.id) {
      const anon = localStorage.getItem(progressKeyFor(null))
      if (anon !== null) localStorage.setItem(target, anon)
    }
  } catch { /* ignore */ }
}
const MIGRATION_KEY = 'jpn:anki-migration:v1'

function loadMigration() {
  try { return JSON.parse(localStorage.getItem(MIGRATION_KEY) || 'null') } catch { return null }
}

/** A graduated FSRS state derived from legacy review counts: the word was
 *  already learned here, so it enters the new queue as a REVIEW card whose
 *  interval mirrors the old ladder step it had reached — not as a new card. */
function graduatedState(count, now = new Date()) {
  const step = Math.min(Math.max(count, 1) - 1, SRS.length - 1)
  const days = SRS[step] || 7
  return {
    stability: days, difficulty: 5,
    due: new Date(now.getTime() + days * 86400000).toISOString(),
    lastReview: now.toISOString(),
    reps: Math.max(1, count), lapses: 0, state: 'review', intervalDays: days,
  }
}

// Fleet coherence (Landry, 2026-11-08): the move runs ITSELF.
// "Normally it should not ask the user to move progress — the
// app should already function that way." Opening this tab now
// imports any learned word that is not yet in the ONE queue,
// silently, as a graduated review card (its legacy count becomes
// its FSRS step, as before). Safety rules kept from the manual
// era: a JSON backup is stashed on-device FIRST (localStorage
// 'jpn:anki-backup:latest' — no share prompt, no asking), legacy
// progress is never deleted or altered, and the move is
// idempotent (front dedupe against the queue). Returns how many
// words were imported.
function autoImportAnkiProgress(cards, progress, noteFor) {
  const learnedIds = Object.keys(progress?.count || {}).filter((id) => (progress.count[id] || 0) > 0)
  if (!cards.length || !learnedIds.length) return 0
  const inQueue = new Set(loadQueue().filter((i) => i.source === 'anki').map((i) => i.front))
  const byId = new Map(cards.map((c) => [c.id, c]))
  const missing = learnedIds.map((id) => byId.get(id)).filter((c) => c && !inQueue.has(c.front))
  if (!missing.length) return 0
  const now = new Date()
  const backup = { exportedAt: now.toISOString(), kind: 'yonde-anki-legacy-backup', progress, learnedCount: learnedIds.length }
  try { localStorage.setItem('jpn:anki-backup:latest', JSON.stringify(backup)) } catch {}
  const items = missing.map((c) => ({
    front: c.front,
    back: c.back,
    level: c.level,
    source: 'anki',
    note: noteFor(progress.count[c.id]),
  }))
  addToQueue(items, now)
  const graduated = loadQueue().map((item) => {
    const card = items.find((i) => queueItemId('anki', i.front) === item.id)
    if (!card) return item
    const legacy = missing.find((c) => c.front === card.front)
    const count = legacy ? (progress.count[legacy.id] || 1) : 1
    return { ...item, fsrs: graduatedState(count, now) }
  })
  saveQueue(graduated)
  const prev = loadMigration()
  const record = { doneAt: now.toISOString(), imported: (prev?.imported || 0) + items.length, backupStashed: true, auto: true }
  try { localStorage.setItem(MIGRATION_KEY, JSON.stringify(record)) } catch {}
  return items.length
}

// The only trace the auto-import leaves on this screen: one
// quiet line saying the words already live in the queue.
function MigrationNote({ migration }) {
  const { t } = useLanguage()
  if (!migration?.imported) return null
  return (
    <p className="text-xs text-slate-500 flex items-center gap-1.5 text-left">
      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
      {t('queue.migrationDone', { date: new Date(migration.doneAt).toLocaleDateString(), count: migration.imported })}
    </p>
  )
}

const today = () => new Date().toISOString().slice(0, 10)
const addDays = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const loadProgress = (key) => {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const p = JSON.parse(raw)
      const t = today()
      if (p.lastDate !== t) {
        p.lastDate = t
        p.newToday = 0
      }
      const newLimit = Math.max(1, Math.min(100, Number(p.newLimit) || 20))
      const newToday = (p.lastDate !== t) ? 0 : Math.max(0, Math.min(newLimit, Number(p.newToday) || 0))
      return { due: p.due || {}, count: p.count || {}, lastDate: t, newToday, newLimit }
    }
  } catch {}
  return { due: {}, count: {}, lastDate: today(), newToday: 0, newLimit: 20 }
}

const saveProgress = (key, p) => {
  try { localStorage.setItem(key, JSON.stringify(p)) } catch {}
}

function Stat({ label, value }) {
  return (
    <div className="text-center">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm font-bold text-slate-200">{value}</p>
    </div>
  )
}

export default function Anki() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [progress, setProgress] = useState(() => loadProgress(progressKeyFor(null)))
  const [mode, setMode] = useState('due')
  const [level, setLevel] = useState('all')
  const [shuffle, setShuffle] = useState(false)
  const [search, setSearch] = useState('')
  const [newLimit, setNewLimit] = useState(progress.newLimit || 20)

  const [queue, setQueue] = useState([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const { user } = useAuth()
  const { t } = useLanguage()

  // The progress move runs itself on open (see
  // autoImportAnkiProgress) — no button, no asking.
  const [migration, setMigration] = useState(loadMigration)
  const autoImportedRef = useRef(false)
  useEffect(() => {
    if (!cards.length || autoImportedRef.current) return
    autoImportedRef.current = true
    try {
      const n = autoImportAnkiProgress(cards, progress, (count) => t('queue.migrationItemNote', { count }))
      if (n > 0) setMigration(loadMigration())
    } catch { /* never blocks */ }
  }, [cards, progress, t])

  useEffect(() => {
    let cancelled = false
    fetch('/data/ankiVocab.json')
      .then((r) => {
        if (!r.ok) throw new Error(t('queue.loadError'))
        return r.json()
      })
      .then((data) => {
        if (cancelled) return
        setCards(data)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    migrateLegacyAnkiKey(user)
    setProgress(loadProgress(progressKeyFor(user)))
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return
    let cancelled = false
    getUserProgress(user.id).then((data) => {
      if (cancelled || !data?.anki) return
      const p = data.anki
      const t = today()
      const cloud = {
        due: p.due || {},
        count: p.count || {},
        lastDate: p.lastDate || t,
        newToday: p.lastDate === t ? Math.max(0, Number(p.newToday) || 0) : 0,
        newLimit: Math.max(1, Math.min(100, Number(p.newLimit) || 20)),
      }
      // Merge, never overwrite (P1-4): per card, the side with more
      // reviews is further along and its schedule wins (stateMerge).
      // Overwriting here used to erase the other device's progress.
      setProgress((local) => {
        const merged = mergeAnkiProgress(local, cloud)
        const normalised = {
          ...merged,
          lastDate: t,
          newToday: merged.lastDate === t ? merged.newToday : 0,
        }
        saveProgress(progressKeyFor(user), normalised)
        return normalised
      })
      setNewLimit(cloud.newLimit)
    })
    return () => { cancelled = true }
  }, [user])

  // Fit v2 encounters (Doc 16 §5 amendment #10): every card the
  // learner has RATED here was genuinely met — derive its word and
  // record it as an encounter, so the Reader's fit (the app and the
  // Telegram bot alike, through the synced learner state) grants it
  // proven credit. recordEncounters no-ops when nothing is new, so
  // running this on every progress change cannot churn.
  useEffect(() => {
    if (!cards.length) return
    recordEncounters(ankiEncounterWords(progress, cards))
  }, [cards, progress])

  const refreshQueue = () => {
    if (!cards.length) return
    const t = today()
    const term = search.trim().toLowerCase()
    const base = cards.filter((c) => {
      if (level !== 'all' && c.level !== level) return false
      if (term && !c.front.toLowerCase().includes(term) && !c.back.toLowerCase().includes(term)) return false
      const due = progress.due[c.id]
      const isDue = due && due <= t
      const isNew = !due
      const newRoom = (progress.newToday || 0) < newLimit
      if (mode === 'due') return isDue || (isNew && newRoom)
      if (mode === 'new') return isNew && newRoom
      return true
    })
    if (shuffle) base.sort(() => Math.random() - 0.5)
    setQueue(base)
    setIndex(0)
    setFlipped(false)
  }

  useEffect(() => {
    refreshQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, mode, level, shuffle, search, newLimit])

  const current = queue[index]

  const stats = useMemo(() => {
    const t = today()
    const filtered = level === 'all' ? cards : cards.filter((c) => c.level === level)
    const due = filtered.filter((c) => progress.due[c.id] && progress.due[c.id] <= t).length
    const newCount = filtered.filter((c) => !progress.due[c.id]).length
    const learned = Object.keys(progress.count).filter((id) => (progress.count[id] || 0) > 0).length
    const byLevel = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0 }
    for (const c of cards) byLevel[c.level] = (byLevel[c.level] || 0) + 1
    return { total: filtered.length, due, new: newCount, learned, newToday: progress.newToday, byLevel }
  }, [cards, progress, level])

  const rate = (quality) => {
    if (!current) return
    const id = current.id
    const next = { ...progress, count: { ...progress.count }, due: { ...progress.due } }
    const isNew = !next.count[id]

    if (quality === 0) {
      // Again – lapse, reset and re-add to queue
      next.count[id] = 0
      next.due[id] = addDays(1)
    } else if (quality === 1) {
      // Hard – shorter interval, do not advance counter
      next.count[id] = next.count[id] || 0
      next.due[id] = addDays(1)
      if (isNew) next.newToday = (next.newToday || 0) + 1
    } else if (quality === 2) {
      // Good – advance one step
      const c = (next.count[id] || 0) + 1
      next.count[id] = c
      next.due[id] = addDays(SRS[Math.min(c - 1, SRS.length - 1)])
      if (isNew) next.newToday = (next.newToday || 0) + 1
    } else {
      // Easy – advance two steps
      const c = (next.count[id] || 0) + 2
      next.count[id] = c
      next.due[id] = addDays(SRS[Math.min(c - 1, SRS.length - 1)])
      if (isNew) next.newToday = (next.newToday || 0) + 1
    }

    setProgress(next)
    saveProgress(progressKeyFor(user), next)
    // The rated card was met, whatever the rating — an encounter
    // (Fit v2): it joins the proven set the Reader fits against.
    recordEncounters([current.front])
    // One queue (integration audit #6): this tab's private ladder
    // used to be a parallel SRS universe — a rating here changed
    // nothing in Today, the plan, or the Twin. The rating now ALSO
    // lands in the ONE queue (source 'anki', the auto-import's
    // door, live): the card joins the queue if it is not there,
    // and the FSRS state advances by the same rating (Anki quality
    // 0–3 maps onto the queue's 1–4). The tab's own progress above
    // still drives this tab's deck order; nothing here is removed.
    try {
      const qid = queueItemId('anki', current.front)
      if (!loadQueue().some((i) => i.id === qid)) {
        addToQueue([{ front: current.front, back: current.back, level: current.level, source: 'anki' }])
      }
      const qItem = loadQueue().find((i) => i.id === qid)
      if (qItem) {
        recordQueueRating(qItem, quality + 1)
        rateQueueItem(qid, quality + 1)
      }
    } catch { /* the mirror never blocks the tab */ }
    if (user) setUserProgress(user.id, { anki: next })
    setFlipped(false)

    if (quality === 0) {
      setQueue((q) => [...q, current])
      setIndex((i) => i + 1)
    } else {
      setIndex((i) => i + 1)
    }
  }

  const resetProgress = () => {
    if (typeof window !== 'undefined' && window.confirm(t('queue.resetConfirm'))) {
      const fresh = { due: {}, count: {}, lastDate: today(), newToday: 0, newLimit }
      setProgress(fresh)
      saveProgress(progressKeyFor(user), fresh)
      if (user) setUserProgress(user.id, { anki: fresh })
    }
  }

  const exportCSV = () => {
    const rows = cards.map((c) => ({ front: c.front, back: c.back, tag: c.tag }))
    const csv = ['front,back,tags', ...rows.map((r) => `${r.front},${r.back},${r.tag}`)].join('\n')
    void deliverTextFile({ filename: 'yonde-anki-cards.csv', text: csv, mime: 'text/csv' })
  }

  if (loading) {
    return <CardSkeleton caption={t('queue.loadingDeck', { count: '8,334' })} />
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20 text-rose-300">
        <p>{error}</p>
      </div>
    )
  }

  if (!current) {
    const summary = mode === 'due' ? t('queue.emptyDue')
      : mode === 'new' ? t('queue.emptyNew', { limit: newLimit }) : t('queue.emptyAll')
    return (
      <div className="max-w-2xl mx-auto text-center py-12 space-y-6">
        <div className="w-20 h-20 mx-auto rounded-full bg-bun-700 flex items-center justify-center text-4xl">🎉</div>
        <h2 className="text-2xl font-bold text-white mb-2">{t('queue.sessionDone')}</h2>
        <p className="text-slate-300">{summary}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button onClick={() => setMode('due')} className="px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-medium transition">{t('queue.studyDue')}</button>
          <button onClick={() => setMode('all')} className="px-5 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 text-sm font-medium transition">{t('queue.studyAll')}</button>
          <button onClick={exportCSV} className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition"><Download size={16} className="inline mr-2" /> {t('queue.exportCsv')}</button>
        </div>
        <MigrationNote migration={migration} />
      </div>
    )
  }

  const progressPct = queue.length ? Math.min(100, Math.round((index / queue.length) * 100)) : 100

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-28 sm:pb-24">
      <MigrationNote migration={migration} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-white">{t('queue.title')}</h2>
        <div className="flex gap-2">
          <a href="https://apps.ankiweb.net/" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-sm bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 flex items-center gap-1"><ExternalLink size={14} /> Anki</a>
          <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg text-sm bg-[#FF6B57] hover:bg-[#FF7F6E] text-white flex items-center gap-1"><Download size={14} /> CSV</button>
          <button onClick={resetProgress} className="px-3 py-1.5 rounded-lg text-sm bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 flex items-center gap-1"><RotateCcw size={14} /> {t('queue.reset')}</button>
        </div>
      </div>

      <div className="rounded-2xl glass p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Settings size={16} className="text-slate-500" />
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="bg-bun-900 border border-bun-600/40 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-[#FF6B57]">
            <option value="due">{t('queue.modeDue')}</option>
            <option value="new">{t('queue.modeNew')}</option>
            <option value="all">{t('queue.modeAll')}</option>
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="bg-bun-900 border border-bun-600/40 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-[#FF6B57]">
            <option value="all">{t('queue.allLevels')}</option>
            <option value="N5">N5</option>
            <option value="N4">N4</option>
            <option value="N3">N3</option>
            <option value="N2">N2</option>
            <option value="N1">N1</option>
          </select>
          <button onClick={() => setShuffle((s) => !s)} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 border transition ${shuffle ? 'bg-[#FF6B57] border-[#FF6B57] text-white' : 'bg-bun-900 border-bun-600/40 text-slate-300 hover:bg-bun-700'}`}><Shuffle size={14} /> {shuffle ? t('queue.on') : t('queue.off')}</button>
          <div className="relative flex-1 min-w-[140px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('queue.searchPlaceholder')} className="w-full bg-bun-900 border border-bun-600/40 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#FF6B57]" />
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>{t('queue.newPerDay')}</span>
            <input type="number" min={1} max={100} value={newLimit} onChange={(e) => {
              const n = Math.max(1, Math.min(100, Number(e.target.value)))
              setNewLimit(n)
              setProgress((p) => {
                const next = { ...p, newLimit: n }
                saveProgress(progressKeyFor(user), next)
                if (user) setUserProgress(user.id, { anki: next })
                return next
              })
            }} className="w-16 bg-bun-900 border border-bun-600/40 rounded-lg px-2 py-1.5 text-center text-slate-200 focus:outline-none focus:border-[#FF6B57]" />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Stat label={t('queue.statTotal')} value={stats.total} />
          <Stat label={t('queue.statDue')} value={stats.due} />
          <Stat label={t('queue.statNewToday')} value={`${stats.newToday} / ${newLimit}`} />
          <Stat label={t('queue.statLearned')} value={stats.learned} />
        </div>
        <div className="grid grid-cols-5 gap-3">
          <Stat label="N5" value={stats.byLevel.N5} />
          <Stat label="N4" value={stats.byLevel.N4} />
          <Stat label="N3" value={stats.byLevel.N3} />
          <Stat label="N2" value={stats.byLevel.N2} />
          <Stat label="N1" value={stats.byLevel.N1} />
        </div>

        <div className="h-2 w-full rounded-full bg-bun-700 overflow-hidden">
          <div className="h-full bg-[#FF6B57] transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="text-xs text-slate-500 text-right">{t('queue.sessionProgress', { index, total: queue.length })}</p>
      </div>

      <div className="rounded-3xl glass p-8 sm:p-12 card-glow text-center min-h-[360px] flex flex-col items-center justify-center">
        <div className="w-24 h-24 rounded-2xl bg-bun-700 border border-bun-600/40 flex items-center justify-center text-4xl shadow-xl mb-6">
          {current.image}
        </div>
        <p className="text-sm text-slate-400 mb-2 uppercase tracking-wide">{current.tag} · {current.level}</p>
        <h3 className="text-4xl font-bold text-white mb-6"><KanjiTapText text={current.front} className="font-bold" /></h3>
        {flipped && (
          <div className="w-full animate-fade-in border-t border-bun-600/30 pt-6">
            <p className="text-2xl text-slate-200 font-medium"><KanjiTapText text={current.back} className="text-slate-200" /></p>
          </div>
        )}
      </div>

      {!flipped ? (
        <button onClick={() => setFlipped(true)} className="w-full py-3 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium transition">{t('queue.showAnswer')}</button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => rate(0)} className="py-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-sm font-medium hover:bg-rose-500/30 transition flex items-center justify-center gap-1"><XCircle size={14} /> {t('queue.rateAgain')}</button>
          <button onClick={() => rate(1)} className="py-2.5 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-200 text-sm font-medium hover:bg-orange-500/30 transition">{t('queue.rateHard')}</button>
          <button onClick={() => rate(2)} className="py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm font-medium hover:bg-emerald-500/30 transition flex items-center justify-center gap-1"><CheckCircle2 size={14} /> {t('queue.rateGood')}</button>
          <button onClick={() => rate(3)} className="py-2.5 rounded-xl bg-teal-500/20 border border-teal-500/40 text-teal-200 text-sm font-medium hover:bg-teal-500/30 transition">{t('queue.rateEasy')}</button>
        </div>
      )}
    </div>
  )
}
