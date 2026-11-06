import { useEffect, useState } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { brand, mascotById } from '../lib/brand.js'
import { refreshTwin, topPatterns } from '../lib/twin.js'
import { loadQueue } from '../lib/queue.js'
import { loadMetrics } from '../lib/metrics.js'
import { loadPlans, tomorrowStr } from '../lib/planner.js'
import { collectLearnerState } from '../lib/learnerState.js'
import { estimateWorkingLevel } from '../lib/twinEstimate.js'
import { LOOP_ORDER, agentLoopStats, loopCentre, weekStrip } from '../lib/loopStats.js'
import { useAuth } from '../hooks/useAuth.js'
import Mascot from './Mascot.jsx'

// THE LOOP — "how all of the agents are working together to make your
// Japanese grow" (Landry, 2026-11-07; Doc 05 §11). Six fleet members,
// one cycle, the Learner Twin at the centre and the one review queue
// as its flywheel: Michi reads the Twin and sets the direction → Saki
// plans tomorrow → Koe calls and makes you speak → Nao turns your
// slips into queue items → Hori digs reading fitted to your words and
// mines new ones → Tsuku builds tomorrow's material from what was
// mined → everything lands back in the Twin, and Michi reads a smarter
// one. Every number on this surface is derived in lib/loopStats.js
// from real Twin fields and real local metrics events — where no
// honest number exists yet, the agent shows its role line instead.
// Nothing here is a sample, a projection, or a decoration.

// The handoffs, in plain language (grounded in the Doc 05 job specs).
const HANDOFFS = {
  michi: {
    gets: 'Your Twin — the whole week that was: sessions, calls, slips, pace.',
    hands: 'The season’s direction — and the weekly letter that tells the truth about it.',
    next: 'Saki',
    door: { view: 'coach', label: 'Read Michi’s Letter' },
  },
  saki: {
    gets: 'Michi’s direction, and your Twin as it stands tonight.',
    hands: 'Tomorrow’s plan — a few things, in the right order, sized to your mode.',
    next: 'Koe',
    door: { view: 'plan', label: 'See Tomorrow’s Plan' },
  },
  koe: {
    gets: 'Today’s plan, and a scene picked from your world.',
    hands: 'You, speaking out loud — and every slip, noticed and kept.',
    next: 'Nao',
    door: { view: 'sensei', label: 'Answer The Call' },
  },
  nao: {
    gets: 'The slips from your calls and sessions.',
    hands: 'One fix at a time, turned into cards in your one queue.',
    next: 'your queue',
    door: { view: 'anki', label: 'Open Your Queue' },
  },
  hori: {
    gets: 'Your documents, and the set of words you already know.',
    hands: 'Reading fitted to your words — and new words, mined into your queue.',
    next: 'Tsuku',
    door: { view: 'reader', label: 'Open The Reader' },
  },
  tsuku: {
    gets: 'What Hori mined, and the level you are reaching for.',
    hands: 'Fresh passages and practice — made for you, checked before they ship.',
    next: 'your Twin',
    door: { view: 'voice', label: 'Try A Voice Loop Scene' },
  },
}

const RING_R = 37 // % of the square — node centres and the SVG ring agree

function nodePos(i) {
  const rad = ((-90 + i * 60) * Math.PI) / 180
  return { x: 50 + RING_R * Math.cos(rad), y: 50 + RING_R * Math.sin(rad) }
}

function AgentDisc({ m, size, selected }) {
  const [imgOk, setImgOk] = useState(true)
  return (
    <span
      aria-hidden="true"
      className="rounded-full flex items-center justify-center shrink-0 transition-all duration-300"
      style={{
        width: size,
        height: size,
        border: `3px solid ${m.color}`,
        background: 'rgba(255,255,255,0.04)',
        boxShadow: selected ? `0 0 0 4px ${m.color}55, 0 0 22px ${m.color}66` : 'none',
        transform: selected ? 'scale(1.08)' : 'scale(1)',
      }}
    >
      {imgOk ? (
        <img
          src={`/fleet/${m.id}.png`}
          alt=""
          draggable="false"
          onError={() => setImgOk(false)}
          style={{ width: size * 0.86, height: size * 0.86, objectFit: 'contain' }}
        />
      ) : (
        <span className="font-bold" style={{ color: m.color, fontSize: size * 0.42 }}>{m.kanji}</span>
      )}
    </span>
  )
}

export default function GrowthLoop({ setActive }) {
  const { user } = useAuth()
  const [selected, setSelected] = useState('michi')
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fn = () => setReducedMotion(mq.matches)
    mq.addEventListener?.('change', fn)
    return () => mq.removeEventListener?.('change', fn)
  }, [])

  const [twin] = useState(() => refreshTwin())
  const [metrics] = useState(() => loadMetrics())
  const planState = loadPlans()
  const tomorrowPlan = planState?.plans?.[tomorrowStr()] ?? null
  const top = topPatterns(twin, 1)[0] ?? null
  const state = collectLearnerState()
  const est = estimateWorkingLevel({
    diagnosisBand: typeof state.diagnosis?.jlptEstimate === 'string' ? state.diagnosis.jlptEstimate : null,
    queueItems: loadQueue(),
    speaking: twin.speaking,
  })
  const stats = agentLoopStats({
    twin,
    metrics,
    tomorrowPlan,
    topPattern: top ? { label: top.label } : null,
    workingLevel: est.band ? { band: est.band } : null,
  })
  const centre = loopCentre(twin)
  const week = weekStrip(metrics)
  const hasAnyData = centre.queueTotal > 0 || week.hasData || LOOP_ORDER.some((id) => stats[id].stat)
  const sel = mascotById(selected)
  const selHandoff = HANDOFFS[selected]
  const selStat = stats[selected]

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-white">The Loop</h2>
        <p className="text-sm text-slate-400 mt-1">
          Six agents, one cycle, your Japanese travelling around it. Nobody here works alone:
          each one hands its work to the next, and everything lands back in your Twin — so the
          fleet you meet tomorrow is smarter than the one you met today.
        </p>
      </div>

      {!hasAnyData && (
        <section className="rounded-2xl glass p-5 card-glow space-y-2">
          <h3 className="text-base font-semibold text-white">This Is How {brand.name} Works</h3>
          <p className="text-sm text-slate-300">
            This is the machine, shown honestly before it has your data: every number on this
            page appears only when it is really yours — nothing here is a sample. One session
            starts the loop turning.
          </p>
          <button
            onClick={() => setActive?.('session')}
            className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold inline-flex items-center gap-1"
          >
            Start With One Session <ChevronRight size={14} />
          </button>
        </section>
      )}

      {/* ——— The diagram ——— */}
      <section className="rounded-2xl glass p-4 sm:p-6 card-glow">
        <div className="relative mx-auto w-full max-w-[560px] aspect-square select-none">
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <linearGradient id="loopGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#71368A" />
                <stop offset="100%" stopColor="#FF6B57" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r={RING_R} fill="none" stroke="url(#loopGrad)" strokeWidth="0.7" opacity="0.55" />
            {LOOP_ORDER.map((id, i) => {
              const mid = nodePos(i + 0.5)
              const angle = -90 + 30 + i * 60
              return (
                <g key={id} transform={`translate(${mid.x} ${mid.y}) rotate(${angle + 90})`} opacity="0.85">
                  <polygon points="0,-2.1 1.35,1.35 -1.35,1.35" fill="#FF6B57" />
                </g>
              )
            })}
            {!reducedMotion && (
              <>
                <path id="loopPulsePath" d="M 50 13 A 37 37 0 1 1 49.99 13" fill="none" stroke="none" />
                <circle r="3.1" fill="#FF6B57" opacity="0.22">
                  <animateMotion dur="18s" repeatCount="indefinite">
                    <mpath href="#loopPulsePath" />
                  </animateMotion>
                </circle>
                <circle r="1.5" fill="#FF8A75">
                  <animateMotion dur="18s" repeatCount="indefinite">
                    <mpath href="#loopPulsePath" />
                  </animateMotion>
                </circle>
              </>
            )}
          </svg>

          {/* The Twin at the centre — the queue is the flywheel. */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[46%] text-center pointer-events-none">
            <p className="text-[11px] uppercase tracking-widest text-slate-400">Your Twin</p>
            <p className="text-4xl font-bold text-white mt-1">{centre.queueTotal}</p>
            <p className="text-xs text-slate-300">words in your one queue</p>
            {centre.queueTotal > 0 && (
              <p className="text-[11px] text-slate-400 mt-1">
                {centre.graduated} graduated · {centre.fresh} fresh
              </p>
            )}
            {est.band && (
              <p className="text-[11px] mt-1.5">
                <span className="text-[#FF8A75] font-medium">Working level {est.band}</span>
                <span className="text-slate-500"> (estimate)</span>
              </p>
            )}
          </div>

          {LOOP_ORDER.map((id, i) => {
            const m = mascotById(id)
            const pos = nodePos(i)
            const st = stats[id]
            const isSel = selected === id
            return (
              <button
                key={id}
                onClick={() => setSelected(id)}
                aria-pressed={isSel}
                className="absolute w-[104px] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 rounded-2xl px-1 py-1.5 focus:outline-none"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                <AgentDisc m={m} size={60} selected={isSel} />
                <span className="text-sm font-semibold text-white leading-none">
                  {m.name} <span style={{ color: m.color }}>{m.kanji}</span>
                </span>
                <span className="text-[11px] text-slate-400 leading-none">{m.role}</span>
                {st.stat && (
                  <span
                    className="text-[11px] font-medium leading-tight text-center rounded-full px-2 py-0.5 mt-0.5"
                    style={{ color: m.color, border: `1px solid ${m.color}66`, background: `${m.color}14` }}
                  >
                    {st.stat}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-center text-xs text-slate-500 mt-2">Tap an agent to see its handoff.</p>
      </section>

      {/* ——— The selected agent's handoff ——— */}
      <section className="rounded-2xl glass p-5 card-glow space-y-4" style={{ borderLeft: `4px solid ${sel.color}` }}>
        <div className="flex items-center gap-3">
          <Mascot agent={sel.id} size={52} showName={false} motion="none" />
          <div>
            <h3 className="text-lg font-bold text-white">
              {sel.name} <span style={{ color: sel.color }}>{sel.kanji}</span>
              <span className="text-sm font-medium text-slate-400"> · {sel.role}</span>
            </h3>
            <p className="text-sm text-slate-300">{sel.job}</p>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <p className="text-slate-300">
            <span className="text-slate-500 font-medium">Gets — </span>{selHandoff.gets}
          </p>
          <p className="text-slate-300 flex items-start gap-1.5">
            <ArrowRight size={15} className="mt-0.5 shrink-0" style={{ color: sel.color }} />
            <span><span className="text-slate-500 font-medium">Hands on to {selHandoff.next} — </span>{selHandoff.hands}</span>
          </p>
        </div>
        {(selStat.stat || selStat.detail) && (
          <div className="rounded-xl bg-white/[0.03] border border-white/5 px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-slate-500">In Your Loop Right Now</p>
            {selStat.stat && <p className="text-base font-semibold text-white mt-1">{selStat.stat}</p>}
            {selStat.detail && <p className="text-sm text-slate-300 mt-0.5">{selStat.detail}</p>}
          </div>
        )}
        <button
          onClick={() => setActive?.(selHandoff.door.view)}
          className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium inline-flex items-center gap-1.5"
        >
          {selHandoff.door.label} <ChevronRight size={14} />
        </button>
      </section>

      {/* ——— Your Japanese this week ——— */}
      <section className="rounded-2xl glass p-5 card-glow space-y-3">
        <h3 className="text-base font-semibold text-white">Your Japanese This Week</h3>
        {week.hasData ? (
          <div className="grid grid-cols-3 gap-3">
            {week.tiles.map((t) => (
              <div key={t.id} className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-3 text-center">
                <p className="text-2xl font-bold text-white">{t.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{t.label}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            Not enough data yet — this strip only ever shows real numbers from the last seven
            days, and yours have not started. One session changes that.
          </p>
        )}
        <p className="text-xs text-slate-500">
          Everything above lands back in your Twin — and next week, Michi reads a smarter one.
          {user ? '' : ' The loop keeps its memory on this device.'}
        </p>
      </section>
    </div>
  )
}
