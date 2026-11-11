// The Day-1 Promise: "Your 60-day height".
//
// Computed ONLY from a finished diagnosis (estimated level + the three
// section scores /60), never from hope. The rule, stated exactly as coded:
//
// NEXT-LEVEL height (e.g. diagnosed N3 → "Pass N2 in 60 days") is promised
// only when ALL of these hold — i.e. the diagnosis shows a latent base
// already sitting at the top of the current level:
//   (1) the modelled total is at or above the CURRENT level's pass mark,
//       or within 10 points of it (gapToPass <= 10);
//   (2) NO section is below the 19/60 survival line (no section would
//       fail the current exam on its own);
//   (3) the strongest section is >= 36/60 (there is a real strength to
//       transfer — the resident's latent base);
//   (4) the learner is not already estimated at N1.
// Otherwise the height is a SECTION RESCUE at the same level: bring the
// weakest section from its score to >= 30/60 in practice (safe margin over
// the 19/60 line), reach the level's pass mark + 15 in timed mocks — PLUS
// a real-life height chosen from the learner's profile (a task handled
// alone), because that is provable in 60 days regardless of exam timing.
// At N1 the height is "N1 with margin" (same rescue shape) unless the
// next-level conditions hold, in which case it is the beyond-exam height:
// N1+ professional Japanese / the next BJT band.
//
// Timelines depend on the latent base the diagnosis found — a resident who
// once operated at this level re-climbs faster than a first-time learner,
// and the copy says so. No blanket promises: no diagnosis, no promise.

import { jlptLevel } from './levels.js'
import { emitLearnerStateSaved } from './stateEvents.js'
import { SECTION_KEYS } from './levels.js'

export const PROMISE_KEY = 'jpn:promise:v1'

const ORDER = ['N5', 'N4', 'N3', 'N2', 'N1']
// 400 is the HSP N2-category line (10 pts) and 480 the N1-category line
// (15 pts) — 400 was missing, which made the `next === 400` note in
// bjtSide below unreachable dead code (P2-8).
const BJT_THRESHOLDS = [200, 320, 400, 420, 480, 530, 600]

// I18N ROUND 2: the promise carries ADDITIVE {key, vars} mirrors of every
// composed line (heightKey / reasoningKeys / planKeys / honestyKey). The
// plain-text fields stay byte-identical to the pre-catalogue copy — they
// are the generation-language copy of this stored record, and older stored
// promises (no keys) keep rendering from them. Render surfaces resolve the
// keys at display time in the user's current language. A var value may
// itself be a {key, vars?, lower?} spec (the section labels and the
// real-life height) — resolvePromiseText resolves one level deep.
export function resolvePromiseVars(tr, vars) {
  if (!vars) return vars
  const out = {}
  for (const [k, v] of Object.entries(vars)) {
    if (v && typeof v === 'object' && typeof v.key === 'string') {
      let s = tr(v.key, v.vars)
      if (v.lower && s) s = s.charAt(0).toLowerCase() + s.slice(1)
      out[k] = s
    } else out[k] = v
  }
  return out
}

export function resolvePromiseText(tr, spec, fallback) {
  if (!spec?.key) return fallback
  return tr(spec.key, resolvePromiseVars(tr, spec.vars))
}

// The real-life height as { text, key }: profile.realLifeGoal is the user's
// own text — it never gets a catalog key (key stays null).
function realLifeHeight(profile) {
  if (profile?.realLifeGoal) return { text: profile.realLifeGoal, key: null }
  const pains = profile?.pains || []
  if (pains.includes('life-admin') || profile?.persona === 'parent') return { text: 'Handle one real city-office, hospital or school visit entirely alone — rehearsed here first', key: 'promise.life.cityOffice' }
  if (pains.includes('keigo') || profile?.persona === 'business') return { text: 'Carry your own part of one real work meeting fully in Japanese, keigo included', key: 'promise.life.workMeeting' }
  if (pains.includes('speaking')) return { text: 'Hold a 10-minute unscripted conversation with a Japanese speaker, without switching to English', key: 'promise.life.conversation' }
  if (pains.includes('blocked-job') || profile?.persona === 'job-hunter') return { text: 'Walk into one real job interview and answer in Japanese without a script', key: 'promise.life.jobInterview' }
  return { text: 'Handle one full day of real life — errands, counters, calls — entirely in Japanese', key: 'promise.life.fullDay' }
}

function bjtSide(diagnosis, profile) {
  const wantsBusiness = profile?.proofTarget === 'bjt' || profile?.proofTarget === 'hsp' || profile?.persona === 'business' || (profile?.pains || []).includes('keigo')
  if (!wantsBusiness || !diagnosis?.bjtScore) return null
  const next = BJT_THRESHOLDS.find((t) => t > diagnosis.bjtScore)
  if (!next) return { text: 'Business side: your BJT estimate (~' + diagnosis.bjtScore + ') is already in J1+ territory — the 60 days defend it with timed BJT training.', spec: { key: 'promise.bjt.maxed', vars: { score: diagnosis.bjtScore } } }
  const pts = next === 480 ? ' (the N1-category line for Highly Skilled Professional points, 15 pts)' : next === 400 ? ' (the N2-category line for Highly Skilled Professional points, 10 pts)' : ''
  const noteKey = next === 480 ? 'promise.bjt.noteN1' : next === 400 ? 'promise.bjt.noteN2' : null
  return { text: `Business side: BJT estimate ~${diagnosis.bjtScore} (${diagnosis.bjtBand}) → next line is ${next}${pts}.`, spec: { key: 'promise.bjt.next', vars: { score: diagnosis.bjtScore, band: diagnosis.bjtBand, next, note: noteKey ? { key: noteKey } : '' } } }
}

export function computeSixtyDayPromise(diagnosis, profile) {
  if (!diagnosis?.jlptEstimate || !diagnosis.sections) return null
  const level = jlptLevel(diagnosis.jlptEstimate)
  if (!level || !level.passMark) return null

  const idx = ORDER.indexOf(diagnosis.jlptEstimate)
  const total = diagnosis.total ?? (diagnosis.sections.language + diagnosis.sections.reading + diagnosis.sections.listening)
  const passMark = level.passMark
  const gapToPass = passMark - total
  const sectionEntries = Object.entries(diagnosis.sections)
  const weakestEntry = [...sectionEntries].sort((a, b) => a[1] - b[1])[0]
  const strongest = Math.max(...sectionEntries.map(([, v]) => v))
  const weakestLabel = SECTION_KEYS.find((s) => s.id === weakestEntry[0])?.label || weakestEntry[0]
  const weakestScore = weakestEntry[1]
  const anyBelowLine = sectionEntries.some(([, v]) => v < level.sectionMin)

  const canAdvance = gapToPass <= 10 && !anyBelowLine && strongest >= 36 && idx < ORDER.length - 1

  const reasoning = []
  const plan = []
  // Key mirrors of reasoning/plan (same order), plus the height spec.
  const reasoningKeys = []
  const planKeys = []
  const sectionLabelSpec = { key: `diag.section.${weakestEntry[0]}` }
  let height
  let heightKey = null
  let lifeKey = null
  let kind

  if (canAdvance) {
    const next = ORDER[idx + 1]
    const nextLevel = jlptLevel(next)
    kind = 'next-level'
    height = `Pass ${next} — ${nextLevel.passMark}/180 · every section ≥ ${nextLevel.sectionMin}/60`
    heightKey = { key: 'promise.height.nextLevel', vars: { next, passMark: nextLevel.passMark, sectionMin: nextLevel.sectionMin } }
    reasoning.push(gapToPass <= 0
      ? `Checkup: ${diagnosis.jlptEstimate} at ${total}/180 — already at the ${passMark} pass mark. ${diagnosis.jlptEstimate} is your base, not your ceiling.`
      : `Checkup: ${diagnosis.jlptEstimate} at ${total}/180 — ${gapToPass} points from the ${passMark} pass mark. ${diagnosis.jlptEstimate} is your base, not your ceiling.`)
    reasoningKeys.push(gapToPass <= 0
      ? { key: 'promise.reason.baseAt', vars: { level: diagnosis.jlptEstimate, total, passMark } }
      : { key: 'promise.reason.baseWithin', vars: { level: diagnosis.jlptEstimate, total, passMark, gap: gapToPass } })
    reasoning.push(`No section under the ${level.sectionMin}/60 survival line (weakest: ${weakestLabel} ${weakestScore}/60); strongest is ${strongest}/60 — a base that transfers upward.`)
    reasoningKeys.push({ key: 'promise.reason.strength', vars: { sectionMin: level.sectionMin, weakestLabel: sectionLabelSpec, weakestScore, strongest } })
    reasoning.push(`So the height is the next rung: ${next}. Train at ${next} — and sit the real one only when mocks clear it with margin.`)
    reasoningKeys.push({ key: 'promise.reason.nextRung', vars: { next } })
    plan.push(`Daily · One Session at ${next} — one scene, your cards, one listening bite`)
    planKeys.push({ key: 'promise.plan.dailyNext', vars: { next } })
    plan.push(`Weakest first · ${weakestLabel} (${weakestScore}/60) gets +15 min until it is over 30/60`)
    planKeys.push({ key: 'promise.plan.weakestFirst', vars: { weakestLabel: sectionLabelSpec, weakestScore } })
    plan.push(`Day 30 · 55 · Timed ${next} mocks — book the real one only at ≥ ${nextLevel.passMark + 15}/180, every section ≥ 30/60`)
    planKeys.push({ key: 'promise.plan.mocksNext', vars: { next, target: nextLevel.passMark + 15 } })
  } else {
    kind = idx >= ORDER.length - 1 ? 'n1-margin' : 'rescue'
    const life = realLifeHeight(profile)
    lifeKey = life.key
    const lifeLower = life.text.charAt(0).toLowerCase() + life.text.slice(1)
    const lifeVar = life.key ? { key: life.key, lower: true } : lifeLower
    height = kind === 'n1-margin'
      ? `N1 with margin — mocks at ${passMark + 15}+/180 · plus: ${lifeLower}`
      : `${diagnosis.jlptEstimate} secured — ${passMark}/180 with margin · ${weakestLabel} rescued · plus: ${lifeLower}`
    heightKey = kind === 'n1-margin'
      ? { key: 'promise.height.n1Margin', vars: { target: passMark + 15, life: lifeVar } }
      : { key: 'promise.height.rescue', vars: { level: diagnosis.jlptEstimate, passMark, weakestLabel: sectionLabelSpec, life: lifeVar } }
    if (anyBelowLine) {
      reasoning.push(`Checkup: ${diagnosis.jlptEstimate} at ${total}/180 — but ${weakestLabel} is ${weakestScore}/60, under the ${level.sectionMin}/60 survival line. One section under the line fails the whole exam, so the promise is rescuing it first.`)
      reasoningKeys.push({ key: 'promise.reason.belowLine', vars: { level: diagnosis.jlptEstimate, total, weakestLabel: sectionLabelSpec, weakestScore, sectionMin: level.sectionMin } })
    } else if (gapToPass > 10) {
      reasoning.push(`Checkup: ${total}/180 against a ${passMark} pass mark — a ${gapToPass}-point gap. Sixty days closes it here far more surely than it also buys the next level.`)
      reasoningKeys.push({ key: 'promise.reason.gap', vars: { total, level: diagnosis.jlptEstimate, passMark, gap: gapToPass } })
    } else {
      reasoning.push(`Checkup: ${diagnosis.jlptEstimate} at ${total}/180, weakest ${weakestLabel} ${weakestScore}/60 — no section shows the 36+/60 strength that makes a jump realistic in 60 days. Securing this level is the promise.`)
      reasoningKeys.push({ key: 'promise.reason.noStrength', vars: { level: diagnosis.jlptEstimate, total, weakestLabel: sectionLabelSpec, weakestScore } })
    }
    reasoning.push(`And because exam dates are only twice a year, the height includes one you can prove any week: ${lifeLower}.`)
    reasoningKeys.push({ key: 'promise.reason.lifeProof', vars: { life: lifeVar } })
    plan.push(`Daily · One Session at ${diagnosis.jlptEstimate} — ${weakestLabel} first, until it clears 30/60`)
    planKeys.push({ key: 'promise.plan.dailyRescue', vars: { level: diagnosis.jlptEstimate, weakestLabel: sectionLabelSpec, sectionMin: level.sectionMin } })
    plan.push(`Real life · Rehearse it in the Voice Loop 3× a week — do it for real before Day 60`)
    planKeys.push({ key: 'promise.plan.rehearse', vars: {} })
    plan.push(`Day 30 · 55 · Mocks at ≥ ${passMark + 10}/180, then ≥ ${passMark + 15}/180 with sections ≥ 30/60 — then book, or re-check`)
    planKeys.push({ key: 'promise.plan.mocksRescue', vars: { level: diagnosis.jlptEstimate, target10: passMark + 10, target15: passMark + 15 } })
  }

  const side = bjtSide(diagnosis, profile)
  if (side) { reasoning.push(side.text); reasoningKeys.push(side.spec) }

  return {
    at: new Date().toISOString(),
    diagnosisAt: diagnosis.at || null,
    kind,
    height,
    heightKey,
    lifeKey,
    currentEstimate: diagnosis.jlptEstimate,
    total,
    passMark,
    weakest: weakestEntry[0],
    weakestLabel,
    weakestScore,
    reasoning,
    reasoningKeys,
    plan,
    planKeys,
    honesty: 'Built from the base your diagnosis found — never a fantasy height. It holds if the daily sessions happen; the Day-30 and Day-55 mocks verify it.',
    honestyKey: 'promise.honesty',
  }
}

export function loadPromise() {
  try {
    const raw = localStorage.getItem(PROMISE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function savePromise(promise) {
  if (!promise) return null
  try { localStorage.setItem(PROMISE_KEY, JSON.stringify(promise)); emitLearnerStateSaved() } catch { /* ignore */ }
  return promise
}
