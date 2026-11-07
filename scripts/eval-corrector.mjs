// Corrector eval runner (Doc 08 §4 — the AI eval gate for Nao).
//
//   npm run eval:corrector            rules mode (offline, default)
//   CORRECTOR_EVAL_LIVE=1 npm run eval:corrector
//                                     live mode: POSTs every gold case
//                                     to the deployed corrector function
//                                     and scores the AI's categories.
//
// Rules mode runs the app's REAL rule classifiers (src/lib/twin.js)
// over the gold set and reports per-category agreement + every miss.
// Misses are EXPECTED — the rules are a heuristic over scene metadata
// (they structurally cannot see e.g. keigo-over-polite, which has no
// signal path in classifyVoiceError). The rules-mode score is the
// baseline the AI is shadow-compared against, not a ship gate.
//
// Live mode is the promotion gate (Doc 08 §4): the AI takes the
// Corrector job only when agreement with the gold set is ≥90% overall
// AND ≥80% in every category with ≥5 cases, on TWO CONSECUTIVE live
// runs. This runner reports one run's verdict; the two-run rule is
// checked against the previous run's printed verdict by the human
// running it. Live mode needs env: CORRECTOR_FUNCTION_URL (the
// deployed function endpoint), CORRECTOR_EVAL_APIKEY (the project
// anon key), CORRECTOR_EVAL_JWT (a signed-in user's access token —
// the function deploys with verify_jwt=true).

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const EVALSET_PATH = join(here, '..', 'supabase', 'functions', 'corrector', 'evalset.json')

export function loadEvalSet(path = EVALSET_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const twin = await import('../src/lib/twin.js')

/**
 * The rule classifier's answer for one gold case, routed by kind the
 * same way production routes it: voice attempts → classifyVoiceError
 * over the scene signals, listening misses → classifyListeningMiss
 * over the heard script, queue lapses → classifyQueueLapse over the
 * card. Returns 0–2 pattern ids (the classifiers' real contract).
 */
export function ruleClassify(evalCase) {
  const r = evalCase.rules || {}
  if (evalCase.kind === 'listening') {
    return twin.classifyListeningMiss(r.script || '')
  }
  if (evalCase.kind === 'queue') {
    return twin.classifyQueueLapse({ front: r.front || '', note: r.note || '', back: r.back || '' })
  }
  return twin.classifyVoiceError({
    scene: {
      model: r.model || evalCase.target || '',
      targetPattern: r.targetPattern || '',
      commonError: r.commonError || '',
      keigoNote: r.keigoNote || '',
      for: r.forTags || [],
      domain: r.domain || '',
    },
    text: evalCase.production || '',
    missing: r.missing || [],
    score: typeof r.score === 'number' ? r.score : 50,
  })
}

/** Score a classify function over the gold set (agreement = expected id in the answer set). */
export function scoreOver(evalSet, classify) {
  const perCategory = {}
  const misses = []
  let agree = 0
  for (const c of evalSet.cases) {
    const got = classify(c) || []
    const hit = got.includes(c.category)
    const row = perCategory[c.category] || { total: 0, agree: 0 }
    row.total += 1
    if (hit) { row.agree += 1; agree += 1 } else misses.push({ id: c.id, category: c.category, got })
    perCategory[c.category] = row
  }
  return { total: evalSet.cases.length, agree, perCategory, misses }
}

export function printReport(title, scored) {
  console.log(`\n${title}`)
  console.log(`overall: ${scored.agree}/${scored.total} (${Math.round((scored.agree / scored.total) * 100)}%)`)
  for (const [cat, row] of Object.entries(scored.perCategory).sort()) {
    console.log(`  ${cat.padEnd(28)} ${row.agree}/${row.total}`)
  }
  if (scored.misses.length) {
    console.log('misses (expected — the gate exists because the incumbent misses):')
    for (const m of scored.misses) {
      console.log(`  ${m.id} expected ${m.category}, got [${m.got.join(', ') || '—'}]`)
    }
  }
  return scored
}

/** The Doc 08 §4 promotion gate, evaluated on ONE live run. */
export function gateVerdict(scored) {
  const overall = scored.agree / scored.total
  const weak = Object.entries(scored.perCategory)
    .filter(([, row]) => row.total >= 5 && row.agree / row.total < 0.8)
    .map(([cat]) => cat)
  const pass = overall >= 0.9 && weak.length === 0
  return { pass, overall, weak }
}

async function runLive(evalSet) {
  const url = process.env.CORRECTOR_FUNCTION_URL
  const apikey = process.env.CORRECTOR_EVAL_APIKEY
  const jwt = process.env.CORRECTOR_EVAL_JWT
  if (!url || !apikey || !jwt) {
    console.error(
      'Live mode needs CORRECTOR_FUNCTION_URL, CORRECTOR_EVAL_APIKEY and CORRECTOR_EVAL_JWT ' +
      '(the deployed corrector endpoint + anon key + a signed-in user token). Nothing was called.',
    )
    process.exit(2)
  }
  const answers = new Map()
  for (const c of evalSet.cases) {
    const ruleCategory = ruleClassify(c)[0] ?? null
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey, Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ production: c.production, target: c.target, context: c.context, ruleCategory }),
    })
    const data = await res.json().catch(() => null)
    answers.set(c.id, res.ok && data?.ok && typeof data.category === 'string' ? [data.category] : [])
  }
  const scored = scoreOver(evalSet, (c) => answers.get(c.id) || [])
  printReport('Corrector eval — LIVE (AI classifier vs gold set)', scored)
  const verdict = gateVerdict(scored)
  console.log(
    verdict.pass
      ? 'gate: PASS for this run — promotion needs TWO consecutive passing runs (Doc 08 §4).'
      : `gate: FAIL (overall ${Math.round(verdict.overall * 100)}%${verdict.weak.length ? `; weak categories: ${verdict.weak.join(', ')}` : ''}) — shadow mode continues.`,
  )
  return scored
}

async function main() {
  const evalSet = loadEvalSet()
  console.log(`Corrector gold set v${evalSet.version}: ${evalSet.cases.length} cases`)
  console.log(`provenance: ${evalSet.provenance}`)
  if (process.env.CORRECTOR_EVAL_LIVE === '1') {
    await runLive(evalSet)
  } else {
    const scored = scoreOver(evalSet, ruleClassify)
    printReport('Corrector eval — RULES mode (local heuristic classifiers vs gold set)', scored)
    console.log('note: rules mode is the offline baseline, not the promotion gate. Live gate: CORRECTOR_EVAL_LIVE=1 (Doc 08 §4).')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
