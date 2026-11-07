import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { applyFeedback, BANDS, bandRank, buildKnownSet, capCandidates, countKnownContent, currentBatchWords, deckCreditSet, evaluateDraft, fitCallback, FOUNDATIONS_COMFY_TARGET, hasFeedbackFor, isColdStart, isDispatchDue, kanjiReadings, levelKeyboard, nextForbiddenList, parseFitCallback, passageNewKanji, passageRatio, passageRecyclesBatch, pickGentle, pickPassage, pickStarter, resolveBand, seenKanjiSet, serveBandFor, shouldAskLevel, shouldGenerate, unknownContentHeadwords, voiceReadWindow } from './fit.ts'
import { DECK_LEVELS } from './deck.ts'
import { DECK_GLOSS } from './gloss.ts'
import { segmentText } from './segment.ts'
import { synthesizeSpeechOgg } from './voice.ts'
import { READ_ALOUD_PASS_SCORE, firstMissedCandidate, scoreReadAloud } from './score.ts'
import { bt, botFittedFooter, botLevelIntro, botTrialUpCopy, languageFromState, languageFromStateRow, type BotLang } from './i18n.ts'

// Yonde Reader bot (Doc 16 §6/§7 R0, Doc 12 step 3.6).
//
// Two routes:
//   POST /functions/v1/reader-bot            — the Telegram webhook.
//   POST /functions/v1/reader-bot?dispatch=1 — the morning dispatch
//     (pg_cron; x-cron-secret vs READER_CRON_SECRET, fail closed).
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
//
// 2026-11-06 late (Landry, live: "build everything, don't stop") —
// R1/R2 pulled forward, Doc 16 build status:
// · CONTINUATION: a Too Hard or Push Me tap no longer ends in a
//   promise — after the protocol message the NEXT passage is served
//   immediately, at the stepped-back / pushed step. Silence after
//   feedback was the live test's first gap.
// · OVERSHOOT v2: when the too-hard passage carried no unknown
//   candidates (its difficulty was register — keigo — invisible to
//   the word gate), the explanation falls back to the words the
//   learner has not personally met (passage tokens not in their
//   QUEUE — credit is an assumption, the queue is fact), hardest
//   first; the honest "ran ahead of your words" line remains the
//   last resort. Register difficulty is a KNOWN GATE LIMIT (§9);
//   the Too Hard tap is today's corrective for it.
// · VOICE OUT: every passage send is followed by the passage as a
//   Telegram voice note (the file_id is cached on the passage row,
//   migration 00014). Text first, voice second; voice never blocks
//   text. The synthesis SEAT moved with amendment #6 (below): Edge
//   TTS refuses this function's datacenter egress, so an uncached
//   passage falls through a direct Edge attempt to a voice_jobs
//   row (migration 00016) for the VM Voice Worker to synthesize.
// · VOICE IN (R2): a voice note from a linked learner is the
//   read-aloud PROOF. With READER_STT_API_KEY set (amendment #6),
//   the note is transcribed by Groq's Whisper and SCORED in code
//   (score.ts — the readAloud twin): at/above 0.7 it counts as
//   that passage's comfy 'read' through the same applyFeedback +
//   dedupe the tap uses, and the reply carries the honest
//   reading-match line plus Nao's one fix. Without the key — or
//   on any transcription failure — the v1 duration proof
//   (voiceReadWindow plausibility) is the fallback, byte-for-byte
//   the v1 behaviour: no transcript, no score claim.
// · VOICE WORKER (amendment #6, 2026-11-07): the ?voicejob=<id>
//   route (x-cron-secret, the dispatch pattern) delivers
//   worker-made audio — download from the voice-cache bucket,
//   sendVoice, cache the file_id on the passage, mark the job
//   sent. The dispatch route sweeps done-but-unsent jobs as the
//   backstop, so a missed poke delays a voice note, never loses it.
// · MORNING DISPATCH (R1): POST ?dispatch=1, authorised by the
//   x-cron-secret header vs READER_CRON_SECRET (pg_cron fires it,
//   like yonde-call-scheduler), serves due learners their morning
//   passage — the bot's ONE sanctioned proactive message (§9).
// · MINI APP: every passage keyboard gains an "Open in Yonde" row
//   (web_app → the PWA /reader route) — tap-a-word lives there,
//   where per-word taps are possible; chat stays fully readable.
// · KANJI READINGS (amendment #9): every passage message carries a
//   collapsed breakdown of EVERY kanji-bearing word in the passage
//   (kanjiReadings in fit.ts, readings from DECK_GLOSS) — not just
//   the new words: a word known by deck credit can still hide a
//   kanji the learner never learned. Expandable blockquote after
//   the passage text; the passage itself stays clean, and the
//   stored text (voice-out, scoring) is untouched.
//
// The bot never nags (Doc 16 §9): it sends when asked, greets once
// each morning when due, and is silent otherwise. There is no
// reading streak and no missed-day message.
//
// Env: READER_BOT_TOKEN, READER_WEBHOOK_SECRET (both set as function
// secrets when the bot is created — never in code), PUSH_ADMIN_SECRET
// (the existing admin pattern from call-scheduler/push-send),
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (runtime-injected).
// R0.5 adds: OPENROUTER_API_KEY (the chat function's project secret,
// reused under the same name) and optional READER_MODEL (default
// 'openrouter/free' — Doc 03 Tier C standing rule). Dispatch adds
// READER_CRON_SECRET (the pg_cron job's shared secret, which also
// authorises the ?voicejob route). Amendment #6 adds optional
// READER_STT_API_KEY (Groq — the voice-in transcription key;
// absent = the duration proof only, exactly the v1 behaviour).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret, x-telegram-bot-api-secret-token, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const RECENT_DAYS = 14

// The Mini App surface (Doc 16 R1): the live PWA's /reader route.
// web_app buttons are valid in private chats with the bot — and
// every Reader chat is private by design.
const MINI_APP_READER_URL = 'https://jpn2easy.vercel.app/reader?tg=4'

// The doors to the app itself (Doc 16 §5 amendment #7): the app
// root, not just /reader. Every status and dead-end reply carries
// the Open Yonde button, the chat Menu button opens the same door
// (registered by reader-admin via setChatMenuButton), and /app is
// the typed route to it.
const MINI_APP_URL = 'https://jpn2easy.vercel.app/?tg=4'
const appButton = (lang: BotLang) => ({
  text: bt(lang, 'app.openYonde'),
  web_app: { url: MINI_APP_URL },
})
const appKeyboard = (lang: BotLang = 'en', rows: Record<string, unknown>[][] = []) => ({
  inline_keyboard: [...rows, [appButton(lang)]],
})

// The morning greeting (Doc 16 R1/§9) is copy key
// 'morning.greeting' in i18n.ts: the one line that precedes a
// dispatched passage. Warm, short, and free of streak/nag
// language — it greets the day; it never comments on yesterday.

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

// Trim an overlong draft at a sentence boundary instead of
// discarding it (Doc 16 §5 amendment #7): the free model often runs
// past the length guard, and the 93–97% gate judges whatever
// survives the trim — nothing unjudged is ever sent. Returns null
// when there is no sentence boundary late enough to keep a real
// passage (≥400 chars): a stub is not a passage.
function trimDraftToFit(text: string, max = 1200): string | null {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const boundary = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'))
  if (boundary < 400) return null
  return cut.slice(0, boundary + 1)
}

// One OpenRouter draft (the chat function's call shape: same base,
// same headers, OPENROUTER_API_KEY env). Returns { text, reason }:
// text is the cleaned passage or null, and reason NAMES the
// outcome — 'ok', 'no_key', 'http_<status>', 'timeout', 'network',
// 'bad_response', 'too_short', 'too_long'. Until amendment #7 every
// failure collapsed into the same silent null, and production
// logged generation_failed { attempts: 0 } forever with no way to
// tell which door was closed. Generation failure must degrade to
// the honest reply, never break the webhook.
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
      console.error(`reader-bot: generation HTTP ${res.status}`)
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
    console.error(`reader-bot: generation draft failed reason=${reason}`)
    return { text: null, reason }
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
// All user-facing furniture lives in i18n.ts (Doc 16 §5
// amendment #11), keyed by the linked user's app language. The
// comments that used to sit on each constant — the voice-proof
// instruction (amendment #10), the N7+ joke reply (amendment #7),
// the ratchet announcement, the level ask + intro (amendment #3),
// the starter footer (amendment #2) and the checkup switch line —
// describe copy keys there now: 'voice.instruction',
// 'n7.jokeReply', 'trialUp', 'level.ask' / 'level.intro*',
// 'starter.footer' and 'checkup.switch'.

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

    // ---------- cron routes: morning dispatch (R1) + voice jobs ----------
    // Checked BEFORE the webhook route: cron callers carry no
    // Telegram secret, only x-cron-secret vs READER_CRON_SECRET.
    // Fail closed: no env secret set, no service — ever. Two flags:
    //   ?dispatch=1     — the morning run (pg_cron, R1);
    //   ?voicejob=<id>  — the Voice Worker's completion poke
    //     (voice-queue fires it the moment a job's audio lands;
    //     amendment #6).
    // The actual serving happens in handleDispatch / handleVoiceJob
    // once the shared helpers below exist; this branch only
    // authorises and flags.
    const routeParams = new URL(req.url).searchParams
    let dispatchMode = false
    let voiceJobId: string | null = null
    if (routeParams.get('dispatch') === '1' || routeParams.get('voicejob')) {
      const cronSecret = Deno.env.get('READER_CRON_SECRET') ?? ''
      const providedCron = req.headers.get('x-cron-secret') ?? ''
      if (!cronSecret || !providedCron || providedCron !== cronSecret) {
        return json({ error: 'Unauthorized' }, 401)
      }
      if (!botToken) {
        console.error('reader-bot: READER_BOT_TOKEN is not set')
        return json({ error: 'Bot is not configured' }, 500)
      }
      if (routeParams.get('dispatch') === '1') dispatchMode = true
      else voiceJobId = routeParams.get('voicejob')
    } else {
      // ---------- webhook route ----------
      // Fail closed: no configured secret, no service.
      if (!webhookSecret || req.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret) {
        return json({ error: 'Unauthorized' }, 401)
      }
      if (!botToken) {
        console.error('reader-bot: READER_BOT_TOKEN is not set')
        return json({ error: 'Bot is not configured' }, 500)
      }
    }

    const update = (dispatchMode || voiceJobId) ? null : await req.json().catch(() => null)
    if (!dispatchMode && !voiceJobId && !update) return json({ ok: true })

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const logEvent = async (userId: string, type: string, payload: Record<string, unknown>) => {
      const { error } = await supabaseAdmin.from('metrics_events').insert({ user_id: userId, type, payload })
      if (error) console.error(`reader-bot: metrics insert failed type=${type}`)
    }

    const linkByChat = async (chatId: number) => {
      const { data } = await supabaseAdmin
        .from('telegram_links')
        .select('user_id, chat_id, username, declared_band, declared_at, fit_step, last_good_step, comfy_streak')
        .eq('chat_id', chatId)
        .maybeSingle()
      return data
    }

    // The Telegram-side declaration in resolveBand's input shape.
    const declaredOf = (link: { declared_band?: string | null; declared_at?: string | null } | null | undefined) => ({
      band: link?.declared_band ?? null,
      at: link?.declared_at ?? null,
    })

    const loadState = async (userId: string) => {
      const { data } = await supabaseAdmin
        .from('learner_state')
        .select('state, updated_at')
        .eq('user_id', userId)
        .maybeSingle()
      return data // { state, updated_at } | null
    }

    // Bot language (Doc 16 §5 amendment #11): the app's language
    // slice is the single source of truth — no bot-side storage.
    // Handlers that already hold a state row resolve from it
    // directly (languageFromState); the helpers below are for the
    // handlers that do not, and each performs the one resolution
    // read for that update. The resolved value is then threaded
    // through opts.lang so nested serves never resolve twice.
    // Unlinked users and a missing slice resolve to 'en'.
    const langForUser = async (userId: string): Promise<BotLang> =>
      languageFromStateRow(await loadState(userId))
    const langForLink = async (
      link: { user_id?: string | null } | null | undefined,
    ): Promise<BotLang> => (link?.user_id ? await langForUser(link.user_id) : 'en')

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
    const knownFor = (
      state: Record<string, unknown>,
      declared?: { band?: string | null; at?: string | null } | string | null,
    ) => {
      const queue = Array.isArray(state.queue) ? state.queue : []
      const estimate = (state.diagnosis as Record<string, unknown> | undefined)?.jlptEstimate
      // Amendment #7: the declaration has TWO stores (the Telegram
      // row passed in here, and learner_state.state.declaredLevel,
      // the app's same-shaped write) and resolveBand is the one
      // choke point that reconciles them — latest timestamp wins,
      // raw 'N7' normalizes to N5 + joke there and only there.
      const stateDeclared = (state.declaredLevel ?? null) as { band?: unknown; at?: unknown } | null
      const { band: resolvedBand, source: bandSource, joke: isJoke } = resolveBand({
        diagnosisBand: typeof estimate === 'string' ? estimate : null,
        declaredBand: typeof declared === 'string' ? declared : (declared?.band ?? null),
        declaredAt: declared && typeof declared === 'object' ? (declared.at ?? null) : null,
        stateDeclaredBand: typeof stateDeclared?.band === 'string' ? stateDeclared.band : null,
        stateDeclaredAt: typeof stateDeclared?.at === 'string' ? stateDeclared.at : null,
      })
      const joke = isJoke === true
      const hasDiagnosis = bandSource === 'diagnosis'
      const band = resolvedBand ?? 'N4' // gentle default; the footer says so
      const credit = resolvedBand ? deckCreditSet(DECK_LEVELS, resolvedBand) : null
      // Fit v2 (amendment #10): ENCOUNTERS — words the learner
      // genuinely met outside the queue (Anki ratings, Speed Cards
      // answers; synced into this same state document by the app).
      // They ride buildKnownSet's personal-vocab slot: FULL proven
      // credit, deliberately unlike the deck credit below them,
      // which stays an assumption. Malformed entries are dropped
      // here; buildKnownSet trims again.
      const encounters = (Array.isArray(state.encounters) ? state.encounters : [])
        .filter((w): w is string => typeof w === 'string')
      const known = buildKnownSet(queue, encounters, credit)
      // Foundations pace is DERIVED, never stored: the winning
      // declaration is raw 'N7' AND no diagnosis exists (a diagnosis
      // overrides band, joke AND pace — resolveBand already put it
      // in charge). While it holds, the ratchet needs double the
      // proof (FOUNDATIONS_COMFY_TARGET) and fitted serves run
      // gentlest-first until the first ratchet completes.
      const pace = bandSource === 'declared' && joke ? 'foundations' : 'standard'
      // basisBand is the resolved band itself (null when 'none'):
      // adaptive fit (amendment #4) shifts the SERVE band from it,
      // while credit above keeps following the basis untouched.
      return { queue, known, encounters, hasDiagnosis, band, bandSource, basisBand: resolvedBand, joke, pace }
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
    ): Promise<{ picked: { passage: Record<string, unknown>; ratio: number } | null; attempted: boolean; reason: string | null }> => {
      const since = new Date(Date.now() - GEN_COOLDOWN_MS).toISOString()
      const { data: recentGen } = await supabaseAdmin
        .from('metrics_events')
        .select('id')
        .eq('user_id', link.user_id)
        .in('type', ['passage_generated', 'generation_failed'])
        .gte('created_at', since)
        .limit(1)
      if (!shouldGenerate(null, !recentGen || recentGen.length === 0)) {
        return { picked: null, attempted: false, reason: 'cooldown' }
      }

      const topic = topicFor(state, link.user_id)
      const chars = GEN_LENGTH_BY_BAND[band] ?? 200
      let forbidden: string[] = []
      let calls = 0
      let lastReason: string | null = null
      for (let attempt = 1; attempt <= GEN_MAX_ATTEMPTS; attempt++) {
        const { text: draft, reason } = await generateDraft(band, topic, chars, forbidden)
        if (draft === null) {
          // Amendment #7: a failed draft CONSUMES the attempt and
          // the loop retries — the old code broke on the first null,
          // so one bad response (an overlong draft, a hiccup) ended
          // the whole sequence and production never produced a
          // single foundry passage. Only a missing key is hopeless:
          // it stops at once instead of burning the sequence.
          lastReason = reason
          console.error(`reader-bot: generation attempt ${attempt} produced no draft reason=${reason}`)
          if (reason === 'no_key') break
          continue
        }
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
          return { picked: { passage, ratio: verdict.ratio }, attempted: true, reason: null }
        }
        forbidden = nextForbiddenList(forbidden, verdict.unknowns)
        lastReason = 'gate_rejected'
      }
      // The reason rides the event (amendment #7): the NEXT silent
      // failure must be diagnosable from the metrics alone.
      await logEvent(link.user_id, 'generation_failed', { band, topic, attempts: calls, reason: lastReason })
      return { picked: null, attempted: true, reason: lastReason }
    }

    // ---------- voice out ----------
    // After a passage TEXT send, the passage also arrives as a
    // Telegram voice note (Doc 16, 2026-11-06 late). Cached rows
    // (voice_file_id, migration 00014) resend by file_id — free and
    // instant. A fresh synthesis uploads once and the file_id is
    // stored back (best-effort).
    //
    // Amendment #6 (2026-11-07): Edge TTS refuses THIS function's
    // datacenter egress (the same block the `tts` function hit —
    // Doc 17), so the direct synthesis below is a lottery ticket,
    // not a route. When it produces nothing, the passage is queued
    // for the VM Voice Worker instead (voice_jobs, migration
    // 00016): the worker synthesizes from an egress Microsoft
    // answers, voice-queue stores the audio in the voice-cache
    // bucket, and the ?voicejob route delivers it moments later.
    // ANY failure along the way is a console line, never a
    // user-facing error: voice enhances the passage; the text is
    // the passage.
    const enqueueVoiceJob = async (chatId: number, passage: Record<string, unknown>) => {
      try {
        const passageId = String(passage.id ?? '')
        const text = String(passage.text ?? '')
        if (!passageId || !text) return
        // One live job per passage is enough: a pending/claimed job
        // will produce the audio, and a done one is awaiting (or
        // retrying) delivery through the dispatch sweep. A failed
        // job does NOT block a fresh enqueue — the next send of
        // this passage retries the worker.
        const { data: live } = await supabaseAdmin
          .from('voice_jobs')
          .select('id')
          .eq('passage_id', passageId)
          .in('status', ['pending', 'claimed', 'done'])
          .limit(1)
        if (live && live.length > 0) return
        const { error } = await supabaseAdmin
          .from('voice_jobs')
          .insert({ passage_id: passageId, chat_id: chatId, text })
        if (error) console.error('reader-bot: voice job enqueue failed')
      } catch (err) {
        console.error('reader-bot: voice job enqueue failed', err)
      }
    }

    const sendPassageVoice = async (chatId: number, passage: Record<string, unknown>) => {
      try {
        const cached = typeof passage.voice_file_id === 'string' ? passage.voice_file_id : ''
        if (cached) {
          await tg(botToken, 'sendVoice', { chat_id: chatId, voice: cached })
          return
        }
        const bytes = await synthesizeSpeechOgg(String(passage.text ?? ''))
        if (bytes) {
          const form = new FormData()
          form.append('chat_id', String(chatId))
          form.append('voice', new Blob([bytes], { type: 'audio/ogg' }), 'passage.ogg')
          const res = await fetch(`https://api.telegram.org/bot${botToken}/sendVoice`, {
            method: 'POST',
            body: form,
          })
          const body = await res.json().catch(() => null)
          const fileId = body?.result?.voice?.file_id
          if (body?.ok && typeof fileId === 'string') {
            passage.voice_file_id = fileId // in case this row sends again in-process
            const { error } = await supabaseAdmin
              .from('reading_passages')
              .update({ voice_file_id: fileId })
              .eq('id', String(passage.id))
            if (error) console.error('reader-bot: voice_file_id cache write failed')
            return
          }
          console.error(`reader-bot: sendVoice upload failed status=${res.status}`)
        }
        // No voice from this egress — hand the passage to the VM
        // Voice Worker. Its delivery arrives as its own message
        // through the ?voicejob route (or the dispatch sweep).
        await enqueueVoiceJob(chatId, passage)
      } catch (err) {
        console.error('reader-bot: passage voice send failed', err)
      }
    }

    // ---------- /read ----------
    // opts.fromLevelTap: this serve ANSWERS a level tap, so the ask
    // below must not fire again inside it. opts.forceStarter: the
    // tap was 'Not sure' — serve the starter track even if the
    // census alone would not call this learner cold. opts
    // .declaredBand overrides the row's value (the level callback
    // has just written it; the serve should not depend on re-read
    // timing). opts.kind = 'morning': a dispatch serve (R1) — the
    // caller has already verified basis + due-ness, the greeting
    // line precedes the passage, and the passage_sent payload is
    // tagged so tomorrow's dispatch can see today's. opts
    // .againPassageId (amendment #7): re-serve THIS passage — the
    // learner tapped Read It Again on the no-fit reply; the gate
    // re-verifies it below before anything is sent.
    const handleRead = async (
      chatId: number,
      opts: { declaredBand?: string | null; declaredAt?: string | null; fromLevelTap?: boolean; forceStarter?: boolean; kind?: string; againPassageId?: string; lang?: BotLang } = {},
    ) => {
      const link = await linkByChat(chatId)
      if (!link) {
        await sendMessage(botToken, chatId, bt('en', 'link.explainer'))
        return
      }
      const declaredBand = opts.declaredBand !== undefined ? opts.declaredBand : (link.declared_band ?? null)
      const declaredAt = opts.declaredAt !== undefined ? opts.declaredAt : (link.declared_at ?? null)
      const row = await loadState(link.user_id)
      const state = (row?.state ?? {}) as Record<string, unknown>
      // Resolved ONCE for this serve: a caller that already
      // resolved the language for this update passes it in;
      // otherwise it comes from the state row just loaded — the
      // read this handler was already making, never a second one.
      const lang = opts.lang ?? languageFromState(state)
      const { queue, known, encounters, hasDiagnosis, band, bandSource, basisBand, joke, pace } = knownFor(state, {
        band: declaredBand,
        at: declaredAt,
      })

      // Fit v2 (amendment #10): the rank keys every gated pick
      // below reads — seen kanji from PROVEN words only (queue
      // fronts ∪ encounters; the below-band deck credit inside
      // `known` contributes nothing here, because its glyphs were
      // assumed, never met), and the current batch — ungraduated
      // Reader-sourced queue words — whose re-use in a candidate
      // outranks even the new-kanji dose.
      const seenKanji = seenKanjiSet([
        ...queue.map((i) => (typeof i?.front === 'string' ? i.front : '')),
        ...encounters,
      ])
      const batchWords = currentBatchWords(queue)
      const fitOpts = { seenKanji, batchWords }

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
        await sendMessage(botToken, chatId, bt(lang, 'level.ask'), { reply_markup: levelKeyboard(bt(lang, 'level.notSure')) })
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
        .select('id, band, topic, text, tokens, new_word_candidates, source, voice_file_id')
      if (bankError || !bank) {
        console.error('reader-bot: passage bank fetch failed')
        await sendMessage(botToken, chatId, bt(lang, 'shelf.empty'))
        return
      }

      let picked: { passage: Record<string, unknown>; ratio: number } | null = null
      let coldStart = false
      let again = false
      if (opts.againPassageId) {
        // Read It Again (amendment #7): re-serving a passage the
        // 14-day freshness exclusion benched is the LEARNER's
        // choice, never a gate change — the passage still has to
        // pass the SAME gate against today's known set and serve
        // band before it is sent. If the learner's words have moved
        // past it, /read says so and falls through to the normal
        // flow.
        const againRow = bank.find((p) => String(p.id) === opts.againPassageId)
        const verified = againRow
          ? pickPassage([againRow as unknown as Record<string, unknown>], known, serveBand, [], fitOpts)
          : null
        if (againRow && verified) {
          picked = { passage: againRow as unknown as Record<string, unknown>, ratio: verified.ratio }
          again = true
        } else {
          await sendMessage(botToken, chatId, bt(lang, 'again.noLongerFits'))
        }
      }
      // Foundations pace (amendment #7): until the first ratchet
      // completes, fitted serves run GENTLEST-FIRST (pickGentle —
      // same window, same gate, starter order), so the earliest
      // reads are the kindest ones that honestly fit. The first
      // ratchet is visible in the step state itself: any step
      // movement (a trial fit_step, a settled last_good_step) means
      // it has fired and normal closest-to-target order resumes.
      const gentleActive = pace === 'foundations'
        && fitStep <= 0
        && (Number(link.last_good_step ?? 0) || 0) <= 0
      if (!picked && cold) {
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
        const fit = gentleActive
          ? (pickGentle(bank, known, serveBand, recentIds, fitOpts) ?? pickPassage(bank, known, serveBand, recentIds, fitOpts))
          : pickPassage(bank, known, serveBand, recentIds, fitOpts)
        if (fit) picked = { passage: fit.passage as Record<string, unknown>, ratio: fit.ratio }
      }
      let genOutcome: { attempted: boolean; reason: string | null } = { attempted: false, reason: null }
      if (!picked && !cold) {
        // R0.5: fitted generation — the bank was never written to
        // the 95% rule, so most learners fit nothing in it. A draft
        // that passes the SAME gate joins through the SAME send path
        // below; one that cannot pass is never sent. Skipped when
        // cold: generation validates drafts against the known set,
        // and against ~nothing every verdict is meaningless — the
        // spend buys rejections, not passages.
        const gen = await tryGenerate(link, state, known, serveBand)
        genOutcome = { attempted: gen.attempted, reason: gen.reason }
        if (gen.picked) picked = gen.picked
      }
      if (!picked) {
        // Amendment #7: the no-fit reply names the TRUE reason,
        // computed from the same facts the pick just saw — never
        // the old generic dead end. Case one: the 14-day freshness
        // exclusion is itself the blocker — an in-gate passage
        // exists, but the learner read it recently. The exclusion
        // exists for freshness, not safety, so the learner can
        // lift it for that one passage: Read It Again.
        const recentFit = !cold && queue.length > 0
          ? pickPassage(
            bank.filter((p) => recentIds.includes(String(p.id))),
            known,
            serveBand,
            [],
            fitOpts,
          )
          : null
        if (recentFit) {
          const againPassage = recentFit.passage as Record<string, unknown>
          await sendMessage(
            botToken,
            chatId,
            bt(lang, 'nofit.recent', {
              topic: esc(String(againPassage.topic || bt(lang, 'passage.defaultTopic'))),
            }),
            {
              reply_markup: appKeyboard(lang, [
                [{ text: bt(lang, 'nofit.readAgainButton'), callback_data: `again:${String(againPassage.id)}` }],
              ]),
            },
          )
          return
        }
        if (queue.length === 0) {
          await sendMessage(
            botToken,
            chatId,
            bt(lang, 'nofit.noSyncedWords'),
            { reply_markup: appKeyboard(lang) },
          )
          return
        }
        // Case two: the bank genuinely runs ahead of this learner's
        // words at their band. Say exactly that, own the generation
        // outcome when one was attempted, and name the nearest
        // useful action. (Not cold, has words, still nothing fits,
        // and NO band basis at all — bandSource 'none': no
        // diagnosis, no declaration — the checkup is named as the
        // switch that turns level-fitting on; the starter track
        // above already covers the truly cold, and a declared
        // learner already has a basis.)
        let noFit = bt(lang, 'nofit.base')
        if (genOutcome.attempted && genOutcome.reason !== 'cooldown') {
          noFit += bt(lang, 'nofit.generated')
        }
        noFit += bt(lang, 'nofit.forward')
        if (!cold && bandSource === 'none') noFit += bt(lang, 'checkup.switch')
        await sendMessage(botToken, chatId, noFit, { reply_markup: appKeyboard(lang) })
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
      const passageTokens = Array.isArray(passage.tokens) ? passage.tokens : []
      const newKanji = coldStart ? [] : passageNewKanji(passageTokens, seenKanji)
      const recycledBatch = !coldStart && passageRecyclesBatch(passageTokens, batchWords)
      // The footer names the fitting basis (Doc 16 §5 labelling):
      // with a diagnosis, the learner's level (via below-band deck
      // credit) and their queue; with a declared band, the level
      // THEY stated and their queue — the wording says the band
      // came from their tap, never from a measurement; with no
      // basis, the queue only. The copy must never claim level
      // fitting that did not happen, on a basis that did not
      // happen. A starter gets its own footer for the same reason:
      // no fit was measured, so none is claimed (amendment #2).
      // Adaptive fit (amendment #4): when the step is off zero the
      // footer says so in plain language — a stretch is named as a
      // stretch (with the way back named too), a gentler notch as
      // settling. Basis labelling above stays the basis; this line
      // is about where the fit AIMED today. Starters never claim
      // it: their selection ignores the step in v1. Fit v2 footer
      // honesty (amendment #10): the new-kanji dose is said out
      // loud — carrying new kanji is the POINT of the passage (the
      // goal is to know more), and the readings block below is
      // where those kanji wait. A batch-recycle pick says so too —
      // only when this passage truly re-uses batch words. Starters
      // skip both lines: their footer already explains that no fit
      // was measured. botFittedFooter (i18n.ts) composes all of
      // this in the learner's language from the same facts.
      const footerText = coldStart
        ? bt(lang, 'starter.footer')
        : botFittedFooter(lang, {
          bandSource,
          band,
          pct,
          newWordCount: newWords.length,
          joke,
          fitStep,
          basisBand,
          newKanjiCount: newKanji.length,
          recycledBatch,
        })
      // Kanji readings breakdown (amendment #9): EVERY kanji-bearing
      // word in the passage, not just the new words — a word can be
      // "known" by deck credit while its kanji was never learned,
      // and the learner stares at glyphs, not headwords. Collapsed
      // in an expandable blockquote between the passage and the
      // footer, so the clean read comes first and help is one tap
      // away; omitted entirely when nothing qualifies. The stored
      // passage text is untouched — voice-out and scoring read it
      // raw, exactly as before.
      const glossBook = DECK_GLOSS as Record<string, { reading: string; meaning: string }>
      const readings = kanjiReadings(
        Array.isArray(passage.tokens) ? passage.tokens : [],
        (h: string) => glossBook[h]?.reading,
        // Amendment #13 (Landry, 2026-11-07): the meaning rides
        // with the reading — knowing how a word sounds is half
        // the aid; the gloss is the other half. Deck meanings are
        // English source data in every UI language.
        (h: string) => glossBook[h]?.meaning,
      )
      const readingsBlock = readings.length > 0
        ? `<blockquote expandable>${bt(lang, 'passage.readingsHeader')}\n` +
          readings.map((r) => `${esc(r.word)} （${esc(r.reading)}）${r.meaning ? ` — ${esc(r.meaning)}` : ''}`).join('\n') +
          '</blockquote>'
        : null
      const lines = [
        bt(lang, 'passage.header', {
          topic: esc(String(passage.topic || bt(lang, 'passage.defaultTopic'))),
          band: esc(String(passage.band)),
        }),
        '',
        renderPassage(String(passage.text), newWords),
        ...(readingsBlock ? ['', readingsBlock] : []),
        '',
        footerText,
        '',
        bt(lang, 'voice.instruction'),
      ]
      // Every passage send carries the adaptive-fit feedback row
      // (amendment #4) under Mine: [Read It ✓] [Push Me 🔥]
      // [Too Hard]. The payloads carry the passage id (fitCallback)
      // so the handler can dedupe — one tap per passage counts —
      // and so Too Hard can explain THAT passage. Read It ✓ is
      // self-report, honestly: a tap cannot verify a read — the
      // voice-note read-aloud (handleVoiceNote) is the performed
      // proof, and both paths share this dedupe so a passage is
      // proven once, by voice or by tap.
      const keyboardRows: Record<string, string>[][] = []
      if (newWords.length > 0) {
        keyboardRows.push([{ text: bt(lang, 'passage.mineButton'), callback_data: `mine:${String(passage.id)}` }])
      }
      keyboardRows.push([
        { text: bt(lang, 'passage.readIt'), callback_data: fitCallback('read', String(passage.id)) },
        { text: bt(lang, 'passage.pushMe'), callback_data: fitCallback('up', String(passage.id)) },
        { text: bt(lang, 'passage.tooHard'), callback_data: fitCallback('hard', String(passage.id)) },
      ])
      // The Mini App row (R1): tap-a-word lives on the PWA /reader
      // page — chat text cannot do per-word taps — so every passage
      // keyboard ends with the door to it. The chat message stays
      // fully readable on its own; this is a door, never a toll.
      keyboardRows.push([
        { text: bt(lang, 'app.openReader'), web_app: { url: MINI_APP_READER_URL } },
      ])
      const extra: Record<string, unknown> = { reply_markup: { inline_keyboard: keyboardRows } }
      // A dispatch serve opens with the morning greeting — the one
      // sanctioned proactive line (Doc 16 §9) — then the passage.
      if (opts.kind === 'morning') {
        await sendMessage(botToken, chatId, bt(lang, 'morning.greeting'))
      }
      await sendMessage(botToken, chatId, lines.join('\n'), extra)
      // Voice out: the passage as a voice note, AFTER the text —
      // hearing it is also the model for the learner's own read-
      // aloud proof (voice-in). Never blocks, never errors the
      // send: sendPassageVoice swallows its own failures.
      await sendPassageVoice(chatId, passage)
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
        // Read It Again re-serves are flagged too: a freshness
        // exclusion the learner chose to lift (amendment #7).
        ...(again ? { again: true } : {}),
        // Dispatch sends are tagged so the next morning's due
        // check can see them (and the funnel can tell a pushed
        // passage from a pulled one).
        ...(opts.kind === 'morning' ? { kind: 'morning' } : {}),
        // Fit v2 (amendment #10): the dose this serve carried and
        // whether it was a batch recycle — the funnel can then see
        // the learning loop turning, not just passages moving.
        ...(coldStart ? {} : { newKanji: newKanji.length, recycledBatch }),
      })
    }

    // ---------- read-again + door callbacks (amendment #7) ----------
    // Read It Again rides the no-fit reply: the passage was benched
    // only by the 14-day freshness exclusion, and re-serving it is
    // the learner's choice — handleRead re-verifies it against the
    // unchanged gate before sending. The door callback is the
    // /start status reply's "Send Me a Passage" button: same serve
    // as /read, no new logic. Both verify ownership to the same
    // standard as every other callback.
    const handleAgain = async (cb: Record<string, unknown>) => {
      const cbId = String(cb.id ?? '')
      const from = (cb.from ?? {}) as Record<string, unknown>
      const message = (cb.message ?? {}) as Record<string, unknown>
      const chat = (message.chat ?? {}) as Record<string, unknown>
      const chatId = Number(chat.id)
      const passageId = String(cb.data ?? '').slice('again:'.length)

      const answer = (text: string) =>
        tg(botToken, 'answerCallbackQuery', { callback_query_id: cbId, text })

      const link = Number.isFinite(chatId) ? await linkByChat(chatId) : null
      if (!link || Number(from.id) !== chatId) {
        await answer(bt('en', 'common.notLinkedToast'))
        return
      }
      const lang = await langForUser(link.user_id)
      await answer(bt(lang, 'again.sending'))
      await handleRead(chatId, { againPassageId: passageId, lang })
    }

    const handleDoorRead = async (cb: Record<string, unknown>) => {
      const cbId = String(cb.id ?? '')
      const from = (cb.from ?? {}) as Record<string, unknown>
      const message = (cb.message ?? {}) as Record<string, unknown>
      const chat = (message.chat ?? {}) as Record<string, unknown>
      const chatId = Number(chat.id)

      const answer = (text: string) =>
        tg(botToken, 'answerCallbackQuery', { callback_query_id: cbId, text })

      const link = Number.isFinite(chatId) ? await linkByChat(chatId) : null
      if (!link || Number(from.id) !== chatId) {
        await answer(bt('en', 'common.notLinkedToast'))
        return
      }
      await answer('')
      await handleRead(chatId, { lang: await langForUser(link.user_id) })
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
        await answer(bt('en', 'common.notLinkedToast'))
        return
      }
      // Resolved once for this tap (amendment #11); every toast
      // and follow-up below speaks it.
      const lang = await langForUser(link.user_id)

      const { data: passage } = await supabaseAdmin
        .from('reading_passages')
        .select('id, band, topic, text, tokens, new_word_candidates')
        .eq('id', passageId)
        .maybeSingle()
      if (!passage) {
        await answer(bt(lang, 'mine.passageGone'))
        return
      }

      const row = await loadState(link.user_id)
      if (!row?.state) {
        // Conservative by design: never fabricate a learner document.
        await answer(bt(lang, 'mine.nothingSyncedToast'))
        await sendMessage(botToken, chatId, bt(lang, 'mine.nothingSynced'))
        return
      }
      const state = row.state as Record<string, unknown>
      const queue = Array.isArray(state.queue) ? [...(state.queue as Record<string, unknown>[])] : []
      // The SAME calibrated known set as /read (Doc 16 §5): a candidate
      // is mined only when it is genuinely new to this learner — not
      // queued, and not credited below their resolved band (diagnosis
      // or declared, amendment #3).
      const { known } = knownFor(state, declaredOf(link))
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
          note: bt(lang, 'mine.cardNote', { sentence: sentenceWith(String(passage.text), c.word) }),
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
          await answer(bt(lang, 'mine.failedToast'))
          return
        }
        await logEvent(link.user_id, 'word_mined', {
          passageId: String(passage.id),
          count: added,
          words: minedWords,
        })
      }

      await answer(
        added > 0
          ? bt(lang, added === 1 ? 'mine.toastOne' : 'mine.toastMany', { count: added })
          : bt(lang, 'mine.toastNone'),
      )
      await sendMessage(
        botToken,
        chatId,
        added > 0
          ? bt(lang, added === 1 ? 'mine.addedOne' : 'mine.addedMany', { count: added })
          : bt(lang, 'mine.nothingNew'),
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
        await answer(bt('en', 'common.notLinkedToast'))
        return
      }
      const lang = await langForUser(link.user_id)

      if (choice === 'none') {
        // 'Not sure' is a complete answer: no declaration is stored,
        // and the passage arrives via the starter track.
        await answer(bt(lang, 'level.noneToast'))
        await handleRead(chatId, { fromLevelTap: true, forceStarter: true, lang })
        return
      }
      // 'N7' is a real answer too (amendment #7): the learners' own
      // joke band — below N5, the lowest real level. It is stored
      // RAW, exactly as tapped; resolveBand is the one place that
      // normalizes it (to N5, with the joke remembered).
      if (choice !== 'N7' && !(BANDS as string[]).includes(choice)) {
        await answer('')
        return
      }

      const declaredAtIso = new Date().toISOString()
      const { error } = await supabaseAdmin
        .from('telegram_links')
        .update({ declared_band: choice, declared_at: declaredAtIso })
        .eq('user_id', link.user_id)
      if (error) {
        console.error('reader-bot: declared band write failed')
        await answer(bt(lang, 'common.saveFailedToast'))
        return
      }
      // The shared declaration contract (amendment #7): mirror the
      // declaration into learner_state.state.declaredLevel — the
      // same { band, at } shape the app writes — so resolveBand's
      // timestamp precedence sees this tap from both surfaces.
      // Conservative write-back in handleMine's pattern: only when
      // a state row already exists (never fabricate one), and
      // best-effort — the telegram_links write above is the record.
      const declRow = await loadState(link.user_id)
      if (declRow?.state) {
        const nextState = {
          ...(declRow.state as Record<string, unknown>),
          declaredLevel: { band: choice, at: declaredAtIso },
        }
        const { error: declError } = await supabaseAdmin
          .from('learner_state')
          .upsert(
            { user_id: link.user_id, state: nextState, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' },
          )
        if (declError) console.error('reader-bot: declaredLevel mirror write failed')
      }
      // The metric carries the RAW value, N7 included.
      await logEvent(link.user_id, 'level_declared', { band: choice })
      if (choice === 'N7') {
        await answer(bt(lang, 'level.n7Toast'))
        await sendMessage(botToken, chatId, bt(lang, 'n7.jokeReply'))
        // The gentlest start, served like Not sure: the starter
        // track, immediately. Foundations pace (derived in
        // knownFor) governs everything after this first serve.
        await handleRead(chatId, {
          fromLevelTap: true,
          forceStarter: true,
          declaredBand: 'N7',
          declaredAt: declaredAtIso,
          lang,
        })
        return
      }
      await answer(bt(lang, 'level.bandToast', { band: choice }))
      // Serve immediately through the normal /read flow: the tap
      // should feel like the passage just arrives. If nothing fits
      // even with the declared credit, the normal nothing-fits copy
      // follows — the declaration is saved either way.
      await handleRead(chatId, { fromLevelTap: true, declaredBand: choice, declaredAt: declaredAtIso, lang })
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
        await answer(bt('en', 'common.notLinkedToast'))
        return
      }

      // Foundations pace (amendment #7): an N7 declarer's ratchet
      // needs double the proof — the pace is derived from the same
      // resolveBand choke point as everything else. The state row
      // loaded here for the pace ALSO resolves this tap's language
      // (amendment #11): one read, both answers.
      const paceRow = await loadState(link.user_id)
      const paceState = (paceRow?.state ?? {}) as Record<string, unknown>
      const lang = languageFromState(paceState)
      const { pace } = knownFor(paceState, declaredOf(link))
      const comfyTarget = pace === 'foundations' ? FOUNDATIONS_COMFY_TARGET : undefined

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
        await answer(bt(lang, 'feedback.alreadyNoted'))
        return
      }

      const after = applyFeedback(
        {
          fit_step: link.fit_step ?? 0,
          last_good_step: link.last_good_step ?? 0,
          comfy_streak: link.comfy_streak ?? 0,
        },
        kind,
        comfyTarget,
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
        await answer(bt(lang, 'common.saveFailedToast'))
        return
      }
      await logEvent(link.user_id, 'reading_feedback', {
        kind,
        passageId,
        fitStepAfter: after.fit_step,
      })

      if (kind === 'read') {
        await answer(bt(lang, 'feedback.logged'))
        if (after.effect === 'trial_up') {
          // The ratchet just fired: the step was proven comfortable
          // AND the fit trials up one. Hori says so out loud — a
          // silent difficulty jump would read as the bot drifting,
          // and the way back is named in the same breath. The count
          // word follows the pace that was actually applied.
          await sendMessage(botToken, chatId, botTrialUpCopy(lang, comfyTarget))
        }
      } else if (kind === 'up') {
        await answer(after.effect === 'max' ? bt(lang, 'feedback.pushMax') : bt(lang, 'feedback.pushing'))
        // CONTINUATION (2026-11-06 late): a push is a request for
        // the harder passage, not for a promise of one — serve it
        // now, at the step just written. At 'max' nothing moved, so
        // there is nothing new to serve: the toast alone is honest.
        if (after.effect !== 'max') {
          await handleRead(chatId, { lang })
        }
      } else if (kind === 'hard') {
        await answer(bt(lang, 'feedback.stepBack'))
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
        // The explanation block, three tiers (v2, 2026-11-06 late):
        //   1. the passage's unknown candidates for this learner
        //      (the amendment-#4 behaviour);
        //   2. when that list is EMPTY — the live-test case: the
        //      passage's difficulty was register (keigo), invisible
        //      to the word gate, so its candidate list carried
        //      nothing to explain — fall back to the words the
        //      learner has not personally MET: passage content
        //      tokens whose headword is not among their QUEUE
        //      fronts. The deck credit is deliberately ignored
        //      here: credit is an assumption (graded-reader
        //      convention); the queue is fact (words they actually
        //      mined, drilled, met). Hardest first, cap 12;
        //   3. when even that is empty — every content word has
        //      crossed their queue and it was STILL too hard — the
        //      original honest line: the difficulty was register,
        //      not vocabulary, and no word list can show it.
        let explainBlock = bt(lang, 'feedback.explainFallback')
        if (passage) {
          const stateRow = await loadState(link.user_id)
          const fbState = (stateRow?.state ?? {}) as Record<string, unknown>
          const { known, queue } = knownFor(fbState, declaredOf(link))
          const lineFor = (word: string, reading?: string, meaning?: string) => {
            const bits = [esc(word)]
            if (reading && reading !== word) bits.push(esc(reading))
            if (meaning) bits.push(esc(meaning))
            return bits.join(' — ')
          }
          const unknownCands = withCandidateLevels(passage as Record<string, unknown>)
            .filter((c) => c.word && !known.has(c.h || c.word))
          if (unknownCands.length > 0) {
            const wordLines = capCandidates(unknownCands).map((c) => lineFor(c.word, c.reading, c.meaning))
            explainBlock = bt(lang, 'feedback.explainCandidates', { lines: wordLines.join('\n') })
          } else {
            const queueSet = buildKnownSet(queue)
            const unmetHeads = unknownContentHeadwords(passage.tokens, queueSet)
            const deck = DECK_LEVELS as Record<string, string>
            const gloss = DECK_GLOSS as Record<string, { reading: string; meaning: string }>
            const toks = Array.isArray(passage.tokens) ? passage.tokens : []
            const items = unmetHeads.map((head, i) => {
              const tok = toks.find((t) => {
                const tt = t as { s?: string; h?: string; l?: string | null }
                return tt && (tt.h || tt.s) === head
              }) as { s?: string; h?: string; l?: string | null } | undefined
              const level = tok?.l ?? deck[head] ?? null
              return {
                word: tok?.s ?? head,
                reading: gloss[head]?.reading ?? '',
                meaning: gloss[head]?.meaning ?? '',
                // Hardest first: deck rank descending; a word with
                // no resolvable level sorts after the levelled ones
                // (likely a name or a fragment the deck never
                // carried — real deck-hard words lead the list).
                rank: level ? bandRank(level) : 0,
                i,
              }
            })
            items.sort((a, b) => (b.rank - a.rank) || (a.i - b.i))
            const top = items.slice(0, 12)
            if (top.length > 0) {
              const wordLines = top.map((it) => lineFor(it.word, it.reading, it.meaning))
              explainBlock = bt(lang, 'feedback.explainUnmet', { lines: wordLines.join('\n') })
            }
          }
        }
        const parts = [
          bt(lang, 'feedback.apology'),
          explainBlock,
          bt(lang, 'feedback.closing'),
        ]
        await sendMessage(botToken, chatId, parts.join('\n\n'))
        // CONTINUATION (2026-11-06 late): the gracious return must
        // DELIVER, not promise. The live test's silence after the
        // apology is the bug this line fixes: the next passage —
        // fitted at the stepped-back state just written — arrives
        // now, as this tap's own answer. If nothing can be served,
        // handleRead's own copy says so: never silence.
        await handleRead(chatId, { lang })
      }
    }

    // ---------- voice in: the read-aloud proof (R2) ----------
    // A voice note from a linked learner is a READ, performed out
    // loud — the receipt the feedback taps cannot be (Doc 16, 2026-
    // 11-06 late). Two proofs, one effect:
    // · SCORED (amendment #6, when READER_STT_API_KEY is set): the
    //   audio is downloaded via getFile and transcribed by Groq's
    //   Whisper (tryTranscribeAndScore below); the transcript is
    //   scored in code (score.ts) and the attempt logs
    //   shadow_attempted { passageId, score, method:
    //   'groq-whisper' }. At/above READ_ALOUD_PASS_SCORE the read
    //   counts, and the reply carries the honest reading-match
    //   line plus Nao's one fix when a new word was skipped.
    // · DURATION (v1, the fallback): Telegram puts the duration in
    //   the update and the audio is never downloaded; a duration
    //   inside voiceReadWindow's plausible window counts the same
    //   way and logs shadow_attempted { passageId, durationSec,
    //   expectedSec, plausible }.
    // Both count through the SAME applyFeedback transition and the
    // SAME hasFeedbackFor dedupe as the Read It ✓ tap (shared via
    // applyVoiceReadEffect) — a passage is proven once, by voice
    // or by tap, never twice. The scored path is authoritative
    // when it produces a score; ANY transcription failure falls
    // back to the duration proof, and without the key the handler
    // behaves byte-for-byte as v1 did.
    // The comfy-read effect of a PROVEN voice read — shared by the
    // duration proof (v1) and the Groq-scored proof (amendment #6):
    // dedupe against reading_feedback (a passage is proven once,
    // by voice or by tap, never twice), apply the same
    // applyFeedback 'read' transition the Read It ✓ tap uses, and
    // write the resulting fit state back to the link row. Returns
    // { trialUp, target }: whether the ratchet trialled the learner
    // up a step (callers say so out loud when it fires, with the
    // count word for the pace that was actually applied).
    const applyVoiceReadEffect = async (
      link: { user_id: string; fit_step?: number | null; last_good_step?: number | null; comfy_streak?: number | null; declared_band?: string | null; declared_at?: string | null },
      passageId: string,
      via: string,
    ): Promise<{ trialUp: boolean; target?: number }> => {
      const { data: priorRows } = await supabaseAdmin
        .from('metrics_events')
        .select('payload')
        .eq('user_id', link.user_id)
        .eq('type', 'reading_feedback')
        .order('created_at', { ascending: false })
        .limit(100)
      const priorPayloads = (priorRows || []).map((r) => r.payload as Record<string, unknown>)
      if (hasFeedbackFor(priorPayloads, passageId)) return { trialUp: false }
      // Foundations pace applies here exactly as on the tap path:
      // double the proof before the ratchet dares a step up.
      const voiceStateRow = await loadState(link.user_id)
      const voiceState = (voiceStateRow?.state ?? {}) as Record<string, unknown>
      const { pace: voicePace } = knownFor(voiceState, declaredOf(link))
      const voiceTarget = voicePace === 'foundations' ? FOUNDATIONS_COMFY_TARGET : undefined
      const after = applyFeedback(
        {
          fit_step: link.fit_step ?? 0,
          last_good_step: link.last_good_step ?? 0,
          comfy_streak: link.comfy_streak ?? 0,
        },
        'read',
        voiceTarget,
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
        console.error('reader-bot: voice-read fit state write failed')
        return { trialUp: false }
      }
      await logEvent(link.user_id, 'reading_feedback', {
        kind: 'read',
        passageId,
        fitStepAfter: after.fit_step,
        via,
      })
      return { trialUp: after.effect === 'trial_up', target: voiceTarget ?? 3 }
    }

    // ---------- voice in: Groq transcription (amendment #6) ----------
    // When READER_STT_API_KEY is set, the learner's voice note is
    // downloaded from Telegram and transcribed by Groq's
    // OpenAI-compatible endpoint (whisper-large-v3-turbo; the free
    // tier's 28,800 audio-seconds/day dwarfs a Reader's ~20-second
    // notes). The transcript is scored HERE, in code (score.ts) —
    // the AI is a sense; the verdict is spine, like every Reader
    // judgement. Returns { score, missed } or null on ANY failure —
    // no key, no file, HTTP error, timeout, empty transcript — and
    // null always means the caller runs the v1 duration proof
    // instead. The transcript itself is never logged or stored;
    // only the score and the one missed word leave this function.
    const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
    const tryTranscribeAndScore = async (
      voice: Record<string, unknown>,
      passage: Record<string, unknown>,
      link: { user_id: string; declared_band?: string | null; declared_at?: string | null },
    ): Promise<{ score: number; missed: Record<string, unknown> | null } | null> => {
      const key = Deno.env.get('READER_STT_API_KEY') ?? ''
      if (!key) return null
      const fileId = typeof voice.file_id === 'string' ? voice.file_id : ''
      if (!fileId) return null
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 45000)
      try {
        // Telegram hands out a file path, then serves the bytes.
        const info = await tg(botToken, 'getFile', { file_id: fileId })
        const filePath = info?.result?.file_path
        if (!info?.ok || typeof filePath !== 'string' || !filePath) return null
        const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`, { signal: ctrl.signal })
        if (!fileRes.ok) return null
        const audio = await fileRes.arrayBuffer()
        if (!audio.byteLength || audio.byteLength > 10 * 1024 * 1024) return null

        const form = new FormData()
        form.append('file', new Blob([audio], { type: 'audio/ogg' }), 'voice.ogg')
        form.append('model', 'whisper-large-v3-turbo')
        form.append('language', 'ja')
        form.append('response_format', 'json')
        const res = await fetch(GROQ_TRANSCRIBE_URL, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Authorization': `Bearer ${key}` },
          body: form,
        })
        if (!res.ok) {
          console.error(`reader-bot: groq transcription HTTP ${res.status}`)
          return null
        }
        const data = await res.json().catch(() => null)
        const transcript = typeof data?.text === 'string' ? data.text.trim() : ''
        // An empty transcript proves nothing either way (silence,
        // or a hallucination guard tripping) — fall back to the
        // duration proof rather than scoring a phantom read.
        if (!transcript) return null

        const { score } = scoreReadAloud(String(passage.text ?? ''), transcript)
        // Nao's one fix runs over THIS learner's new words for the
        // passage — the same list /read bolded: the passage's
        // candidates minus the learner's known set, in passage
        // order, checked by surface then headword.
        const stateRow = await loadState(link.user_id)
        const sttState = (stateRow?.state ?? {}) as Record<string, unknown>
        const { known } = knownFor(sttState, declaredOf(link))
        const newWords = withCandidateLevels(passage).filter((c) => c.word && !known.has(c.h || c.word))
        const missed = firstMissedCandidate(newWords, transcript) as unknown as Record<string, unknown> | null
        return { score, missed }
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    }

    const handleVoiceNote = async (voiceMsg: Record<string, unknown>) => {
      const vChat = (voiceMsg.chat ?? {}) as Record<string, unknown>
      const vFrom = (voiceMsg.from ?? {}) as Record<string, unknown>
      const chatId = Number(vChat.id)
      const voice = (voiceMsg.voice ?? {}) as Record<string, unknown>
      const durationSec = Number(voice.duration ?? 0)

      // Same ownership standard as every callback: the note must be
      // in the linked private chat, from the person who owns it.
      const link = Number.isFinite(chatId) ? await linkByChat(chatId) : null
      if (!link || Number(vFrom.id) !== chatId) {
        if (Number.isFinite(chatId)) await sendMessage(botToken, chatId, bt('en', 'link.explainer'))
        return
      }
      const lang = await langForUser(link.user_id)

      // The current passage: the LATEST passage_sent for this
      // learner inside the last 24h (the same metrics-lookup
      // pattern as the 14-day exclusion).
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const { data: sentRows } = await supabaseAdmin
        .from('metrics_events')
        .select('payload, created_at')
        .eq('user_id', link.user_id)
        .eq('type', 'passage_sent')
        .gte('created_at', dayAgo)
        .order('created_at', { ascending: false })
        .limit(1)
      const currentId = (sentRows?.[0]?.payload as Record<string, unknown> | undefined)?.passageId
      if (typeof currentId !== 'string' || !currentId) {
        await sendMessage(botToken, chatId, bt(lang, 'voice.noPassage'))
        return
      }
      const { data: passage } = await supabaseAdmin
        .from('reading_passages')
        .select('id, text, tokens, new_word_candidates')
        .eq('id', currentId)
        .maybeSingle()
      if (!passage) {
        await sendMessage(botToken, chatId, bt(lang, 'voice.passageGone'))
        return
      }

      // ---------- the scored proof (amendment #6) ----------
      // With a transcription key, the scored proof runs FIRST and
      // is authoritative when it produces a score: the reply names
      // the reading match honestly (a match against the text,
      // never a pronunciation grade — the web Reader's words,
      // mirrored), at/above the pass line the comfy-read effect
      // applies, and a skipped new word earns Nao's one fix.
      // Below the line nothing is marked — reads here only ever
      // add up, never against the learner. On ANY transcription
      // failure (or no key) control falls through to the v1
      // duration proof below, untouched.
      const scored = await tryTranscribeAndScore(voice, passage as Record<string, unknown>, link)
      if (scored) {
        const pct = Math.round(scored.score * 100)
        await logEvent(link.user_id, 'shadow_attempted', {
          passageId: currentId,
          score: Math.round(scored.score * 1000) / 1000,
          method: 'groq-whisper',
        })
        const missedWord = scored.missed ? String(scored.missed.word ?? '') : ''
        const fixLine = scored.missed && missedWord
          ? bt(lang, 'voice.fix', {
            word: `<b>${esc(missedWord)}</b>`,
            readingSuffix: scored.missed.reading && scored.missed.reading !== scored.missed.word
              ? `（${esc(String(scored.missed.reading))}）`
              : '',
            meaningSuffix: scored.missed.meaning ? ` — ${esc(String(scored.missed.meaning))}` : '',
            sentence: esc(sentenceWith(String(passage.text), missedWord)),
          })
          : ''
        if (scored.score >= READ_ALOUD_PASS_SCORE) {
          const voiceEffect = await applyVoiceReadEffect(link, currentId, 'voice')
          await sendMessage(
            botToken,
            chatId,
            bt(lang, 'voice.matchPass', { pct }) + fixLine,
          )
          if (voiceEffect.trialUp) {
            await sendMessage(botToken, chatId, botTrialUpCopy(lang, voiceEffect.target))
          }
        } else {
          await sendMessage(
            botToken,
            chatId,
            bt(lang, 'voice.matchBelow', { pct }) + fixLine,
          )
        }
        return
      }

      const chars = [...String(passage.text)].length
      const win = voiceReadWindow(chars, durationSec)
      await logEvent(link.user_id, 'shadow_attempted', {
        passageId: currentId,
        durationSec,
        expectedSec: Math.round(win.expectedSec * 10) / 10,
        plausible: win.plausible,
      })
      if (!win.plausible) {
        await sendMessage(
          botToken,
          chatId,
          durationSec > win.maxSec
            ? bt(lang, 'voice.durationLong')
            : bt(lang, 'voice.durationQuick'),
        )
        return
      }

      // Plausible: the read counts. If a feedback tap (or an
      // earlier voice read) already proved this passage, the voice
      // is thanked but never double-counted — the shared effect
      // helper dedupes first, then applies the same transition the
      // scored path uses.
      const voiceEffect = await applyVoiceReadEffect(link, currentId, 'voice')
      await sendMessage(
        botToken,
        chatId,
        bt(lang, 'voice.durationPlausible'),
      )
      if (voiceEffect.trialUp) {
        await sendMessage(botToken, chatId, botTrialUpCopy(lang, voiceEffect.target))
      }
    }

    // ---------- voice job delivery (amendment #6) ----------
    // The worker made the audio; this is the last mile. Download
    // the ogg from the private voice-cache bucket, sendVoice it to
    // the job's chat, cache Telegram's file_id on the passage (so
    // every future send of this passage takes the free file_id
    // path in sendPassageVoice), and mark the job sent. Used by
    // the ?voicejob route (the immediate poke from voice-queue)
    // and by the dispatch sweep (the backstop). Returns whether
    // the voice was delivered; any failure leaves the job `done`
    // for the sweep to retry — delayed, never lost.
    const deliverVoiceJob = async (job: Record<string, unknown>): Promise<boolean> => {
      try {
        const storagePath = typeof job.storage_path === 'string' ? job.storage_path : ''
        const chatId = Number(job.chat_id)
        if (!storagePath || !Number.isFinite(chatId)) return false
        const { data: blob, error } = await supabaseAdmin.storage.from('voice-cache').download(storagePath)
        if (error || !blob) {
          console.error(`reader-bot: voice job audio download failed job=${String(job.id)}`)
          return false
        }
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const form = new FormData()
        form.append('chat_id', String(chatId))
        form.append('voice', new Blob([bytes], { type: 'audio/ogg' }), 'passage.ogg')
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendVoice`, {
          method: 'POST',
          body: form,
        })
        const body = await res.json().catch(() => null)
        const fileId = body?.result?.voice?.file_id
        if (!body?.ok || typeof fileId !== 'string') {
          console.error(`reader-bot: voice job sendVoice failed status=${res.status} job=${String(job.id)}`)
          return false
        }
        if (typeof job.passage_id === 'string' && job.passage_id) {
          const { error: cacheError } = await supabaseAdmin
            .from('reading_passages')
            .update({ voice_file_id: fileId })
            .eq('id', job.passage_id)
          if (cacheError) console.error('reader-bot: voice job file_id cache write failed')
        }
        const { error: sentError } = await supabaseAdmin
          .from('voice_jobs')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', String(job.id))
          .eq('status', 'done')
        if (sentError) console.error('reader-bot: voice job sent write failed')
        return true
      } catch (err) {
        console.error('reader-bot: voice job delivery failed', err)
        return false
      }
    }

    const handleVoiceJob = async (jobId: string) => {
      const { data: job } = await supabaseAdmin
        .from('voice_jobs')
        .select('id, passage_id, chat_id, status, storage_path')
        .eq('id', jobId)
        .maybeSingle()
      if (!job) return json({ ok: false, error: 'Job not found' }, 404)
      if (job.status !== 'done') return json({ ok: true, skipped: String(job.status) })
      const delivered = await deliverVoiceJob(job as Record<string, unknown>)
      return json({ ok: delivered })
    }

    // ---------- morning dispatch (R1) ----------
    // Fired by pg_cron (READER_CRON_SECRET header — authorised in
    // the route check above, before the webhook secret is even
    // consulted). Serves every due learner their morning passage
    // through the UNCHANGED read flow: the fitting logic is not
    // forked, the serve is just tagged kind:'morning' and preceded
    // by the greeting (both inside handleRead). Due = inside
    // [morning_time, +30min) in the learner's own tz AND no morning
    // passage already sent on their tz date. Learners without a
    // band basis are skipped SILENTLY — a dispatch must never nag a
    // stranger into declaring a level (§9); their /read asks the
    // question when THEY come.
    const handleDispatch = async () => {
      // Voice backstop (amendment #6): any job the worker finished
      // whose completion poke never landed — or whose delivery
      // failed — is retried on the cron's regular pass, before the
      // morning serves. A missed callback can delay a voice note;
      // it can never lose one. Delivery failures are logged inside
      // deliverVoiceJob and never break the dispatch itself.
      const { data: doneJobs } = await supabaseAdmin
        .from('voice_jobs')
        .select('id, passage_id, chat_id, status, storage_path')
        .eq('status', 'done')
        .order('completed_at', { ascending: true })
        .limit(25)
      for (const job of doneJobs ?? []) {
        await deliverVoiceJob(job as Record<string, unknown>)
      }

      const { data: links, error } = await supabaseAdmin
        .from('telegram_links')
        .select('user_id, chat_id, declared_band, declared_at, morning_time, tz')
        .not('chat_id', 'is', null)
      if (error || !links) {
        console.error('reader-bot: dispatch link scan failed')
        return json({ ok: false, due: 0, sent: 0 }, 500)
      }
      let due = 0
      let sent = 0
      for (const link of links) {
        try {
          const chatId = Number(link.chat_id)
          if (!Number.isFinite(chatId)) continue
          // Band basis gate: diagnosis or declared — nothing else
          // is dispatched to. The diagnosis lives in learner_state
          // (resolveBand input); the declared band rides the row.
          const row = await loadState(link.user_id)
          const state = (row?.state ?? {}) as Record<string, unknown>
          const { bandSource } = knownFor(state, declaredOf(link))
          if (bandSource === 'none') continue

          // The learner's local clock, from their tz. Intl does the
          // tz maths; a bad tz string falls back to Asia/Tokyo (the
          // column default) rather than breaking the run.
          const tz = typeof link.tz === 'string' && link.tz ? link.tz : 'Asia/Tokyo'
          let parts: Record<string, string> = {}
          try {
            parts = Object.fromEntries(
              new Intl.DateTimeFormat('en-CA', {
                timeZone: tz, hour12: false,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              }).formatToParts(new Date()).map((p) => [p.type, p.value]),
            )
          } catch {
            parts = {}
          }
          const hh = Number(parts.hour ?? NaN) % 24
          const mm = Number(parts.minute ?? NaN)
          const ss = Number(parts.second ?? 0)
          if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue
          const nowMinutes = hh * 60 + mm + (Number.isFinite(ss) ? ss / 60 : 0)
          const [mh, mmin] = String(link.morning_time ?? '07:30').split(':').map(Number)
          const morningMinutes = (Number.isFinite(mh) ? mh : 7) * 60 + (Number.isFinite(mmin) ? mmin : 30)
          if (!isDispatchDue({ morningMinutes, nowMinutes, sentMorningToday: false })) continue

          // Already served this morning (their tz date)? The window
          // check above can't know — the events can. "Today" for
          // the learner begins at their local midnight, which is
          // `now - nowMinutes` in real time.
          const dayStartUtc = new Date(Date.now() - nowMinutes * 60000).toISOString()
          const { data: morningRows } = await supabaseAdmin
            .from('metrics_events')
            .select('id')
            .eq('user_id', link.user_id)
            .eq('type', 'passage_sent')
            .eq('payload->>kind', 'morning')
            .gte('created_at', dayStartUtc)
            .limit(1)
          if (!isDispatchDue({ morningMinutes, nowMinutes, sentMorningToday: !!morningRows && morningRows.length > 0 })) continue

          due++
          // Served == a morning-tagged passage_sent exists now that
          // did not before (handleRead's failure paths send honest
          // copy instead of a passage, and must not count).
          await handleRead(chatId, { kind: 'morning' })
          const { data: checkRows } = await supabaseAdmin
            .from('metrics_events')
            .select('id')
            .eq('user_id', link.user_id)
            .eq('type', 'passage_sent')
            .eq('payload->>kind', 'morning')
            .gte('created_at', dayStartUtc)
            .limit(1)
          if (checkRows && checkRows.length > 0) sent++
        } catch (err) {
          console.error('reader-bot: dispatch serve failed for one learner', err)
        }
      }
      return json({ ok: true, due, sent })
    }

    // A dispatch call has no Telegram update — serve and return.
    if (dispatchMode) {
      return await handleDispatch()
    }

    // A voicejob call has no Telegram update either — deliver the
    // one worker-made voice and return.
    if (voiceJobId) {
      return await handleVoiceJob(voiceJobId)
    }

    // ---------- update routing ----------
    if (update.callback_query) {
      const cb = update.callback_query as Record<string, unknown>
      if (String(cb.data ?? '').startsWith('mine:')) {
        try { await handleMine(cb) } catch (err) { console.error('reader-bot: mine failed', err) }
      } else if (String(cb.data ?? '').startsWith('again:')) {
        try { await handleAgain(cb) } catch (err) { console.error('reader-bot: again failed', err) }
      } else if (String(cb.data ?? '') === 'door:read') {
        try { await handleDoorRead(cb) } catch (err) { console.error('reader-bot: door read failed', err) }
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
    if (!msg || chat.type !== 'private') {
      return json({ ok: true })
    }
    // Voice notes route BEFORE the text gate: a voice message has
    // no .text at all, and it is the read-aloud proof (R2 v1).
    if (msg.voice) {
      try { await handleVoiceNote(msg) } catch (err) { console.error('reader-bot: voice note handling failed', err) }
      return json({ ok: true })
    }
    if (typeof msg.text !== 'string') {
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
          // Amendment #7 (Bug 1): /start used to send the link
          // explainer to EVERY plain /start — including chats that
          // were already linked, which read as "you lost the
          // connection" when nothing was lost. The link is checked
          // FIRST now: a linked chat gets its true status (linked,
          // the basis in charge, and the doors); only a stranger
          // gets the explainer.
          const link = await linkByChat(chatId)
          if (!link) {
            await sendMessage(botToken, chatId, bt('en', 'link.explainer'))
          } else {
            const row = await loadState(link.user_id)
            const state = (row?.state ?? {}) as Record<string, unknown>
            // The language rides the state row just loaded — no
            // second read for the status reply (amendment #11).
            const lang = languageFromState(state)
            const { band, bandSource, joke } = knownFor(state, declaredOf(link))
            const basisLine =
              bandSource === 'diagnosis'
                ? bt(lang, 'start.basisDiagnosis', { band })
                : bandSource === 'declared' && joke
                  ? bt(lang, 'start.basisDeclaredJoke')
                  : bandSource === 'declared'
                    ? bt(lang, 'start.basisDeclared', { band })
                    : bt(lang, 'start.basisNone')
            await sendMessage(
              botToken,
              chatId,
              bt(lang, 'start.status', { basis: basisLine }),
              {
                reply_markup: appKeyboard(lang, [
                  [{ text: bt(lang, 'start.sendPassage'), callback_data: 'door:read' }],
                ]),
              },
            )
          }
        } else {
          const { data: pending } = await supabaseAdmin
            .from('telegram_links')
            .select('user_id, link_expires_at')
            .eq('link_code', code)
            .is('chat_id', null)
            .maybeSingle()
          const unexpired = pending && (!pending.link_expires_at || new Date(pending.link_expires_at as string) > new Date())
          if (!unexpired) {
            await sendMessage(botToken, chatId, bt('en', 'link.expired'))
          } else {
            const { error } = await supabaseAdmin
              .from('telegram_links')
              .update({
                chat_id: chatId,
                // Migration 00017: Telegram's signed Mini App
                // identity is the user, not the conversation.
                // Private chats make the two numbers equal today;
                // storing from.id explicitly keeps the identity
                // bridge correct if that ever stops being the
                // only shape this surface serves.
                telegram_user_id: typeof from.id === 'number' ? from.id : chatId,
                username: typeof from.username === 'string' ? from.username : null,
                linked_at: new Date().toISOString(),
                link_code: null,
                link_expires_at: null,
              })
              .eq('user_id', pending.user_id)
              .is('chat_id', null)
            if (error) {
              console.error('reader-bot: link claim failed')
              await sendMessage(botToken, chatId, bt('en', 'link.failed'))
            } else {
              // Post-claim language (amendment #11): the claimed
              // user's state row may already carry a language
              // slice — resolve from it when it does; a user whose
              // app has not synced a choice yet hears English
              // until it does. No slice is ever written here.
              const claimLang = await langForUser(pending.user_id as string)
              await sendMessage(botToken, chatId, bt(claimLang, 'welcome'), { reply_markup: appKeyboard(claimLang) })
            }
          }
        }
      } else if (cmd === '/read') {
        await handleRead(chatId)
      } else if (cmd === '/app') {
        // The typed door (amendment #7): the whole app, one tap —
        // the chat stays the reading shelf; sessions, the checkup
        // and Koe's calls live in Yonde itself.
        const appLink = await linkByChat(chatId)
        const appLang = await langForLink(appLink)
        await sendMessage(
          botToken,
          chatId,
          bt(appLang, 'app.reply'),
          { reply_markup: appKeyboard(appLang) },
        )
      } else if (cmd === '/level') {
        // Re-opens the one-tap question at any time (Doc 16 §5
        // amendment #3), with the intro line naming the basis
        // currently in charge. Unlinked chats get the explainer —
        // there is no row to declare onto.
        const link = await linkByChat(chatId)
        if (!link) {
          await sendMessage(botToken, chatId, bt('en', 'link.explainer'))
        } else {
          const row = await loadState(link.user_id)
          const state = (row?.state ?? {}) as Record<string, unknown>
          const lang = languageFromState(state)
          const { band, bandSource, joke } = knownFor(state, declaredOf(link))
          await sendMessage(botToken, chatId, botLevelIntro(lang, bandSource, bandSource === 'none' ? null : band, joke), {
            reply_markup: levelKeyboard(bt(lang, 'level.notSure')),
          })
        }
      } else if (cmd === '/unlink') {
        const { data: cleared } = await supabaseAdmin
          .from('telegram_links')
          .update({ chat_id: null, telegram_user_id: null, username: null, linked_at: null })
          .eq('chat_id', chatId)
          .select('user_id')
        // The confirmation speaks the language the account had
        // chosen — resolved from the just-unlinked user's state
        // row (the slice survives unlinking; only the chat link
        // was cleared). A chat that was never linked hears
        // English.
        const unlinkLang = cleared && cleared.length > 0
          ? await langForUser(String(cleared[0].user_id))
          : 'en'
        await sendMessage(
          botToken,
          chatId,
          cleared && cleared.length > 0
            ? bt(unlinkLang, 'unlink.done')
            : bt('en', 'unlink.notLinked'),
        )
      } else {
        const helpLink = await linkByChat(chatId)
        const helpLang = await langForLink(helpLink)
        await sendMessage(botToken, chatId, bt(helpLang, 'help'), { reply_markup: appKeyboard(helpLang) })
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
