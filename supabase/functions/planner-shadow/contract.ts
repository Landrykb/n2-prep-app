// Planner contract — the pure, testable core of the planner-shadow
// edge function (Doc 05 §5.1, Phase 3 step 2). Everything here is
// deterministic: request validation, prompt assembly, and the strict
// validation of the model's plan JSON. index.ts is the thin Deno
// shell (env, fetch, HTTP) around this module, so the node test suite
// can pin the contract offline — the same twin discipline as the
// corrector (contract.ts vs src/lib/twin.js) and reader-bot.
//
// SHADOW MODE: the AI writes a plan for the same learner and day as
// the rules planner, the client logs the pair + a `planner_shadow`
// comparison metric, and nothing user-visible changes. The rules
// plan remains the only plan the user ever sees. The function holds
// no state and writes nothing.
//
// THE STRICT CONTRACT — an AI plan is discarded whole when ANY of
// these fail (Doc 05 §5: "Saki chooses ids from supplied inventories
// only; invented ids fail validation → fallback plan"):
//   1. Shape: the plan carries the rules plan's decision fields
//      (planner.js buildPlan) with the right types.
//   2. References: every id it names — opener scene, cards, listening
//      item, focus pattern — exists in the posted pools.
//   3. Mode: the plan's mode EQUALS the rules plan's mode. The mode
//      is the deterministic spine's (detectMode writes twin.mode;
//      Doc 05 §7) — the AI plans INSIDE the mode, never over it.
//   4. Date: forDate equals the rules plan's forDate.
//   5. Size: total item count within the rules plan's count ±2.
//   6. Bookkeeping consistency: cardBudget === cardIds.length.
//   7. Experiment: experiments are started and measured by code
//      (Doc 05 §5 guardrails). The AI may not start, stop, or alter
//      one — its plan echoes the rules plan's experiment exactly
//      (variable + variant), or null when the rules run none.
// Display text (scene/listening titles, focus label) is resolved
// from the pools by CODE, never trusted from the model (Doc 05 §2.3
// rule 3: facts come from code or not at all).

// The adaptation modes (code ids from src/lib/modes.js MODES — the
// test suite pins this list against it; Doc 05 §7 names them Surge /
// Cruise / Slump / BadWeek / EventApproach).
export const PLAN_MODES: string[] = ['surge', 'cruise', 'slump', 'badweek', 'event']

export const PLAN_ITEM_TOLERANCE = 2

export interface PoolEntry {
  id: string
  label: string // scene/listening title, card front, or focus label
}

export interface PlannerPools {
  scenes: PoolEntry[]
  cards: PoolEntry[]
  listening: PoolEntry[]
  focus: PoolEntry[]
}

export interface PlanLike {
  forDate: string
  opener: { kind: string; sceneId: string }
  cardIds: string[]
  cardBudget: number
  listeningItemId: string | null
  focusPattern: string | null
  experiment: { variable: string; variant: string; [key: string]: unknown } | null
  mode: string
  [key: string]: unknown
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_POOL = { scenes: 600, cards: 300, listening: 600, focus: 12 }

function isMode(value: unknown): value is string {
  return typeof value === 'string' && PLAN_MODES.includes(value)
}

function cleanPool(value: unknown, cap: number): PoolEntry[] | null {
  if (!Array.isArray(value) || value.length > cap) return null
  const seen = new Set<string>()
  const out: PoolEntry[] = []
  for (const e of value) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null
    const r = e as Record<string, unknown>
    const id = r.id
    const label = r.title ?? r.front ?? r.label
    if (typeof id !== 'string' || !id || typeof label !== 'string') return null
    if (seen.has(id)) return null // a duplicated pool id makes references ambiguous
    seen.add(id)
    out.push({ id, label })
  }
  return out
}

function cleanPlanShape(value: unknown): PlanLike | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const p = value as Record<string, unknown>
  if (typeof p.forDate !== 'string' || !DATE_RE.test(p.forDate)) return null
  const opener = p.opener as Record<string, unknown> | null
  if (!opener || typeof opener !== 'object' || Array.isArray(opener)) return null
  if (opener.kind !== 'scene' || typeof opener.sceneId !== 'string' || !opener.sceneId) return null
  if (!Array.isArray(p.cardIds) || !p.cardIds.every((c) => typeof c === 'string' && c.length > 0)) return null
  if (typeof p.cardBudget !== 'number' || !Number.isFinite(p.cardBudget)) return null
  if (p.listeningItemId !== null && typeof p.listeningItemId !== 'string') return null
  if (p.focusPattern !== null && p.focusPattern !== undefined && typeof p.focusPattern !== 'string') return null
  if (!isMode(p.mode)) return null
  let experiment: PlanLike['experiment'] = null
  if (p.experiment !== null && p.experiment !== undefined) {
    const e = p.experiment as Record<string, unknown>
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null
    if (typeof e.variable !== 'string' || typeof e.variant !== 'string') return null
    // Keep the whole object (the rules experiment also carries id +
    // variantLabel): the AI plan echoes it verbatim, and the echo is
    // compared on variable + variant only.
    experiment = { ...e, variable: e.variable, variant: e.variant }
  }
  return {
    ...(p as PlanLike),
    forDate: p.forDate,
    opener: { kind: 'scene', sceneId: opener.sceneId },
    cardIds: [...(p.cardIds as string[])],
    cardBudget: p.cardBudget,
    listeningItemId: (p.listeningItemId as string | null) ?? null,
    focusPattern: (p.focusPattern as string | null) ?? null,
    experiment,
    mode: p.mode,
  }
}

// ------------------------------------------------------------ request
export interface PlannerRequest {
  twinSummary: Record<string, unknown>
  rulesPlan: PlanLike
  pools: PlannerPools
}

/**
 * Validate the POST body. twinSummary must be the app's real summary
 * shape (src/lib/twin.js twinSummaryForAi): an object whose mode is a
 * known mode and whose dueCount is a non-negative number. The rules
 * plan must carry the buildPlan decision fields, and its mode must
 * agree with the twin summary's — a pair whose two mode anchors
 * disagree is not shadowable (the client builds both from the same
 * refresh cycle, so disagreement means something is stale).
 */
export function validatePlannerRequest(
  body: unknown,
): { ok: true; value: PlannerRequest } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'body_not_object' }
  }
  const b = body as Record<string, unknown>

  const ts = b.twinSummary
  if (!ts || typeof ts !== 'object' || Array.isArray(ts)) return { ok: false, reason: 'twin_summary_invalid' }
  const twinSummary = ts as Record<string, unknown>
  if (!isMode(twinSummary.mode)) return { ok: false, reason: 'twin_mode_invalid' }
  if (typeof twinSummary.dueCount !== 'number' || !Number.isFinite(twinSummary.dueCount) || twinSummary.dueCount < 0) {
    return { ok: false, reason: 'twin_summary_invalid' }
  }
  if (twinSummary.sections !== undefined) {
    const s = twinSummary.sections as Record<string, unknown>
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, reason: 'twin_summary_invalid' }
    for (const v of Object.values(s)) {
      if (v !== null && typeof v !== 'number') return { ok: false, reason: 'twin_summary_invalid' }
    }
  }
  if (twinSummary.topFingerprint !== undefined) {
    if (!Array.isArray(twinSummary.topFingerprint)) return { ok: false, reason: 'twin_summary_invalid' }
    for (const f of twinSummary.topFingerprint) {
      const r = f as Record<string, unknown>
      if (!r || typeof r !== 'object' || typeof r.pattern !== 'string') return { ok: false, reason: 'twin_summary_invalid' }
    }
  }

  const rulesPlan = cleanPlanShape(b.rulesPlan)
  if (!rulesPlan) return { ok: false, reason: 'rules_plan_invalid' }
  if (rulesPlan.mode !== twinSummary.mode) return { ok: false, reason: 'mode_anchor_mismatch' }

  const rawPools = b.pools as Record<string, unknown> | null
  if (!rawPools || typeof rawPools !== 'object' || Array.isArray(rawPools)) {
    return { ok: false, reason: 'pools_invalid' }
  }
  const scenes = cleanPool(rawPools.scenes, MAX_POOL.scenes)
  const cards = cleanPool(rawPools.cards, MAX_POOL.cards)
  const listening = cleanPool(rawPools.listening, MAX_POOL.listening)
  const focus = cleanPool(rawPools.focus, MAX_POOL.focus)
  if (!scenes || !cards || !listening || !focus) return { ok: false, reason: 'pools_invalid' }

  return { ok: true, value: { twinSummary, rulesPlan, pools: { scenes, cards, listening, focus } } }
}

// ------------------------------------------------------------- items
/** Canonical item references for a plan — the unit the shadow metric
 *  and the outcome scorer count. Mirrored in src/lib/plannerShadow.js
 *  (the test suite pins the two implementations equal). */
export function planItemRefs(plan: PlanLike | null | undefined): string[] {
  if (!plan) return []
  const refs: string[] = []
  if (plan.opener?.sceneId) refs.push(`scene:${plan.opener.sceneId}`)
  for (const id of plan.cardIds || []) refs.push(`card:${id}`)
  if (plan.listeningItemId) refs.push(`listening:${plan.listeningItemId}`)
  return refs
}

export function planItemCount(plan: PlanLike | null | undefined): number {
  return planItemRefs(plan).length
}

// ------------------------------------------------------------- prompt
// Static-first (Doc 03 §3 rule 2): the system message carries the
// job, the contract, and the global prompt rules, and never changes
// per request; the learner data (twin summary, pools, rules plan)
// rides in the user message, last.
export function buildPlannerMessages(req: PlannerRequest): { role: string; content: string }[] {
  const rulesCount = planItemCount(req.rulesPlan)
  const system =
    'You are Saki, the Planner — the nightly planner inside Yonde, a Japanese-learning app. ' +
    'A deterministic rule planner has already made tomorrow\'s plan for this learner; that plan is the one the learner will see. ' +
    'Your job in this shadow run: write YOUR OWN plan for the same learner and the same day, in exactly the same JSON shape, so the two can be compared. ' +
    'Answer with JSON only, in exactly this shape: ' +
    '{"forDate": "<the same date>", "opener": {"kind": "scene", "sceneId": "<an id from the scenes inventory>"}, ' +
    '"cardIds": ["<ids from the cards inventory>"], "cardBudget": <must equal the number of cardIds>, ' +
    '"listeningItemId": "<an id from the listening inventory>", "focusPattern": "<an id from the focus inventory, or null>", ' +
    '"experiment": <echo the comparison plan\'s experiment exactly, or null>, "mode": "<the learner\'s current mode, unchanged>", ' +
    '"minutes": <a whole number of minutes the plan should take>, "note": "<one short plain-English sentence on why this mix fits this learner>"}. ' +
    'Hard rules: choose ids ONLY from the inventories you are given — an invented id discards the whole plan. ' +
    'The mode is decided by code, never by you: carry it exactly. The experiment is run by code, never by you: echo it exactly or send null. ' +
    `Keep the total item count (1 scene + cards + 1 listening) within ${PLAN_ITEM_TOLERANCE} of the comparison plan's ${rulesCount} items. ` +
    'Never state a score, level, date, or pass mark that was not in the input. ' +
    'Plan for the learner in the twin summary: lean on their top error patterns and weakest section, respect the mode (a slump or bad-week plan stays small and re-win only; an event plan stays rehearsal).'
  const userParts = [
    `Twin summary (assembled by code): ${JSON.stringify(req.twinSummary)}`,
    `Inventories — scenes: ${JSON.stringify(req.pools.scenes)}`,
    `Inventories — cards: ${JSON.stringify(req.pools.cards)}`,
    `Inventories — listening: ${JSON.stringify(req.pools.listening)}`,
    `Inventories — focus patterns: ${JSON.stringify(req.pools.focus)}`,
    `The rule planner's plan for the same day (the comparison baseline; keep or change its choices, ids only from the inventories): ${JSON.stringify(req.rulesPlan)}`,
  ]
  return [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n') },
  ]
}

// ------------------------------------------------------------ response
/**
 * The strict output contract. Any violation discards the whole plan
 * ({ ok: false, reason }) — a partially-valid AI plan is not a plan.
 * On success the returned plan is NORMALISED into the rules plan's
 * full shape: titles and the focus label are resolved from the pools
 * by code, the experiment and comeback flag are carried from the
 * rules plan (both are code-owned state), and the source is stamped
 * 'ai-shadow-v1' — never presented as anything else. The bookkeeping
 * fields createdAt/consumed are deliberately not carried: the shadow
 * log entry itself is the record.
 */
export function validatePlannerOutput(
  raw: unknown,
  ctx: { rulesPlan: PlanLike; pools: PlannerPools },
): { ok: true; plan: Record<string, unknown> } | { ok: false; reason: string } {
  const { rulesPlan } = ctx
  // Normalise the pools here too (same rule as the request path), so
  // a caller handing over raw {id, title|front|label} entries gets
  // identical behaviour — never silently-undefined titles.
  const nScenes = cleanPool(ctx.pools?.scenes, MAX_POOL.scenes)
  const nCards = cleanPool(ctx.pools?.cards, MAX_POOL.cards)
  const nListening = cleanPool(ctx.pools?.listening, MAX_POOL.listening)
  const nFocus = cleanPool(ctx.pools?.focus, MAX_POOL.focus)
  if (!nScenes || !nCards || !nListening || !nFocus) return { ok: false, reason: 'pools_invalid' }
  const pools: PlannerPools = { scenes: nScenes, cards: nCards, listening: nListening, focus: nFocus }
  const plan = cleanPlanShape(raw)
  if (!plan) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not_an_object' }
    return { ok: false, reason: 'plan_shape_invalid' }
  }
  const r = raw as Record<string, unknown>

  if (plan.forDate !== rulesPlan.forDate) return { ok: false, reason: 'fordate_mismatch' }
  if (plan.mode !== rulesPlan.mode) return { ok: false, reason: 'mode_mismatch' }

  const scene = pools.scenes.find((s) => s.id === plan.opener.sceneId)
  if (!scene) return { ok: false, reason: 'scene_not_in_pool' }

  if (new Set(plan.cardIds).size !== plan.cardIds.length) return { ok: false, reason: 'duplicate_card' }
  const cardIds = new Set(pools.cards.map((c) => c.id))
  if (plan.cardIds.some((id) => !cardIds.has(id))) return { ok: false, reason: 'card_not_in_pool' }
  if (plan.cardBudget !== plan.cardIds.length) return { ok: false, reason: 'cardbudget_mismatch' }

  let listening: PoolEntry | null = null
  if (plan.listeningItemId === null) {
    if (rulesPlan.listeningItemId !== null) return { ok: false, reason: 'listening_not_in_pool' }
  } else {
    listening = pools.listening.find((l) => l.id === plan.listeningItemId) ?? null
    if (!listening) return { ok: false, reason: 'listening_not_in_pool' }
  }

  let focusLabel: string | null = null
  if (plan.focusPattern !== null) {
    const f = pools.focus.find((x) => x.id === plan.focusPattern)
    if (!f) return { ok: false, reason: 'focus_not_in_pool' }
    focusLabel = f.label
  }

  // The experiment is code-run state: echo or nothing.
  if (rulesPlan.experiment === null) {
    if (plan.experiment !== null) return { ok: false, reason: 'experiment_not_allowed' }
  } else if (
    !plan.experiment ||
    plan.experiment.variable !== rulesPlan.experiment.variable ||
    plan.experiment.variant !== rulesPlan.experiment.variant
  ) {
    return { ok: false, reason: 'experiment_mismatch' }
  }

  const count = planItemCount(plan)
  if (Math.abs(count - planItemCount(rulesPlan)) > PLAN_ITEM_TOLERANCE) {
    return { ok: false, reason: 'item_count_out_of_window' }
  }

  if (typeof r.minutes !== 'number' || !Number.isFinite(r.minutes) || r.minutes < 3 || r.minutes > 90) {
    return { ok: false, reason: 'minutes_invalid' }
  }
  let note = ''
  if (r.note !== undefined && r.note !== null && r.note !== '') {
    if (typeof r.note !== 'string' || r.note.length > 500) return { ok: false, reason: 'note_invalid' }
    note = r.note.trim()
  }

  return {
    ok: true,
    plan: {
      forDate: plan.forDate,
      opener: { kind: 'scene', sceneId: plan.opener.sceneId },
      sceneTitle: scene.label,
      cardIds: plan.cardIds,
      cardBudget: plan.cardBudget,
      listeningItemId: plan.listeningItemId,
      listeningTitle: listening ? listening.label : null,
      focusPattern: plan.focusPattern,
      focusLabel,
      experiment: rulesPlan.experiment ?? null,
      mode: plan.mode,
      comeback: Boolean((rulesPlan as Record<string, unknown>).comeback),
      minutes: Math.round(r.minutes),
      source: 'ai-shadow-v1',
      note,
    },
  }
}

/** Strip code fences and parse the model's reply as JSON (null on any failure). */
export function parseModelJson(text: unknown): unknown {
  if (typeof text !== 'string') return null
  const cleaned = text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

/** Full model-reply pipeline: raw reply text → validated plan or a named reason. */
export function planFromModelText(
  text: unknown,
  ctx: { rulesPlan: PlanLike; pools: PlannerPools },
): { ok: true; plan: Record<string, unknown> } | { ok: false; reason: string } {
  const parsed = parseModelJson(text)
  if (parsed === null) return { ok: false, reason: 'unparseable' }
  return validatePlannerOutput(parsed, ctx)
}
