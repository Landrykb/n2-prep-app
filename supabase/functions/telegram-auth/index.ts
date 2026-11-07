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

  try {
    // telegram_user_id is the identity Telegram signs. chat_id is
    // only the compatibility path: in a private chat the two are
    // the same number, and every row claimed before 00017 has that
    // shape. New claims store both explicitly.
    const link = (await findLink('telegram_user_id')) ?? (await findLink('chat_id'))
    if (!link?.user_id || !link.linked_at) {
      await diag('link_lookup', 'not_linked', validation.telegramUserId)
      return json({ error: 'not_linked' }, 403)
    }

    const { data: existing, error: userError } = await supabaseAdmin.auth.admin.getUserById(link.user_id)
    const email = existing?.user?.email
    if (userError || !existing?.user || existing.user.id !== link.user_id || !email) {
      console.error('telegram-auth: linked account could not be resolved')
      await diag('get_user', 'account_unavailable', validation.telegramUserId)
      return json({ error: 'account_unavailable' }, 500)
    }

    const { data: generated, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    const tokenHash = generated?.properties?.hashed_token
    if (linkError || !generated?.user || generated.user.id !== link.user_id || !tokenHash) {
      console.error('telegram-auth: session exchange could not be created')
      await diag('generate_link', 'session_unavailable', validation.telegramUserId)
      return json({ error: 'session_unavailable' }, 500)
    }
    await diag('success', undefined, validation.telegramUserId)

    // Deliberately no action_link and no email in this response:
    // the client needs only the one-time hash and the account id
    // it can compare against any session already in the webview.
    return json({ ok: true, token_hash: tokenHash, user_id: link.user_id })
  } catch {
    console.error('telegram-auth: exchange failed')
    await diag('exchange', 'threw', validation.telegramUserId)
    return json({ error: 'Service unavailable' }, 500)
  }
})
