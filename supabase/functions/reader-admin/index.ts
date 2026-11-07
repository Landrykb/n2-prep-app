// reader-admin — the Reader's permanent operator door (Doc 16).
//
// Why this exists: reader-bot's own ?setup=1 route accepted only the
// shared admin secret (whose value is unrecoverable once set) or the
// runtime service key (which the Supabase gateway rejects as an
// apikey) — so registering the webhook/commands required deploying a
// THROWAWAY function twice during R0 activation. This function is the
// durable replacement, and reader-bot's dead setup route is removed.
//
// Security model (the call-scheduler pattern): deployed with
// verify_jwt = TRUE, so any JWT reaching this handler was already
// signature-verified by the gateway; the claims check below then
// restricts callers to THIS project's service_role. Telegram never
// calls this function — reader-bot (verify_jwt = false + its webhook
// secret header) remains the only Telegram surface.
//
// What it does, and all it does: registers reader-bot's webhook,
// command list and chat menu button with Telegram using the project
// secrets, then returns Telegram's own read-backs (getMe /
// getWebhookInfo / getMyCommands / getChatMenuButton) so
// registration is verified, never assumed. The bot token never
// leaves Supabase env.

function isServiceRoleJwtForProject(token: string, projectRef: string): boolean {
  if (!token || !projectRef) return false
  const parts = String(token).split('.')
  if (parts.length !== 3) return false
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(decodeURIComponent(Array.from(atob(padded), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')))
    return payload?.role === 'service_role' && payload?.ref === projectRef
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const projectRef = supabaseUrl.replace('https://', '').split('.')[0]
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!isServiceRoleJwtForProject(bearer, projectRef)) return json({ error: 'Unauthorized' }, 401)

  const botToken = Deno.env.get('READER_BOT_TOKEN') ?? ''
  const webhookSecret = Deno.env.get('READER_WEBHOOK_SECRET') ?? ''
  if (!botToken || !webhookSecret) return json({ error: 'Reader secrets are not set' }, 500)

  const tg = async (method: string, payload: unknown) => {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.json().catch(() => ({ ok: false, httpStatus: res.status }))
  }

  const webhookUrl = `${supabaseUrl}/functions/v1/reader-bot`
  const setWebhook = await tg('setWebhook', {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ['message', 'callback_query'],
  })
  const setMyCommands = await tg('setMyCommands', {
    commands: [
      { command: 'read', description: 'Send me a passage at my level' },
      { command: 'app', description: 'Open Yonde — sessions, checkup, calls' },
      { command: 'unlink', description: 'Disconnect this chat from Yonde' },
      { command: 'start', description: 'Link this chat to your Yonde account' },
      { command: 'level', description: 'Tell Hori your level (one tap)' },
    ],
  })
  // The chat Menu button opens Yonde itself (Doc 16 §5 amendment
  // #7): set WITHOUT a chat_id, it is the default for every private
  // chat — the app becomes one tap from the chat's own chrome, not
  // only from buttons inside messages.
  const setChatMenuButton = await tg('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'Open Yonde',
      web_app: { url: 'https://jpn2easy.vercel.app/?tg=4' },
    },
  })
  const getMe = await tg('getMe', {})
  const getWebhookInfo = await tg('getWebhookInfo', {})
  const getMyCommands = await tg('getMyCommands', {})
  const getChatMenuButton = await tg('getChatMenuButton', {})
  return json({
    ok: true,
    webhookUrl,
    setWebhook,
    setMyCommands,
    setChatMenuButton,
    bot: getMe?.result ? { id: getMe.result.id, username: getMe.result.username, first_name: getMe.result.first_name } : getMe,
    webhookInfo: getWebhookInfo?.result ?? getWebhookInfo,
    commands: getMyCommands?.result ?? getMyCommands,
    menuButton: getChatMenuButton?.result ?? getChatMenuButton,
  })
})
