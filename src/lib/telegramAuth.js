// Telegram Mini App identity bridge (Doc 16 §5 amendment #8).
//
// A linked Telegram chat and a Supabase browser session are two
// different things. Telegram's webview has separate storage from
// the learner's browser/PWA, so merely opening Yonde there used to
// mean a fresh sign-in screen. Telegram signs the launch identity
// in WebApp.initData, though: this module hands that signed string
// to the telegram-auth edge function, which verifies the Telegram
// HMAC, resolves the linked account, and returns a one-time
// Supabase magic-link token hash. verifyOtp exchanges it for the
// ordinary session — no password, no second identity system.

export const TELEGRAM_BRIDGE_STORAGE_PREFIX = 'yonde:telegram-auth:'

let capturedHashInitData = null

// Telegram ALSO hands the signed launch identity in the page URL
// fragment (#tgWebAppData=<url-encoded initData>&tgWebAppVersion=
// ...&tgWebAppPlatform=...). That copy matters: if the
// telegram-web-app.js script fails to load inside the webview,
// window.Telegram never appears and the WebApp copy of initData is
// unreachable — but the URL copy is always there on a real launch.
// Captured once, at first read: the app's own hash router may
// rewrite the fragment later, so the first reader keeps the value.
export function initDataFromUrlHash(hash) {
  if (typeof hash !== 'string' || !hash.includes('tgWebAppData=')) return ''
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const data = params.get('tgWebAppData')
    return typeof data === 'string' ? data : ''
  } catch {
    return ''
  }
}

export function getTelegramInitData(source) {
  const webApp = source?.Telegram?.WebApp ?? globalThis.window?.Telegram?.WebApp
  if (typeof webApp?.initData === 'string' && webApp.initData) return webApp.initData
  if (capturedHashInitData === null) {
    capturedHashInitData = initDataFromUrlHash(globalThis.window?.location?.hash ?? '')
  }
  return capturedHashInitData
}

// The pure bridge decision, kept separate so the phase2 suite can
// pin it without a browser, Telegram, or a network:
//   no signed launch       → do nothing (ordinary web behaviour)
//   no linked account      → leave the sign-in screen in charge
//   linked == current user → nothing to exchange
//   otherwise              → exchange the token hash for a session
export function telegramBridgeDecision({ hasInitData, functionUserId, sessionUserId } = {}) {
  if (!hasInitData) return 'not-telegram'
  if (!functionUserId) return 'not-linked'
  if (functionUserId === sessionUserId) return 'already'
  return 'bridge'
}

let bridgeInitData = ''
let bridgePromise = null

async function initDataDigest(initData) {
  if (!globalThis.crypto?.subtle) return null
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(initData),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function readAttemptMarker(storage, key) {
  try {
    return storage?.getItem(key)
  } catch {
    return null
  }
}

function writeAttemptMarker(storage, key, value) {
  try {
    storage?.setItem(key, value)
  } catch {
    // Storage can be unavailable in a webview. The module-level
    // promise still prevents a render loop in this page session.
  }
}

async function runTelegramBridge({ client, currentSession, initData, fetchImpl }) {
  const env = import.meta.env ?? {}
  const supabaseUrl = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.replace(/\/+$/, '') : ''
  const anonKey = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY : ''
  if (!client || !supabaseUrl || !anonKey) return 'failed:config'

  let session = currentSession
  if (session === undefined) {
    const { data } = await client.auth.getSession()
    session = data?.session ?? null
  }

  // Failure statuses carry their stage (temporary diagnostics,
  // 2026-11-07): fetch / httpNNN / shape / otp. Success and
  // decision values are unchanged.
  let response
  try {
    response = await fetchImpl(`${supabaseUrl}/functions/v1/telegram-auth`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ initData }),
    })
  } catch {
    return 'failed:fetch'
  }

  if (response.status === 403) {
    const body = await response.json().catch(() => null)
    return body?.error === 'not_linked' ? 'not-linked' : 'failed:http403'
  }
  if (!response.ok) return `failed:http${response.status}`

  const body = await response.json().catch(() => null)
  const decision = telegramBridgeDecision({
    hasInitData: true,
    functionUserId: typeof body?.user_id === 'string' ? body.user_id : null,
    sessionUserId: session?.user?.id ?? null,
  })
  if (decision === 'already') return 'already'
  if (decision !== 'bridge' || typeof body?.token_hash !== 'string' || !body.token_hash) {
    return 'failed:shape'
  }

  // Installed @supabase/supabase-js 2.109.0 types VerifyTokenHashParams
  // with type: EmailOtpType, and 'magiclink' is one of its members.
  const { data, error } = await client.auth.verifyOtp({
    token_hash: body.token_hash,
    type: 'magiclink',
  })
  if (error || !data?.session || data.session.user?.id !== body.user_id) return 'failed:otp'
  return 'bridged'
}

export function bridgeTelegramSession(options = {}) {
  const initData = typeof options.initData === 'string'
    ? options.initData
    : getTelegramInitData(options.windowSource)
  if (!initData) return Promise.resolve('not-telegram')

  // force (the Sign In With Telegram button): a deliberate tap
  // always runs the exchange fresh — the attempt marker and the
  // memoised promise exist to stop render loops, not people.
  if (!options.force && bridgePromise && bridgeInitData === initData) return bridgePromise
  bridgeInitData = initData

  bridgePromise = (async () => {
    const storage = options.storage ?? globalThis.sessionStorage
    let markerKey = null
    try {
      const digest = await initDataDigest(initData)
      if (digest) {
        markerKey = `${TELEGRAM_BRIDGE_STORAGE_PREFIX}${digest}`
        if (!options.force) {
          const previous = readAttemptMarker(storage, markerKey)
          if (previous) return previous === 'attempted' ? 'failed:attempted' : previous
        }
        writeAttemptMarker(storage, markerKey, 'attempted')
      }

      let client = options.client
      if (!client) {
        client = (await import('./supabaseClient.js')).supabase
      }
      const status = await runTelegramBridge({
        client,
        currentSession: options.currentSession,
        initData,
        fetchImpl: options.fetchImpl ?? globalThis.fetch?.bind(globalThis),
      })
      if (markerKey) writeAttemptMarker(storage, markerKey, status)
      return status
    } catch {
      if (markerKey) writeAttemptMarker(storage, markerKey, 'failed')
      return 'failed'
    }
  })()

  return bridgePromise
}

// Diag beacon (2026-11-11): when the bridge does not land, the
// client tells the function what ITS side saw — the bridge stage
// word plus environment booleans (is the Telegram object there,
// did the launch fragment carry data, how long is initData).
// Stage words and booleans only; the function validates the
// initData independently and records the pair server-side
// (telegram_auth_diag, migration 00027). Fire-and-forget:
// diagnostics never break the app.
export function reportTelegramDiag({ stage, initData } = {}) {
  try {
    const webApp = globalThis.window?.Telegram?.WebApp
    const data = typeof initData === 'string' ? initData : getTelegramInitData()
    const diag = {
      stage: typeof stage === 'string' ? stage : 'unknown',
      hasWebApp: !!webApp,
      initDataLen: data ? data.length : 0,
      hashHasTgData: (globalThis.window?.location?.hash ?? '').includes('tgWebAppData'),
      platform: typeof webApp?.platform === 'string' ? webApp.platform : null,
    }
    telegramAuthPost({ initData: data || undefined, diagOnly: true, diag }).catch(() => {})
  } catch { /* diagnostics never break the app */ }
}

// --- Link management (v3, Landry's design 2026-11-07) -----------
// The button in the app does three jobs against the same door:
// sign in (bridgeTelegramSession above), report the link state,
// and attach Telegram to the account already signed in here.

async function telegramAuthPost(body, accessToken) {
  const env = import.meta.env ?? {}
  const supabaseUrl = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.replace(/\/+$/, '') : ''
  const anonKey = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY : ''
  if (!supabaseUrl || !anonKey) return { status: 0, body: null }
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/telegram-auth`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  } catch {
    return { status: 0, body: null }
  }
}

// { linked, mine, userId } for the Telegram user who launched this
// Mini App — mine = the link points at the session's account.
export async function telegramLinkStatus(session) {
  const initData = getTelegramInitData()
  if (!initData) return { linked: false, mine: false, userId: null, reachable: false }
  const { status, body } = await telegramAuthPost({ initData, statusOnly: true })
  if (status !== 200 || !body) return { linked: false, mine: false, userId: null, reachable: false }
  const userId = typeof body.user_id === 'string' ? body.user_id : null
  return {
    linked: body.linked === true && !!userId,
    mine: !!userId && !!session?.user?.id && userId === session.user.id,
    userId,
    reachable: true,
  }
}

// Attach this Telegram user to the signed-in account. Returns a
// status word the UI can show: linked / already / elsewhere /
// other-telegram / no-session / failed.
export async function linkTelegramToSession(session) {
  const initData = getTelegramInitData()
  if (!initData) return 'not-telegram'
  if (!session?.access_token) return 'no-session'
  const { status, body } = await telegramAuthPost(
    { initData, linkOnly: true },
    session.access_token,
  )
  if (status === 200 && body?.linked) return body.already ? 'already' : 'linked'
  if (status === 409 && body?.error === 'linked_elsewhere') return 'elsewhere'
  if (status === 409 && body?.error === 'account_has_other_telegram') return 'other-telegram'
  if (status === 401) return 'no-session'
  return 'failed'
}
