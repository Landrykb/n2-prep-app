import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { applyFeedback, BANDS, buildKnownSet, capCandidates, countKnownContent, deckCreditSet, evaluateDraft, fitCallback, hasFeedbackFor, isColdStart, nextForbiddenList, parseFitCallback, passageRatio, pickPassage, pickStarter, resolveBand, serveBandFor, shouldAskLevel, shouldGenerate } from './fit.ts'
import { DECK_LEVELS } from './deck.ts'
import { DECK_GLOSS } from './gloss.ts'
import { segmentText } from './segment.ts'

// Yonde Reader bot (Doc 16 §6/§7 R0, Doc 12 step 3.6).
//
// One route only:
//   POST /functions/v1/reader-bot            — the Telegram webhook.
// Operator setup (webhook + command registration) lives in the
// separate reader-admin function, so the bot token never leaves
// Supabase env and this function carries no dead admin door.
//
// R0 scope (Doc 16 §7): linking via one-time codes the app mints,
// /read on demand with passages spine-fitted per learner (fit.ts — the
// ratio gate is code, never AI), and one-tap mining of the passage's
// new words into the ONE queue inside the learner_state document.
// R0.5 adds fitted generation as the bank-miss fallback (see
// tryGenerate below): AI drafts, code validates, the gate is the same.
// Cold start (Doc 16 §5 amendment #2): a learner with no diagnosis
// and <40 known content words has no fitting basis at all — /read
// serves a LABELLED starter from the low bands (fit.ts pickStarter)
// instead of the dead-end reply, and fitted generation is skipped
// until a basis exists.
// Declared level (Doc 16 §5 amendment #3): the starter track still
// made the checkup the only road to fitting, and Landry's answer was
// that he never entered a level anywhere — /read must not demand
// homework. So with NO band basis at all, /read first asks ONE
// question with one-tap buttons; the tap is stored on the link row
// (declared_band, migration 00011) and becomes the fitting basis —
// a starting belief the learner states, overridden by a real
// diagnosis whenever one exists, and labelled as declared in every
// footer. /level re-opens the question at any time.
// Adaptive fit (Doc 16 §5 amendment #4): even a stated level is a
// snapshot, so the fit ADAPTS ITSELF around the basis band. Every
// passage send carries a feedback row — [Read It ✓] [Push Me 🔥]
// [Too Hard] — whose taps move a step state on the link row
// (fit_step / last_good_step / comfy_streak, migration 00012) via
// applyFeedback in fit.ts: comfortable reads ratchet the previous
// known level and trial a stretch, Push Me steps up for fun, and
// Too Hard runs the overshoot protocol (apologize, explain what
// was sent, step back to the previous known level — never a crash
// below it). /read aims at serveBandFor(basis, fit_step).
// No morning dispatch (R1), no Mini App (R1), no voice (R2).
//
// The bot never nags (Doc 16 §9): it sends when asked, and is silent
// otherwise. There is no reading streak and no missed-day message.
//
// Env: READER_BOT_TOKEN, READER_WEBHOOK_SECRET (both set as function
// secrets when the bot is created — never in code), PUSH_ADMIN_SECRET
// (the existing admin pattern from call-scheduler/push-send),
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (runtime-injected).
// R0.5 adds: OPENROUTER_API_KEY (the chat function's project secret,
// reused under the same name) and optional READER_MODEL (default
// 'openrouter/free' — Doc 03 Tier C standing rule).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret, x-telegram-bot-api-secret-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const RECENT_DAYS = 14

// --- R0.5 fitted generation (Doc 16 §7: pulled forward from R1) ---
// The bank was never written to the 95% rule, so bank-first alone
// leaves most /read calls with nothing that passes the gate. When —
// and only when — no bank passage fits, Tsuku drafts one and CODE
// validates it: segment, ratio, unknown cap, retry with the unknown
// words forbidden. The gate numbers do not move; generation is just
// a second, tireless author held to them. An accepted draft is
// cached into reading_passages (source 'foundry') so the bank grows
// toward the learners it actually serves.

const GEN_MAX_ATTEMPTS = 4
const GEN_COOLDOWN_MS = 10 * 60 * 1000
const GEN_LENGTH_BY_BAND: Record<string, number> = { N5: 120, N4: 180, N3: 230, N2: 300, N1: 350 }

// Topic sources, in order: the learner's Twin persona (learner_state
// .profile.persona — the only structured life-context the profile
// carries today), else a rotation over everyday-life topics.
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

// One OpenRouter draft (the chat function's call shape: same base,
// same headers, OPENROUTER_API_KEY env). Returns the cleaned passage
// text, or null on ANY failure — no key, HTTP error, timeout, empty
// completion. Generation failure must degrade to the honest reply,
// never break the webhook.
async function generateDraft(band: string, topic: string, chars: number, forbidden: string[]): Promise<string | null> {
  const key = Deno.env.get('OPENROUTER_API_KEY') ?? ''
  if (!key) return null
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
      console.error(`reader-bot: generation HTTP ${res.status}`)
      return null
    }
    const data = await res.json().catch(() => null)
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') return null
    const text = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()
    if (text.length < 30 || text.length > 1200) return null
    return text
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// --- small ports of client logic (twins pinned on the client side) ---

// queueItemId from src/lib/queue.js — same hash, so a word mined here
// dedupes against the same word added in the app, and vice versa.
function queueItemId(source: string, front: string): string {
  let h = 0
  const s = `${source}|${front}`
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return `q${(h >>> 0).toString(36)}-${s.length}`
}

// createCardState from src/lib/fsrs.js — a brand-new FSRS card.
function freshCardState(now: Date) {
  return {
    stability: 0,
    difficulty: 0,
    due: now.toISOString(),
    lastReview: null,
    reps: 0,
    lapses: 0,
    state: 'new',
  }
}

// --- Telegram helpers ---

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function tg(token: string, method: string, payload: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.ok) {
    console.error(`reader-bot: telegram ${method} failed status=${res.status}`)
  }
  return body
}

const sendMessage = (token: string, chatId: number, text: string, extra: Record<string, unknown> = {}) =>
  tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra })

// --- copy (Hori's voice; plain language; no streak talk, ever) ---

const LINK_EXPLAINER =
  '🔍 Hori here — I run Yonde Reader. This chat is not linked yet.\n' +
  'Open Yonde → <b>Fleet</b> → <b>Yonde Reader on Telegram</b> → <b>Connect Telegram</b>, then tap the link there. ' +
  'It takes ten seconds, and then /read works here.'

const WELCOME =
  '🔍 Linked — Hori here, your Miner in Yonde.\n' +
  'Send /read any time and I will dig up a short passage fitted to the words you actually know. ' +
  'New words come <b>bold</b>, and one tap mines them into your review queue.\n' +
  'No streaks, no nagging — reading when you feel like it is the whole design.'

const HELP = 'I only know two tricks so far: /read (a passage at your level) and /unlink (disconnect this chat).'

// The one-tap level ask (Doc 16 §5 amendment #3). It is the /read
// response when the learner has no band basis at all — never a
// standalone nag — and it fires at most once: once a band is
// declared (or a diagnosis exists) /read serves instead. The
// callback_data values are tiny by design (level:N5 = 8 bytes,
// level:none = 10): Telegram rejects oversized button payloads
// silently, so the whole level surface stays far under the limit.
const LEVEL_ASK =
  '🔍 One thing first — I do not know your level yet, and I fit every passage to it.\n' +
  'Tap yours and reading starts now. No forms, no homework: this tap is just where we start, ' +
  'and your checkup in Yonde is the sharper measure whenever you want it.'

const levelKeyboard = {
  inline_keyboard: [
    BANDS.map((b) => ({ text: b, callback_data: `level:${b}` })),
    [{ text: 'Not sure', callback_data: 'level:none' }],
  ],
}

// The /level intro line names the CURRENT basis before offering the
// buttons (Doc 16 §5 amendment #3) — a learner re-asking the
// question should be told what is in charge right now.
const levelIntro = (source: string, band: string | null) =>
  source === 'diagnosis'
    ? `Your checkup put you at ${band}, and a checkup always outranks a tap — I fit to it. ` +
      'If that feels wrong, a fresh checkup in Yonde is the way to change it. ' +
      'A tap below only sets your starting level for if no checkup were on file.'
    : source === 'declared'
      ? `You told me ${band} — that is the level I fit to. Tap to change it, ` +
        'or take the checkup in Yonde for the sharper measure.'
      : LEVEL_ASK

// The starter footer (cold start, Doc 16 §5 amendment #2). It must
// never claim fitting that did not happen: it says plainly this is a
// starter, says why, invites mining (mined words are the first real
// known set), and names the checkup as the switch for fitting.
const STARTER_FOOTER =
  'A starter, not a fitted pick — I do not know your level yet, so this one is from the easy shelf, with the new words kept few. ' +
  'Mine any words you like: every mined word teaches me what you know. ' +
  'Take the 10-minute checkup in Yonde and fitting switches on — from then on, every passage is measured against your words before it is sent.'

// Appended to the nothing-fits reply when the learner has words but
// no diagnosis (and is not cold): the checkup is named as the switch
// that turns level-fitting on, in the same spirit as the footers.
const CHECKUP_SWITCH_LINE =
  '\nThe checkup is the switch here: take the 10-minute checkup in Yonde, and I can fit to your level, not just your queue.'

// The first sentence of `text` containing `word` — the mined card's
// context line (Doc 16 §3: the card carries the sentence it came from).
function sentenceWith(text: string, word: string): string {
  const sentences = String(text).split(/(?<=[。！？\n])/)
  const hit = sentences.find((s) => s.includes(word))
  const chosen = (hit ?? text).trim()
  return chosen.length > 120 ? `${chosen.slice(0, 117)}...` : chosen
}

// Passage text with new words bolded (+ reading in parentheses).
// Rebuilt by scanning the raw text, so it is exact regardless of how
// the passage was tokenised.
function renderPassage(text: string, newWords: { word: string; reading: string }[]): string {
  const surfaces = [...newWords].sort((a, b) => b.word.length - a.word.length)
  let out = ''
  let i = 0
  while (i < text.length) {
    const hit = surfaces.find((w) => w.word && text.startsWith(w.word, i))
    if (hit) {
      const reading = hit.reading && hit.reading !== hit.word ? `（${esc(hit.reading)}）` : ''
      out += `<b>${esc(hit.word)}${reading}</b>`
      i += hit.word.length
    } else {
      out += esc(text[i])
      i++
    }
  }
  return out
}

// Stored bank candidates carry { word, reading, meaning, h } — no
// level of their own. capCandidates orders by deck level, so the
// send and mine paths resolve each candidate's level here: the deck
// first, then the passage's own tokens (a token's `l` is the level
// the bank builder assigned, scene overrides included), else null
// (capCandidates sorts null level last).
function withCandidateLevels(passage: Record<string, unknown>) {
  const cands = Array.isArray(passage.new_word_candidates)
    ? (passage.new_word_candidates as { word: string; reading: string; meaning: string; h?: string; level?: string | null }[])
    : []
  const tokenLevel = new Map<string, string | null>()
  const tokens = Array.isArray(passage.tokens) ? passage.tokens : []
  for (const t of tokens) {
    const tok = t as { h?: string; l?: string | null }
    if (tok && typeof tok.h === 'string' && !tokenLevel.has(tok.h)) tokenLevel.set(tok.h, tok.l ?? null)
  }
  const deck = DECK_LEVELS as Record<string, string>
  return cands.map((c) => {
    const head = c.h || c.word
    const level = deck[head] ?? tokenLevel.get(head) ?? c.level ?? null
    return { ...c, level }
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const botToken = Deno.env.get('READER_BOT_TOKEN') ?? ''
  const webhookSecret = Deno.env.get('READER_WEBHOOK_SECRET') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  try {
    // ---------- no setup route here — on purpose ----------
    // Registration (webhook + command list) lives in the separate
    // reader-admin function (verify_jwt = true + the service_role
    // claims check). This function's earlier ?setup=1 route accepted
    // only the unrecoverable admin secret or the gateway-rejected
    // runtime key, so it could never be used — a dead door is attack
    // surface, and it was removed 2026-11-06 (Doc 16).

    // ---------- webhook route ----------
    // Fail closed: no configured secret, no service.
    if (!webhookSecret || req.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret) {
      return json({ error: 'Unauthorized' }, 401)
    }
    if (!botToken) {
      console.error('reader-bot: READER_BOT_TOKEN is not set')
      return json({ error: 'Bot is not configured' }, 500)
    }

    const update = await req.json().catch(() => null)
    if (!update) return json({ ok: true })

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const logEvent = async (userId: string, type: string, payload: Record<string, unknown>) => {
      const { error } = await supabaseAdmin.from('metrics_events').insert({ user_id: userId, type, payload })
      if (error) console.error(`reader-bot: metrics insert failed type=${type}`)
    }

    const linkByChat = async (chatId: number) => {
      const { data } = await supabaseAdmin
        .from('telegram_links')
        .select('user_id, chat_id, username, declared_band, fit_step, last_good_step, comfy_streak')
        .eq('chat_id', chatId)
        .maybeSingle()
      return data
    }

    const loadState = async (userId: string) => {
      const { data } = await supabaseAdmin
        .from('learner_state')
        .select('state, updated_at')
        .eq('user_id', userId)
        .maybeSingle()
      return data // { state, updated_at } | null
    }

    // The calibrated known set (Doc 16 §5 amendment): queue fronts +
    // Twin personal vocab + below-band deck credit. The credit follows
    // the resolved band basis (resolveBand, amendment #3): it exists
    // with a DIAGNOSIS — the checkup certifies the vocabulary below
    // the band — OR with a DECLARED band, the one-tap starting belief
    // the learner states in Telegram (self-assessment is the same
    // graded-reader assumption, owned by the learner; the gate still
    // validates every passage, and a diagnosis overrides the tap
    // whenever one exists). With neither basis there is no credit:
    // the set is queue-only and conservative. hasDiagnosis stays
    // diagnosis-only, for copy that speaks about the checkup itself.
    // (Personal vocab has no stored list yet — twin.vocab is derived
    // stats — so it contributes nothing today; the parameter stays
    // plumbed for when the Twin grows one.)
    const knownFor = (state: Record<string, unknown>, declaredBand?: string | null) => {
      const queue = Array.isArray(state.queue) ? state.queue : []
      const estimate = (state.diagnosis as Record<string, unknown> | undefined)?.jlptEstimate
      const { band: resolvedBand, source: bandSource } = resolveBand({
        diagnosisBand: typeof estimate === 'string' ? estimate : null,
        declaredBand: declaredBand ?? null,
      })
      const hasDiagnosis = bandSource === 'diagnosis'
      const band = resolvedBand ?? 'N4' // gentle default; the footer says so
      const credit = resolvedBand ? deckCreditSet(DECK_LEVELS, resolvedBand) : null
      const known = buildKnownSet(queue, [], credit)
      // basisBand is the resolved band itself (null when 'none'):
      // adaptive fit (amendment #4) shifts the SERVE band from it,
      // while credit above keeps following the basis untouched.
      return { queue, known, hasDiagnosis, band, bandSource, basisBand: resolvedBand }
    }

    // ---------- R0.5 generation fallback ----------
    // Runs ONLY when the bank pick failed. One sequence per /read,
    // behind a per-user cooldown read from the generation events
    // themselves (passage_generated / generation_failed within the
    // last 10 minutes suppress a new sequence — cost discipline).
    const tryGenerate = async (
      link: { user_id: string },
      state: Record<string, unknown>,
      known: Set<string>,
      band: string,
    ): Promise<{ passage: Record<string, unknown>; ratio: number } | null> => {
      const since = new Date(Date.now() - GEN_COOLDOWN_MS).toISOString()
      const { data: recentGen } = await supabaseAdmin
        .from('metrics_events')
        .select('id')
        .eq('user_id', link.user_id)
        .in('type', ['passage_generated', 'generation_failed'])
        .gte('created_at', since)
        .limit(1)
      if (!shouldGenerate(null, !recentGen || recentGen.length === 0)) return null

      const topic = topicFor(state, link.user_id)
      const chars = GEN_LENGTH_BY_BAND[band] ?? 200
      let forbidden: string[] = []
      let calls = 0
      for (let attempt = 1; attempt <= GEN_MAX_ATTEMPTS; attempt++) {
        const draft = await generateDraft(band, topic, chars, forbidden)
        if (draft === null) break // OpenRouter unreachable — stop, degrade honestly
        calls++
        const tokens = segmentText(draft)
        const verdict = evaluateDraft(tokens, known)
        if (verdict.accept) {
          const passageId = `foundry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          // Candidates from the accepted unknowns, by headword (the
          // send/mining contract), with dictionary reading + gloss
          // where the deck gloss resolves them.
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
            band,
            topic,
            text: draft,
            tokens,
            new_word_candidates: candidates,
            source: 'foundry',
          }
          // Cache it back into the bank, bank-first for the next
          // learner (Doc 16 §4). Best-effort: a failed insert (e.g.
          // migration 00010 not yet applied) must not cost this
          // learner the passage she is already holding.
          const { error: insertError } = await supabaseAdmin.from('reading_passages').insert(passage)
          if (insertError) console.error('reader-bot: foundry passage cache insert failed')
          await logEvent(link.user_id, 'passage_generated', {
            passageId, band, topic, attempts: attempt, ratio: Math.round(verdict.ratio * 1000) / 1000,
          })
          return { passage, ratio: verdict.ratio }
        }
        forbidden = nextForbiddenList(forbidden, verdict.unknowns)
      }
      await logEvent(link.user_id, 'generation_failed', { band, topic, attempts: calls })
      return null
    }

    // ---------- /read ----------
    // opts.fromLevelTap: this serve ANSWERS a level tap, so the ask
    // below must not fire again inside it. opts.forceStarter: the
    // tap was 'Not sure' — serve the starter track even if the
    // census alone would not call this learner cold. opts
    // .declaredBand overrides the row's value (the level callback
    // has just written it; the serve should not depend on re-read
    // timing).
    const handleRead = async (
      chatId: number,
      opts: { declaredBand?: string | null; fromLevelTap?: boolean; forceStarter?: boolean } = {},
    ) => {
      const link = await linkByChat(chatId)
      if (!link) {
        await sendMessage(botToken, chatId, LINK_EXPLAINER)
        return
      }
      const declaredBand = opts.declaredBand !== undefined ? opts.declaredBand : (link.declared_band ?? null)
      const row = await loadState(link.user_id)
      const state = (row?.state ?? {}) as Record<string, unknown>
      const { queue, known, hasDiagnosis, band, bandSource, basisBand } = knownFor(state, declaredBand)

      // Adaptive fit (Doc 16 §5 amendment #4): /read aims at the
      // SERVE band — the basis band shifted by the learner's fit
      // step (serveBandFor, both fitting twins). The ±1 pick window
      // and the generation prompt follow the serve band; the deck
      // credit inside knownFor keeps following the BASIS band,
      // because credit certifies what the learner knows — the step
      // only chooses where in the window to aim. No basis → no
      // serve band → the gentle N4 default in `band` stands.
      const fitStep = Number(link.fit_step ?? 0) || 0
      const serveBand = serveBandFor(basisBand, fitStep) ?? band

      // The level ask (Doc 16 §5 amendment #3): a linked learner
      // with NO band basis gets one question before any passage —
      // fitting to a level they never stated would be a guess, and
      // gating on the checkup is homework. The ask IS the /read
      // response in this state (never a standalone nag), and it
      // stops the moment a basis exists.
      if (!opts.fromLevelTap && shouldAskLevel({ ...link, declared_band: declaredBand }, bandSource)) {
        await sendMessage(botToken, chatId, LEVEL_ASK, { reply_markup: levelKeyboard })
        return
      }

      // Cold start (Doc 16 §5 amendment #2): no band basis of any
      // kind AND a known-content census under the limit = nothing to
      // fit against. For this learner the gated pick can fit nothing
      // and generation has nothing to validate against — /read runs
      // the starter track instead (below). A declared band is never
      // cold (amendment #3): the tap IS a basis.
      const cold = opts.forceStarter === true
        || (bandSource === 'none' && isColdStart(hasDiagnosis, countKnownContent(known)))

      const since = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
      const { data: sentRows } = await supabaseAdmin
        .from('metrics_events')
        .select('payload')
        .eq('user_id', link.user_id)
        .eq('type', 'passage_sent')
        .gte('created_at', since)
      const recentIds = (sentRows || [])
        .map((r) => (r.payload as Record<string, unknown>)?.passageId)
        .filter((x): x is string => typeof x === 'string')

      const { data: bank, error: bankError } = await supabaseAdmin
        .from('reading_passages')
        .select('id, band, topic, text, tokens, new_word_candidates, source')
      if (bankError || !bank) {
        console.error('reader-bot: passage bank fetch failed')
        await sendMessage(botToken, chatId, 'The reading shelf is empty on my side right now — try again a little later.')
        return
      }

      let picked: { passage: Record<string, unknown>; ratio: number } | null = null
      let coldStart = false
      if (cold) {
        // Starter track FIRST for a cold learner (Doc 16 §5
        // amendment #2): a labelled low-band passage whose mined
        // words become the first real known set. The gate is not
        // consulted — with ~no known words it cannot pass anything,
        // which is the dead end this track exists to end. Starter
        // SELECTION also ignores the adaptive fit step in v1
        // (amendment #4): the starter shelf is the floor, not a
        // stretch target — but starter sends carry the feedback
        // row like every send, and their taps move the same step
        // state the fitted path reads.
        const starter = pickStarter(bank, known, recentIds)
        if (starter) {
          picked = {
            passage: starter.passage as Record<string, unknown>,
            ratio: passageRatio(starter.passage.tokens, known),
          }
          coldStart = true
        }
      }
      if (!picked) {
        const fit = pickPassage(bank, known, serveBand, recentIds)
        if (fit) picked = { passage: fit.passage as Record<string, unknown>, ratio: fit.ratio }
      }
      if (!picked && !cold) {
        // R0.5: fitted generation — the bank was never written to
        // the 95% rule, so most learners fit nothing in it. A draft
        // that passes the SAME gate joins through the SAME send path
        // below; one that cannot pass is never sent. Skipped when
        // cold: generation validates drafts against the known set,
        // and against ~nothing every verdict is meaningless — the
        // spend buys rejections, not passages.
        picked = await tryGenerate(link, state, known, serveBand)
      }
      if (!picked) {
        const nothingFits = queue.length === 0
          ? 'I do not have your synced words yet, so I cannot fit a passage to you. Open Yonde signed in once — your queue syncs on its own — then send /read again.'
          : 'Nothing in the bank fits your words today. Every passage is checked against what you know before it is sent, and I would rather send nothing than the wrong level. New words from your next session change the fit — try /read again after it.'
        await sendMessage(
          botToken,
          chatId,
          // Not cold, has words, still nothing fits, and NO band
          // basis at all (bandSource 'none': no diagnosis, no
          // declaration): name the checkup as the switch that turns
          // level-fitting on (the starter track above already covers
          // the truly cold; this line is for the in-between). A
          // declared learner already has a basis — for them the
          // checkup is a sharpening, named in the fitted footers,
          // not a switch that is off.
          !cold && bandSource === 'none' ? nothingFits + CHECKUP_SWITCH_LINE : nothingFits,
        )
        return
      }

      const passage = picked.passage as Record<string, unknown>
      const rawCandidates = Array.isArray(passage.new_word_candidates)
        ? (passage.new_word_candidates as { word: string; reading: string; meaning: string; h?: string }[])
        : []
      // A starter is sent with the CAPPED candidate list (Doc 16 §5
      // amendment #2): level-ordered (easiest first), at most 12, so
      // bolding shows the most learnable words and the matching Mine
      // can never flood a brand-new queue. Fitted sends keep the
      // bank's own list untouched.
      const candidates = coldStart ? capCandidates(withCandidateLevels(passage)) : rawCandidates
      // New-word selection matches by HEADWORD (Doc 16 §5): a candidate
      // whose dictionary form is already known — queued, or credited
      // below the learner's band — is not new, whatever surface the
      // passage used.
      const newWords = candidates.filter((c) => c.word && !known.has(c.h || c.word))
      const pct = Math.round(picked.ratio * 100)

      // The footer names the fitting basis (Doc 16 §5 labelling):
      // with a diagnosis, the learner's level (via below-band deck
      // credit) and their queue; with a declared band, the level
      // THEY stated and their queue — the wording says the band
      // came from their tap, never from a measurement; with no
      // basis, the queue only. The copy must never claim level
      // fitting that did not happen, on a basis that did not
      // happen. A starter gets its own footer for the same reason:
      // no fit was measured, so none is claimed (amendment #2).
      let footerText = coldStart
        ? STARTER_FOOTER
        : bandSource === 'diagnosis'
        ? `Fitted to your ${esc(band)} level and your queue: about ${pct}% of its words should already be familiar (an estimate) · ${newWords.length} new word${newWords.length === 1 ? '' : 's'}`
        : bandSource === 'declared'
        ? `Fitted to the ${esc(band)} you told me and your queue: about ${pct}% of its words should already be familiar (an estimate) · ${newWords.length} new word${newWords.length === 1 ? '' : 's'}` +
          '\nYour checkup in Yonde sharpens this whenever you want it.'
        : `Fitted to your queue: about ${pct}% of its words should already be familiar (an estimate) · ${newWords.length} new word${newWords.length === 1 ? '' : 's'}` +
          '\nBand N4 is a gentle default — take the 10-minute checkup in Yonde and I will fit to your real level.'
      // Adaptive fit (amendment #4): when the step is off zero the
      // footer says so in plain language — a stretch is named as a
      // stretch (with the way back named too), a gentler notch as
      // settling. Basis labelling above stays the basis; this line
      // is about where the fit AIMED today. Starters never claim
      // it: their selection ignores the step in v1.
      if (!coldStart && fitStep !== 0) {
        const basisLabel = esc(basisBand ?? band)
        footerText += fitStep > 0
          ? `\nStretching you a little past ${basisLabel} today — Push Me works both ways: Too Hard brings us back.`
          : `\nKeeping it a notch gentler than ${basisLabel} while it settles.`
      }
      const lines = [
        `🔍 Hori dug this up for you — ${esc(String(passage.topic || 'Reading'))} · ${esc(String(passage.band))}`,
        '',
        renderPassage(String(passage.text), newWords),
        '',
        footerText,
      ]
      // Every passage send carries the adaptive-fit feedback row
      // (amendment #4) under Mine: [Read It ✓] [Push Me 🔥]
      // [Too Hard]. The payloads carry the passage id (fitCallback)
      // so the handler can dedupe — one tap per passage counts —
      // and so Too Hard can explain THAT passage. Read It ✓ is
      // self-report, honestly: chat cannot verify a read (the
      // voice-note proof belongs to R2, §5 amendment #4).
      const keyboardRows: Record<string, string>[][] = []
      if (newWords.length > 0) {
        keyboardRows.push([{ text: 'Mine the New Words', callback_data: `mine:${String(passage.id)}` }])
      }
      keyboardRows.push([
        { text: 'Read It ✓', callback_data: fitCallback('read', String(passage.id)) },
        { text: 'Push Me 🔥', callback_data: fitCallback('up', String(passage.id)) },
        { text: 'Too Hard', callback_data: fitCallback('hard', String(passage.id)) },
      ])
      const extra: Record<string, unknown> = { reply_markup: { inline_keyboard: keyboardRows } }
      await sendMessage(botToken, chatId, lines.join('\n'), extra)
      // Event names (Doc 16 §8): passage_sent is the R0 send event;
      // reading_opened belongs to the R1 Mini App and is NOT logged here.
      await logEvent(link.user_id, 'passage_sent', {
        passageId: String(passage.id),
        band: String(passage.band),
        ratio: Math.round(picked.ratio * 1000) / 1000,
        newWords: newWords.length,
        // Starter sends are flagged so the funnel can tell the
        // on-ramp from fitted reads (Doc 16 §5 amendment #2).
        ...(coldStart ? { coldStart: true } : {}),
      })
    }

    // ---------- mine callback ----------
    const handleMine = async (cb: Record<string, unknown>) => {
      const cbId = String(cb.id ?? '')
      const from = (cb.from ?? {}) as Record<string, unknown>
      const message = (cb.message ?? {}) as Record<string, unknown>
      const chat = (message.chat ?? {}) as Record<string, unknown>
      const chatId = Number(chat.id)
      const data = String(cb.data ?? '')
      const passageId = data.slice('mine:'.length)

      const answer = (text: string) =>
        tg(botToken, 'answerCallbackQuery', { callback_query_id: cbId, text })

      // Verify who the tap came from (bot-surface rule): the tap must
      // be in the linked private chat, from the person who owns it.
      const link = Number.isFinite(chatId) ? await linkByChat(chatId) : null
      if (!link || Number(from.id) !== chatId) {
        await answer('This chat is not linked to a Yonde account.')
        return
      }

      const { data: passage } = await supabaseAdmin
        .from('reading_passages')
        .select('id, band, topic, text, tokens, new_word_candidates')
        .eq('id', passageId)
        .maybeSingle()
      if (!passage) {
        await answer('That passage is no longer on the shelf.')
        return
      }

      const row = await loadState(link.user_id)
      if (!row?.state) {
        // Conservative by design: never fabricate a learner document.
        await answer('Nothing synced yet.')
        await sendMessage(botToken, chatId, 'There is nothing synced to mine into yet — open Yonde signed in once so your queue exists here, then tap Mine again.')
        return
      }
      const state = row.state as Record<string, unknown>
      const queue = Array.isArray(state.queue) ? [...(state.queue as Record<string, unknown>[])] : []
      // The SAME calibrated known set as /read (Doc 16 §5): a candidate
      // is mined only when it is genuinely new to this learner — not
      // queued, and not credited below their resolved band (diagnosis
      // or declared, amendment #3).
      const { known } = knownFor(state, link.declared_band ?? null)
      // Mine works from the same capped, level-ordered candidate list
      // a starter send bolds (Doc 16 §5 amendment #2): stored lists
      // are builder-capped at 12 today, so for fitted passages the
      // set is unchanged — the cap is the standing guarantee that no
      // Mine, first or otherwise, adds more than 12 words at a tap.
      const candidates = capCandidates(withCandidateLevels(passage as Record<string, unknown>))
      const toMine = candidates.filter((c) => c.word && !known.has(c.h || c.word))

      // Read-modify-write on the learner_state document, mirroring the
      // client's upsert shape (stateSync.js). RACE LIMITATION, stated
      // plainly: a client push landing between this read and write can
      // be overwritten — but the client's merge (stateMerge.js) unions
      // the queue on its next pull/push, and ids dedupe by the shared
      // queueItemId hash, so mined words are re-adopted, never lost
      // permanently and never duplicated.
      const now = new Date()
      const seenIds = new Set(queue.map((i) => i.id))
      let added = 0
      const minedWords: string[] = []
      for (const c of toMine) {
        // The queue front is the HEADWORD (dictionary form): it dedupes
        // against the same word added in the app under its dictionary
        // form via the shared queueItemId hash, and it is the form
        // FSRS should teach — the passage surface stays in the note.
        const front = c.h || c.word
        const id = queueItemId('reader', front)
        if (seenIds.has(id)) continue
        seenIds.add(id)
        minedWords.push(front)
        queue.push({
          id,
          front,
          back: c.meaning || '',
          reading: c.reading || '',
          note: `From Hori's Reader passage: 「${sentenceWith(String(passage.text), c.word)}」`,
          source: 'reader',
          level: String(passage.band),
          createdAt: now.toISOString(),
          fsrs: freshCardState(now),
        })
        added++
      }

      if (added > 0) {
        const { error } = await supabaseAdmin
          .from('learner_state')
          .upsert(
            { user_id: link.user_id, state: { ...state, queue }, updated_at: now.toISOString() },
            { onConflict: 'user_id' },
          )
        if (error) {
          console.error('reader-bot: learner_state write-back failed')
          await answer('Mining failed on my side — try again.')
          return
        }
        await logEvent(link.user_id, 'word_mined', {
          passageId: String(passage.id),
          count: added,
          words: minedWords,
        })
      }

      await answer(added > 0 ? `Mined ${added} word${added === 1 ? '' : 's'}.` : 'Nothing new to mine.')
      await sendMessage(
        botToken,
        chatId,
        added > 0
          ? `⛏ ${added} word${added === 1 ? '' : 's'} joined your review queue — they will surface in your sessions, with this passage's sentence on the card.`
          : 'Nothing new to mine — you already know, or have already queued, every bolded word in that passage.',
      )
    }

    // ---------- level callback (the one-tap declared level) ----------
    const handleLevel = async (cb: Record<string, unknown>) => {
      const cbId = String(cb.id ?? '')
      const from = (cb.from ?? {}) as Record<string, unknown>
      const message = (cb.message ?? {}) as Record<string, unknown>
      const chat = (message.chat ?? {}) as Record<string, unknown>
      const chatId = Number(chat.id)
      const choice = String(cb.data ?? '').slice('level:'.length)

      const answer = (text: string) =>
        tg(botToken, 'answerCallbackQuery', { callback_query_id: cbId, text })

      // The SAME ownership verification as the Mine callback: the
      // tap must be in the linked private chat, from its owner —
      // a level declaration writes learner state, so it is held to
      // exactly the same standard.
      const link = Number.isFinite(chatId) ? await linkByChat(chatId) : null
      if (!link || Number(from.id) !== chatId) {
        await answer('This chat is not linked to a Yonde account.')
        return
      }

      if (choice === 'none') {
        // 'Not sure' is a complete answer: no declaration is stored,
        // and the passage arrives via the starter track.
        await answer('No problem — we start easy.')
        await handleRead(chatId, { fromLevelTap: true, forceStarter: true })
        return
      }
      if (!(BANDS as string[]).includes(choice)) {
        await answer('')
        return
      }

      const { error } = await supabaseAdmin
        .from('telegram_links')
        .update({ declared_band: choice, declared_at: new Date().toISOString() })
        .eq('user_id', link.user_id)
      if (error) {
        console.error('reader-bot: declared band write failed')
        await answer('That did not save on my side — try again.')
        return
      }
      await answer(`${choice} — got it.`)
      await logEvent(link.user_id, 'level_declared', { band: choice })
      // Serve immediately through the normal /read flow: the tap
      // should feel like the passage just arrives. If nothing fits
      // even with the declared credit, the normal nothing-fits copy
      // follows — the declaration is saved either way.
      await handleRead(chatId, { fromLevelTap: true, declaredBand: choice })
    }

    // ---------- feedback callback (adaptive fit, amendment #4) ----------
    const handleFeedback = async (cb: Record<string, unknown>) => {
      const cbId = String(cb.id ?? '')
      const from = (cb.from ?? {}) as Record<string, unknown>
      const message = (cb.message ?? {}) as Record<string, unknown>
      const chat = (message.chat ?? {}) as Record<string, unknown>
      const chatId = Number(chat.id)
      const parsed = parseFitCallback(String(cb.data ?? ''))

      const answer = (text: string) =>
        tg(botToken, 'answerCallbackQuery', { callback_query_id: cbId, text })

      if (!parsed) {
        await answer('')
        return
      }
      const { kind, passageId } = parsed

      // The SAME ownership verification as Mine and level: the tap
      // must be in the linked private chat, from its owner — a
      // feedback tap moves the learner's fit state, so it is held
      // to exactly the same standard.
      const link = Number.isFinite(chatId) ? await linkByChat(chatId) : null
      if (!link || Number(from.id) !== chatId) {
        await answer('This chat is not linked to a Yonde account.')
        return
      }

      // One feedback tap per passage is enough: the first tap for a
      // passage id counts, later ones are acknowledged and dropped.
      // The dedupe source is the reading_feedback events themselves
      // (the same metrics-lookup pattern as the 14-day exclusion).
      const { data: priorRows } = await supabaseAdmin
        .from('metrics_events')
        .select('payload')
        .eq('user_id', link.user_id)
        .eq('type', 'reading_feedback')
        .order('created_at', { ascending: false })
        .limit(100)
      const priorPayloads = (priorRows || []).map((r) => r.payload as Record<string, unknown>)
      if (hasFeedbackFor(priorPayloads, passageId)) {
        await answer('Already noted ✓')
        return
      }

      const after = applyFeedback(
        {
          fit_step: link.fit_step ?? 0,
          last_good_step: link.last_good_step ?? 0,
          comfy_streak: link.comfy_streak ?? 0,
        },
        kind,
      )
      const { error } = await supabaseAdmin
        .from('telegram_links')
        .update({
          fit_step: after.fit_step,
          last_good_step: after.last_good_step,
          comfy_streak: after.comfy_streak,
        })
        .eq('user_id', link.user_id)
      if (error) {
        console.error('reader-bot: fit state write failed')
        await answer('That did not save on my side — try again.')
        return
      }
      await logEvent(link.user_id, 'reading_feedback', {
        kind,
        passageId,
        fitStepAfter: after.fit_step,
      })

      if (kind === 'read') {
        await answer('Logged ✓')
        if (after.effect === 'trial_up') {
          // The ratchet just fired: the step was proven comfortable
          // AND the fit trials up one. Hori says so out loud — a
          // silent difficulty jump would read as the bot drifting,
          // and the way back is named in the same breath.
          await sendMessage(
            botToken,
            chatId,
            '🔍 Three comfortable reads in a row — that level is properly yours now. ' +
              'The next passage stretches a little past it; that is the fit hardening, one notch at a time. ' +
              'If it overshoots, Too Hard brings us straight back.',
          )
        }
      } else if (kind === 'up') {
        await answer(after.effect === 'max' ? 'Already at full stretch' : '🔥 Pushing you')
      } else if (kind === 'hard') {
        await answer('Stepping back to your level')
        // THE OVERSHOOT PROTOCOL (Doc 16 §5 amendment #4): the step
        // has already returned to last_good_step above — the
        // previous known level, never a crash below it. What the
        // learner SEES is the protocol, in order: Hori apologizes,
        // EXPLAINS WHAT WAS SENT (this passage's new words for this
        // learner — word — reading — meaning, capped at 12), and
        // closes by naming where the fit now stands and how it
        // hardens again: gradually.
        const { data: passage } = await supabaseAdmin
          .from('reading_passages')
          .select('id, band, topic, text, tokens, new_word_candidates')
          .eq('id', passageId)
          .maybeSingle()
        let wordLines: string[] = []
        if (passage) {
          const stateRow = await loadState(link.user_id)
          const fbState = (stateRow?.state ?? {}) as Record<string, unknown>
          const { known } = knownFor(fbState, link.declared_band ?? null)
          const unknownCands = withCandidateLevels(passage as Record<string, unknown>)
            .filter((c) => c.word && !known.has(c.h || c.word))
          wordLines = capCandidates(unknownCands).map((c) => {
            const bits = [esc(c.word)]
            if (c.reading && c.reading !== c.word) bits.push(esc(c.reading))
            if (c.meaning) bits.push(esc(c.meaning))
            return bits.join(' — ')
          })
        }
        const parts = [
          '🔍 Sorry — I got ahead of myself with that one.',
          wordLines.length > 0
            ? `What was in it — the new words that made it a stretch:\n${wordLines.join('\n')}`
            : 'It ran ahead of the words you know — that one is on me, not on you.',
          'We are back at the level that fits you, and it will harden again gradually — a little stretch at a time, never a leap.',
        ]
        await sendMessage(botToken, chatId, parts.join('\n\n'))
      }
    }

    // ---------- dispatch ----------
    if (update.callback_query) {
      const cb = update.callback_query as Record<string, unknown>
      if (String(cb.data ?? '').startsWith('mine:')) {
        try { await handleMine(cb) } catch (err) { console.error('reader-bot: mine failed', err) }
      } else if (String(cb.data ?? '').startsWith('level:')) {
        try { await handleLevel(cb) } catch (err) { console.error('reader-bot: level failed', err) }
      } else if (String(cb.data ?? '').startsWith('fit:')) {
        try { await handleFeedback(cb) } catch (err) { console.error('reader-bot: feedback failed', err) }
      } else if (cb.id) {
        await tg(botToken, 'answerCallbackQuery', { callback_query_id: String(cb.id), text: '' })
      }
      return json({ ok: true })
    }

    const msg = update.message as Record<string, unknown> | undefined
    const chat = (msg?.chat ?? {}) as Record<string, unknown>
    const from = (msg?.from ?? {}) as Record<string, unknown>
    // Reader is a private-chat surface; group chats are ignored politely.
    if (!msg || chat.type !== 'private' || typeof msg.text !== 'string') {
      return json({ ok: true })
    }
    const chatId = Number(chat.id)
    const text = (msg.text as string).trim()
    const [rawCmd, ...rest] = text.split(/\s+/)
    const cmd = rawCmd.split('@')[0].toLowerCase()

    try {
      if (cmd === '/start') {
        const code = (rest[0] ?? '').trim()
        if (!code) {
          await sendMessage(botToken, chatId, LINK_EXPLAINER)
        } else {
          const { data: pending } = await supabaseAdmin
            .from('telegram_links')
            .select('user_id, link_expires_at')
            .eq('link_code', code)
            .is('chat_id', null)
            .maybeSingle()
          const unexpired = pending && (!pending.link_expires_at || new Date(pending.link_expires_at as string) > new Date())
          if (!unexpired) {
            await sendMessage(botToken, chatId, 'That link has expired or was already used. In Yonde → Fleet → Yonde Reader on Telegram, tap Connect Telegram for a fresh one.')
          } else {
            const { error } = await supabaseAdmin
              .from('telegram_links')
              .update({
                chat_id: chatId,
                username: typeof from.username === 'string' ? from.username : null,
                linked_at: new Date().toISOString(),
                link_code: null,
                link_expires_at: null,
              })
              .eq('user_id', pending.user_id)
              .is('chat_id', null)
            if (error) {
              console.error('reader-bot: link claim failed')
              await sendMessage(botToken, chatId, 'Linking failed on my side — try the fresh link from the app once more.')
            } else {
              await sendMessage(botToken, chatId, WELCOME)
            }
          }
        }
      } else if (cmd === '/read') {
        await handleRead(chatId)
      } else if (cmd === '/level') {
        // Re-opens the one-tap question at any time (Doc 16 §5
        // amendment #3), with the intro line naming the basis
        // currently in charge. Unlinked chats get the explainer —
        // there is no row to declare onto.
        const link = await linkByChat(chatId)
        if (!link) {
          await sendMessage(botToken, chatId, LINK_EXPLAINER)
        } else {
          const row = await loadState(link.user_id)
          const state = (row?.state ?? {}) as Record<string, unknown>
          const { band, bandSource } = knownFor(state, link.declared_band ?? null)
          await sendMessage(botToken, chatId, levelIntro(bandSource, bandSource === 'none' ? null : band), {
            reply_markup: levelKeyboard,
          })
        }
      } else if (cmd === '/unlink') {
        const { data: cleared } = await supabaseAdmin
          .from('telegram_links')
          .update({ chat_id: null, username: null, linked_at: null })
          .eq('chat_id', chatId)
          .select('user_id')
        await sendMessage(
          botToken,
          chatId,
          cleared && cleared.length > 0
            ? 'Unlinked. This chat will not receive Yonde Reader messages. Your queue and everything you mined stay in Yonde, untouched.'
            : 'This chat is not linked to a Yonde account, so there was nothing to unlink.',
        )
      } else {
        await sendMessage(botToken, chatId, HELP)
      }
    } catch (err) {
      console.error('reader-bot: message handling failed', err)
    }
    // Always 200 after the secret check: a non-200 makes Telegram
    // retry the same update, which helps nobody.
    return json({ ok: true })
  } catch (err) {
    console.error('reader-bot error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
