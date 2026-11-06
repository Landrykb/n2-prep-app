import { useEffect, useState } from 'react'
import { X, Brain, Eye, Play, Search, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import TtsButton from './TtsButton.jsx'
import KanjiTapText from './KanjiTapText.jsx'
import KanjiLens from './KanjiLens.jsx'
import { kanjiReadings } from '../lib/kanjiReadings.js'

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
    <div className="rounded-xl bg-gradient-to-r from-rose-900/20 to-[#71368A]/20 border border-rose-500/20 p-4">
      <h4 className="text-xs uppercase tracking-wider text-rose-300 mb-3 flex items-center gap-2"><Play size={14} /> Learn with real videos</h4>
      <p className="text-sm text-slate-300 mb-4">
        Watching a real teacher explain <span className="text-[#FF8A75] font-medium">{keyword}</span> in a lesson or real-life clip makes it stick.
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
  if (!item) return null

  const type = item.type || item._type || (item.char ? 'Kanji' : item.pattern ? 'Grammar' : item.word ? 'Vocab' : 'Common')
  const title = item.char || item.pattern || item.word || item.front || item._key || 'Detail'
  const fallback = kanjiReadings[item.char || item.word || title] || { on: '', kun: '' }
  const on = item.on || fallback.on || ''
  const kun = item.kun || fallback.kun || ''
  const subtitle = item.reading || (on && kun ? `${on} · ${kun}` : on || kun || '')
  const meaning = item.meaning || ''
  const topIcon = item.image || item.emoji || item.char || '字'
  const image = topIcon
  const story = item.story || item.scene || item.mnemonic || ''
  const example = item.example || ''
  const exampleGlossary = item.exampleGlossary || []
  const lensChar = item.char && [...item.char].length === 1 ? item.char : null
  const form = item.form || ''
  const nuance = item.nuance || ''
  const collocation = item.collocation || ''
  const videoUrl = item.video || null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-bun-900/90 p-3 sm:p-6 overflow-hidden" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl sm:rounded-3xl glass p-4 sm:p-8 card-glow my-4 sm:my-8"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '80dvh' }}
      >
        <div className="flex items-start justify-between mb-4 sm:mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 sm:w-20 sm:h-20 rounded-xl sm:rounded-2xl bg-gradient-to-br ${item.gradient || 'from-[#71368A] to-[#FF6B57]'} flex items-center justify-center text-3xl sm:text-5xl shadow-xl`}>
              {image}
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-slate-400">{type}</p>
              <h2 className="text-3xl sm:text-5xl font-bold text-white leading-tight break-all">{title}</h2>
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

          {lensChar && <KanjiLens char={lensChar} item={item} />}

          {form && (
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">Form</h4>
              <KanjiTapText text={form} className="text-slate-200 text-sm font-medium" />
            </div>
          )}

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
              <KanjiTapText text={story} className="text-slate-200 text-sm" />
            </div>
          )}

          {nuance && (
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2"><Eye size={14} /> Nuance</h4>
              <KanjiTapText text={nuance} className="text-slate-200 text-sm" />
            </div>
          )}

          {collocation && (
            <p className="text-sm text-slate-300">
              <span className="text-slate-500">Collocation:</span> <KanjiTapText text={collocation} className="text-slate-300" />
            </p>
          )}

          {example && (
            <div className="rounded-xl bg-gradient-to-r from-[#71368A]/30 to-[#FF6B57]/20 border border-[#FF6B57]/20 p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs uppercase tracking-wider text-[#FF8A75]">Example</h4>
                <TtsButton text={example} className="scale-90" />
              </div>
              <KanjiTapText text={example} className="text-lg text-slate-100 font-medium" />
              {exampleGlossary.length > 0 && <Glossary items={exampleGlossary} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
