// Telegram Mini App initData validation (Telegram Web Apps spec).
//
// This module is deliberately pure and uses only WebCrypto
// (globalThis.crypto.subtle): the Deno edge function imports it in
// production, and the Node reader suite imports the same file for
// its known-vector checks. No bot token, initData, or user payload
// is logged here or returned beyond the Telegram user id the caller
// needs for the link lookup.

export const TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60
const MAX_INIT_DATA_LENGTH = 16_384
const FUTURE_TOLERANCE_SECONDS = 5 * 60

export type TelegramInitDataValidation =
  | {
      ok: true
      telegramUserId: number
      authDate: number
      user: Record<string, unknown>
    }
  | {
      ok: false
      reason:
        | 'malformed'
        | 'missing_hash'
        | 'missing_auth_date'
        | 'bad_signature'
        | 'stale'
        | 'future'
        | 'bad_user'
    }

const encoder = new TextEncoder()

function hexEncode(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0)
  }
  return difference === 0
}

async function hmacSha256(keyBytes: BufferSource, data: string): Promise<ArrayBuffer> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(data))
}

export async function validateTelegramInitData(
  initData: unknown,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TelegramInitDataValidation> {
  if (
    typeof initData !== 'string' ||
    initData.length === 0 ||
    initData.length > MAX_INIT_DATA_LENGTH ||
    typeof botToken !== 'string' ||
    botToken.length === 0 ||
    !Number.isFinite(nowSeconds)
  ) {
    return { ok: false, reason: 'malformed' }
  }

  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const entries = [...params.entries()]
  if (entries.length === 0) return { ok: false, reason: 'malformed' }

  const seen = new Set<string>()
  for (const [key] of entries) {
    if (!key || seen.has(key)) return { ok: false, reason: 'malformed' }
    seen.add(key)
  }

  const suppliedHash = params.get('hash')
  if (!suppliedHash || !/^[0-9a-fA-F]{64}$/.test(suppliedHash)) {
    return { ok: false, reason: 'missing_hash' }
  }

  const authDateRaw = params.get('auth_date')
  if (!authDateRaw || !/^\d+$/.test(authDateRaw)) {
    return { ok: false, reason: 'missing_auth_date' }
  }
  const authDate = Number(authDateRaw)
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    return { ok: false, reason: 'missing_auth_date' }
  }
  if (nowSeconds - authDate > TELEGRAM_INIT_DATA_MAX_AGE_SECONDS) {
    return { ok: false, reason: 'stale' }
  }
  if (authDate - nowSeconds > FUTURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'future' }
  }

  const dataCheckString = entries
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  // Telegram's two-stage HMAC: the secret is HMAC-SHA256 keyed by
  // the literal string "WebAppData" over the bot token; initData's
  // hash is HMAC-SHA256 of the data-check-string under that secret.
  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken)
  const expectedHash = hexEncode(await hmacSha256(secretKey, dataCheckString))
  if (!constantTimeEqual(suppliedHash.toLowerCase(), expectedHash)) {
    return { ok: false, reason: 'bad_signature' }
  }

  const userRaw = params.get('user')
  if (!userRaw) return { ok: false, reason: 'bad_user' }

  let user: unknown
  try {
    user = JSON.parse(userRaw)
  } catch {
    return { ok: false, reason: 'bad_user' }
  }
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    return { ok: false, reason: 'bad_user' }
  }

  const telegramUserId = (user as Record<string, unknown>).id
  if (
    typeof telegramUserId !== 'number' ||
    !Number.isSafeInteger(telegramUserId) ||
    telegramUserId <= 0
  ) {
    return { ok: false, reason: 'bad_user' }
  }

  return {
    ok: true,
    telegramUserId,
    authDate,
    user: user as Record<string, unknown>,
  }
}
