import { useState } from 'react'
import { Building2, Headphones, BookOpen, Award, ExternalLink, CheckCircle2, XCircle, Brain } from 'lucide-react'
import { bjtScoreMapping, bjtKeigo, bjtVocab, bjtReading, bjtListening, bjtResources } from '../data/bjt.js'
import KanjiTapText from './KanjiTapText.jsx'

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

function MiniQuiz({ questions }) {
  const [selected, setSelected] = useState(Array(questions.length).fill(null))
  const [show, setShow] = useState(Array(questions.length).fill(false))

  const choose = (qi, oi) => {
    setSelected((s) => s.map((v, i) => (i === qi ? oi : v)))
    setShow((s) => s.map((v, i) => (i === qi ? true : v)))
  }

  return (
    <div className="space-y-6">
      {questions.map((q, qi) => (
        <div key={qi} className="rounded-2xl glass p-4 card-glow">
          <p className="text-slate-200 font-medium mb-3">{qi + 1}. {q.prompt}</p>
          <div className="grid gap-2">
            {q.options.map((opt, oi) => {
              const isCorrect = opt.correct
              const isChosen = selected[qi] === oi
              const isRevealed = show[qi]
              const cls = [
                'w-full text-left px-4 py-3 rounded-xl border transition flex items-center gap-2',
                isRevealed && isCorrect ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200' : isRevealed && isChosen ? 'bg-rose-500/15 border-rose-500/50 text-rose-200' : 'bg-bun-700/40 border-bun-600/30 text-slate-200 hover:bg-bun-700/60',
              ].join(' ')
              return (
                <button key={oi} onClick={() => choose(qi, oi)} disabled={isRevealed} className={cls}>
                  {isRevealed && isCorrect ? <CheckCircle2 size={16} className="shrink-0" /> : isRevealed && isChosen ? <XCircle size={16} className="shrink-0" /> : <span className="text-slate-500 shrink-0">{String.fromCharCode(65 + oi)}.</span>}
                  {opt.label}
                </button>
              )
            })}
          </div>
          {show[qi] && <p className="text-sm text-slate-400 mt-3 bg-bun-900/40 rounded-lg p-3"><KanjiTapText text={q.explanation} className="text-slate-400" /></p>}
        </div>
      ))}
    </div>
  )
}

export default function BJT() {
  const [active, setActive] = useState('score')
  const tabs = [
    { id: 'score', label: 'Score Map', icon: Award },
    { id: 'vocab', label: 'Business Vocab', icon: BookOpen },
    { id: 'keigo', label: 'Keigo', icon: Brain },
    { id: 'reading', label: 'Reading', icon: BookOpen },
    { id: 'listening', label: 'Listening', icon: Headphones },
    { id: 'resources', label: 'Resources', icon: ExternalLink },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={20} className="text-violet-400" />
            <h2 className="text-2xl font-bold text-white">BJT Preparation</h2>
          </div>
          <p className="text-sm text-slate-400">Business Japanese Proficiency Test — aimed at the J1 range.</p>
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

      {active === 'score' && (
        <section className="rounded-2xl glass p-5 card-glow space-y-4">
          <h3 className="text-lg font-bold text-white">JLPT ↔ BJT equivalence</h3>
          <p className="text-sm text-slate-300">BJT is scored 0–800 and split into six bands. Use the table below to set your target alongside the JLPT level.</p>
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
          <p className="text-xs text-slate-500">* The BJT tests real-world business communication, so it is not a 1:1 replacement for JLPT, but the table gives a rough study orientation.</p>
        </section>
      )}

      {active === 'vocab' && (
        <section className="rounded-2xl glass p-5 card-glow space-y-4">
          <h3 className="text-lg font-bold text-white">Core business vocabulary</h3>
          <p className="text-sm text-slate-400">Tap any word to open its kanji breakdown.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bjtVocab.map((v, i) => (
              <div key={i} className="rounded-xl bg-bun-700/40 border border-bun-600/30 p-3">
                <p className="text-lg text-white font-bold mb-1"><KanjiTapText text={v.word} className="text-white font-bold" /></p>
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
        <section className="space-y-6">
          <div className="rounded-2xl glass p-5 card-glow">
            <h3 className="text-lg font-bold text-white mb-2">{bjtReading.title}</h3>
            <p className="text-xs text-slate-400 mb-4">{bjtReading.level} · target time {bjtReading.time} min</p>
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 leading-loose text-slate-100">
              <KanjiTapText text={bjtReading.text} />
            </div>
          </div>
          <MiniQuiz questions={bjtReading.questions} />
        </section>
      )}

      {active === 'listening' && (
        <section className="space-y-6">
          <div className="rounded-2xl glass p-5 card-glow">
            <h3 className="text-lg font-bold text-white mb-2">{bjtListening.title}</h3>
            <p className="text-xs text-slate-400 mb-4">{bjtListening.level} · read the script, then answer</p>
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-5 leading-loose text-slate-100">
              <KanjiTapText text={bjtListening.script} />
            </div>
          </div>
          <MiniQuiz questions={bjtListening.questions} />
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
