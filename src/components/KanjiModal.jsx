import { useEffect, useState, useMemo } from 'react'
import { X, Brain, Eye, BookOpen, Play, Search, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import TtsButton from './TtsButton.jsx'
const DOODLE_DATA_URL = '/data/doodleData.json'

function useDoodleData() {
  const [data, setData] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch(DOODLE_DATA_URL)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [])
  return data
}

function generateDoodle(item, data) {
  if (item?.doodle) return item.doodle
  if (!data) return '✨'

  const { meaningEmoji, kanjiEmoji } = data
  const emojis = []
  if (item?.meaning) {
    const words = item.meaning.split(/[^a-zA-Z]+/).filter(Boolean)
    for (const w of words) {
      const e = meaningEmoji[w.toLowerCase()]
      if (e && !emojis.includes(e)) emojis.push(e)
      if (emojis.length >= 3) break
    }
  }
  if (emojis.length > 0) return emojis.join('')

  if (item?.radicals?.length) return item.radicals.map((r) => r.icon).join('')

  const target = item?.word || item?.char || ''
  const parts = []
  for (const ch of target) {
    const e = kanjiEmoji[ch]
    if (e && !parts.includes(e)) parts.push(e)
    if (parts.length >= 3) break
  }
  if (parts.length > 0) return parts.join('')
  return '✨'
}

function useDoodle(item, data) {
  const key = useMemo(() => {
    const id = item?._key || item?.word || item?.pattern || item?.char || item?.front || ''
    return id ? `n2:mnemonic:${id}` : ''
  }, [item])

  const doodle = useMemo(() => {
    if (item?.doodle) return item.doodle
    if (!data || !key) return '✨✨'
    const saved = localStorage.getItem(key)
    const base = saved || generateDoodle(item, data) || '✨'
    const parts = Array.from(base)
    return parts.length < 2 ? base + '✨' : base
  }, [key, item, data])

  useEffect(() => {
    if (!key) return
    if (doodle === '✨' || doodle === '✨✨') return
    if (localStorage.getItem(key) !== doodle) localStorage.setItem(key, doodle)
  }, [key, doodle])

  return doodle
}

function Glossary({ items }) {
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {items.map((g, i) => (
        <span key={i} className="text-xs px-2 py-1 rounded-full bg-bun-700/60 border border-bun-600/30 text-slate-300">
          {g.word} · {g.reading}
        </span>
      ))}
    </div>
  )
}

function DoodleStory({ doodle }) {
  const parts = Array.from(doodle)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (parts.length <= 1) return
    const id = setInterval(() => {
      setStep((s) => (s + 1) % parts.length)
    }, 700)
    return () => clearInterval(id)
  }, [parts.length])

  return (
    <div className="rounded-xl bg-gradient-to-r from-amber-900/20 to-orange-900/20 border border-amber-500/20 p-4">
      <h4 className="text-xs uppercase tracking-wider text-amber-300 mb-4 flex items-center gap-2"><Eye size={14} /> Visual story</h4>
      <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
        {parts.map((c, i) => (
          <div
            key={i}
            className={`text-3xl sm:text-5xl transition-all duration-500 ${i === step ? 'opacity-100 scale-125 -translate-y-2' : 'opacity-40 scale-90'}`}
          >
            {c}
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-slate-400 mt-4">{step + 1} / {parts.length} · the mnemonic comes alive</p>
    </div>
  )
}

function RadicalStory({ radicals, title }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (radicals.length <= 1) return
    const id = setInterval(() => {
      setStep((s) => (s < radicals.length - 1 ? s + 1 : 0))
    }, 1200)
    return () => clearInterval(id)
  }, [radicals])

  return (
    <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
      <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2"><BookOpen size={14} /> Component story</h4>
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
        {radicals.map((r, i) => (
          <div
            key={i}
            className={`text-center transition-all duration-500 ${i <= step ? 'opacity-100 scale-100' : 'opacity-35 scale-90'}`}
          >
            <div className="text-3xl sm:text-5xl mb-1 transition-transform duration-500" style={{ transform: i === step ? 'translateY(-4px)' : 'none' }}>
              {r.icon}
            </div>
            <p className="text-xs font-bold text-white">{r.part}</p>
            <p className="text-[10px] text-slate-400">{r.name}</p>
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-slate-400 mt-4">
        {step + 1} / {radicals.length}: <span className="text-slate-200">{radicals[step]?.name}</span> builds into <span className="text-violet-300">{title}</span>
      </p>
    </div>
  )
}

function FallbackLinks({ keyword, type }) {
  const query = `${keyword} ${type === 'Grammar' ? 'JLPT N2 grammar' : type === 'Vocab' ? 'JLPT N2 vocabulary' : 'JLPT N2 kanji'}`
  const youtube = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
  return (
    <div className="flex flex-wrap gap-2 mt-4">
      <a
        href={youtube}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium transition"
      >
        <Search size={16} /> YouTube search
      </a>
    </div>
  )
}

function VideoBox({ keyword, type }) {
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    const query = type === 'Grammar'
      ? `${keyword.replace(/^〜/, '')} 文法 使い方 JLPT N2`
      : type === 'Vocab'
      ? `${keyword} 単語 意味 JLPT N2`
      : `${keyword} 漢字 読み方 JLPT N2`
    let cancelled = false
    const search = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('videos', { body: { q: query } })
        if (cancelled) return
        if (error) throw error
        const all = data?.videos || []
        const cleanKeyword = keyword.replace(/^〜/, '').toLowerCase()
        const relevant = all.filter((v) => v.title.toLowerCase().includes(cleanKeyword) || v.channel.toLowerCase().includes(cleanKeyword))
        setVideos(relevant)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load videos.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    search()
    return () => { cancelled = true }
  }, [keyword, type])

  return (
    <div className="rounded-xl bg-gradient-to-r from-rose-900/20 to-violet-900/20 border border-rose-500/20 p-4">
      <h4 className="text-xs uppercase tracking-wider text-rose-300 mb-3 flex items-center gap-2"><Play size={14} /> Learn with real videos</h4>
      <p className="text-sm text-slate-300 mb-4">
        Watching a real teacher explain <span className="text-violet-300 font-medium">{keyword}</span> in a lesson or real-life clip makes it stick.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={18} className="animate-spin" /> Searching YouTube…
        </div>
      )}

      {error && (
        <div className="text-sm text-rose-300 bg-rose-900/20 rounded-lg p-3">
          <div className="flex items-start gap-2"><AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{error}</span></div>
          <FallbackLinks keyword={keyword} type={type} />
        </div>
      )}

      {!loading && !error && videos.length > 0 && (
        <div className="space-y-4">
          {videos.map((v) => (
            <div key={v.id} className="rounded-xl overflow-hidden border border-bun-600/30 bg-bun-900">
              <div className="aspect-video w-full">
                <iframe
                  className="w-full h-full"
                  src={v.embed}
                  title={v.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <div className="p-3">
                <p className="text-xs font-bold text-slate-100 line-clamp-2">{v.title}</p>
                <p className="text-[10px] text-slate-400 mt-1">{v.channel}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && videos.length === 0 && (
        <div className="text-sm text-slate-400">
          No teaching videos found.
          <FallbackLinks keyword={keyword} type={type} />
        </div>
      )}
    </div>
  )
}

export default function KanjiModal({ item, onClose }) {
  const doodleData = useDoodleData()
  const doodle = useDoodle(item, doodleData)

  if (!item) return null

  const type = item.type || item._type || (item.char ? 'Kanji' : item.pattern ? 'Grammar' : item.word ? 'Vocab' : 'Common')
  const title = item.char || item.pattern || item.word || item.front || item._key || 'Detail'
  const subtitle = item.reading || item.on || ''
  const meaning = item.meaning || ''
  const image = item.image || item.emoji || '🦝'
  const story = item.story || item.scene || item.mnemonic || ''
  const example = item.example || ''
  const exampleGlossary = item.exampleGlossary || []
  const radicals = item.radicals || []
  const form = item.form || ''
  const nuance = item.nuance || ''
  const collocation = item.collocation || ''
  const videoUrl = item.video || null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bun-900/90 p-3 sm:p-6" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85dvh] overflow-y-auto rounded-2xl sm:rounded-3xl glass p-4 sm:p-8 card-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4 sm:mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 sm:w-20 sm:h-20 rounded-xl sm:rounded-2xl bg-gradient-to-br ${item.gradient || 'from-violet-500 to-fuchsia-500'} flex items-center justify-center text-3xl sm:text-5xl shadow-xl`}>
              {image}
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-slate-400">{type}</p>
              <h2 className="text-3xl sm:text-5xl font-bold text-white leading-tight break-words">{title}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TtsButton text={title} />
            <button onClick={onClose} className="p-2 rounded-lg bg-bun-700 text-slate-300 hover:text-white">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {subtitle && <span className="text-cyan-300 font-medium">{subtitle}</span>}
            {meaning && <span className="text-emerald-300 font-medium">{meaning}</span>}
            {item.meaningFr && <span className="text-slate-400 text-sm">/ {item.meaningFr}</span>}
          </div>

          {doodle && <DoodleStory doodle={doodle} />}

          {form && (
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">Form</h4>
              <p className="text-slate-200 text-sm font-medium">{form}</p>
            </div>
          )}

          {radicals.length > 0 && <RadicalStory radicals={radicals} title={title} />}

          {videoUrl ? (
            <div className="rounded-xl overflow-hidden border border-bun-600/30">
              <iframe
                className="w-full aspect-video"
                src={videoUrl}
                title={`${title} video`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <VideoBox key={title} keyword={title} type={type} />
          )}

          {story && (
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2"><Brain size={14} /> Memory Story</h4>
              <p className="text-slate-200 leading-relaxed text-sm">{story}</p>
            </div>
          )}

          {nuance && (
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2"><Eye size={14} /> Nuance</h4>
              <p className="text-slate-200 leading-relaxed text-sm">{nuance}</p>
            </div>
          )}

          {collocation && (
            <p className="text-sm text-slate-300">
              <span className="text-slate-500">Collocation:</span> {collocation}
            </p>
          )}

          {example && (
            <div className="rounded-xl bg-gradient-to-r from-violet-900/30 to-fuchsia-900/30 border border-violet-500/20 p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-violet-300">Example</h4>
                <TtsButton text={example} className="scale-90" />
              </div>
              <p className="text-lg text-slate-100 leading-loose font-medium">{example}</p>
              {exampleGlossary.length > 0 && <Glossary items={exampleGlossary} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
