import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { BANDS, buildKnownSet, deckCreditSet, evaluateDraft, nextForbiddenList, pickPassage, shouldGenerate } from './fit.ts'
import { DECK_LEVELS } from './deck.ts'
import { DECK_GLOSS } from './gloss.ts'
import { segmentText } from './segment.ts'

// Yonde Reader bot (Doc 16 §6/§7 R0, Doc 12 step 3.6).
//
// One function, two routes:
//   POST /functions/v1/reader-bot            — the Telegram webhook.
//   POST /functions/v1/reader-bot?setup=1    — operator setup: registers
//     the webhook (with its secret) and the bot's command list with
//     Telegram, so the bot token never leaves Supabase env.
//
// R0 scope (Doc 16 §7): linking via one-time codes the app mints,
// /read on demand with passages spine-fitted per learner (fit.ts — the
// ratio gate is code, never AI), and one-tap mining of the passage's
// new words into the ONE queue inside the learner_state document.
// R0.5 adds fitted generation as the bank-miss fallback (see
// tryGenerate below): AI drafts, code validates, the gate is the same.
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
    const url = new URL(req.url)

    // ---------- setup route (operator only) ----------
    if (url.searchParams.get('setup') === '1') {
      // Admin pattern from call-scheduler: the shared admin secret, or
      // the runtime service key as bearer. (call-scheduler's third path,
      // a gateway-verified legacy service_role JWT, is deliberately not
      // replicated: setup is a rare operator call and the admin secret
      // is the documented route.)
      const adminSecret = Deno.env.get('PUSH_ADMIN_SECRET') ?? ''
      const providedSecret = req.headers.get('X-Admin-Secret') ?? ''
      const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const authorised = (providedSecret !== '' && providedSecret === adminSecret)
        || (bearer !== '' && bearer === serviceKey)
      if (!authorised) return json({ error: 'Unauthorized' }, 401)
      if (!botToken || !webhookSecret) {
        return json({ error: 'READER_BOT_TOKEN / READER_WEBHOOK_SECRET are not set on this function' }, 500)
      }
      const webhookUrl = `${supabaseUrl}/functions/v1/reader-bot`
      const setWebhook = await tg(botToken, 'setWebhook', {
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      })
      const setMyCommands = await tg(botToken, 'setMyCommands', {
        commands: [
          { command: 'read', description: 'Send me a passage at my level' },
          { command: 'unlink', description: 'Disconnect this chat from Yonde' },
          { command: 'start', description: 'Link this chat to your Yonde account' },
        ],
      })
      return json({ ok: true, webhookUrl, setWebhook, setMyCommands })
    }

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
        .select('user_id, chat_id, username')
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
    // Twin personal vocab + below-band deck credit. Credit exists ONLY
    // with a diagnosis — a diagnosed band certifies the vocabulary
    // below it; without one the set is queue-only and conservative.
    // (Personal vocab has no stored list yet — twin.vocab is derived
    // stats — so it contributes nothing today; the parameter stays
    // plumbed for when the Twin grows one.)
    const knownFor = (state: Record<string, unknown>) => {
      const queue = Array.isArray(state.queue) ? state.queue : []
      const estimate = (state.diagnosis as Record<string, unknown> | undefined)?.jlptEstimate
      const hasDiagnosis = typeof estimate === 'string' && (BANDS as string[]).includes(estimate)
      const band = hasDiagnosis ? (estimate as string) : 'N4' // gentle default; the footer says so
      const credit = hasDiagnosis ? deckCreditSet(DECK_LEVELS, band) : null
      const known = buildKnownSet(queue, [], credit)
      return { queue, known, hasDiagnosis, band }
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
    const handleRead = async (chatId: number) => {
      const link = await linkByChat(chatId)
      if (!link) {
        await sendMessage(botToken, chatId, LINK_EXPLAINER)
        return
      }
      const row = await loadState(link.user_id)
      const state = (row?.state ?? {}) as Record<string, unknown>
      const { queue, known, hasDiagnosis, band } = knownFor(state)

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

      let picked = pickPassage(bank, known, band, recentIds)
      if (!picked) {
        // R0.5: fitted generation — the bank was never written to
        // the 95% rule, so most learners fit nothing in it. A draft
        // that passes the SAME gate joins through the SAME send path
        // below; one that cannot pass is never sent.
        picked = await tryGenerate(link, state, known, band)
      }
      if (!picked) {
        await sendMessage(
          botToken,
          chatId,
          queue.length === 0
            ? 'I do not have your synced words yet, so I cannot fit a passage to you. Open Yonde signed in once — your queue syncs on its own — then send /read again.'
            : 'Nothing in the bank fits your words today. Every passage is checked against what you know before it is sent, and I would rather send nothing than the wrong level. New words from your next session change the fit — try /read again after it.',
        )
        return
      }

      const passage = picked.passage as Record<string, unknown>
      const candidates = Array.isArray(passage.new_word_candidates)
        ? (passage.new_word_candidates as { word: string; reading: string; meaning: string; h?: string }[])
        : []
      // New-word selection matches by HEADWORD (Doc 16 §5): a candidate
      // whose dictionary form is already known — queued, or credited
      // below the learner's band — is not new, whatever surface the
      // passage used.
      const newWords = candidates.filter((c) => c.word && !known.has(c.h || c.word))
      const pct = Math.round(picked.ratio * 100)

      const lines = [
        `🔍 Hori dug this up for you — ${esc(String(passage.topic || 'Reading'))} · ${esc(String(passage.band))}`,
        '',
        renderPassage(String(passage.text), newWords),
        '',
        // The footer names BOTH fitting sources (Doc 16 §5 labelling):
        // with a diagnosis, the learner's level (via below-band deck
        // credit) and their queue; without one, the queue only — the
        // copy must never claim level fitting that did not happen.
        (hasDiagnosis
          ? `Fitted to your ${esc(band)} level and your queue: about ${pct}% of its words should already be familiar (an estimate) · ${newWords.length} new word${newWords.length === 1 ? '' : 's'}`
          : `Fitted to your queue: about ${pct}% of its words should already be familiar (an estimate) · ${newWords.length} new word${newWords.length === 1 ? '' : 's'}` +
            '\nBand N4 is a gentle default — take the 10-minute checkup in Yonde and I will fit to your real level.'),
      ]
      const extra: Record<string, unknown> = {}
      if (newWords.length > 0) {
        extra.reply_markup = {
          inline_keyboard: [[{ text: 'Mine the New Words', callback_data: `mine:${String(passage.id)}` }]],
        }
      }
      await sendMessage(botToken, chatId, lines.join('\n'), extra)
      // Event names (Doc 16 §8): passage_sent is the R0 send event;
      // reading_opened belongs to the R1 Mini App and is NOT logged here.
      await logEvent(link.user_id, 'passage_sent', {
        passageId: String(passage.id),
        band: String(passage.band),
        ratio: Math.round(picked.ratio * 1000) / 1000,
        newWords: newWords.length,
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
        .select('id, band, topic, text, new_word_candidates')
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
      // queued, and not credited below their diagnosed band.
      const { known } = knownFor(state)
      const candidates = Array.isArray(passage.new_word_candidates)
        ? (passage.new_word_candidates as { word: string; reading: string; meaning: string; h?: string }[])
        : []
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

    // ---------- dispatch ----------
    if (update.callback_query) {
      const cb = update.callback_query as Record<string, unknown>
      if (String(cb.data ?? '').startsWith('mine:')) {
        try { await handleMine(cb) } catch (err) { console.error('reader-bot: mine failed', err) }
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
