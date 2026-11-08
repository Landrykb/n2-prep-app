import { useState } from 'react'
import { X, CheckCircle2, Circle, Lock, Compass, Target, HeartPulse } from 'lucide-react'
import { PERSONAS, PAINS, PROOF_TARGETS, saveProfile, ladderWithStatus, drySpellDays, PROOF_LADDER } from '../lib/profile.js'
import { loadMetrics } from '../lib/metrics.js'
import { saveDeclaredLevel } from '../lib/learnerState.js'
import { BANDS } from '../lib/readerFit.js'
import { useLanguage } from '../hooks/useLanguage.js'

// "Start with your problem" onboarding — three questions, saved to
// localStorage (jpn:profile:v1), dismissible, re-openable from Today.
// First run does not end at the save (audit P0-2): the form hands off
// to the ONE next step — the checkup — with the level declaration as
// the skip path, so a new learner is never left standing on Today
// wondering where the plan went. Editing an existing problem keeps
// the old behaviour: save and close.
export function OnboardingFlow({ initial, onDone, onClose, setActive }) {
  const { t } = useLanguage()
  const [persona, setPersona] = useState(initial?.persona || '')
  const [pains, setPains] = useState(initial?.pains || [])
  const [proofTarget, setProofTarget] = useState(initial?.proofTarget || '')
  const [realLifeGoal, setRealLifeGoal] = useState(initial?.realLifeGoal || '')
  const [savedProfile, setSavedProfile] = useState(null) // first-run handoff panel

  const togglePain = (id) => setPains((cur) => (cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]))
  const complete = persona && pains.length && proofTarget

  const finish = () => {
    const profile = { persona, pains, proofTarget, realLifeGoal }
    saveProfile(profile)
    if (initial) { onDone?.(profile); return } // editing: save + close, as before
    setSavedProfile(profile) // first run: hand off, don't just close
  }

  const handoff = (view) => {
    onDone?.(savedProfile)
    setActive?.(view)
  }

  if (savedProfile) {
    return (
      <div className="rounded-3xl glass p-6 sm:p-8 card-glow space-y-5 border border-[#FF6B57]/25">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#FF8A75] mb-1"><Compass size={14} /> {t('problem.eyebrow')}</p>
          <h2 className="text-2xl font-bold text-white">{t('problem.nextTitle')}</h2>
        </div>
        <button onClick={() => handoff('diagnosis')} className="w-full px-6 py-3.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-semibold text-sm transition">
          {t('twin.level.takeCheckup')}
        </button>
        <div className="space-y-2">
          <p className="text-sm text-slate-300">{t('problem.nextLevelLine')}</p>
          <div className="flex flex-wrap gap-2">
            {[...BANDS, 'N7'].map((b) => (
              <button key={b} onClick={() => { saveDeclaredLevel(b); handoff('session') }} className="px-3 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-semibold">
                {b === 'N7' ? 'N7+' : b}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => handoff('session')} className="text-xs text-slate-400 hover:text-slate-200 transition">
          {t('problem.nextSkip')}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-3xl glass p-6 sm:p-8 card-glow space-y-7 border border-[#FF6B57]/25">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#FF8A75] mb-1"><Compass size={14} /> {t('problem.eyebrow')}</p>
          <h2 className="text-2xl font-bold text-white">{t('problem.title')}</h2>
          <p className="text-sm text-slate-400 mt-1">{t('problem.subtitle')}</p>
        </div>
        {onClose && <button onClick={onClose} className="p-2 rounded-lg bg-bun-700 text-slate-400 hover:text-white shrink-0" aria-label={t('problem.dismiss')}><X size={16} /></button>}
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-white">{t('problem.q1')}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {PERSONAS.map((p) => (
            <button key={p.id} onClick={() => setPersona(p.id)} className={`text-left rounded-xl border p-3 transition ${persona === p.id ? 'bg-[#FF6B57]/20 border-[#FF6B57]/50' : 'bg-bun-700/40 border-bun-600/30 hover:bg-bun-700/60'}`}>
              <p className="text-sm font-semibold text-white">{t(p.labelKey)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{t(p.descKey)}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-white">{t('problem.q2')} <span className="text-slate-400 font-normal">{t('problem.q2Hint')}</span></h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {PAINS.map((p) => {
            const on = pains.includes(p.id)
            return (
              <button key={p.id} onClick={() => togglePain(p.id)} className={`text-left rounded-xl border p-3 transition ${on ? 'bg-rose-500/10 border-rose-500/40' : 'bg-bun-700/40 border-bun-600/30 hover:bg-bun-700/60'}`}>
                <p className="text-sm font-semibold text-white flex items-center gap-2">{on ? <CheckCircle2 size={15} className="text-rose-300 shrink-0" /> : <Circle size={15} className="text-slate-500 shrink-0" />}{t(p.labelKey)}</p>
                <p className="text-xs text-slate-400 mt-0.5 ml-6">{t(p.descKey)}</p>
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-white">{t('problem.q3')}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {PROOF_TARGETS.map((target) => (
            <button key={target.id} onClick={() => setProofTarget(target.id)} className={`text-left rounded-xl border p-3 transition ${proofTarget === target.id ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-bun-700/40 border-bun-600/30 hover:bg-bun-700/60'}`}>
              <p className="text-sm font-semibold text-white">{t(target.labelKey)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{t(target.descKey)}</p>
            </button>
          ))}
        </div>
        {proofTarget === 'real-life' && (
          <input value={realLifeGoal} onChange={(e) => setRealLifeGoal(e.target.value)} placeholder={t('problem.realLifePlaceholder')}
            className="w-full rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
        )}
      </section>

      <button onClick={finish} disabled={!complete} className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition">
        {t('problem.buildCta')}
      </button>
      {!complete && <p className="text-xs text-slate-500 -mt-4">{t('problem.incompleteHint')}</p>}
    </div>
  )
}

// The Proof Ladder — where you are, the next height, what each height unlocks.
export function ProofLadderView({ diagnosis, profile }) {
  const { t } = useLanguage()
  const [metrics] = useState(() => loadMetrics())
  const ladder = ladderWithStatus(diagnosis, { metrics, now: new Date() })
  const dryDays = drySpellDays(metrics, new Date())
  return (
    <div className="rounded-2xl bg-[#151129] border border-white/5 p-5 space-y-3">
      <h3 className="text-lg font-bold text-white flex items-center gap-2"><Target size={18} className="text-emerald-300" /> {t('problem.ladderTitle')}</h3>
      <p className="text-xs text-slate-400">
        {diagnosis
          ? <>{t('problem.ladderCurrentStart')}<span className="text-white font-semibold">{diagnosis.jlptEstimate}</span>{t('problem.ladderCurrentRest', { language: diagnosis.sections.language, reading: diagnosis.sections.reading, listening: diagnosis.sections.listening, bjt: diagnosis.bjtScore, band: diagnosis.bjtBand })}</>
          : t('problem.ladderNoDiagnosis')}
        {profile?.proofTarget === 'real-life' && profile?.realLifeGoal ? <>{t('problem.ladderNamedHeightStart')}<span className="text-emerald-300">{profile.realLifeGoal}</span>{t('problem.ladderNamedHeightEnd')}</> : null}
      </p>
      <div className="space-y-2">
        {ladder.map((h, idx) => {
          // Tank fill (Landry, 2026-11-08): the rung fills like
          // water to the fraction of its own bar the learner's
          // numbers cover — progress is a level in a tank, not a
          // label that flips. Full tank = reached; the first
          // not-full rung is the next height.
          const pct = Math.round((h.fill || 0) * 100)
          const full = (h.fill || 0) >= 1
          // The water must READ as water (Landry, 2026-11-08:
          // "make it more visible", "like it is full and start
          // spilling into other tanks"): a strong body of colour,
          // a bright waterline, taller waves — and a full tank
          // pours over its rim into the next tank below it.
          const fillBg = h.status === 'reached' ? 'bg-emerald-400/35' : 'bg-sky-400/30'
          const lineBg = h.status === 'reached' ? 'bg-emerald-200/80' : 'bg-sky-200/80'
          const waveFront = h.status === 'reached' ? 'rgba(110,231,183,0.85)' : 'rgba(125,211,252,0.85)'
          const waveBack = h.status === 'reached' ? 'rgba(110,231,183,0.45)' : 'rgba(125,211,252,0.45)'
          const wavePath = 'M0 7 Q15 1 30 7 T60 7 T90 7 T120 7 V12 H0 Z'
          const receives = idx > 0 && (ladder[idx - 1].fill || 0) >= 1
          const spillSolid = h.status === 'reached' ? 'bg-emerald-200' : 'bg-sky-200'
          const spillBody = h.status === 'reached' ? 'bg-emerald-300/50' : 'bg-sky-300/50'
          return (
          <div key={h.id} className="relative">
          <div className={`relative overflow-hidden rounded-xl border min-h-[84px] ${h.status === 'reached' ? 'border-emerald-500/40' : h.status === 'next' ? 'border-[#FF6B57]/40' : h.status === 'covered' ? 'border-sky-300/35' : 'border-bun-600/20 opacity-75'}`}>
            {h.fill > 0 && (
              <div aria-hidden="true" className={`absolute inset-x-0 bottom-0 ${fillBg}`} style={{ height: `${pct}%` }}>
                <div className={`absolute inset-x-0 ${full ? 'top-[10px]' : 'top-0'} h-[2px] ${lineBg}`} />
                <svg className={`tank-wave-b absolute ${full ? 'top-[3px]' : '-top-[8px]'} left-0 block h-[12px] w-[200%]`} viewBox="0 0 120 12" preserveAspectRatio="none"><path d={wavePath} fill={waveBack} /></svg>
                <svg className={`tank-wave-a absolute ${full ? 'top-[1px]' : '-top-[6px]'} left-0 block h-[12px] w-[200%]`} viewBox="0 0 120 12" preserveAspectRatio="none"><path d={wavePath} fill={waveFront} /></svg>
              </div>
            )}
            {receives && !full && (
              <span aria-hidden="true" className={`absolute left-[24px] top-[3px] block h-[6px] w-[14px] rounded-[50%] border-2 ${h.status === 'reached' ? 'border-emerald-200/70' : 'border-sky-200/70'} motion-safe:animate-ping`} />
            )}
            <div className="relative flex items-start gap-3 p-3">
              <span className="mt-0.5 shrink-0">{h.status === 'reached' ? <CheckCircle2 size={17} className="text-emerald-300" /> : h.status === 'covered' ? <CheckCircle2 size={17} className="text-sky-300" /> : h.status === 'next' ? <HeartPulse size={17} className="text-[#FF8A75]" /> : <Lock size={15} className="text-slate-500" />}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white">{h.labelKey ? t(h.labelKey) : h.label} {h.status === 'next' && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-[#FF6B57] text-white align-middle">{t('problem.badgeNext')}</span>}{h.status === 'reached' && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/60 text-emerald-100 align-middle">{t(typeof h.bjtMin === 'number' ? 'problem.badgeProvenBjt' : 'problem.badgeProven')}</span>}{h.status !== 'reached' && h.fill >= 1 && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300 align-middle">{t('problem.badgeUnproven')}</span>}{h.fill > 0 && <span className={`float-right text-base font-extrabold ${h.status === 'reached' ? 'text-emerald-100' : 'text-sky-100'}`}>{pct}%</span>}</p>
                <p className="text-xs text-slate-400">{t('problem.ladderProof', { proof: h.proofKey ? t(h.proofKey) : h.proof })}</p>
                <p className="text-xs text-slate-300">{t('problem.ladderUnlocks', { unlocks: h.unlocksKey ? t(h.unlocksKey) : h.unlocks })}</p>
              </div>
            </div>
          </div>
          {full && idx < ladder.length - 1 && (
            <div aria-hidden="true" className="absolute left-[25px] -bottom-[11px] z-20">
              <div className={`relative h-[11px] w-[8px] rounded-full ${spillBody}`}>
                <span className={`tank-spill-dot absolute left-1/2 top-0 -ml-[2px] block h-[4px] w-[4px] rounded-full ${spillSolid}`} />
                <span className={`tank-spill-dot d2 absolute left-1/2 top-0 -ml-[2px] block h-[4px] w-[4px] rounded-full ${spillSolid}`} />
                <span className={`tank-spill-dot d3 absolute left-1/2 top-0 -ml-[2px] block h-[4px] w-[4px] rounded-full ${spillSolid}`} />
              </div>
            </div>
          )}
          </div>
          )
        })}
      </div>
      {dryDays >= 2 && (
        <p className="text-[11px] text-amber-200/80">{t('problem.ladderDry', { days: dryDays })}</p>
      )}
      <p className="text-[11px] text-slate-500">{t('problem.ladderFooter')}</p>
    </div>
  )
}

export { PROOF_LADDER }
