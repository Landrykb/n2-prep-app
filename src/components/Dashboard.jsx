import { useState } from 'react'
import { Calendar, Flame, Target, Layers, BookOpen, Brain, Bot, AlertCircle, ChevronRight } from 'lucide-react'
import NotificationCard from './NotificationCard.jsx'

const actions = [
  { id: 'anki', label: 'SRS cards', icon: Layers, amount: '25', color: 'violet', desc: 'Review due + new cards' },
  { id: 'lessons', label: 'Grammar pattern', icon: Brain, amount: '1', color: 'cyan', desc: 'Master one N2 point' },
  { id: 'reading', label: 'Reading passage', icon: BookOpen, amount: '1', color: 'emerald', desc: 'Train parsing speed' },
  { id: 'ai', label: 'Ask the AI tutor', icon: Bot, amount: '', color: 'fuchsia', desc: 'Explain a weak point' },
  { id: 'errors', label: 'Review errors', icon: AlertCircle, amount: '3', color: 'rose', desc: 'Clear due mistakes' },
]

const focusText = {
  foundation: 'You have time. Build vocabulary + kanji recognition first.',
  patterns: 'Focus on grammar patterns and reading strategy.',
  speed: 'Pick up the pace. Drill past questions and review errors.',
  sprint: 'Final sprint. Mock tests, error log, and weak points only.',
}

export default function Dashboard({ streak, daysToExam, nextExam, setActive }) {
  const [checked, setChecked] = useState({ srs: false, grammar: false, reading: false, errors: false })
  const dateLabel = nextExam?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const focus = daysToExam > 120 ? 'foundation' : daysToExam > 60 ? 'patterns' : daysToExam > 30 ? 'speed' : 'sprint'

  const toggle = (key) => setChecked((c) => ({ ...c, [key]: !c[key] }))

  const completed = Object.values(checked).filter(Boolean).length
  const progress = Math.round((completed / 4) * 100)

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Top: exam + streak */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 border border-violet-500/20 p-5 sm:p-8 card-glow">
        <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <Calendar size={16} className="text-violet-300" />
            <span className="text-xs sm:text-sm font-medium text-emerald-300">{daysToExam} days to July JLPT · {dateLabel}</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold text-white mb-2">July JLPT is in {daysToExam} days.</h1>
          <p className="max-w-2xl text-slate-300 leading-relaxed text-sm sm:text-base mb-5">
            {focusText[focus]} Do a little, consistently.
          </p>
          <div className="flex items-center gap-6 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-500/20 text-orange-300 flex items-center justify-center text-lg">🔥</div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-white leading-none">{streak}</p>
                <p className="text-[10px] sm:text-xs text-slate-400">day streak</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-500/20 text-violet-300 flex items-center justify-center"><Target size={20} /></div>
              <div>
                <p className="text-xl sm:text-2xl font-bold text-white leading-none">{daysToExam}</p>
                <p className="text-[10px] sm:text-xs text-slate-400">days left</p>
              </div>
            </div>
          </div>
          <div className="w-full bg-bun-700/50 rounded-full h-2 mb-2">
            <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-slate-400">{completed}/4 daily habits checked · keep the streak</p>
        </div>
      </section>

      {/* Today's practical actions */}
      <section>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Flame size={18} className="text-orange-400" /> Do today</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {actions.map((a) => {
            const Icon = a.icon
            const colorMap = {
              violet: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
              cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
              emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
              fuchsia: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20',
              rose: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
            }
            return (
              <button
                key={a.id}
                onClick={() => setActive(a.id)}
                className={`text-left rounded-2xl glass p-4 card-glow border transition hover:border-violet-500/30 group`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${colorMap[a.color]}`}>
                  <Icon size={20} />
                </div>
                <div className="flex items-baseline gap-2 mb-1">
                  <h3 className="font-bold text-white">{a.label}</h3>
                  {a.amount && <span className="text-xs px-1.5 py-0.5 rounded bg-bun-700 text-slate-300">{a.amount}</span>}
                </div>
                <p className="text-xs text-slate-400 mb-3">{a.desc}</p>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-300 group-hover:translate-x-0.5 transition">
                  Start <ChevronRight size={14} />
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Daily goal checklist */}
      <section className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl glass p-5 card-glow space-y-4">
          <h2 className="text-lg font-bold text-white">Daily habits</h2>
          {[
            { key: 'srs', label: '25 SRS cards reviewed', icon: Layers },
            { key: 'grammar', label: '1 grammar pattern mastered', icon: Brain },
            { key: 'reading', label: '1 daily reading passage', icon: BookOpen },
            { key: 'errors', label: 'Reviewed 3 error log items', icon: AlertCircle },
          ].map((h) => {
            const Icon = h.icon
            const isChecked = checked[h.key]
            return (
              <button
                key={h.key}
                onClick={() => toggle(h.key)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition text-left ${isChecked ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-bun-700/40 border-bun-600/30 hover:bg-bun-700/60'}`}
              >
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isChecked ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500'}`}>
                  {isChecked && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </div>
                <Icon size={16} className={isChecked ? 'text-emerald-300' : 'text-slate-400'} />
                <span className={`text-sm ${isChecked ? 'text-emerald-200 line-through' : 'text-slate-200'}`}>{h.label}</span>
              </button>
            )
          })}
        </div>
        <NotificationCard />
      </section>
    </div>
  )
}
