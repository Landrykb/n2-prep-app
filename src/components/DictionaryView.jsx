import { useEffect, useMemo, useState } from 'react'
import { Search, Loader2, BookOpen, X } from 'lucide-react'
import { localDictionary, loadDictionary, search, LEVELS } from '../lib/dictionary.js'
import { useKanjiModal } from '../hooks/useKanjiModal.js'
import TtsButton from './TtsButton.jsx'
import KanjiTapText from './KanjiTapText.jsx'

const LEVEL_STYLE = {
  N5: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  N4: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  N3: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  N2: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  N1: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
}

const levelClass = (lv) => LEVEL_STYLE[lv] || 'bg-violet-500/15 text-violet-300 border-violet-500/30'

export default function DictionaryView() {
  const [dict, setDict] = useState(localDictionary)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [levels, setLevels] = useState([])
  const { open } = useKanjiModal()

  useEffect(() => {
    let cancelled = false
    loadDictionary().then((d) => {
      if (cancelled) return
      setDict(d)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const results = useMemo(() => search(dict, query, { levels, limit: 60 }), [dict, query, levels])

  const toggleLevel = (lv) => setLevels((cur) => (cur.includes(lv) ? cur.filter((l) => l !== lv) : [...cur, lv]))

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <header className="flex items-center gap-3">
        <BookOpen className="text-violet-400 shrink-0" size={24} />
        <div>
          <h2 className="text-2xl font-bold text-white leading-tight">Dictionary</h2>
          <p className="text-xs text-slate-400">
            {loading ? 'Loading…' : `${dict.entries.length.toLocaleString()} words`} · search Japanese, kana, or English
          </p>
        </div>
      </header>

      <div className="rounded-2xl glass p-4 card-glow space-y-3">
        <div className="relative">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 納期, のうき, or deadline"
            aria-label="Search the dictionary"
            autoComplete="off"
            className="w-full rounded-xl bg-bun-900 border border-bun-600/40 pl-10 pr-10 py-3 text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-500 hover:text-white"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {LEVELS.map((lv) => (
            <button
              key={lv}
              onClick={() => toggleLevel(lv)}
              aria-pressed={levels.includes(lv)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                levels.includes(lv) ? levelClass(lv) : 'bg-bun-800 text-slate-400 border-bun-600/40 hover:text-white'
              }`}
            >
              {lv}
            </button>
          ))}
          {levels.length > 0 && (
            <button onClick={() => setLevels([])} className="px-2.5 py-1 rounded-full text-xs text-slate-400 hover:text-white underline">
              clear
            </button>
          )}
        </div>
      </div>

      {loading && !query && (
        <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading the full word list…</p>
      )}

      {query && results.length === 0 && !loading && (
        <p className="text-sm text-slate-400">
          No match for “{query}”{levels.length ? ` in ${levels.join(', ')}` : ''}. Try kana, or a shorter English word.
        </p>
      )}

      <ul className="space-y-2">
        {results.map((e) => (
          <li key={`${e.word}|${e.reading}|${e.level}`} className="rounded-xl glass p-3.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xl font-semibold text-white break-all">
                  <KanjiTapText text={e.word} />
                </span>
                {e.reading && e.reading !== e.word && <span className="text-cyan-300 text-sm">{e.reading}</span>}
                {e.level && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${levelClass(e.level)}`}>{e.level}</span>}
              </div>
              <p className="text-sm text-slate-300 mt-0.5">{e.meaning}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <TtsButton text={e.word} className="p-1.5" />
              <button
                onClick={() => open({ _type: e.type || 'Vocab', _key: e.word, word: e.word, char: e.word.length === 1 ? e.word : undefined, reading: e.reading, meaning: e.meaning, image: e.image })}
                aria-label={`Show details for ${e.word}`}
                title="Visual breakdown"
                className="p-1.5 rounded-lg bg-bun-800/60 text-slate-400 hover:text-violet-300"
              >
                <BookOpen size={15} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
