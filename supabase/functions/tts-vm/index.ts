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

  const authHeader = req.headers.get('Authorization') ?? ''
  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userError } = await caller.auth.getUser()
  if (userError || !user) return json({ error: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as { text?: unknown; voice?: unknown }
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const cast = typeof body?.voice === 'string' && CASTS.includes(body.voice) ? body.voice : 'female'
  if (!text || text.length > MAX_TEXT_CHARS) return json({ error: 'Text missing or too long' }, 400)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Cache first: the same line in the same cast never synthesizes twice.
  const cachePath = `tts-cache/${await hashOf(`${cast}\n${text}`)}.mp3`
  const cached = await admin.storage.from(BUCKET).download(cachePath).catch(() => null)
  if (cached) {
    const bytes = new Uint8Array(await cached.arrayBuffer())
    if (bytes.length > 0) return audioResponse(bytes)
  }

  const { data: job, error: insertError } = await admin
    .from('voice_jobs')
    .insert({ kind: 'tts', text, voice_cast: cast, user_id: user.id, status: 'pending' })
    .select('id')
    .single()
  if (insertError || !job) {
    console.error('tts-vm: job insert failed')
    return json({ error: 'Voice queue unavailable' }, 502)
  }

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
      const file = await admin.storage.from(BUCKET).download(row.storage_path).catch(() => null)
      if (!file) return json({ error: 'Audio unavailable' }, 502)
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.length === 0) return json({ error: 'Audio unavailable' }, 502)
      // Seed the content cache for the next identical line
      // (best effort — the bytes are already in hand).
      await admin.storage.from(BUCKET).upload(cachePath, bytes, { contentType: 'audio/mpeg', upsert: true }).catch(() => null)
      return audioResponse(bytes)
    }
  }
  // Timed out: the job still completes on the worker and its
  // audio waits in the bucket; the caller's fallback serves this
  // tap, and a later identical line re-enqueues cleanly.
  return json({ error: 'Voice worker busy' }, 504)
})
