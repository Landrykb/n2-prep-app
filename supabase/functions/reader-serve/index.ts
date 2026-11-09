import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildKnownSet, countKnownContent, currentBatchWords, deckCreditSet, evaluateDraft, isColdStart, nextForbiddenList, passageRatio, pickGentle, pickPassage, pickStarter, resolveBand, seenKanjiSet, serveBandFor, shouldGenerate } from './fit.ts'
import { DECK_LEVELS } from './deck.ts'
import { DECK_GLOSS } from './gloss.ts'
import { segmentText } from './segment.ts'

// Yonde Reader — web serve (Doc 16 amendment #16).
//
// The Telegram bot (reader-bot) has always had the full serve
// pipeline: bank-first pick against the learner's real known set,
// and fitted generation (R0.5) when the bank fits nothing. The web
// /reader page only ever had the bank half — so a learner whose
// words fit no bank passage got "nothing fits today" in the app
// while the bot would have fitted one on the spot (Landry hit
// exactly this, 2026-11-07). This function is the SAME pipeline
// behind a user JWT (verify_jwt=true, delete-account's auth
// pattern): it rebuilds the known set server-side from the same
// learner_state document the bot reads, picks with the same
// fit.ts (a byte-identical twin — the gate does not move), and
// generates with the same draft-grade-retry loop, caching accepted
// drafts into reading_passages for every surface.
//
// Response contract (the client renders, this function decides):
//   { status: 'picked', passage, ratio, coldStart, generated }
//   { status: 'nofit', reason, generationAttempted }
// reason ∈ need_level | cold | no_words | recent_only |
//          cooldown | gate | bank_error
// A nofit is an honest answer, never an error: HTTP 200 either
// way. Only auth/config failures use 4xx/5xx.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const RECENT_DAYS = 14

// --- R0.5 fitted generation — copied from reader-bot (the draft
// loop is a twin; fit.ts/segment.ts are byte-identical files). ---
const GEN_MAX_ATTEMPTS = 4
const GEN_COOLDOWN_MS = 10 * 60 * 1000
const GEN_LENGTH_BY_BAND: Record<string, number> = { N5: 120, N4: 180, N3: 230, N2: 300, N1: 350 }

const PERSONA_TOPICS: Record<string, string> = {
  'resident': 'everyday life in a Japanese neighbourhood',
  'job-hunter': 'looking for a job in Japan — applications and interviews',
  'student': 'student life in Japan — school and a part-time job',
  'ssw': 'working life in Japan — the workplace and daily routines',
  'business': 'office life in Japan — meetings and email',
  'parent': 'family life in Japan — school notes and the city office',
}
const ROTATION_TOPICS = [
  'a visit to the city office',
  'trains and the station',
  'a convenience store stop',
  'work and colleagues',
  'a clinic visit and health',
  'the weather and the seasons',
  'shopping at a local shop',
  'neighbours and the neighbourhood',
]

function topicFor(state: Record<string, unknown>, userId: string): string {
  const profile = (state.profile ?? {}) as Record<string, unknown>
  const persona = typeof profile.persona === 'string' ? profile.persona : ''
  if (PERSONA_TOPICS[persona]) return PERSONA_TOPICS[persona]
  const day = Math.floor(Date.now() / 86400000)
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (Math.imul(31, h) + userId.charCodeAt(i)) | 0
  return ROTATION_TOPICS[Math.abs(day + h) % ROTATION_TOPICS.length]
}

function trimDraftToFit(text: string, max = 1200): string | null {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const boundary = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'))
  if (boundary < 400) return null
  return cut.slice(0, boundary + 1)
}


// Model chain (2026-11-08): relying on 'openrouter/free'
// alone silently broke production generation — the router's
// free pool changed (Nov 2026 catalogue: mostly tiny, code and
// reasoning models) and every response came back in a shape
// the old parser rejected: generation_failed { reason:
// 'bad_response', attempts: 0 } on every attempt, both
// surfaces, for two days, while /read kept answering with the
// one benched passage. Each attempt now walks NAMED free
// models (verified present in the catalogue the day this
// shipped; Gemma first — multilingual, instruction-tuned),
// and the parser accepts the shapes those models actually
// return. READER_MODEL, when set, is tried first.
const GEN_MODEL_CHAIN = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  // A different provider pool for when Google's free endpoints
  // rate-limit (2026-11-09: a 429 storm on both Gemmas no-fitted
  // the first user's Mini App open; chain verified against
  // OpenRouter's live free catalogue the same day).
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'openrouter/free',
]

function genModels(): string[] {
  const pinned = Deno.env.get('READER_MODEL') ?? ''
  const chain = pinned ? [pinned, ...GEN_MODEL_CHAIN] : [...GEN_MODEL_CHAIN]
  return [...new Set(chain)]
}

// Pull the passage text out of a chat-completions response,
// tolerantly: plain string content (the classic shape),
// content as an array of parts (several free providers),
// the legacy completions `text` field, an error object riding
// a 200, or a reasoning model that spent its whole answer
// thinking (reasoning_only — chain-of-thought is not a
// passage and is never served as one).
function extractContent(data: unknown): { text: string | null; reason: string } {
  if (!data || typeof data !== 'object') return { text: null, reason: 'bad_response' }
  const d = data as Record<string, unknown>
  if (d.error) return { text: null, reason: 'api_error' }
  const choices = d.choices as Array<Record<string, unknown>> | undefined
  const choice = choices?.[0]
  if (!choice) return { text: null, reason: 'bad_response' }
  const message = choice.message as Record<string, unknown> | undefined
  const content = message?.content
  if (typeof content === 'string' && content.trim()) return { text: content, reason: 'ok' }
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        const p = part as Record<string, unknown> | null
        return typeof p?.text === 'string' ? p.text : ''
      })
      .join('')
    if (joined.trim()) return { text: joined, reason: 'ok' }
  }
  if (typeof choice.text === 'string' && choice.text.trim()) return { text: choice.text, reason: 'ok' }
  if (typeof message?.reasoning === 'string' && (message.reasoning as string).trim()) {
    return { text: null, reason: 'reasoning_only' }
  }
  return { text: null, reason: 'bad_response' }
}

async function generateDraft(band: string, topic: string, chars: number, forbidden: string[], model: string, targets: string[] = []): Promise<{ text: string | null; reason: string }> {
  const key = Deno.env.get('OPENROUTER_API_KEY') ?? ''
  if (!key) return { text: null, reason: 'no_key' }
  const system =
    'You write short, natural Japanese reading passages for a language-learning app. ' +
    'Write plain, warm, everyday Japanese at exactly the requested JLPT level, using mostly simple everyday words. ' +
    'Write ONE passage only: no title, no furigana, no romaji, no English, no commentary before or after.'
  const forbiddenLine = forbidden.length > 0
    ? `\nDo not use any of these words at all: ${forbidden.join('、')}.`
    : ''
  // Heard Words seeding (Doc 22): the learner's own heard words
  // are the preferred new-word dose — the passage is written
  // around the Japanese their life already said to them.
  const targetLine = targets.length > 0
    ? `\nThe learner recently heard these words in real life. Work as many of them as fit naturally into the passage: ${targets.join('、')}. They count toward the at-most-8 unknown words.`
    : ''
  const user =
    `Write a passage of about ${chars} Japanese characters at JLPT ${band} level about: ${topic}. ` +
    `You may use at most about 8 words that a ${band} learner would not know yet.${forbiddenLine}${targetLine}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': Deno.env.get('APP_URL') ?? 'https://yonde.app',
        'X-Title': 'Yonde',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
        max_tokens: 800,
      }),
    })
    if (!res.ok) {
      console.error(`reader-serve: generation HTTP ${res.status}`)
      return { text: null, reason: `http_${res.status}` }
    }
    const data = await res.json().catch(() => null)
    const extracted = extractContent(data)
    if (extracted.text === null) return { text: null, reason: extracted.reason }
    const raw = extracted.text
    const cleaned = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()
    if (cleaned.length < 30) return { text: null, reason: 'too_short' }
    const text = trimDraftToFit(cleaned)
    if (text === null) return { text: null, reason: 'too_long' }
    return { text, reason: 'ok' }
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : 'network'
    console.error(`reader-serve: generation draft failed reason=${reason}`)
    return { text: null, reason }
  } finally {
    clearTimeout(timer)
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Not configured' }, 500)

  // The caller is the learner: the gateway has already validated
  // the JWT (verify_jwt=true); getUser names whose world to fit.
  const authHeader = req.headers.get('Authorization') ?? ''
  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userError } = await caller.auth.getUser()
  if (userError || !user) return json({ error: 'Unauthorized' }, 401)
  const userId = user.id

  const body = await req.json().catch(() => ({})) as { excludeIds?: unknown }
  const excludeIds = Array.isArray(body?.excludeIds)
    ? body.excludeIds.filter((x): x is string => typeof x === 'string')
    : []

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const logEvent = async (type: string, payload: Record<string, unknown>) => {
    const { error } = await supabaseAdmin.from('metrics_events').insert({ user_id: userId, type, payload })
    if (error) console.error(`reader-serve: metrics insert failed type=${type}`)
  }

  const { data: stateRow } = await supabaseAdmin
    .from('learner_state')
    .select('state, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  const state = (stateRow?.state ?? {}) as Record<string, unknown>

  const { data: link } = await supabaseAdmin
    .from('telegram_links')
    .select('declared_band, declared_at, fit_step, last_good_step')
    .eq('user_id', userId)
    .maybeSingle()

  // knownFor — the bot's composition, unchanged (reader-bot
  // index.ts): queue fronts + encounters as proven credit +
  // below-band deck credit when a basis exists; resolveBand is
  // the one choke point for diagnosis vs declaration vs 'N7'.
  const queue = Array.isArray(state.queue) ? state.queue : []
  const estimate = (state.diagnosis as Record<string, unknown> | undefined)?.jlptEstimate
  const stateDeclared = (state.declaredLevel ?? null) as { band?: unknown; at?: unknown } | null
  const { band: resolvedBand, source: bandSource, joke: isJoke } = resolveBand({
    diagnosisBand: typeof estimate === 'string' ? estimate : null,
    declaredBand: link?.declared_band ?? null,
    declaredAt: link?.declared_at ?? null,
    stateDeclaredBand: typeof stateDeclared?.band === 'string' ? stateDeclared.band : null,
    stateDeclaredAt: typeof stateDeclared?.at === 'string' ? stateDeclared.at : null,
  })
  const joke = isJoke === true
  const hasDiagnosis = bandSource === 'diagnosis'
  const band = resolvedBand ?? 'N4' // gentle default, as the bot
  const credit = resolvedBand ? deckCreditSet(DECK_LEVELS, resolvedBand) : null
  const encounters = (Array.isArray(state.encounters) ? state.encounters : [])
    .filter((w): w is string => typeof w === 'string')
  const known = buildKnownSet(queue, encounters, credit)
  const pace = bandSource === 'declared' && joke ? 'foundations' : 'standard'

  const seenKanji = seenKanjiSet([
    ...queue.map((i) => (typeof i?.front === 'string' ? i.front : '')),
    ...encounters,
  ])
  const batchWords = currentBatchWords(queue)
  const fitOpts = { seenKanji, batchWords }
  const fitStep = Number(link?.fit_step ?? 0) || 0
  const serveBand = serveBandFor(resolvedBand, fitStep) ?? band

  // The level ask, as data: no basis at all (and not cold — cold
  // has its starter track below). The bot asks with buttons; the
  // web page keeps its own honest empty state for this case.
  const cold = bandSource === 'none' && isColdStart(hasDiagnosis, countKnownContent(known))
  if (bandSource === 'none' && !cold) {
    return json({ status: 'nofit', reason: 'need_level', generationAttempted: false })
  }

  const since = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
  const { data: sentRows } = await supabaseAdmin
    .from('metrics_events')
    .select('payload')
    .eq('user_id', userId)
    .eq('type', 'passage_sent')
    .gte('created_at', since)
  const recentIds = [
    ...(sentRows || [])
      .map((r) => (r.payload as Record<string, unknown>)?.passageId)
      .filter((x): x is string => typeof x === 'string'),
    ...excludeIds,
  ]

  const { data: bank, error: bankError } = await supabaseAdmin
    .from('reading_passages')
    .select('id, band, topic, text, tokens, new_word_candidates, source, voice_file_id')
  if (bankError || !bank) {
    console.error('reader-serve: passage bank fetch failed')
    return json({ status: 'nofit', reason: 'bank_error', generationAttempted: false })
  }

  let picked: { passage: Record<string, unknown>; ratio: number } | null = null
  let coldStart = false
  let generated = false

  if (cold) {
    const starter = pickStarter(bank, known, recentIds)
    if (starter) {
      picked = { passage: starter.passage as Record<string, unknown>, ratio: passageRatio(starter.passage.tokens, known) }
      coldStart = true
    }
  }
  if (!picked && !cold) {
    const gentleActive = pace === 'foundations'
      && fitStep <= 0
      && (Number(link?.last_good_step ?? 0) || 0) <= 0
    const fit = gentleActive
      ? (pickGentle(bank, known, serveBand, recentIds, fitOpts) ?? pickPassage(bank, known, serveBand, recentIds, fitOpts))
      : pickPassage(bank, known, serveBand, recentIds, fitOpts)
    if (fit) picked = { passage: fit.passage as Record<string, unknown>, ratio: fit.ratio }
  }

  // Heard Words seeding (Doc 22): the learner's heard words
  // from the last 7 days (aggregated across days), minus the
  // ones already known, become the foundry's target list —
  // the bot twin's heardTargets, mirrored. Best-effort: any
  // failure returns [] and generation proceeds as before.
  const heardTargets = async (): Promise<string[]> => {
    try {
      const jstDay = (daysAgo: number) => new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(Date.now() - daysAgo * 86400000))
      const { data } = await supabaseAdmin
        .from('heard_words')
        .select('item, kind, count')
        .eq('user_id', userId)
        .gte('day', jstDay(6))
      if (!data) return []
      const totals = new Map<string, { item: string; kind: string; count: number }>()
      for (const row of data as { item: string; kind: string; count: number }[]) {
        const cur = totals.get(row.item)
        if (cur) cur.count += row.count
        else totals.set(row.item, { item: row.item, kind: row.kind, count: row.count })
      }
      return [...totals.values()]
        .filter((r) => r.kind === 'word' && r.item && !known.has(r.item))
        .sort((a, b) => b.count - a.count || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0))
        .slice(0, 8)
        .map((r) => r.item)
    } catch {
      return []
    }
  }

  let generationAttempted = false
  let genReason: string | null = null
  if (!picked && !cold) {
    // R0.5 fitted generation, the bot's tryGenerate sequence with
    // the same cooldown read from the generation events.
    const cdSince = new Date(Date.now() - GEN_COOLDOWN_MS).toISOString()
    const { data: recentGen } = await supabaseAdmin
      .from('metrics_events')
      .select('id')
      .eq('user_id', userId)
      .in('type', ['passage_generated', 'generation_failed'])
      .gte('created_at', cdSince)
      .limit(1)
    if (!shouldGenerate(null, !recentGen || recentGen.length === 0)) {
      genReason = 'cooldown'
    } else {
      generationAttempted = true
      const topic = topicFor(state, userId)
      const targets = await heardTargets()
      const chars = GEN_LENGTH_BY_BAND[serveBand] ?? 200
      let forbidden: string[] = []
      let calls = 0
      const models = genModels()
      let lastModel = ''
      let lastReason: string | null = null
      for (let attempt = 1; attempt <= GEN_MAX_ATTEMPTS; attempt++) {
        lastModel = models[(attempt - 1) % models.length]
        const { text: draft, reason } = await generateDraft(serveBand, topic, chars, forbidden, lastModel, targets)
        if (draft === null) {
          lastReason = reason
          console.error(`reader-serve: generation attempt ${attempt} produced no draft reason=${reason}`)
          if (reason === 'no_key') break
          // A 429 is a rate limit, not a refusal: give the pool
          // a breath before the next attempt instead of burning
          // the whole chain inside a second (2026-11-09: a 429
          // storm no-fitted the first user's Mini App open).
          if (reason === 'http_429' && attempt < GEN_MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 1200 * attempt))
          }
          continue
        }
        calls++
        const tokens = segmentText(draft)
        const verdict = evaluateDraft(tokens, known)
        if (verdict.accept) {
          const passageId = `foundry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          const candidates = verdict.unknowns.map((head) => {
            const surface = tokens.find((t) => t.h === head)?.s ?? head
            const gloss = (DECK_GLOSS as Record<string, { reading: string; meaning: string }>)[head]
            return {
              word: draft.includes(head) ? head : surface,
              reading: gloss?.reading ?? '',
              meaning: gloss?.meaning ?? '',
              h: head,
            }
          })
          const passage: Record<string, unknown> = {
            id: passageId,
            band: serveBand,
            topic,
            text: draft,
            tokens,
            new_word_candidates: candidates,
            source: 'foundry',
          }
          const { error: insertError } = await supabaseAdmin.from('reading_passages').insert(passage)
          if (insertError) console.error('reader-serve: foundry passage cache insert failed')
          await logEvent('passage_generated', {
            passageId, band: serveBand, topic, attempts: attempt, ratio: Math.round(verdict.ratio * 1000) / 1000, model: lastModel, surface: 'web',
            seeded: verdict.unknowns.filter((u) => targets.includes(u)).length, seededTargets: targets.length,
          })
          picked = { passage, ratio: verdict.ratio }
          generated = true
          break
        }
        forbidden = nextForbiddenList(forbidden, verdict.unknowns)
        lastReason = 'gate_rejected'
      }
      if (!picked) {
        genReason = lastReason
        await logEvent('generation_failed', { band: serveBand, topic, attempts: calls, reason: lastReason, model: lastModel, surface: 'web' })
      }
    }
  }

  if (picked) {
    return json({
      status: 'picked',
      passage: picked.passage,
      ratio: picked.ratio,
      coldStart,
      generated,
    })
  }

  // Name the true no-fit reason, as the bot does (amendment #7).
  let reason = 'gate'
  if (cold) reason = 'cold'
  else if (queue.length === 0 && encounters.length === 0) reason = 'no_words'
  else if (genReason === 'cooldown') reason = 'cooldown'
  else {
    const recentFit = pickPassage(
      bank.filter((p) => recentIds.includes(String(p.id))),
      known,
      serveBand,
      [],
      fitOpts,
    )
    if (recentFit) reason = 'recent_only'
  }
  return json({ status: 'nofit', reason, generationAttempted })
})
