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

function realLifeHeight(profile) {
  if (profile?.realLifeGoal) return profile.realLifeGoal
  const pains = profile?.pains || []
  if (pains.includes('life-admin') || profile?.persona === 'parent') return 'Handle one real city-office, hospital or school visit entirely alone — rehearsed here first'
  if (pains.includes('keigo') || profile?.persona === 'business') return 'Carry your own part of one real work meeting fully in Japanese, keigo included'
  if (pains.includes('speaking')) return 'Hold a 10-minute unscripted conversation with a Japanese speaker, without switching to English'
  if (pains.includes('blocked-job') || profile?.persona === 'job-hunter') return 'Walk into one real job interview and answer in Japanese without a script'
  return 'Handle one full day of real life — errands, counters, calls — entirely in Japanese'
}

function bjtSide(diagnosis, profile) {
  const wantsBusiness = profile?.proofTarget === 'bjt' || profile?.proofTarget === 'hsp' || profile?.persona === 'business' || (profile?.pains || []).includes('keigo')
  if (!wantsBusiness || !diagnosis?.bjtScore) return null
  const next = BJT_THRESHOLDS.find((t) => t > diagnosis.bjtScore)
  if (!next) return 'Business side: your BJT estimate (~' + diagnosis.bjtScore + ') is already in J1+ territory — the 60 days defend it with timed BJT training.'
  const pts = next === 480 ? ' (the N1-category line for Highly Skilled Professional points, 15 pts)' : next === 400 ? ' (the N2-category line for Highly Skilled Professional points, 10 pts)' : ''
  return `Business side: BJT estimate ~${diagnosis.bjtScore} (${diagnosis.bjtBand}) → next line is ${next}${pts}.`
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
  let height
  let kind

  if (canAdvance) {
    const next = ORDER[idx + 1]
    const nextLevel = jlptLevel(next)
    kind = 'next-level'
    height = `Pass ${next} (JLPT ${nextLevel.passMark}/180, every section ≥ ${nextLevel.sectionMin}/60)`
    reasoning.push(`Your checkup estimates you at ${diagnosis.jlptEstimate} with ${total}/180 — ${gapToPass <= 0 ? 'already at/above' : `within ${gapToPass} points of`} the ${diagnosis.jlptEstimate} pass mark (${passMark}), so ${diagnosis.jlptEstimate} is treated as your base, not your ceiling.`)
    reasoning.push(`No section is under the ${level.sectionMin}/60 survival line (weakest: ${weakestLabel} ${weakestScore}/60) and your strongest section is ${strongest}/60 — that strength is a latent base that transfers upward when the input is pitched one level up.`)
    reasoning.push(`So the honest 60-day height is the next rung, ${next} — trained at ${next} for technique, with input from ${next} and above, and sat only when practice mocks clear it with margin.`)
    plan.push(`Daily: the One Session — one scene, your cards, one listening bite, all pitched at ${next}.`)
    plan.push(`Weakest first: ${weakestLabel} (${weakestScore}/60) gets the extra 15 minutes until it is safely over 30/60 in practice.`)
    plan.push(`Day 30 and Day 55: timed ${next} mocks. Day-60 rule: book the real ${next} only if mocks sit ≥ ${nextLevel.passMark + 15}/180 with every section ≥ 30/60 — margin, not luck.`)
  } else {
    kind = idx >= ORDER.length - 1 ? 'n1-margin' : 'rescue'
    const life = realLifeHeight(profile)
    height = kind === 'n1-margin'
      ? `N1 with real margin — mocks at ${passMark + 15}+/180 — plus: ${life.charAt(0).toLowerCase() + life.slice(1)}`
      : `${diagnosis.jlptEstimate} secured — pass mark ${passMark}/180 with margin, ${weakestLabel} rescued — plus: ${life.charAt(0).toLowerCase() + life.slice(1)}`
    if (anyBelowLine) reasoning.push(`Your checkup estimates ${diagnosis.jlptEstimate} at ${total}/180, but ${weakestLabel} is ${weakestScore}/60 — under the ${level.sectionMin}/60 survival line. One section under the line fails the whole exam, so the next level is NOT the honest promise yet; rescuing this section is.`)
    else if (gapToPass > 10) reasoning.push(`Your checkup estimates ${total}/180 against the ${diagnosis.jlptEstimate} pass mark of ${passMark} — a gap of ${gapToPass} points. Sixty days closes that gap at this level far more reliably than it buys the next level as well, so this level, secured with margin, is the honest promise.`)
    else reasoning.push(`Your checkup estimates ${diagnosis.jlptEstimate} at ${total}/180 with ${weakestLabel} weakest at ${weakestScore}/60 and no section showing the 36+/60 latent strength that makes a level jump realistic in 60 days — so this level, secured, is the honest promise.`)
    reasoning.push(`And because exam dates are only twice a year, the height includes one you can prove any week: ${life.charAt(0).toLowerCase() + life.slice(1)}.`)
    plan.push(`Daily: the One Session, pitched at ${diagnosis.jlptEstimate} — with ${weakestLabel} first until it clears 30/60 in practice (safe margin over the ${level.sectionMin}/60 line).`)
    plan.push(`Rehearse the real-life height in the Voice Loop at least 3× per week, then do it for real once before Day 60.`)
    plan.push(`Day 30: timed ${diagnosis.jlptEstimate} mock, target ≥ ${passMark + 10}/180. Day 55: target ≥ ${passMark + 15}/180 with every section ≥ 30/60 — then book, or re-run the diagnosis and let it re-promise honestly.`)
  }

  const side = bjtSide(diagnosis, profile)
  if (side) reasoning.push(side)

  return {
    at: new Date().toISOString(),
    diagnosisAt: diagnosis.at || null,
    kind,
    height,
    currentEstimate: diagnosis.jlptEstimate,
    total,
    passMark,
    weakest: weakestEntry[0],
    weakestLabel,
    weakestScore,
    reasoning,
    plan,
    honesty: 'This height is computed from the latent base your diagnosis actually found — a resident re-climbing a level they once held moves faster than a first-time learner at the same score, and a weaker base gets a rescue height, not a fantasy. Timelines depend on that base and on the daily sessions actually happening; the Day-30/Day-55 mock gates are how we check the promise is on track.',
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
