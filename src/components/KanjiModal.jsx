import { useEffect, useState } from 'react'
import { X, Brain, Eye, BookOpen, Play, Search } from 'lucide-react'
import TtsButton from './TtsButton.jsx'

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
      <div className="flex items-center justify-center gap-2 sm:gap-4">
        {radicals.map((r, i) => (
          <div
            key={i}
            className={`text-center transition-all duration-500 ${i <= step ? 'opacity-100 scale-100' : 'opacity-35 scale-90'}`}
          >
            <div className="text-4xl sm:text-5xl mb-1 transition-transform duration-500" style={{ transform: i === step ? 'translateY(-4px)' : 'none' }}>
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

function VideoBox({ keyword, type }) {
  const query = `${keyword} ${type === 'Grammar' ? 'JLPT N2 grammar' : type === 'Vocab' ? 'JLPT N2 vocabulary' : 'JLPT N2 kanji'}`
  const youtube = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
  const ammo = `https://www.youtube.com/c/JapaneseAmmowithMisa/search?query=${encodeURIComponent(keyword)}`

  return (
    <div className="rounded-xl bg-gradient-to-r from-rose-900/20 to-violet-900/20 border border-rose-500/20 p-4">
      <h4 className="text-xs uppercase tracking-wider text-rose-300 mb-3 flex items-center gap-2"><Play size={14} /> Learn with real videos</h4>
      <p className="text-sm text-slate-300 mb-3">
        Watching a real teacher explain <span className="text-violet-300 font-medium">{keyword}</span> in a lesson or real-life clip makes it stick.
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={youtube}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium transition"
        >
          <Play size={16} /> YouTube search
        </a>
        <a
          href={ammo}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 border border-bun-600/40 text-slate-200 text-sm font-medium transition"
        >
          <Search size={16} /> Japanese Ammo
        </a>
      </div>
    </div>
  )
}

export default function KanjiModal({ item, onClose }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bun-900/90 p-4 sm:p-6" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl glass p-6 sm:p-8 card-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br ${item.gradient || 'from-violet-500 to-fuchsia-500'} flex items-center justify-center text-4xl sm:text-5xl shadow-xl`}>
              {image}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">{type}</p>
              <h2 className="text-5xl sm:text-6xl font-bold text-white leading-none">{title}</h2>
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
            <VideoBox keyword={title} type={type} />
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
