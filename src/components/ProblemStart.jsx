import { useState } from 'react'
import { X, CheckCircle2, Circle, Lock, Compass, Target, HeartPulse } from 'lucide-react'
import { PERSONAS, PAINS, PROOF_TARGETS, saveProfile, ladderWithStatus, PROOF_LADDER } from '../lib/profile.js'
import { useLanguage } from '../hooks/useLanguage.js'

// "Start with your problem" onboarding — three questions, saved to
// localStorage (jpn:profile:v1), dismissible, re-openable from Today.
export function OnboardingFlow({ initial, onDone, onClose }) {
  const { t } = useLanguage()
  const [persona, setPersona] = useState(initial?.persona || '')
  const [pains, setPains] = useState(initial?.pains || [])
  const [proofTarget, setProofTarget] = useState(initial?.proofTarget || '')
  const [realLifeGoal, setRealLifeGoal] = useState(initial?.realLifeGoal || '')

  const togglePain = (id) => setPains((cur) => (cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]))
  const complete = persona && pains.length && proofTarget

  const finish = () => {
    const profile = { persona, pains, proofTarget, realLifeGoal }
    saveProfile(profile)
    onDone?.(profile)
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
  const ladder = ladderWithStatus(diagnosis)
  return (
    <div className="rounded-2xl glass p-5 card-glow space-y-3">
      <h3 className="text-lg font-bold text-white flex items-center gap-2"><Target size={18} className="text-emerald-300" /> {t('problem.ladderTitle')}</h3>
      <p className="text-xs text-slate-400">
        {diagnosis
          ? <>{t('problem.ladderCurrentStart')}<span className="text-white font-semibold">{diagnosis.jlptEstimate}</span>{t('problem.ladderCurrentRest', { language: diagnosis.sections.language, reading: diagnosis.sections.reading, listening: diagnosis.sections.listening, bjt: diagnosis.bjtScore, band: diagnosis.bjtBand })}</>
          : t('problem.ladderNoDiagnosis')}
        {profile?.proofTarget === 'real-life' && profile?.realLifeGoal ? <>{t('problem.ladderNamedHeightStart')}<span className="text-emerald-300">{profile.realLifeGoal}</span>{t('problem.ladderNamedHeightEnd')}</> : null}
      </p>
      <div className="space-y-2">
        {ladder.map((h) => (
          <div key={h.id} className={`flex items-start gap-3 rounded-xl border p-3 ${h.status === 'reached' ? 'bg-emerald-500/10 border-emerald-500/30' : h.status === 'next' ? 'bg-[#FF6B57]/15 border-[#FF6B57]/40' : 'bg-bun-700/30 border-bun-600/20 opacity-75'}`}>
            <span className="mt-0.5 shrink-0">{h.status === 'reached' ? <CheckCircle2 size={17} className="text-emerald-300" /> : h.status === 'next' ? <HeartPulse size={17} className="text-[#FF8A75]" /> : <Lock size={15} className="text-slate-500" />}</span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">{h.label} {h.status === 'next' && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-[#FF6B57] text-white align-middle">{t('problem.badgeNext')}</span>}{h.status === 'reached' && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/60 text-emerald-100 align-middle">{t('problem.badgeReached')}</span>}</p>
              <p className="text-xs text-slate-400">{t('problem.ladderProof', { proof: h.proof })}</p>
              <p className="text-xs text-slate-300">{t('problem.ladderUnlocks', { unlocks: h.unlocks })}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">{t('problem.ladderFooter')}</p>
    </div>
  )
}

export { PROOF_LADDER }
