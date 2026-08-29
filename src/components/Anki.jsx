import { useEffect, useState, useMemo } from 'react'
import { Download, ExternalLink, Loader2, RotateCcw, Search, Settings, Shuffle, CheckCircle2, XCircle } from 'lucide-react'

const SRS = [1, 3, 7, 14, 30, 90, 180]
const PROGRESS_KEY = 'n2:anki-progress'

const today = () => new Date().toISOString().slice(0, 10)
const addDays = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const loadProgress = () => {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      const t = today()
      if (p.lastDate !== t) {
        p.lastDate = t
        p.newToday = 0
      }
      return { due: {}, count: {}, lastDate: t, newToday: 0, newLimit: 20, ...p }
    }
  } catch {}
  return { due: {}, count: {}, lastDate: today(), newToday: 0, newLimit: 20 }
}

const saveProgress = (p) => {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)) } catch {}
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

  const [progress, setProgress] = useState(loadProgress())
  const [mode, setMode] = useState('due')
  const [level, setLevel] = useState('all')
  const [shuffle, setShuffle] = useState(false)
  const [search, setSearch] = useState('')
  const [newLimit, setNewLimit] = useState(progress.newLimit || 20)

  const [queue, setQueue] = useState([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

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
    saveProgress(next)
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
      saveProgress(fresh)
    }
  }

  const exportCSV = () => {
    const rows = cards.map((c) => ({ front: c.front, back: c.back, tag: c.tag }))
    const csv = ['front,back,tags', ...rows.map((r) => `${r.front},${r.back},${r.tag}`)].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'n2-anki-cards.csv'
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
          <button onClick={() => setMode('due')} className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition">Study due</button>
          <button onClick={() => setMode('all')} className="px-5 py-2.5 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 text-sm font-medium transition">Study all</button>
          <button onClick={exportCSV} className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition"><Download size={16} className="inline mr-2" /> Export CSV</button>
        </div>
      </div>
    )
  }

  const progressPct = queue.length ? Math.min(100, Math.round((index / queue.length) * 100)) : 100

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-white">Anki Cards</h2>
        <div className="flex gap-2">
          <a href="https://apps.ankiweb.net/" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-sm bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 flex items-center gap-1"><ExternalLink size={14} /> Anki</a>
          <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg text-sm bg-violet-600 hover:bg-violet-500 text-white flex items-center gap-1"><Download size={14} /> CSV</button>
          <button onClick={resetProgress} className="px-3 py-1.5 rounded-lg text-sm bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 flex items-center gap-1"><RotateCcw size={14} /> Reset</button>
        </div>
      </div>

      <div className="rounded-2xl glass p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Settings size={16} className="text-slate-500" />
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="bg-bun-900 border border-bun-600/40 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500">
            <option value="due">Due + new today</option>
            <option value="new">New only</option>
            <option value="all">All cards</option>
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="bg-bun-900 border border-bun-600/40 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500">
            <option value="all">All levels</option>
            <option value="N5">N5</option>
            <option value="N4">N4</option>
            <option value="N3">N3</option>
            <option value="N2">N2</option>
            <option value="N1">N1</option>
          </select>
          <button onClick={() => setShuffle((s) => !s)} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 border transition ${shuffle ? 'bg-violet-600 border-violet-500 text-white' : 'bg-bun-900 border-bun-600/40 text-slate-300 hover:bg-bun-700'}`}><Shuffle size={14} /> {shuffle ? 'On' : 'Off'}</button>
          <div className="relative flex-1 min-w-[140px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-full bg-bun-900 border border-bun-600/40 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500" />
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>New/day</span>
            <input type="number" min={1} max={100} value={newLimit} onChange={(e) => {
              const n = Math.max(1, Math.min(100, Number(e.target.value)))
              setNewLimit(n)
              setProgress((p) => { const next = { ...p, newLimit: n }; saveProgress(next); return next })
            }} className="w-16 bg-bun-900 border border-bun-600/40 rounded-lg px-2 py-1.5 text-center text-slate-200 focus:outline-none focus:border-violet-500" />
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
          <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="text-xs text-slate-500 text-right">{index} / {queue.length} in this session</p>
      </div>

      <div className="rounded-3xl glass p-8 sm:p-12 card-glow text-center min-h-[360px] flex flex-col items-center justify-center">
        <div className={`w-24 h-24 rounded-2xl bg-gradient-to-br ${current.level === 'N1' ? 'from-rose-500 to-red-600' : current.level === 'N2' ? 'from-orange-500 to-amber-600' : current.level === 'N3' ? 'from-yellow-500 to-amber-600' : current.level === 'N4' ? 'from-emerald-500 to-teal-600' : 'from-cyan-500 to-blue-600'} flex items-center justify-center text-4xl shadow-xl mb-6`}>
          {current.image}
        </div>
        <p className="text-sm text-slate-400 mb-2 uppercase tracking-wide">{current.tag} · {current.level}</p>
        <h3 className="text-4xl font-bold text-white mb-6">{current.front}</h3>
        {flipped && (
          <div className="w-full animate-fade-in border-t border-bun-600/30 pt-6">
            <p className="text-2xl text-slate-200 font-medium">{current.back}</p>
          </div>
        )}
      </div>

      {!flipped ? (
        <button onClick={() => setFlipped(true)} className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition">Show answer</button>
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
