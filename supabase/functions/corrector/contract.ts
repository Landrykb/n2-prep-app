// Corrector contract — the pure, testable core of the corrector edge
// function (Doc 05 §4, Doc 08 §4). Everything here is deterministic:
// the taxonomy, request validation, prompt assembly, and the strict
// validation of the model's JSON answer. index.ts is the thin Deno
// shell (env, fetch, HTTP) around this module, so the node test suite
// can pin the contract offline against the REAL client taxonomy
// (src/lib/twin.js ERROR_PATTERNS) — the same twin discipline as
// reader-bot/fit.ts vs src/lib/readerFit.js.
//
// SHADOW MODE (Phase 3 step 1): this function's classifications are
// compared against the local rule classifier and logged as a metric.
// They change NOTHING user-visible. The rules stay authoritative
// until the Doc 08 §4 gate passes (≥90% overall agreement with the
// gold set AND ≥80% in every category with ≥5 cases, on two
// consecutive live eval runs).

// The fingerprint taxonomy (Doc 05 §2.2) — ids must match
// src/lib/twin.js ERROR_PATTERNS exactly (order included); the
// corrector test suite pins that. The gloss is the prompt-facing
// one-liner for each id (Doc 05 §2.2 wording, condensed).
export const CORRECTOR_TAXONOMY: { id: string; gloss: string }[] = [
  { id: 'particle-ha-ga', gloss: 'は vs が — topic marker vs subject marker chosen wrong' },
  { id: 'particle-ni-de', gloss: 'に vs で — existence/time marker vs action-place marker chosen wrong' },
  { id: 'particle-wo-omission', gloss: 'the object marker を dropped before a verb' },
  { id: 'word-order', gloss: 'pieces in English order; Japanese puts the verb last' },
  { id: 'counter-documents', gloss: 'documents/copies counted with the wrong counter (they take 通 or 枚, never 個)' },
  { id: 'counter-people', gloss: 'people counted with the wrong counter (they take 人, or 名 in polite service Japanese)' },
  { id: 'counter-general', gloss: 'everyday things counted with the wrong counter family (個・つ・本…)' },
  { id: 'verb-form-te', gloss: 'て-form built or used wrong (chains actions, makes requests)' },
  { id: 'verb-form-nai', gloss: 'ない-form built wrong (negatives)' },
  { id: 'past-tense-slip', gloss: 'past tense missed or mis-timed (た-forms)' },
  { id: 'keigo-direction', gloss: 'keigo direction swapped: 尊敬語 (raises the other) used for self, or 謙譲語 (lowers self) used for the other' },
  { id: 'keigo-over-polite', gloss: 'so formal it sounds distant — politeness past what the moment needs' },
  { id: 'keigo-under-polite', gloss: 'plain forms where the setting expects です・ます politeness' },
  { id: 'register-mix', gloss: 'casual and polite styles mixed inside one production' },
  { id: 'listening-numbers-dates', gloss: 'listening: a number, price, time or date was misheard' },
  { id: 'listening-negation', gloss: 'listening: a ない / ません negation was missed, flipping the meaning' },
  { id: 'listening-speed-drop', gloss: 'listening: the sentence moved on before the meaning landed (speed, not knowledge)' },
  { id: 'vocab-near-miss', gloss: 'right idea, wrong word (a close neighbour of the needed word)' },
  { id: 'pronunciation-unintelligible', gloss: 'the speech transcript is unrecoverable — judged from the transcript text only, never from sound' },
]

export const TAXONOMY_IDS: string[] = CORRECTOR_TAXONOMY.map((t) => t.id)

export function isTaxonomyId(value: unknown): value is string {
  return typeof value === 'string' && TAXONOMY_IDS.includes(value)
}

// ------------------------------------------------------------ request
export interface CorrectorRequest {
  production: string
  target: string
  context: string
  ruleCategory: string | null
}

const MAX_TEXT = 2000

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_TEXT ? trimmed : null
}

/**
 * Validate the POST body. context arrives as a string or a small
 * object (scene id / target pattern / missing phrases) and is
 * normalised to one string for the prompt. ruleCategory is the local
 * rules' first pattern for this error, or null — it is a hint the
 * model may overrule, never an answer key.
 */
export function validateCorrectorRequest(
  body: unknown,
): { ok: true; value: CorrectorRequest } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'body_not_object' }
  }
  const b = body as Record<string, unknown>
  const production = cleanText(b.production)
  if (!production) return { ok: false, reason: 'production_missing_or_too_long' }
  let target = ''
  if (b.target !== undefined && b.target !== null && b.target !== '') {
    const t = cleanText(b.target)
    if (!t) return { ok: false, reason: 'target_invalid' }
    target = t
  }
  let context = ''
  if (typeof b.context === 'string') {
    const c = cleanText(b.context)
    if (b.context.trim() && !c) return { ok: false, reason: 'context_invalid' }
    context = c ?? ''
  } else if (b.context && typeof b.context === 'object' && !Array.isArray(b.context)) {
    const serialised = JSON.stringify(b.context)
    if (serialised.length > MAX_TEXT) return { ok: false, reason: 'context_invalid' }
    context = serialised
  } else if (b.context !== undefined && b.context !== null && b.context !== '') {
    return { ok: false, reason: 'context_invalid' }
  }
  let ruleCategory: string | null = null
  if (b.ruleCategory !== undefined && b.ruleCategory !== null && b.ruleCategory !== '') {
    if (!isTaxonomyId(b.ruleCategory)) return { ok: false, reason: 'rule_category_not_in_taxonomy' }
    ruleCategory = b.ruleCategory
  }
  return { ok: true, value: { production, target, context, ruleCategory } }
}

// ------------------------------------------------------------- prompt
// Static-first (Doc 03 §3 rule 2): the system message carries the
// taxonomy + the global prompt rules (Doc 05 §2.3) and never changes
// per request, so provider prompt caching can hold it; the learner
// data rides in the user message, last.
export function buildCorrectorMessages(req: CorrectorRequest): { role: string; content: string }[] {
  const taxonomyLines = CORRECTOR_TAXONOMY.map((t) => `- ${t.id}: ${t.gloss}`).join('\n')
  const system =
    'You are Nao, the Fixer — the error corrector inside Yonde, a Japanese-learning app. ' +
    'A learner produced Japanese in a practice scene. Classify the SINGLE most valuable error ' +
    'in their production into exactly one category from this fixed taxonomy:\n' +
    taxonomyLines +
    '\nRules: answer with JSON only, in exactly this shape: ' +
    '{"category": "<one taxonomy id>", "correction": "<the corrected Japanese sentence>", "note": "<one short plain-English note naming the fix, at most 25 words>"}. ' +
    'One fix only — the most valuable one; park the rest silently. Plain language: if the note uses a Japanese grammar term, give its reading or a plain-English equivalent in the same breath. ' +
    'Never state a score, level, date, or pass mark — numbers come from code, not from you. ' +
    'Never judge pronunciation or sounds; judge only the text you are given. ' +
    'If the production has no clear error, still pick the closest category and let the note say the line is nearly there.'
  const userParts = [
    `Learner's production: ${req.production}`,
    req.target ? `Target (the model line for the scene): ${req.target}` : 'Target: (not provided)',
    req.context ? `Context: ${req.context}` : 'Context: (not provided)',
    req.ruleCategory
      ? `The app's local rule classifier guessed: ${req.ruleCategory}. It is a heuristic guess and may be wrong — overrule it when the production says otherwise.`
      : 'The app\'s local rule classifier made no guess for this one.',
  ]
  return [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n') },
  ]
}

// ------------------------------------------------------------ response
export interface CorrectorResult {
  category: string
  correction: string
  note: string
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

/**
 * The strict output contract (Doc 05 §2.3 rule 6: output = the job's
 * JSON schema or nothing). A category outside the taxonomy, an empty
 * correction, or an over-long field discards the whole answer.
 */
export function validateCorrectorOutput(
  raw: unknown,
): { ok: true; value: CorrectorResult } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'not_an_object' }
  }
  const r = raw as Record<string, unknown>
  if (!isTaxonomyId(r.category)) return { ok: false, reason: 'category_not_in_taxonomy' }
  if (typeof r.correction !== 'string' || !r.correction.trim() || r.correction.length > 1000) {
    return { ok: false, reason: 'correction_invalid' }
  }
  if (typeof r.note !== 'string' || !r.note.trim() || r.note.length > 500) {
    return { ok: false, reason: 'note_invalid' }
  }
  return {
    ok: true,
    value: { category: r.category, correction: r.correction.trim(), note: r.note.trim() },
  }
}

/** Full model-reply pipeline: raw reply text → validated result or a named reason. */
export function resultFromModelText(
  text: unknown,
): { ok: true; value: CorrectorResult } | { ok: false; reason: string } {
  const parsed = parseModelJson(text)
  if (parsed === null) return { ok: false, reason: 'unparseable' }
  return validateCorrectorOutput(parsed)
}
