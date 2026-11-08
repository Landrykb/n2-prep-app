import { useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, Layers, RotateCcw } from 'lucide-react'
import { brand, mascotById } from '../lib/brand.js'
import { refreshTwin, topPatterns } from '../lib/twin.js'
import { loadQueue } from '../lib/queue.js'
import { loadMetrics } from '../lib/metrics.js'
import { loadPlans, tomorrowStr } from '../lib/planner.js'
import { collectLearnerState } from '../lib/learnerState.js'
import { estimateWorkingLevel } from '../lib/twinEstimate.js'
import { LOOP_ORDER, agentLoopStats, loopCentre, weekStrip } from '../lib/loopStats.js'
import { useAuth } from '../hooks/useAuth.js'
import { useLanguage } from '../hooks/useLanguage.js'

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
    getsKey: 'loop.michi.gets',
    handsKey: 'loop.michi.hands',
    next: 'Saki',
    door: { view: 'coach', labelKey: 'loop.michi.door' },
  },
  saki: {
    getsKey: 'loop.saki.gets',
    handsKey: 'loop.saki.hands',
    next: 'Koe',
    // Saki's plan IS Today's plan — the door lands on Today, where the
    // plan line and tomorrow's plan actually live, not on the legacy
    // countdown view that used to share the name (audit P1-2).
    door: { view: 'dashboard', labelKey: 'loop.saki.door' },
  },
  koe: {
    getsKey: 'loop.koe.gets',
    handsKey: 'loop.koe.hands',
    next: 'Nao',
    door: { view: 'sensei', labelKey: 'loop.koe.door' },
  },
  nao: {
    getsKey: 'loop.nao.gets',
    handsKey: 'loop.nao.hands',
    nextKey: 'loop.next.yourQueue',
    // "Open Your Queue" opens the ONE queue where it is actually
    // reviewed — step 2 of today's session — not the legacy Anki deck
    // that merely borrowed the queue's name (audit P1-1/P1-2).
    door: { view: 'session', labelKey: 'loop.nao.door' },
  },
  hori: {
    getsKey: 'loop.hori.gets',
    handsKey: 'loop.hori.hands',
    next: 'Tsuku',
    door: { view: 'reader', labelKey: 'loop.hori.door' },
  },
  tsuku: {
    getsKey: 'loop.tsuku.gets',
    handsKey: 'loop.tsuku.hands',
    nextKey: 'loop.next.yourTwin',
    door: { view: 'voice', labelKey: 'loop.tsuku.door' },
  },
}

function AgentDisc({ m, size, selected }) {
  const [imgOk, setImgOk] = useState(true)
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {selected && (
        <>
          <span aria-hidden="true" className="loop-sonar absolute inset-0 rounded-full pointer-events-none" style={{ border: `2px solid ${m.color}` }} />
          <span aria-hidden="true" className="loop-sonar-late absolute inset-0 rounded-full pointer-events-none" style={{ border: `2px solid ${m.color}` }} />
        </>
      )}
      <span
        aria-hidden="true"
        className="relative rounded-full flex items-center justify-center w-full h-full transition-all duration-300"
        style={{
          border: `3px solid ${m.color}`,
          background: selected ? `${m.color}1f` : 'rgba(255,255,255,0.04)',
          boxShadow: selected ? `0 0 0 3px #151129, 0 0 0 5.5px ${m.color}` : 'none',
          transform: selected ? 'scale(1.07)' : 'scale(1)',
        }}
      >
        {imgOk ? (
          <img
            src={`/fleet/${m.id}.png`}
            alt=""
            draggable="false"
            onError={() => setImgOk(false)}
            className={selected ? 'mascot-bob' : undefined}
            style={{ width: size * 0.86, height: size * 0.86, objectFit: 'contain' }}
          />
        ) : (
          <span className="font-bold" style={{ color: m.color, fontSize: size * 0.42 }}>{m.kanji}</span>
        )}
      </span>
    </span>
  )
}

export default function GrowthLoop({ setActive }) {
  const { user } = useAuth()
  const { t } = useLanguage()
  // Accordion state (Landry, 2026-11-08): the page opens on the
  // SIMPLE view — no agent pre-opened. Tapping a station opens
  // its handoff UNDER that station; tapping it again, tapping
  // another station, or tapping anywhere outside collapses it
  // back to the simple view.
  const [selected, setSelected] = useState(null)

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
    tr: t,
  })
  const centre = loopCentre(twin)
  const week = weekStrip(metrics)
  const hasAnyData = centre.queueTotal > 0 || week.hasData || LOOP_ORDER.some((id) => stats[id].stat)

  return (
    <div className="space-y-6 max-w-4xl mx-auto" onClick={() => setSelected(null)}>
      <p className="text-[15px] leading-relaxed text-slate-300">
        {t('loop.header.intro')}
      </p>

      {!hasAnyData && (
        <section className="rounded-3xl bg-[#151129] border border-white/5 p-5 space-y-2">
          <h3 className="text-base font-semibold text-white">{t('loop.empty.title', { brand: brand.name })}</h3>
          <p className="text-sm text-slate-300">
            {t('loop.empty.body')}
          </p>
          <button
            onClick={() => setActive?.('session')}
            className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold inline-flex items-center gap-1"
          >
            {t('loop.empty.start')} <ChevronRight size={14} />
          </button>
        </section>
      )}

      {/* ——— The route ———
          The loop is a ROUTE, not a ring (Landry, 2026-11-08: the
          circle "does not display well" — on a phone the ring
          crushed six nodes, their stat pills and the centre stack
          into each other). Drawn like a line map: your Twin is the
          home station at the top, the six agents are stations down
          the line in cycle order, and the return strip at the
          bottom closes the loop. Normal flow only — nothing can
          overlap at any width. */}
      <section className="rounded-3xl bg-[#151129] border border-white/5 px-4 py-5 sm:px-6">
        {/* Home station — your Twin, the flywheel. */}
        <div className="flex items-center gap-3.5">
          <span aria-hidden="true" className="w-14 h-14 rounded-full flex items-center justify-center shrink-0" style={{ border: '3px solid #71368A', background: 'rgba(113,54,138,0.12)' }}>
            <Layers size={22} className="text-[#C39BD3]" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{t('loop.centre.twin')}</p>
            <p className="text-[13px] text-slate-300 mt-0.5">{t('loop.centre.words')}</p>
            {centre.queueTotal > 0 && (
              <p className="text-[11px] text-slate-400">{t('loop.centre.breakdown', { graduated: centre.graduated, fresh: centre.fresh })}</p>
            )}
            {est.band && (
              <p className="text-[11px]">
                <span className="text-[#FF8A75] font-medium">{t('loop.centre.workingLevel', { band: est.band })}</span>
                <span className="text-slate-500"> {t('loop.centre.estimate')}</span>
              </p>
            )}
          </div>
          <p className="text-[40px] leading-none font-bold text-white shrink-0">{centre.queueTotal}</p>
        </div>

        <div className="w-14 flex justify-center py-1" aria-hidden="true"><ChevronDown size={14} className="text-slate-600" /></div>

        {/* The stations, in cycle order, on one spine. */}
        <div className="relative">
          <div aria-hidden="true" className="absolute left-[27px] top-7 bottom-7 w-[2px] bg-white/[0.08]" />
          {LOOP_ORDER.map((id) => {
            const m = mascotById(id)
            const st = stats[id]
            const h = HANDOFFS[id]
            const isSel = selected === id
            return (
              <div key={id} className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setSelected(isSel ? null : id) }}
                  aria-expanded={isSel}
                  className="relative w-full flex items-center gap-3.5 py-2.5 px-2 -mx-2 rounded-2xl text-left focus:outline-none"
                  style={isSel ? { background: `${m.color}0d` } : undefined}
                >
                  <span className="relative z-10 rounded-full bg-[#151129] shrink-0">
                    <AgentDisc m={m} size={56} selected={isSel} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-semibold text-white leading-tight">
                      {m.name} <span style={{ color: m.color }}>{m.kanji}</span>
                      <span className="text-xs font-medium text-slate-400"> · {m.roleKey ? t(m.roleKey) : m.role}</span>
                    </span>
                    {st.stat
                      ? <span className="block text-[13px] font-medium mt-0.5" style={{ color: m.color }}>{st.stat}</span>
                      : <span className="block text-[13px] text-slate-400 mt-0.5">{m.jobKey ? t(m.jobKey) : m.job}</span>}
                  </span>
                  <ChevronDown size={15} className={`text-slate-500 shrink-0 transition-transform duration-300 ${isSel ? 'rotate-180' : ''}`} />
                </button>
                {isSel && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="ml-[70px] mr-1 mb-2.5 rounded-2xl px-4 py-3.5 space-y-2.5 loop-unfold"
                    style={{ background: `${m.color}0d`, border: `1px solid ${m.color}26` }}
                  >
                    <div className="space-y-1.5 text-sm">
                      <p className="text-slate-300">
                        <span className="text-slate-500 font-medium">{t('loop.handoff.gets')} </span>{t(h.getsKey)}
                      </p>
                      <p className="text-slate-300 flex items-start gap-1.5">
                        <ArrowRight size={15} className="mt-0.5 shrink-0" style={{ color: m.color }} />
                        <span><span className="text-slate-500 font-medium">{t('loop.handoff.handsTo', { next: h.nextKey ? t(h.nextKey) : h.next })} </span>{t(h.handsKey)}</span>
                      </p>
                    </div>
                    {(st.stat || st.detail) && (
                      <div className="rounded-xl px-3.5 py-2.5 bg-white/[0.03] border border-white/5">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{t('loop.handoff.inYourLoop')}</p>
                        {st.stat && <p className="text-[15px] font-semibold text-white mt-1">{st.stat}</p>}
                        {st.detail && <p className="text-sm text-slate-300 mt-0.5">{st.detail}</p>}
                      </div>
                    )}
                    <button
                      onClick={() => setActive?.(h.door.view)}
                      className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium inline-flex items-center gap-1.5"
                    >
                      {t(h.door.labelKey)} <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* The return leg — the loop closes. */}
        <div className="mt-3 flex items-center gap-2.5 rounded-2xl bg-white/[0.04] px-4 py-3">
          <RotateCcw size={15} className="text-[#FF8A75] shrink-0" />
          <p className="text-xs text-slate-300">{t('loop.route.return')}</p>
        </div>
        <p className="text-center text-xs text-slate-500 mt-4">{t('loop.diagram.tap')}</p>
      </section>

      {/* ——— Your Japanese this week ——— */}
      <section className="rounded-3xl bg-[#151129] border border-white/5 p-5 space-y-3">
        <h3 className="text-base font-semibold text-white">{t('loop.week.title')}</h3>
        {week.hasData ? (
          <div className="grid grid-cols-3 gap-3">
            {week.tiles.map((tile) => (
              <div key={tile.id} className="rounded-2xl bg-white/[0.04] px-3 py-3.5 text-center">
                <p className="text-2xl font-bold text-white">{tile.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{tile.labelKey ? t(tile.labelKey) : tile.label}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            {t('loop.week.empty')}
          </p>
        )}
        <p className="text-xs text-slate-500">
          {t('loop.week.footer')}
          {user ? '' : ` ${t('loop.week.footerGuest')}`}
        </p>
      </section>
    </div>
  )
}
