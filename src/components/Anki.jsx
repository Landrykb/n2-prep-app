import { useEffect, useState } from 'react'
import { Download, ExternalLink, Loader2 } from 'lucide-react'

export default function Anki() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [queue, setQueue] = useState([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(0)

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
        setQueue([...data])
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const current = queue[index]

  const rate = (again) => {
    if (again) {
      setQueue((q) => [...q, current])
    } else {
      setDone((d) => d + 1)
    }
    setFlipped(false)
    if (index + 1 >= queue.length) {
      if (!again) setQueue((q) => q.filter((_, i) => i !== index))
      else setIndex((x) => x + 1)
    } else {
      setIndex((x) => x + 1)
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
        <p>Loading 4,871-card N2 deck…</p>
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
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="w-20 h-20 mx-auto rounded-full bg-bun-700 flex items-center justify-center text-4xl mb-6">🎉</div>
        <h2 className="text-2xl font-bold text-white mb-2">Session done</h2>
        <p className="text-slate-300 mb-6">Reviewed {done} cards. The cards will keep cycling until you mark them good.</p>
        <button onClick={exportCSV} className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition"><Download size={16} className="inline mr-2" /> Export CSV for Anki</button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Anki Cards</h2>
        <div className="flex gap-2">
          <a href="https://apps.ankiweb.net/" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-sm bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 flex items-center gap-1"><ExternalLink size={14} /> Anki</a>
          <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg text-sm bg-violet-600 hover:bg-violet-500 text-white flex items-center gap-1"><Download size={14} /> CSV</button>
        </div>
      </div>

      <div className="h-2 w-full rounded-full bg-bun-700 overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-500" style={{ width: ((done / cards.length) * 100) + '%' }} /></div>

      <div className="rounded-3xl glass p-8 sm:p-12 card-glow text-center min-h-[360px] flex flex-col items-center justify-center">
        <div className={`w-24 h-24 rounded-2xl bg-gradient-to-br ${current.tag === 'Kanji' ? 'from-amber-500 to-orange-600' : current.tag === 'Grammar' ? 'from-violet-500 to-fuchsia-600' : current.tag === 'Vocab' ? 'from-cyan-500 to-blue-600' : 'from-emerald-500 to-teal-600'} flex items-center justify-center text-4xl shadow-xl mb-6`}>
          {current.image}
        </div>
        <p className="text-sm text-slate-400 mb-2 uppercase tracking-wide">{current.tag}</p>
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
          <button onClick={() => rate(true)} className="py-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-sm font-medium hover:bg-rose-500/30 transition">Again</button>
          <button onClick={() => rate(false)} className="py-2.5 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-200 text-sm font-medium hover:bg-orange-500/30 transition">Hard</button>
          <button onClick={() => rate(false)} className="py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm font-medium hover:bg-emerald-500/30 transition">Good</button>
          <button onClick={() => rate(false)} className="py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-medium hover:bg-cyan-500/30 transition">Easy</button>
        </div>
      )}
    </div>
  )
}
