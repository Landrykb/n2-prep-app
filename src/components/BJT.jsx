import { useEffect, useMemo, useState } from 'react'
import { Building2, Headphones, BookOpen, Award, ExternalLink, Brain, Dumbbell, Play, Layers } from 'lucide-react'
import {
  bjtScoreMapping,
  bjtLevels,
  bjtKeigo,
  bjtVocab,
  bjtPassages,
  bjtListening,
  bjtDailyQuestions,
  bjtResources,
  bjtStrategy,
} from '../data/bjt.js'
import { supabase } from '../lib/supabaseClient.js'
import { shuffleWithSeed } from '../lib/shuffle.js'
import TtsButton from './TtsButton.jsx'
import KanjiTapText from './KanjiTapText.jsx'
import MiniQuiz from './MiniQuiz.jsx'

function colorClass(color) {
  const map = {
    emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    violet: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    slate: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  }
  return map[color] || map.slate
}

function BjtVideoBox({ query }) {
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    const search = async () => {
      setLoading(true)
      setError('')
      try {
        const { data, error } = await supabase.functions.invoke('videos', { body: { q: query } })
        if (cancelled) return
        if (error) throw error
        setVideos(data?.videos?.slice(0, 4) || [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load videos.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    search()
    return () => { cancelled = true }
  }, [query])

  if (loading) return <div className="text-sm text-slate-400 flex items-center gap-2"><Layers size={16} className="animate-spin" /> Loading videos…</div>
  if (error) return <p className="text-sm text-rose-300">{error}</p>
  if (!videos.length) return <p className="text-sm text-slate-500">No BJT videos found. Try the resource links below.</p>

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {videos.map((v) => (
        <div key={v.id} className="rounded-xl overflow-hidden border border-bun-600/30 bg-bun-900">
          <div className="aspect-video w-full">
            <iframe className="w-full h-full" src={v.embed} title={v.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
          </div>
          <div className="p-3">
            <p className="text-xs font-bold text-slate-100 line-clamp-2">{v.title}</p>
            <p className="text-[10px] text-slate-400 mt-1">{v.channel}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function BJT() {
  const [active, setActive] = useState('drill')
  const [target, setTarget] = useState('J1')
  const [levelFilter, setLevelFilter] = useState('all')
  const [passageIdx, setPassageIdx] = useState(0)
  const [listenIdx, setListenIdx] = useState(0)
  const [showTranscript, setShowTranscript] = useState(false)
  const [drillSeed, setDrillSeed] = useState(0)

  const drillPool = useMemo(() => {
    if (target === 'all') return bjtDailyQuestions
    // bjtLevels runs J1 (hardest) → J5 (easiest). Targeting a level means you
    // should also be solid on everything easier than it, so include this level
    // and all levels below it.
    const targetIdx = bjtLevels.indexOf(target)
    const allowed = bjtLevels.slice(targetIdx)
    return bjtDailyQuestions.filter((q) => allowed.includes(q.level))
  }, [target])

  // Seeded shuffle keeps render pure while still reshuffling on "New set".
  const daily = useMemo(() => shuffleWithSeed(drillPool, drillSeed).slice(0, 5), [drillPool, drillSeed])

  const filteredVocab = useMemo(() => {
    if (levelFilter === 'all') return bjtVocab
    return bjtVocab.filter((v) => v.level === levelFilter)
  }, [levelFilter])

  const tabs = [
    { id: 'drill', label: 'Daily Drill', icon: Dumbbell },
    { id: 'vocab', label: 'Vocab', icon: BookOpen },
    { id: 'keigo', label: 'Keigo', icon: Brain },
    { id: 'reading', label: 'Reading', icon: BookOpen },
    { id: 'listening', label: 'Listening', icon: Headphones },
    { id: 'score', label: 'Score Map', icon: Award },
    { id: 'videos', label: 'BJT Videos', icon: Play },
    { id: 'resources', label: 'Resources', icon: ExternalLink },
  ]

  const newDrill = () => setDrillSeed((s) => s + 1)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={20} className="text-violet-400" />
            <h2 className="text-2xl font-bold text-white">BJT + N2 Prep</h2>
          </div>
          <p className="text-sm text-slate-400">Prepare for either BJT or N2. BJT can be taken anytime — use the drills and videos when you feel ready.</p>
        </div>
      </div>

      <div className="flex p-1 rounded-xl bg-bun-700/60 border border-bun-600/40 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition whitespace-nowrap ${active === t.id ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {active === 'drill' && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-white">Daily BJT drill</h3>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Target level:</label>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="bg-bun-900 border border-bun-600/40 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500">
                <option value="all">Mixed</option>
                {bjtLevels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <button onClick={newDrill} className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium">New set</button>
            </div>
          </div>
          <p className="text-sm text-slate-400">5 random questions up to {target === 'all' ? 'mixed levels' : target}. N2 business items are labeled where relevant.</p>
          <MiniQuiz key={daily.map((q) => q.id).join(',')} questions={daily} />
        </section>
      )}

      {active === 'score' && (
        <section className="rounded-2xl glass p-5 card-glow space-y-4">
          <h3 className="text-lg font-bold text-white">JLPT ↔ BJT equivalence</h3>
          <p className="text-sm text-slate-300">BJT is scored 0–800 in six bands. Use it alongside N2: you can sit either exam depending on which you feel ready for first.</p>
          <div className="rounded-xl bg-bun-700/40 border border-bun-600/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <label className="text-sm text-slate-300">Focus on:</label>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="bg-bun-900 border border-bun-600/40 rounded-lg px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-violet-500">
                {bjtLevels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <p className="text-sm text-slate-200"><span className="font-bold text-violet-300">{target} strategy:</span> {bjtStrategy[target]}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bjtScoreMapping.map((m, i) => (
              <div key={i} className={`rounded-xl p-4 border ${colorClass(m.color)}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-2xl font-bold">{m.bjt}</p>
                  <span className="text-xs bg-bun-900/50 px-2 py-0.5 rounded">{m.jlpt}</span>
                </div>
                <p className="text-sm opacity-90">{m.score}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {active === 'vocab' && (
        <section className="rounded-2xl glass p-5 card-glow space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-white">Business vocabulary</h3>
            <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className="bg-bun-900 border border-bun-600/40 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500">
              <option value="all">All levels</option>
              {bjtLevels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <p className="text-sm text-slate-400">Tap any word to open its kanji breakdown.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredVocab.map((v, i) => (
              <div key={i} className="rounded-xl bg-bun-700/40 border border-bun-600/30 p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-lg text-white font-bold"><KanjiTapText text={v.word} className="text-white font-bold" /></p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-bun-700 text-slate-400">{v.level}</span>
                </div>
                <p className="text-sm text-cyan-300 mb-1">{v.reading}</p>
                <p className="text-xs text-slate-400">{v.meaning}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {active === 'keigo' && (
        <section className="rounded-2xl glass p-5 card-glow space-y-4 overflow-x-auto">
          <h3 className="text-lg font-bold text-white">Business keigo swap table</h3>
          <table className="w-full text-sm text-left min-w-[600px]">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-bun-600/40">
                <th className="pb-2 font-medium">Plain</th>
                <th className="pb-2 font-medium">Respectful (sonkeigo)</th>
                <th className="pb-2 font-medium">Humble (kenjougo)</th>
                <th className="pb-2 font-medium">Scene</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bun-600/30">
              {bjtKeigo.map((k, i) => (
                <tr key={i}>
                  <td className="py-3 pr-4"><KanjiTapText text={k.plain} className="text-white" /></td>
                  <td className="py-3 pr-4"><KanjiTapText text={k.sonkei} className="text-violet-300" /></td>
                  <td className="py-3 pr-4"><KanjiTapText text={k.kenjou} className="text-emerald-300" /></td>
                  <td className="py-3 text-slate-400">{k.scene}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {active === 'reading' && (
        <section className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {bjtPassages.map((p, i) => (
              <button key={i} onClick={() => setPassageIdx(i)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${passageIdx === i ? 'bg-violet-600 text-white' : 'bg-bun-700 text-slate-300 hover:bg-bun-600'}`}>
                {p.title} <span className="text-slate-400">· {p.level}</span>
              </button>
            ))}
          </div>
          <div className="rounded-2xl glass p-5 card-glow space-y-4">
            <div>
              <h3 className="text-lg font-bold text-white">{bjtPassages[passageIdx].title}</h3>
              <p className="text-xs text-slate-400">{bjtPassages[passageIdx].level} · target time {bjtPassages[passageIdx].time} min</p>
            </div>
            <p className="text-xs text-slate-500">Real BJT passages come with Japanese questions and answer choices. Use this as reading practice.</p>
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 leading-loose text-slate-100">
              <KanjiTapText text={bjtPassages[passageIdx].text} />
            </div>
            <MiniQuiz key={passageIdx} questions={bjtPassages[passageIdx].questions} />
          </div>
        </section>
      )}

      {active === 'listening' && (
        <section className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {bjtListening.map((l, i) => (
              <button key={i} onClick={() => setListenIdx(i)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${listenIdx === i ? 'bg-violet-600 text-white' : 'bg-bun-700 text-slate-300 hover:bg-bun-600'}`}>
                {l.title} <span className="text-slate-400">· {l.level}</span>
              </button>
            ))}
          </div>
          <div className="rounded-2xl glass p-5 card-glow space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white">{bjtListening[listenIdx].title}</h3>
                <p className="text-xs text-slate-400">{bjtListening[listenIdx].level} · listen first, then answer</p>
              </div>
            </div>
          <p className="text-xs text-slate-500">本番のBJTは音声のみです。ここでは、まず音声を聞いてから日本語の質問に答えてください。原稿は確認用です。</p>
          <div className="flex flex-wrap gap-2">
            <TtsButton text={bjtListening[listenIdx].script} className="px-3 py-1.5 text-sm font-medium" />
            <button onClick={() => setShowTranscript((s) => !s)} className="px-3 py-1.5 rounded-lg bg-bun-700 text-slate-300 hover:bg-bun-600 text-xs font-medium">
              {showTranscript ? 'Hide transcript' : 'Show transcript'}
            </button>
          </div>
            {showTranscript && (
              <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 leading-loose text-slate-100">
                <KanjiTapText text={bjtListening[listenIdx].script} />
              </div>
            )}
            <MiniQuiz key={listenIdx} questions={bjtListening[listenIdx].questions} />
          </div>
        </section>
      )}

      {active === 'videos' && (
        <section className="space-y-6">
          <div className="rounded-2xl glass p-5 card-glow space-y-4">
            <h3 className="text-lg font-bold text-white">BJT-related videos</h3>
            <p className="text-sm text-slate-400">YouTube videos pulled for BJT and business Japanese.</p>
            <BjtVideoBox query="BJT ビジネス日本語 J1 準備" />
          </div>
          <div className="rounded-2xl glass p-5 card-glow space-y-4">
            <h3 className="text-lg font-bold text-white">More video searches</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {['BJT listening practice', 'business keigo Japanese', 'JLPT N2 business vocabulary', 'BJT J1 reading'].map((q) => (
                <a key={q} href={`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`} target="_blank" rel="noreferrer" className="rounded-xl bg-bun-700/40 border border-bun-600/30 p-4 hover:border-violet-500/40 transition flex items-center gap-2 text-sm text-slate-200">
                  <Play size={14} className="text-rose-400" /> {q}
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {active === 'resources' && (
        <section className="rounded-2xl glass p-5 card-glow space-y-4">
          <h3 className="text-lg font-bold text-white">BJT resources</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bjtResources.map((r, i) => (
              <a key={i} href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl bg-bun-700/40 border border-bun-600/30 p-4 hover:border-violet-500/40 transition">
                <span className="text-2xl">{r.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white text-sm">{r.name}</p>
                  <p className="text-xs text-slate-400">{r.category}</p>
                </div>
                <ExternalLink size={14} className="text-slate-500" />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
