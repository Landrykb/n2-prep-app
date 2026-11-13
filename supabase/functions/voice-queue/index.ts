import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Yonde Voice Worker queue door (Doc 16 §5 amendment #6, 2026-11-07).
//
// Why this function exists: Microsoft's Edge TTS endpoint refuses
// synthesis from Supabase's datacenter egress (proven 2026-11-06 —
// consistent 502s out of the `tts` function), but answers fine from
// Landry's own always-on VM. So synthesis moved OUT of the request
// path entirely: reader-bot queues a `voice_jobs` row (migration
// 00016) whenever a passage has no voice yet, and a tiny polling
// worker on the VM (~/voice-worker/worker.py) claims jobs through
// THIS function, synthesizes with edge-tts, and hands the ogg/opus
// bytes back. Passages are cached assets — synthesized once, then
// reused forever via the Telegram file_id reader-bot caches on the
// passage row — so a tiny worker covers the whole Reader.
//
// Invocation budget (2026-11-13, Supabase fair-use letter):
// the worker used to poll claim every 10s and tts-claim every
// 1.5s AROUND THE CLOCK — ~66k invocations a day at idle,
// 622k in a billing period against the free plan's 550k line,
// with real jobs numbering in the dozens. Claims are now
// LONG-POLLS: the worker passes waitSeconds and this function
// holds the request open, re-checking the queue every 2.5s,
// until a job appears or the wait expires. Idle cost drops to
// ~2 calls/minute across both lanes (~115k/month worst case,
// most of it headroom), and pickup latency stays under ~3s —
// the wait is server-side, so a job landing mid-wait is
// claimed inside the same invocation.
//
// Protocol (POST JSON, header `x-worker-secret` == env
// VOICE_WORKER_SECRET — the worker's ONE single-purpose secret; it
// holds no database keys and no bot token):
//   { action: 'claim' }                    → { job: { id, text } | null }
//   { action: 'complete', jobId, audioBase64 }
//                                          → bytes stored in the
//                                            private `voice-cache`
//                                            bucket at <jobId>.ogg,
//                                            job marked done, then a
//                                            best-effort poke to
//                                            reader-bot ?voicejob=
//                                            so the voice sends now
//   { action: 'fail', jobId, error }       → job marked failed with
//                                            the (capped) error
//
// Deployed with verify_jwt = false, like reader-bot: the worker
// secret IS the auth, checked before anything else, fail closed —
// no env secret set, no service, ever. Nothing sensitive is ever
// logged: no secret, no passage text (job ids and byte counts only).
//
// Env: VOICE_WORKER_SECRET (this door's key), READER_CRON_SECRET
// (shared with reader-bot's cron routes — authorises the voicejob
// poke), SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (runtime-injected).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// A passage voice note runs well under a minute (~30–60 KB of
// ogg/opus in practice). 2 MB decoded is generous head-room and a
// hard stop against a broken or hostile caller filling the bucket.
const MAX_AUDIO_BYTES = 2 * 1024 * 1024
const BUCKET = 'voice-cache'

const LONG_POLL_MAX_S = 50
const LONG_POLL_STEP_MS = 2500
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // ---------- the worker secret is the whole door ----------
  // Fail closed: no env secret configured, no service — and a
  // mismatch is indistinguishable from a missing header.
  const workerSecret = Deno.env.get('VOICE_WORKER_SECRET') ?? ''
  const provided = req.headers.get('x-worker-secret') ?? ''
  if (!workerSecret || !provided || provided !== workerSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const action = typeof body?.action === 'string' ? body.action : ''

    // ---------- claim: the oldest pending job, atomically ----------
    // The claim is a conditional UPDATE (status must still be
    // 'pending' in the same statement that marks it 'claimed'), so
    // two pollers racing the same row cannot both win it: the
    // loser's update matches zero rows and the loop moves on to
    // the next pending job. One worker polls today; the guard is
    // what makes a second one safe tomorrow.
    // tryClaim: one atomic claim attempt for a lane. Returns
    // { job } on a win, { job: null } when the lane is empty,
    // or { response } when a database error must surface as-is.
    const tryClaim = async (kind: 'passage' | 'tts') => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: pending, error: selError } = await supabaseAdmin
          .from('voice_jobs')
          .select(kind === 'tts' ? 'id, text, voice_cast' : 'id, text')
          .eq('status', 'pending')
          .eq('kind', kind)
          .order('created_at', { ascending: true })
          .limit(1)
        if (selError) {
          console.error('voice-queue: pending scan failed')
          return { response: json({ error: 'Queue read failed' }, 500) }
        }
        const next = pending?.[0]
        if (!next) return { job: null }
        const { data: claimed, error: claimError } = await supabaseAdmin
          .from('voice_jobs')
          .update({ status: 'claimed', claimed_at: new Date().toISOString() })
          .eq('id', next.id)
          .eq('status', 'pending')
          .eq('kind', kind)
          .select(kind === 'tts' ? 'id, text, voice_cast' : 'id, text')
        if (claimError) {
          console.error('voice-queue: claim write failed')
          return { response: json({ error: 'Claim failed' }, 500) }
        }
        if (claimed && claimed.length > 0) {
          const row = claimed[0] as { id: string; text: string; voice_cast?: string }
          return {
            job: kind === 'tts'
              ? { id: row.id, text: row.text, cast: row.voice_cast || 'female' }
              : { id: row.id, text: row.text },
          }
        }
        // Lost the race for this row — try the next pending one.
      }
      return { job: null }
    }

    // Long-poll claim (both lanes): hold the request open up to
    // waitSeconds (clamped), re-checking every 2.5s, so an idle
    // worker costs one invocation per wait instead of one per
    // breath — and a job arriving mid-wait is still claimed in
    // ~3s. waitSeconds absent/0 keeps the old instant behaviour.
    if (action === 'claim' || action === 'tts-claim') {
      const kind = action === 'claim' ? 'passage' : 'tts'
      const waitRaw = Number((body as Record<string, unknown>)?.waitSeconds)
      const waitS = Number.isFinite(waitRaw) ? Math.min(Math.max(waitRaw, 0), LONG_POLL_MAX_S) : 0
      const deadline = Date.now() + waitS * 1000
      for (;;) {
        const r = await tryClaim(kind)
        if ('response' in r && r.response) return r.response
        if (r.job) return json({ job: r.job })
        if (Date.now() >= deadline) return json({ job: null })
        await sleep(Math.min(LONG_POLL_STEP_MS, Math.max(deadline - Date.now(), 0)))
      }
    }

    // ---------- complete: store the audio, mark done, poke ----------
    if (action === 'complete') {
      const jobId = typeof body?.jobId === 'string' ? body.jobId : ''
      const audioBase64 = typeof body?.audioBase64 === 'string' ? body.audioBase64 : ''
      if (!jobId || !audioBase64) {
        return json({ error: 'jobId and audioBase64 are required' }, 400)
      }
      let bytes: Uint8Array
      try {
        const bin = atob(audioBase64)
        bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      } catch {
        return json({ error: 'audioBase64 is not valid base64' }, 400)
      }
      if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES) {
        return json({ error: 'Audio size out of bounds' }, 400)
      }
      const storagePath = `${jobId}.ogg`
      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, bytes, { contentType: 'audio/ogg', upsert: true })
      if (uploadError) {
        console.error(`voice-queue: storage upload failed job=${jobId}`)
        return json({ error: 'Storage upload failed' }, 500)
      }
      // Only a CLAIMED job completes: a late or duplicate complete
      // for a job in any other state is refused rather than
      // resurrecting it.
      const { data: done, error: doneError } = await supabaseAdmin
        .from('voice_jobs')
        .update({
          status: 'done',
          storage_path: storagePath,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('status', 'claimed')
        .select('id')
      if (doneError) {
        console.error(`voice-queue: done write failed job=${jobId}`)
        return json({ error: 'Job update failed' }, 500)
      }
      if (!done || done.length === 0) {
        return json({ error: 'Job is not in a claimed state' }, 409)
      }
      console.log(`voice-queue: job ${jobId} done (${bytes.length} bytes)`)

      // Best-effort poke: reader-bot downloads the audio and sends
      // the voice note NOW instead of waiting for a sweep. The
      // shared cron secret authorises the route (the same header
      // pg_cron uses). Any failure here is a console line only —
      // the job is durably `done`, and reader-bot's dispatch route
      // sweeps done-but-unsent jobs as the backstop.
      const cronSecret = Deno.env.get('READER_CRON_SECRET') ?? ''
      if (cronSecret && supabaseUrl) {
        try {
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 15000)
          await fetch(`${supabaseUrl}/functions/v1/reader-bot?voicejob=${encodeURIComponent(jobId)}`, {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'x-cron-secret': cronSecret, 'Content-Type': 'application/json' },
            body: '{}',
          }).catch(() => null)
          clearTimeout(timer)
        } catch {
          console.error(`voice-queue: reader-bot poke failed job=${jobId}`)
        }
      }
      return json({ ok: true })
    }

    // ---------- tts-complete: AAC/m4a bytes back, no Telegram poke ---
    if (action === 'tts-complete') {
      const jobId = typeof body?.jobId === 'string' ? body.jobId : ''
      const audioBase64 = typeof body?.audioBase64 === 'string' ? body.audioBase64 : ''
      if (!jobId || !audioBase64) {
        return json({ error: 'jobId and audioBase64 are required' }, 400)
      }
      let bytes: Uint8Array
      try {
        const bin = atob(audioBase64)
        bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      } catch {
        return json({ error: 'audioBase64 is not valid base64' }, 400)
      }
      if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES) {
        return json({ error: 'Audio size out of bounds' }, 400)
      }
      const storagePath = `${jobId}.m4a`
      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, bytes, { contentType: 'audio/mp4', upsert: true })
      if (uploadError) {
        console.error(`voice-queue: tts storage upload failed job=${jobId}`)
        return json({ error: 'Storage upload failed' }, 500)
      }
      const { data: done, error: doneError } = await supabaseAdmin
        .from('voice_jobs')
        .update({
          status: 'done',
          storage_path: storagePath,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('status', 'claimed')
        .eq('kind', 'tts')
        .select('id')
      if (doneError) {
        console.error(`voice-queue: tts done write failed job=${jobId}`)
        return json({ error: 'Job update failed' }, 500)
      }
      if (!done || done.length === 0) {
        return json({ error: 'Job is not in a claimed state' }, 409)
      }
      console.log(`voice-queue: tts job ${jobId} done (${bytes.length} bytes)`)
      return json({ ok: true })
    }

    // ---------- fail: the worker's honest report ----------
    if (action === 'fail') {
      const jobId = typeof body?.jobId === 'string' ? body.jobId : ''
      if (!jobId) {
        return json({ error: 'jobId is required' }, 400)
      }
      const error = String(body?.error ?? 'worker reported failure').slice(0, 200)
      const { data: failed, error: failError } = await supabaseAdmin
        .from('voice_jobs')
        .update({ status: 'failed', error })
        .eq('id', jobId)
        .in('status', ['pending', 'claimed'])
        .select('id')
      if (failError) {
        console.error(`voice-queue: fail write failed job=${jobId}`)
        return json({ error: 'Job update failed' }, 500)
      }
      if (!failed || failed.length === 0) {
        return json({ error: 'Job is not in a failable state' }, 409)
      }
      console.log(`voice-queue: job ${jobId} failed`)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('voice-queue error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
