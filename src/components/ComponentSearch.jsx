import { useEffect, useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { getRadicals, loadComponents, loadKanjiIndex, intersectComponents } from '../lib/kanjiDb.js'

// Find By Parts — Shirabe-style multi-radical search (docs/19).
// Pick the parts you can see in a kanji; the result set is the pure
// intersection of the KanjiVG component index (kanjiDb.intersectComponents)
// enriched from the kanji index and sorted most-frequent first. Nothing is
// approximated: a kanji appears only if its component tree really contains
// every picked part.

const RESULT_CAP = 120

export default function ComponentSearch({ onOpenKanji }) {
  const [radicals, setRadicals] = useState(null)
  const [components, setComponents] = useState(null)
  const [index, setIndex] = useState(null)
  const [selected, setSelected] = useState([])
  const [partFilter, setPartFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([getRadicals(), loadComponents(), loadKanjiIndex()]).then(([r, c, idx]) => {
      if (!cancelled) { setRadicals(r); setComponents(c); setIndex(idx) }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const indexByChar = useMemo(() => new Map((index || []).map((r) => [r.char, r])), [index])

  const results = useMemo(() => {
    if (!components || !selected.length) return null
    const chars = intersectComponents(selected, components)
    const rows = chars.map((c) => indexByChar.get(c)).filter(Boolean)
    rows.sort((a, b) => (a.freq ?? 99999) - (b.freq ?? 99999) || (a.strokes ?? 999) - (b.strokes ?? 999))
    return rows
  }, [components, selected, indexByChar])

  const radicalGroups = useMemo(() => {
    if (!radicals) return []
    const groups = new Map()
    for (const r of radicals) {
      const key = r.strokes ?? 0
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(r)
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0])
  }, [radicals])

  const moreParts = useMemo(() => {
    if (!components || !partFilter.trim()) return []
    const q = partFilter.trim()
    return Object.entries(components)
      .filter(([el]) => el.includes(q) && !selected.includes(el))
      .map(([el, v]) => ({ el, count: [...v[0]].length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 60)
  }, [components, partFilter, selected])

  const toggle = (part) => {
    setSelected((cur) => (cur.includes(part) ? cur.filter((p) => p !== part) : [...cur, part]))
  }

  if (!radicals || !components || !index) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
        <Loader2 size={16} className="animate-spin" /> Loading the parts index…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">Pick the parts you can see in the kanji — 日 and 月 find 明.</p>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Parts:</span>
          {selected.map((part) => (
            <button
              key={part}
              onClick={() => toggle(part)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FF6B57] text-white text-sm font-medium"
              aria-label={`Remove part ${part}`}
            >
              {part} <X size={13} />
            </button>
          ))}
          <button onClick={() => setSelected([])} className="px-2.5 py-1 rounded-full bg-bun-800 text-slate-300 border border-bun-600/40 text-xs font-medium hover:text-white">
            Clear All
          </button>
        </div>
      )}

      <div className="space-y-3">
        {radicalGroups.map(([strokes, group]) => (
          <div key={strokes} className="flex items-start gap-3">
            <span className="text-xs text-slate-500 w-14 shrink-0 pt-1.5">{strokes ? `${strokes} strokes` : 'Radicals'}</span>
            <div className="flex flex-wrap gap-1.5">
              {group.map((r) => {
                const forms = [r.char, ...(r.variants || [])]
                return forms.map((form) => {
                  const active = selected.includes(form)
                  return (
                    <button
                      key={`${r.n}-${form}`}
                      onClick={() => toggle(form)}
                      aria-pressed={active}
                      title={`Radical ${r.n}${r.nameEn ? ` — ${r.nameEn}` : ''}${r.nameJa ? ` (${r.nameJa})` : ''}`}
                      className={`min-w-[36px] px-2 py-1.5 rounded-lg text-base border transition ${
                        active ? 'bg-[#FF6B57] text-white border-[#FF6B57]' : 'bg-bun-800 text-slate-200 border-bun-600/40 hover:border-[#FF6B57]/40 hover:text-white'
                      }`}
                    >
                      {form}
                    </button>
                  )
                })
              })}
            </div>
          </div>
        ))}
      </div>

      <div>
        <label className="block text-xs text-slate-500 mb-1.5" htmlFor="more-parts-filter">More Parts — type a part to find rarer components</label>
        <input
          id="more-parts-filter"
          value={partFilter}
          onChange={(e) => setPartFilter(e.target.value)}
          placeholder="e.g. 吾"
          className="w-full sm:w-64 px-3 py-2 rounded-lg bg-bun-800 border border-bun-600/40 text-slate-100 text-sm placeholder:text-slate-500 focus:outline-none focus:border-[#FF6B57]/60"
        />
        {moreParts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {moreParts.map(({ el, count }) => (
              <button
                key={el}
                onClick={() => toggle(el)}
                className="px-2 py-1.5 rounded-lg bg-bun-800 text-slate-200 border border-bun-600/40 text-sm hover:border-[#FF6B57]/40 hover:text-white"
              >
                {el} <span className="text-[10px] text-slate-500">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {results !== null && (
        <div>
          <p className="text-xs text-slate-500 mb-2">
            {results.length === 0
              ? 'No kanji in the database is built from all of these parts — try removing one.'
              : `${results.length} kanji built from ${selected.join(' + ')}${results.length > RESULT_CAP ? ` — showing the ${RESULT_CAP} most frequent; add another part to narrow` : ''}`}
          </p>
          {results.length > 0 && (
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
              {results.slice(0, RESULT_CAP).map((row) => (
                <button
                  key={row.char}
                  onClick={() => onOpenKanji(row.char)}
                  className="rounded-xl bg-bun-800 border border-bun-600/30 px-2 py-2.5 text-center hover:border-[#FF6B57]/40 transition"
                >
                  <span className="block text-2xl font-bold text-white">{row.char}</span>
                  <span className="block text-[10px] text-slate-400 mt-0.5 truncate">{row.on || row.meaning}</span>
                </button>
              ))}
            </div>
          )}
          {results.length > RESULT_CAP && (
            <p className="text-xs text-slate-500 mt-2">+{results.length - RESULT_CAP} more — add another part to narrow.</p>
          )}
        </div>
      )}
    </div>
  )
}
