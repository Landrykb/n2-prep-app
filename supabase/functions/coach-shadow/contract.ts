// Coach contract — the pure, testable core of the coach-shadow edge
// function (Doc 05 §9.1, Phase 3 step 3). Everything here is
// deterministic: request validation, prompt assembly, and the strict
// validation of the model's letter JSON. index.ts is the thin Deno
// shell (env, fetch, HTTP) around this module, so the node test suite
// can pin the contract offline — the same twin discipline as the
// corrector and planner-shadow contracts.
//
// SHADOW MODE: the AI writes a weekly letter for the same learner
// and week as the rules Coach (CoachLetter.jsx generateCoachLetter),
// the client logs the pair + a `coach_shadow` comparison metric, and
// nothing user-visible changes. The rules letter remains the only
// letter the user ever sees. The function holds no state and writes
// nothing.
//
// THE STRICT CONTRACT — an AI letter is discarded whole when ANY of
// these fail (Doc 05 §9: "if a number isn't in the payload, it may
// not appear in the letter"):
//   1. Shape: the letter carries the rules letter's fields with the
//      right types (weekStart, mode, paragraphs[], citedNumbers{}).
//   2. Identity: weekStart and mode EQUAL the rules letter's (and
//      the facts'). The mode is the deterministic spine's — the AI
//      writes inside it, never over it.
//   3. Numbers: every numeral in the letter's text exists in the
//      posted facts (weekFacts + twinSummary — numeric values and
//      numerals inside their strings, absolute values included; the
//      /180 diagnosis scale counts as a fact when a diagnosis delta
//      is present, because the rules letter itself cites it). A
//      letter inventing "12 sessions" when the facts say 5 is
//      discarded whole. citedNumbers keys must be a subset of the
//      rules letter's, with equal values.
//   4. No promise/guarantee language (PROMISE_BLOCKLIST below).
//   5. No punishment/shame language (SHAME_BLOCKLIST below) — the
//      product's no-shame rule (Doc 05 §1, Doc 06 §2), enforced in
//      code on the AI's prose just as it is on ours.
//   6. Mode not contradicted (approximation, stated honestly): when
//      the facts' mode is badweek or slump, the letter may not
//      contain 'surge' or 'intensive' anywhere. This is a word-level
//      proxy for "do not propose surge behaviour in a bad week" —
//      it cannot read intent (a sentence saying "no surge this
//      week" also fails), and the eval gate (Doc 08 §4.2) treats it
//      as such: a cheap hard floor, not a judgement.
// Display facts (modeLabel, generatedAt, source) are stamped by
// CODE, never trusted from the model.

// The adaptation modes (code ids from src/lib/modes.js MODES — the
// test suite pins this list against it; Doc 05 §7).
export const COACH_MODES: string[] = ['surge', 'cruise', 'slump', 'badweek', 'event']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Hard language prohibitions (Doc 05 §9.1). Case-insensitive
// substring matches over the letter's paragraphs. '保証' covers
// 合格保証 as a substring; both are listed because the list is the
// documentation a reviewer reads.
export const PROMISE_BLOCKLIST: string[] = [
  'guarantee',
  'guaranteed',
  'will pass',
  '合格保証',
  '保証',
]

// The no-shame rule as a word list: the letter may never call the
// learner lazy, say they failed anyone, or reach for disappointment
// or shame as motivation. 'failed you' is the phrase form — bare
// 'failed' is legitimate ("a drill that failed"), the accusation is
// not.
export const SHAME_BLOCKLIST: string[] = [
  'lazy',
  'failed you',
  'disappointed',
  'shame',
]

const QUIET_MODES: string[] = ['badweek', 'slump']
export const MODE_CONTRADICTION_WORDS: string[] = ['surge', 'intensive']

// ------------------------------------------------------------- types
export interface WeekFacts {
  weekStart: string
  mode: string
  modeLabel: string
  sessionCount: number
  minutes: number
  proof: number
  callsKept: number
  callsTotal: number
  diagnosis: {
    totalDelta: number
    toTotal: number
    sections: Record<string, number>
  } | null
  topPattern: { id: string; label: string; plain: string; count: number } | null
  learningStyleNote: string | null
  citedNumbers: Record<string, number>
}

export interface CoachLetterLike {
  weekStart: string
  generatedAt?: string
  mode: string
  modeLabel: string
  paragraphs: string[]
  citedNumbers: Record<string, number>
  source?: string
  [key: string]: unknown
}

export interface CoachRequest {
  twinSummary: Record<string, unknown>
  weekFacts: WeekFacts
  rulesLetter: CoachLetterLike
}

// ------------------------------------------------------------ helpers
function isMode(value: unknown): value is string {
  return typeof value === 'string' && COACH_MODES.includes(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function cleanCitedNumbers(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!isFiniteNumber(v)) return null
    out[k] = v
  }
  return out
}

function cleanParagraphs(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null
  const out: string[] = []
  for (const p of value) {
    if (typeof p !== 'string' || !p.trim() || p.length > 2000) return null
    out.push(p)
  }
  return out
}

function cleanLetterShape(value: unknown, requireModeLabel = true): CoachLetterLike | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const l = value as Record<string, unknown>
  if (typeof l.weekStart !== 'string' || !DATE_RE.test(l.weekStart)) return null
  if (!isMode(l.mode)) return null
  // modeLabel is code-stamped on the way out (never trusted from the
  // model), so the model's own output need not carry it; the rules
  // letter in a request always does.
  if (l.modeLabel !== undefined && typeof l.modeLabel !== 'string') return null
  if (requireModeLabel && !l.modeLabel) return null
  const paragraphs = cleanParagraphs(l.paragraphs)
  if (!paragraphs) return null
  const citedNumbers = cleanCitedNumbers(l.citedNumbers)
  if (!citedNumbers) return null
  return {
    ...(l as CoachLetterLike),
    weekStart: l.weekStart,
    mode: l.mode,
    modeLabel: (l.modeLabel as string) || '',
    paragraphs,
    citedNumbers,
  }
}

function cleanWeekFacts(value: unknown): WeekFacts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const f = value as Record<string, unknown>
  if (typeof f.weekStart !== 'string' || !DATE_RE.test(f.weekStart)) return null
  if (!isMode(f.mode)) return null
  if (typeof f.modeLabel !== 'string' || !f.modeLabel) return null
  for (const k of ['sessionCount', 'minutes', 'proof', 'callsKept', 'callsTotal']) {
    if (!isFiniteNumber(f[k]) || (f[k] as number) < 0) return null
  }
  let diagnosis: WeekFacts['diagnosis'] = null
  if (f.diagnosis !== null && f.diagnosis !== undefined) {
    const d = f.diagnosis as Record<string, unknown>
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null
    if (!isFiniteNumber(d.totalDelta) || !isFiniteNumber(d.toTotal)) return null
    if (!d.sections || typeof d.sections !== 'object' || Array.isArray(d.sections)) return null
    const sections: Record<string, number> = {}
    for (const [k, v] of Object.entries(d.sections as Record<string, unknown>)) {
      if (!isFiniteNumber(v)) return null
      sections[k] = v
    }
    diagnosis = { totalDelta: d.totalDelta, toTotal: d.toTotal, sections }
  }
  let topPattern: WeekFacts['topPattern'] = null
  if (f.topPattern !== null && f.topPattern !== undefined) {
    const t = f.topPattern as Record<string, unknown>
    if (!t || typeof t !== 'object' || Array.isArray(t)) return null
    if (typeof t.id !== 'string' || typeof t.label !== 'string' || typeof t.plain !== 'string') return null
    if (!isFiniteNumber(t.count) || t.count < 0) return null
    topPattern = { id: t.id, label: t.label, plain: t.plain, count: t.count }
  }
  if (f.learningStyleNote !== null && f.learningStyleNote !== undefined && typeof f.learningStyleNote !== 'string') return null
  const citedNumbers = cleanCitedNumbers(f.citedNumbers)
  if (!citedNumbers) return null
  return {
    weekStart: f.weekStart,
    mode: f.mode,
    modeLabel: f.modeLabel,
    sessionCount: f.sessionCount as number,
    minutes: f.minutes as number,
    proof: f.proof as number,
    callsKept: f.callsKept as number,
    callsTotal: f.callsTotal as number,
    diagnosis,
    topPattern,
    learningStyleNote: (f.learningStyleNote as string | null) ?? null,
    citedNumbers,
  }
}

// ------------------------------------------------------------ numerals
/**
 * Every numeral in a text, as numbers ('12', '4.1', '1,000' → 12,
 * 4.1, 1000). Mirrored in src/lib/coachShadow.js (the test suite
 * pins the two implementations equal on samples).
 */
export function extractNumerals(text: unknown): number[] {
  if (typeof text !== 'string') return []
  const out: number[] = []
  const re = /\d[\d,]*(?:\.\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[0].replace(/,/g, ''))
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

function collectFactNumbers(value: unknown, into: Set<number>): void {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      into.add(value)
      into.add(Math.abs(value)) // a delta of −3 is written "down 3"
    }
    return
  }
  if (typeof value === 'string') {
    for (const n of extractNumerals(value)) into.add(n)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectFactNumbers(v, into)
    return
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectFactNumbers(v, into)
  }
}

/**
 * The set of numbers the letter is allowed to state: every number
 * anywhere in the week facts or the twin summary (values and string
 * numerals — so "N3" in the level line permits a 3), plus the /180
 * diagnosis scale when a diagnosis delta is present (the rules
 * letter itself cites totals as "x/180"; 180 is a payload fact
 * about the checkup, not an invention).
 */
export function allowedFactNumbers(facts: WeekFacts, twinSummary: Record<string, unknown>): Set<number> {
  const into = new Set<number>()
  collectFactNumbers(facts, into)
  collectFactNumbers(twinSummary, into)
  if (facts.diagnosis) into.add(180)
  return into
}

function blockedTerm(text: string, list: string[]): string | null {
  const lower = text.toLowerCase()
  for (const term of list) {
    if (lower.includes(term.toLowerCase())) return term
  }
  return null
}

// ------------------------------------------------------------ request
/**
 * Validate the POST body. twinSummary must be the app's real summary
 * shape (src/lib/twin.js twinSummaryForAi): an object whose mode is
 * a known mode and whose dueCount is a non-negative number (the
 * planner-shadow anchor checks). The facts and the rules letter
 * must agree on weekStart and mode — a trio whose anchors disagree
 * is not shadowable (the client builds all three in one render
 * cycle, so disagreement means something is stale).
 */
export function validateCoachRequest(
  body: unknown,
): { ok: true; value: CoachRequest } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'body_not_object' }
  }
  const b = body as Record<string, unknown>

  const ts = b.twinSummary
  if (!ts || typeof ts !== 'object' || Array.isArray(ts)) return { ok: false, reason: 'twin_summary_invalid' }
  const twinSummary = ts as Record<string, unknown>
  if (!isMode(twinSummary.mode)) return { ok: false, reason: 'twin_mode_invalid' }
  if (!isFiniteNumber(twinSummary.dueCount) || twinSummary.dueCount < 0) {
    return { ok: false, reason: 'twin_summary_invalid' }
  }

  const weekFacts = cleanWeekFacts(b.weekFacts)
  if (!weekFacts) return { ok: false, reason: 'week_facts_invalid' }

  const rulesLetter = cleanLetterShape(b.rulesLetter)
  if (!rulesLetter) return { ok: false, reason: 'rules_letter_invalid' }

  if (rulesLetter.weekStart !== weekFacts.weekStart) return { ok: false, reason: 'week_anchor_mismatch' }
  if (rulesLetter.mode !== weekFacts.mode || twinSummary.mode !== weekFacts.mode) {
    return { ok: false, reason: 'mode_anchor_mismatch' }
  }
  return { ok: true, value: { twinSummary, weekFacts, rulesLetter } }
}

// ------------------------------------------------------------- prompt
// Static-first (Doc 03 §3 rule 2): the system message carries the
// job, the contract, and the global prompt rules, and never changes
// per request; the learner data (facts, twin summary, rules letter)
// rides in the user message, last.
export function buildCoachMessages(req: CoachRequest): { role: string; content: string }[] {
  const system =
    'You are Michi, the Coach — the weekly coach inside Yonde, a Japanese-learning app. ' +
    'A deterministic rule coach has already written this learner\'s weekly letter from the same facts; that letter is the one the learner will see. ' +
    'Your job in this shadow run: write YOUR OWN weekly letter for the same learner and the same week, in exactly the same JSON shape, so the two can be compared. ' +
    'Answer with JSON only, in exactly this shape: ' +
    '{"weekStart": "<the same week start date>", "mode": "<the week\'s mode, unchanged>", ' +
    '"paragraphs": ["<the letter, one string per paragraph>"], ' +
    '"citedNumbers": {"<keys copied from the facts\' citedNumbers, with the same values>": 0}}. ' +
    'Hard rules: state ONLY numbers that appear in the facts you are given — every numeral in your letter is checked against them, and one invented number discards the whole letter. ' +
    'Never promise or guarantee an outcome (no "guarantee", no "will pass", no 保証). ' +
    'Never shame: no calling the learner lazy, no disappointment, no "failed you" — this app has no punishment mechanics and neither does its coach. ' +
    'The mode is decided by code, never by you: carry it exactly and write inside it — a slump or bad-week letter stays small, kind, and re-win shaped, and never proposes surge or intensive work. ' +
    'Be honest, including when the week slid: name what the record shows and what the rescue is. Warmth in tone, zero inflation in facts. ' +
    'Close with the same sign-off shape as a coach\'s letter: a final paragraph signed "— Michi, your coach."'
  const userParts = [
    `Week facts (computed by code from the learner's real record): ${JSON.stringify(req.weekFacts)}`,
    `Twin summary (assembled by code): ${JSON.stringify(req.twinSummary)}`,
    `The rule coach's letter for the same week (the comparison baseline; write your own letter from the facts, in your own words): ${JSON.stringify(req.rulesLetter)}`,
  ]
  return [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n') },
  ]
}

// ------------------------------------------------------------ response
/**
 * The strict output contract. Any violation discards the whole
 * letter ({ ok: false, reason }) — a partially-valid AI letter is
 * not a letter. On success the letter is NORMALISED into the rules
 * letter's full shape: modeLabel is carried from the rules letter,
 * generatedAt is stamped from ctx.nowIso (code's clock, never the
 * model's), and the source is stamped 'ai-shadow-v1'.
 */
export function validateCoachOutput(
  raw: unknown,
  ctx: { rulesLetter: CoachLetterLike; weekFacts: WeekFacts; twinSummary: Record<string, unknown>; nowIso?: string },
): { ok: true; letter: Record<string, unknown> } | { ok: false; reason: string } {
  const { rulesLetter, weekFacts } = ctx
  const letter = cleanLetterShape(raw, false)
  if (!letter) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not_an_object' }
    return { ok: false, reason: 'letter_shape_invalid' }
  }

  if (letter.weekStart !== rulesLetter.weekStart) return { ok: false, reason: 'week_mismatch' }
  if (letter.mode !== rulesLetter.mode || letter.mode !== weekFacts.mode) {
    return { ok: false, reason: 'mode_mismatch' }
  }

  // citedNumbers: a subset of the rules letter's, values equal —
  // the AI echoes the figures it used; it may not mint new ones.
  for (const [k, v] of Object.entries(letter.citedNumbers)) {
    if (!(k in rulesLetter.citedNumbers) || rulesLetter.citedNumbers[k] !== v) {
      return { ok: false, reason: 'cited_numbers_mismatch' }
    }
  }

  const text = letter.paragraphs.join('\n')

  // Every numeral in the prose must exist in the facts (Doc 05 §9).
  const allowed = allowedFactNumbers(weekFacts, ctx.twinSummary)
  for (const p of letter.paragraphs) {
    for (const n of extractNumerals(p)) {
      if (!allowed.has(n)) return { ok: false, reason: 'number_not_in_facts' }
    }
  }

  const promise = blockedTerm(text, PROMISE_BLOCKLIST)
  if (promise) return { ok: false, reason: `promise_language:${promise}` }
  const shame = blockedTerm(text, SHAME_BLOCKLIST)
  if (shame) return { ok: false, reason: `shame_language:${shame}` }

  // Mode contradiction, word-level approximation (see header): in a
  // quiet mode the letter may not reach for surge vocabulary at all.
  if (QUIET_MODES.includes(weekFacts.mode)) {
    const hit = blockedTerm(text, MODE_CONTRADICTION_WORDS)
    if (hit) return { ok: false, reason: `mode_contradiction:${hit}` }
  }

  return {
    ok: true,
    letter: {
      weekStart: letter.weekStart,
      generatedAt: ctx.nowIso ?? null,
      mode: letter.mode,
      modeLabel: rulesLetter.modeLabel,
      paragraphs: letter.paragraphs,
      citedNumbers: letter.citedNumbers,
      source: 'ai-shadow-v1',
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

/** Full model-reply pipeline: raw reply text → validated letter or a named reason. */
export function letterFromModelText(
  text: unknown,
  ctx: { rulesLetter: CoachLetterLike; weekFacts: WeekFacts; twinSummary: Record<string, unknown>; nowIso?: string },
): { ok: true; letter: Record<string, unknown> } | { ok: false; reason: string } {
  const parsed = parseModelJson(text)
  if (parsed === null) return { ok: false, reason: 'unparseable' }
  return validateCoachOutput(parsed, ctx)
}
