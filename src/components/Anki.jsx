import { useEffect, useState, useMemo } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { getUserProgress, setUserProgress } from '../lib/supabaseApi.js'
import { addToQueue, loadQueue, saveQueue, queueItemId } from '../lib/queue.js'
import { userKey } from '../lib/userKey.js'
import { mergeAnkiProgress } from '../lib/stateMerge.js'
import KanjiTapText from './KanjiTapText.jsx'
import { Download, ExternalLink, Loader2, RotateCcw, Search, Settings, Shuffle, CheckCircle2, XCircle, Layers } from 'lucide-react'

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

// One-time, USER-INITIATED move of legacy Anki progress into the ONE queue.
// Safety rules (Doc 08 §6): a JSON backup downloads FIRST; legacy progress
// is never deleted or altered; the move is idempotent (flag + queue dedupe)
// and never runs on its own.
function MigrationCard({ cards, progress }) {
  const [migration, setMigration] = useState(loadMigration)
  const [note, setNote] = useState('')
  const learnedIds = useMemo(
    () => Object.keys(progress?.count || {}).filter((id) => (progress.count[id] || 0) > 0),
    [progress],
  )

  const doMigration = () => {
    if (!cards.length || !learnedIds.length) return
    const now = new Date()
    // 1) Backup first — always, before anything is written anywhere.
    const backup = {
      exportedAt: now.toISOString(),
      kind: 'yonde-anki-legacy-backup',
      progress,
      learnedCount: learnedIds.length,
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'yonde-anki-backup.json'
    a.click()
    URL.revokeObjectURL(url)

    // 2) Import the known words as graduated review cards.
    const byId = new Map(cards.map((c) => [c.id, c]))
    const items = learnedIds.map((id) => byId.get(id)).filter(Boolean).map((c) => ({
      front: c.front,
      back: c.back,
      level: c.level,
      source: 'anki',
      note: `Moved from your Anki tab — you had already learned this word there (reviewed ${progress.count[c.id]}×).`,
    }))
    addToQueue(items, now)
    const queue = loadQueue().map((item) => {
      if (item.source !== 'anki') return item
      const card = items.find((i) => queueItemId('anki', i.front) === item.id)
      if (!card) return item
      const legacy = cards.find((c) => c.front === card.front)
      const count = legacy ? (progress.count[legacy.id] || 1) : 1
      return { ...item, fsrs: graduatedState(count, now) }
    })
    saveQueue(queue)

    const record = { doneAt: now.toISOString(), imported: items.length, backupDownloaded: true }
    try { localStorage.setItem(MIGRATION_KEY, JSON.stringify(record)) } catch {}
    setMigration(record)
    setNote(`Done — ${items.length} known word${items.length === 1 ? '' : 's'} moved into the one queue as review cards. Your Anki progress here is untouched, and your backup file is in your downloads.`)
  }

  return (
    <div className="rounded-2xl glass p-5 card-glow space-y-3 text-left">
      <h3 className="font-bold text-white flex items-center gap-2"><Layers size={17} className="text-[#FF8A75]" /> One queue, everywhere</h3>
      {migration ? (
        <p className="text-sm text-emerald-300 flex items-start gap-2"><CheckCircle2 size={16} className="shrink-0 mt-0.5" /> Moved on {new Date(migration.doneAt).toLocaleDateString()}: {migration.imported} known words now live in the Today queue with their learning preserved. This tab keeps working exactly as before — nothing was deleted.</p>
      ) : (
        <>
          <p className="text-sm text-slate-300">The rest of the app now reviews everything in <strong className="text-white">one queue</strong> with the newer FSRS scheduler. You have <strong className="text-white">{learnedIds.length} learned word{learnedIds.length === 1 ? '' : 's'}</strong> in this tab’s older system. Moving them is one tap, it downloads a backup of this progress <em>first</em>, and it never deletes anything here.</p>
          <button onClick={doMigration} disabled={!learnedIds.length || !cards.length} className="px-4 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] disabled:opacity-40 text-white text-sm font-semibold">Move My Progress To The New System</button>
          {!learnedIds.length && <p className="text-xs text-slate-500">Nothing to move yet — words become “learned” here after their first good review.</p>}
        </>
      )}
      {note && <p className="text-xs text-slate-400">{note}</p>}
    </div>
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

  useEffect(() => {
    let cancelled = false
    fetch('/data/ankiVocab.json')
      .then((r) => {
        if (!r.ok) throw new Error('Could not load deck')
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
  }, [])

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
    if (typeof window !== 'undefined' && window.confirm('Reset all saved Anki progress?')) {
      const fresh = { due: {}, count: {}, lastDate: today(), newToday: 0, newLimit }
      setProgress(fresh)
      saveProgress(progressKeyFor(user), fresh)
      if (user) setUserProgress(user.id, { anki: fresh })
    }
  }

  const exportCSV = () => {
    const rows = cards.map((c) => ({ front: c.front, back: c.back, tag: c.tag }))
    const csv = ['front,back,tags', ...rows.map((r) => `${r.front},${r.back},${r.tag}`)].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'yonde-anki-cards.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20 text-slate-400">
        <Loader2 size={24} className="animate-spin mx-auto mb-4" />
        <p>Loading 8,334-card deck…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20 text-rose-300">
        <p>{error}</p>
      </div>
    )
  }

  if (!current) {
    const summary = mode === 'due' ? 'No due cards right now. Check back tomorrow or switch to All.'
      : mode === 'new' ? `No new cards left today. Limit: ${newLimit}.` : 'You have studied the whole deck in this mode.'
    return (
      <div className="max-w-2xl mx-auto text-center py-12 space-y-6">
        <div className="w-20 h-20 mx-auto rounded-full bg-bun-700 flex items-center justify-center text-4xl">🎉</div>
        <h2 className="text-2xl font-bold text-white mb-2">Session done</h2>
        <p className="text-slate-300">{summary}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button onClick={() => setMode('due')} className="px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-medium transition">Study due</button>
          <button onClick={() => setMode('all')} className="px-5 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 text-sm font-medium transition">Study all</button>
          <button onClick={exportCSV} className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition"><Download size={16} className="inline mr-2" /> Export CSV</button>
        </div>
        <MigrationCard cards={cards} progress={progress} />
      </div>
    )
  }

  const progressPct = queue.length ? Math.min(100, Math.round((index / queue.length) * 100)) : 100

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-28 sm:pb-24">
      <MigrationCard cards={cards} progress={progress} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-white">Anki Cards</h2>
        <div className="flex gap-2">
          <a href="https://apps.ankiweb.net/" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-sm bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 flex items-center gap-1"><ExternalLink size={14} /> Anki</a>
          <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg text-sm bg-[#FF6B57] hover:bg-[#FF7F6E] text-white flex items-center gap-1"><Download size={14} /> CSV</button>
          <button onClick={resetProgress} className="px-3 py-1.5 rounded-lg text-sm bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 flex items-center gap-1"><RotateCcw size={14} /> Reset</button>
        </div>
      </div>

      <div className="rounded-2xl glass p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Settings size={16} className="text-slate-500" />
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="bg-bun-900 border border-bun-600/40 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-[#FF6B57]">
            <option value="due">Due + new today</option>
            <option value="new">New only</option>
            <option value="all">All cards</option>
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="bg-bun-900 border border-bun-600/40 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-[#FF6B57]">
            <option value="all">All levels</option>
            <option value="N5">N5</option>
            <option value="N4">N4</option>
            <option value="N3">N3</option>
            <option value="N2">N2</option>
            <option value="N1">N1</option>
          </select>
          <button onClick={() => setShuffle((s) => !s)} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 border transition ${shuffle ? 'bg-[#FF6B57] border-[#FF6B57] text-white' : 'bg-bun-900 border-bun-600/40 text-slate-300 hover:bg-bun-700'}`}><Shuffle size={14} /> {shuffle ? 'On' : 'Off'}</button>
          <div className="relative flex-1 min-w-[140px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-full bg-bun-900 border border-bun-600/40 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#FF6B57]" />
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>New/day</span>
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
          <Stat label="Total" value={stats.total} />
          <Stat label="Due" value={stats.due} />
          <Stat label="New today" value={`${stats.newToday} / ${newLimit}`} />
          <Stat label="Learned" value={stats.learned} />
        </div>
        <div className="grid grid-cols-5 gap-3">
          <Stat label="N5" value={stats.byLevel.N5} />
          <Stat label="N4" value={stats.byLevel.N4} />
          <Stat label="N3" value={stats.byLevel.N3} />
          <Stat label="N2" value={stats.byLevel.N2} />
          <Stat label="N1" value={stats.byLevel.N1} />
        </div>

        <div className="h-2 w-full rounded-full bg-bun-700 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-[#71368A] to-cyan-500 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="text-xs text-slate-500 text-right">{index} / {queue.length} in this session</p>
      </div>

      <div className="rounded-3xl glass p-8 sm:p-12 card-glow text-center min-h-[360px] flex flex-col items-center justify-center">
        <div className={`w-24 h-24 rounded-2xl bg-gradient-to-br ${current.level === 'N1' ? 'from-rose-500 to-red-600' : current.level === 'N2' ? 'from-orange-500 to-amber-600' : current.level === 'N3' ? 'from-yellow-500 to-amber-600' : current.level === 'N4' ? 'from-emerald-500 to-teal-600' : 'from-cyan-500 to-blue-600'} flex items-center justify-center text-4xl shadow-xl mb-6`}>
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
        <button onClick={() => setFlipped(true)} className="w-full py-3 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium transition">Show answer</button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => rate(0)} className="py-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-sm font-medium hover:bg-rose-500/30 transition flex items-center justify-center gap-1"><XCircle size={14} /> Again</button>
          <button onClick={() => rate(1)} className="py-2.5 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-200 text-sm font-medium hover:bg-orange-500/30 transition">Hard</button>
          <button onClick={() => rate(2)} className="py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm font-medium hover:bg-emerald-500/30 transition flex items-center justify-center gap-1"><CheckCircle2 size={14} /> Good</button>
          <button onClick={() => rate(3)} className="py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-medium hover:bg-cyan-500/30 transition">Easy</button>
        </div>
      )}
    </div>
  )
}
