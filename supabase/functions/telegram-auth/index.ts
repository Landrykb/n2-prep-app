import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateTelegramInitData } from './validate.ts'

// Telegram Mini App identity bridge (Doc 16 §5 amendment #8).
//
// The Mini App runs in Telegram's own webview, whose storage is
// separate from the learner's browser/PWA. A telegram_links row by
// itself therefore cannot carry the web session into that webview.
// Telegram does, however, sign the Mini App launch identity in
// `initData`. This function is the exchange point:
//
//   1. validate initData against READER_BOT_TOKEN, in validate.ts;
//   2. resolve the signed Telegram user to a CLAIMED telegram_links
//      row (telegram_user_id first; chat_id is the private-chat
//      fallback for rows claimed before migration 00017);
//   3. ask Supabase Auth to mint a one-time magic-link token hash
//      for that exact account;
//   4. return ONLY { ok, token_hash, user_id } so the client can
//      call supabase.auth.verifyOtp({ token_hash, type:
//      'magiclink' }) and receive its normal session.
//
// v3 (Landry's design, 2026-11-07): the exchange is also the LINK.
// The Sign In With Telegram button creates the account + link on
// first use ("link from the beginning"), and a signed-in caller
// can POST { linkOnly: true } with their session JWT to attach
// Telegram to an existing account ("link later, from inside the
// app"). { statusOnly: true } reports the link state.
//
// Deployed with verify_jwt=false: the Telegram HMAC is the door,
// not a caller JWT. Every failure is closed and generic. initData,
// token hashes, email addresses, and the action_link are never
// logged or returned.
//
// Env: READER_BOT_TOKEN (already the reader-bot secret),
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (runtime-injected).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

type TelegramLink = {
  user_id: string
  linked_at: string | null
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const botToken = Deno.env.get('READER_BOT_TOKEN') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!botToken || !supabaseUrl || !serviceKey) {
    console.error('telegram-auth: required configuration is missing')
    return json({ error: 'Service unavailable' }, 500)
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // TEMPORARY DIAGNOSTICS (2026-11-07, Landry's Mini App is not
  // recognised — the positive path never landed for him): record
  // ONLY the stage + reason code of each attempt in
  // telegram_auth_diag. Never initData, never hashes, never email.
  // Remove once the failure stage is known and fixed.
  const diag = async (stage: string, reason?: string, tgUser?: number) => {
    try {
      await supabaseAdmin.from('telegram_auth_diag').insert({
        stage,
        reason: reason ?? null,
        tg_user: tgUser ?? null,
      })
    } catch { /* diagnostics must never break the door */ }
  }

  // TEMPORARY CLIENT DIAGNOSTICS (same investigation): the client
  // reports what IT saw at bootstrap — whether Telegram's WebApp
  // object and signed initData were present, and the bridge status
  // it computed. Whitelisted short fields only; this branch never
  // touches the exchange.
  if (body && typeof body === 'object' && 'clientDiag' in body) {
    const d = (body.clientDiag ?? {}) as Record<string, unknown>
    const pick = (v: unknown, max: number) =>
      typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '-'
    await diag(
      'client',
      `status=${pick(d.status, 24)} init=${pick(d.hasInitData, 5)} len=${pick(d.initDataLen, 6)} webapp=${pick(d.webAppPresent, 5)} platform=${pick(d.platform, 16)} session=${pick(d.hadSession, 5)}`,
    )
    return json({ ok: true })
  }

  const validation = await validateTelegramInitData(body?.initData, botToken)
  if (!validation.ok) {
    await diag('validation', validation.reason)
    return json({ error: 'invalid_init_data' }, 401)
  }

  const findLink = async (column: 'telegram_user_id' | 'chat_id') => {
    const { data, error } = await supabaseAdmin
      .from('telegram_links')
      .select('user_id, linked_at')
      .eq(column, validation.telegramUserId)
      .not('linked_at', 'is', null)
      .maybeSingle()
    if (error) throw new Error('link lookup failed')
    return data as TelegramLink | null
  }

  const tg = validation.telegramUserId

  try {
    // telegram_user_id is the identity Telegram signs. chat_id is
    // only the compatibility path: in a private chat the two are
    // the same number, and every row claimed before 00017 has that
    // shape. New claims store both explicitly.
    const link = (await findLink('telegram_user_id')) ?? (await findLink('chat_id'))

    // --- statusOnly: report the link state for this Telegram user
    // (the in-app Telegram row asks before offering its button).
    if (body?.statusOnly === true) {
      return json({ ok: true, linked: !!link?.user_id, user_id: link?.user_id ?? null })
    }

    // --- linkOnly: attach this Telegram user to the account the
    // caller is ALREADY signed in as (Authorization: Bearer <the
    // app session JWT>). This is "link later, from inside the app":
    // the same one-tap act, performed after an email sign-in.
    if (body?.linkOnly === true) {
      const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const { data: caller, error: callerError } = await supabaseAdmin.auth.getUser(jwt)
      if (callerError || !caller?.user) {
        await diag('link_only', 'no_session', tg)
        return json({ error: 'no_session' }, 401)
      }
      const me = caller.user.id
      if (link?.user_id) {
        if (link.user_id === me) {
          await diag('link_only', 'already', tg)
          return json({ ok: true, linked: true, already: true, user_id: me })
        }
        await diag('link_only', 'linked_elsewhere', tg)
        return json({ error: 'linked_elsewhere' }, 409)
      }
      // One Telegram per account, both directions: an account that
      // already carries a DIFFERENT Telegram id must unlink there
      // first (the bot's /unlink), never silently re-point.
      const { data: mine } = await supabaseAdmin
        .from('telegram_links')
        .select('telegram_user_id')
        .eq('user_id', me)
        .not('linked_at', 'is', null)
        .maybeSingle()
      if (mine && Number(mine.telegram_user_id) !== tg) {
        await diag('link_only', 'account_has_other', tg)
        return json({ error: 'account_has_other_telegram' }, 409)
      }
      const { error: insError } = await supabaseAdmin.from('telegram_links').insert({
        user_id: me,
        chat_id: tg,
        telegram_user_id: tg,
        linked_at: new Date().toISOString(),
      })
      if (insError) {
        await diag('link_only', 'insert_failed', tg)
        return json({ error: 'account_unavailable' }, 500)
      }
      await diag('link_only', 'linked', tg)
      return json({ ok: true, linked: true, user_id: me })
    }

    // --- Default: the Sign In With Telegram exchange. A linked
    // Telegram user gets a session for the linked account. An
    // UNLINKED one gets "link from the beginning": a Yonde account
    // is created from the Telegram identity on the spot, the link
    // row is written in the same act, and the session returned is
    // that new account's. Telegram-created accounts are
    // passwordless and carry a deterministic internal address
    // (tg-<id>@miniapp.yonde.local) — reachable through Telegram,
    // which is the door they came in by.
    let userId = link?.user_id ?? null
    let isNew = false
    if (!userId) {
      const email = `tg-${tg}@miniapp.yonde.local`
      const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { via: 'telegram-miniapp', telegram_user_id: tg },
      })
      if (createError || !createdUser?.user) {
        // Adopt-or-fail: a previous partial attempt may have made
        // the auth user without the link — resolve by the
        // deterministic address instead of erroring forever.
        const { data: gen, error: genError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email,
        })
        if (genError || !gen?.user) {
          await diag('create_user', 'failed', tg)
          return json({ error: 'account_unavailable' }, 500)
        }
        userId = gen.user.id
      } else {
        userId = createdUser.user.id
      }
      // chat_id = the Telegram user id: the Mini App only ever
      // launches from this bot's private chat, where the two are
      // the same number (the 00017 backfill shape).
      const { error: insError } = await supabaseAdmin.from('telegram_links').insert({
        user_id: userId,
        chat_id: tg,
        telegram_user_id: tg,
        linked_at: new Date().toISOString(),
      })
      if (insError) {
        const again = (await findLink('telegram_user_id')) ?? (await findLink('chat_id'))
        if (again?.user_id) {
          userId = again.user_id
        } else {
          await diag('create_link', 'failed', tg)
          return json({ error: 'account_unavailable' }, 500)
        }
      } else {
        isNew = true
      }
      await diag('create', isNew ? 'created_and_linked' : 'adopted_and_linked', tg)
    }

    const { data: existing, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId)
    const email = existing?.user?.email
    if (userError || !existing?.user || existing.user.id !== userId || !email) {
      console.error('telegram-auth: account could not be resolved')
      await diag('get_user', 'account_unavailable', tg)
      return json({ error: 'account_unavailable' }, 500)
    }

    const { data: generated, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    const tokenHash = generated?.properties?.hashed_token
    if (linkError || !generated?.user || generated.user.id !== userId || !tokenHash) {
      console.error('telegram-auth: session exchange could not be created')
      await diag('generate_link', 'session_unavailable', tg)
      return json({ error: 'session_unavailable' }, 500)
    }
    await diag('success', undefined, tg)

    // Deliberately no action_link and no email in this response:
    // the client needs only the one-time hash and the account id
    // it can compare against any session already in the webview.
    return json({ ok: true, token_hash: tokenHash, user_id: userId, is_new: isNew })
  } catch {
    console.error('telegram-auth: exchange failed')
    await diag('exchange', 'threw', tg)
    return json({ error: 'Service unavailable' }, 500)
  }
})
