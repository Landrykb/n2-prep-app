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

async function generateDraft(band: string, topic: string, chars: number, forbidden: string[]): Promise<{ text: string | null; reason: string }> {
  const key = Deno.env.get('OPENROUTER_API_KEY') ?? ''
  if (!key) return { text: null, reason: 'no_key' }
  const model = Deno.env.get('READER_MODEL') ?? 'openrouter/free'
  const system =
    'You write short, natural Japanese reading passages for a language-learning app. ' +
    'Write plain, warm, everyday Japanese at exactly the requested JLPT level, using mostly simple everyday words. ' +
    'Write ONE passage only: no title, no furigana, no romaji, no English, no commentary before or after.'
  const forbiddenLine = forbidden.length > 0
    ? `\nDo not use any of these words at all: ${forbidden.join('、')}.`
    : ''
  const user =
    `Write a passage of about ${chars} Japanese characters at JLPT ${band} level about: ${topic}. ` +
    `You may use at most about 8 words that a ${band} learner would not know yet.${forbiddenLine}`
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
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') return { text: null, reason: 'bad_response' }
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
      const chars = GEN_LENGTH_BY_BAND[serveBand] ?? 200
      let forbidden: string[] = []
      let calls = 0
      let lastReason: string | null = null
      for (let attempt = 1; attempt <= GEN_MAX_ATTEMPTS; attempt++) {
        const { text: draft, reason } = await generateDraft(serveBand, topic, chars, forbidden)
        if (draft === null) {
          lastReason = reason
          console.error(`reader-serve: generation attempt ${attempt} produced no draft reason=${reason}`)
          if (reason === 'no_key') break
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
            passageId, band: serveBand, topic, attempts: attempt, ratio: Math.round(verdict.ratio * 1000) / 1000, surface: 'web',
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
        await logEvent('generation_failed', { band: serveBand, topic, attempts: calls, reason: lastReason, surface: 'web' })
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
