import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// tts-vm — the app's server voice route, moved off Supabase
// egress (Doc 17 addendum 5, 2026-11-08).
//
// The `tts` function's own synthesis is dead from the
// datacenter: Microsoft's Edge endpoint refuses it there
// (probed 2026-11-08 — the function answers its own 502), while
// Landry's Voice Worker VM is answered reliably. So this
// function does no synthesis at all: it enqueues a kind='tts'
// job on voice_jobs (migration 00018) and waits for the VM
// worker's fast lane (voice-queue tts-claim / tts-complete) to
// hand MP3 bytes back through the private voice-cache bucket,
// then returns them. Typical wait: the worker polls every
// 1.5 s and synthesis takes ~2 s, so most lines land in 3–6 s.
//
// Repeated lines are free: finished audio is also stored under
// a content hash (`tts-cache/<sha256(cast+text)>.mp3`) and a
// cache hit returns without enqueueing anything — the scene
// partners say the same lines every day.
//
// Auth: verify_jwt=true at the gateway; the caller is named
// from the JWT (the reader-serve pattern). Lines are capped at
// 700 chars — this route serves button lines, not passages
// (the Reader's voice notes have their own lane).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const CASTS = ['female', 'male', 'girl', 'boy']
const MAX_TEXT_CHARS = 700
const WAIT_MS = 20000
const POLL_MS = 500
const BUCKET = 'voice-cache'

async function hashOf(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// The client plays a signed https URL, not the bytes
// (2026-11-08): WebKit rejected the returned MP3 *blob* with
// NotSupportedError on Landry's phone while the very same
// bytes streamed fine from an https src — the mechanism the
// pre-rendered listening files already use. Signing is best
// effort: on failure the caller falls back to the bytes.
async function urlResponse(
  admin: ReturnType<typeof createClient>,
  path: string,
): Promise<Response | null> {
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600).catch(() => ({ data: null }))
  if (!data?.signedUrl) return null
  return json({ url: data.signedUrl, contentType: 'audio/mpeg' })
}

const audioResponse = (bytes: Uint8Array) =>
  new Response(bytes, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' },
  })

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Not configured' }, 500)

  // Stage probes (migration 00019): one row per stage reached,
  // so a failed tap names where it died — the 2026-11-08
  // 'server-tts-null' taps left no job and no other trace.
  // Defined before auth so even an auth failure leaves its row;
  // best effort — a probe failure never affects the response.
  const probeAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const probe = async (stage: string, detail = '') => {
    try { await probeAdmin.from('tts_probe').insert({ stage, detail: detail.slice(0, 120) }) } catch { /* ignore */ }
  }
  await probe('arrived')

  const authHeader = req.headers.get('Authorization') ?? ''
  // The caller is named by asking the Auth API directly
  // (2026-11-08): supabase-js getUser() THREW an unhandled
  // exception for real user tokens in this runtime — every
  // signed-in voice request died right here with a 500 (the
  // 'arrived'-only probe rows), while a claim-invalid token
  // returned a clean error and hid the fault for weeks. A
  // plain fetch names its failures instead of throwing them.
  let user: { id: string } | null = null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authHeader },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (res.ok) {
      const u = await res.json().catch(() => null) as { id?: string } | null
      if (u?.id) user = { id: u.id }
      else await probe('auth-fail', 'no user id in auth response')
    } else {
      await probe('auth-fail', `auth http ${res.status}`)
    }
  } catch (err) {
    await probe('auth-fail', `auth fetch: ${(err as Error)?.name ?? 'error'}`)
  }
  if (!user) return json({ error: 'Unauthorized' }, 401)
  await probe('authed')

  const body = await req.json().catch(() => ({})) as { text?: unknown; voice?: unknown }
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const cast = typeof body?.voice === 'string' && CASTS.includes(body.voice) ? body.voice : 'female'
  if (!text || text.length > MAX_TEXT_CHARS) {
    await probe('bad-body', `len=${text.length}`)
    return json({ error: 'Text missing or too long' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Cache first: the same line in the same cast never synthesizes twice.
  const cachePath = `tts-cache/${await hashOf(`${cast}\n${text}`)}.mp3`
  // storage-js download() resolves { data, error } — the Blob
  // is .data. Reading .arrayBuffer() off the result object
  // itself threw and 500'd every cache miss (2026-11-08: the
  // crash hiding behind the getUser crash).
  const cacheDl = await admin.storage.from(BUCKET).download(cachePath).catch(() => null)
  const cached = cacheDl?.data ?? null
  if (cached && cached.size > 0) {
    await probe('cache-hit')
    return await urlResponse(admin, cachePath) ?? audioResponse(new Uint8Array(await cached.arrayBuffer()))
  }

  const { data: job, error: insertError } = await admin
    .from('voice_jobs')
    .insert({ kind: 'tts', text, voice_cast: cast, user_id: user.id, status: 'pending' })
    .select('id')
    .single()
  if (insertError || !job) {
    console.error('tts-vm: job insert failed')
    await probe('insert-fail', insertError?.message ?? 'no job row')
    return json({ error: 'Voice queue unavailable' }, 502)
  }
  await probe('inserted')

  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const { data: row } = await admin
      .from('voice_jobs')
      .select('status, storage_path')
      .eq('id', job.id)
      .maybeSingle()
    if (!row) break
    if (row.status === 'failed') return json({ error: 'Synthesis failed' }, 502)
    if (row.status === 'done' && row.storage_path) {
      const jobDl = await admin.storage.from(BUCKET).download(row.storage_path).catch(() => null)
      const file = jobDl?.data ?? null
      if (!file) return json({ error: 'Audio unavailable' }, 502)
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.length === 0) return json({ error: 'Audio unavailable' }, 502)
      // Seed the content cache for the next identical line
      // (best effort — the bytes are already in hand).
      await admin.storage.from(BUCKET).upload(cachePath, bytes, { contentType: 'audio/mpeg', upsert: true }).catch(() => null)
      await probe('done')
      return await urlResponse(admin, cachePath) ?? audioResponse(bytes)
    }
  }
  // Timed out: the job still completes on the worker and its
  // audio waits in the bucket; the caller's fallback serves this
  // tap, and a later identical line re-enqueues cleanly.
  await probe('timeout')
  return json({ error: 'Voice worker busy' }, 504)
})
