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

export function getTelegramInitData(source) {
  const webApp = source?.Telegram?.WebApp ?? globalThis.window?.Telegram?.WebApp
  return typeof webApp?.initData === 'string' ? webApp.initData : ''
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
  if (!client || !supabaseUrl || !anonKey) return 'failed'

  let session = currentSession
  if (session === undefined) {
    const { data } = await client.auth.getSession()
    session = data?.session ?? null
  }

  const response = await fetchImpl(`${supabaseUrl}/functions/v1/telegram-auth`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initData }),
  })

  if (response.status === 403) {
    const body = await response.json().catch(() => null)
    return body?.error === 'not_linked' ? 'not-linked' : 'failed'
  }
  if (!response.ok) return 'failed'

  const body = await response.json().catch(() => null)
  const decision = telegramBridgeDecision({
    hasInitData: true,
    functionUserId: typeof body?.user_id === 'string' ? body.user_id : null,
    sessionUserId: session?.user?.id ?? null,
  })
  if (decision === 'already') return 'already'
  if (decision !== 'bridge' || typeof body?.token_hash !== 'string' || !body.token_hash) {
    return 'failed'
  }

  // Installed @supabase/supabase-js 2.109.0 types VerifyTokenHashParams
  // with type: EmailOtpType, and 'magiclink' is one of its members.
  const { data, error } = await client.auth.verifyOtp({
    token_hash: body.token_hash,
    type: 'magiclink',
  })
  if (error || !data?.session || data.session.user?.id !== body.user_id) return 'failed'
  return 'bridged'
}

export function bridgeTelegramSession(options = {}) {
  const initData = typeof options.initData === 'string'
    ? options.initData
    : getTelegramInitData(options.windowSource)
  if (!initData) return Promise.resolve('not-telegram')

  if (bridgePromise && bridgeInitData === initData) return bridgePromise
  bridgeInitData = initData

  bridgePromise = (async () => {
    const storage = options.storage ?? globalThis.sessionStorage
    let markerKey = null
    try {
      const digest = await initDataDigest(initData)
      if (digest) {
        markerKey = `${TELEGRAM_BRIDGE_STORAGE_PREFIX}${digest}`
        const previous = readAttemptMarker(storage, markerKey)
        if (previous) return previous === 'attempted' ? 'failed' : previous
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
