import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { localDateStr, todaysSlots, slotIdFor } from './slot.ts'

// Yobidashi server scheduler (Doc 02 §3.2/§7, Phase 2 step 2.5).
//
// Invoked by cron every ~15 minutes (GitHub Actions workflow
// .github/workflows/call-scheduler.yml; pg_cron is the documented
// alternative). For every signed-in user who synced call settings
// (call_windows, enabled), it computes today's deterministic slots with the
// SAME hash the client uses (./slot.ts, a pinned port of src/lib/calls.js),
// and for any slot whose minute has just arrived it sends ONE web push via
// the existing push-send function — the push is only a doorbell; the call
// itself is the in-app ringing screen, and the client's catch-up ring on
// next open remains the fallback for anything the doorbell misses.
//
// Dedupe: a slot is claimed by inserting its id into call_dispatches
// BEFORE sending (PK conflict = already dispatched, skip). A failed send
// marks the row 'failed' — it is not silently retried by later runs, the
// catch-up ring covers it.
//
// Dispatch window: slot time <= now and no older than DISPATCH_WINDOW_MIN.
// Cron (especially GitHub Actions) can run late; anything older falls back
// to the client's on-open catch-up, by design — no stale "summons" should
// arrive an hour after its moment.
//
// Auth: scheduler-to-server only. Accepts the same X-Admin-Secret that
// gates push-send's admin path (PUSH_ADMIN_SECRET), or a service-role
// bearer. Never callable by a user JWT to ring other users.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const DISPATCH_WINDOW_MIN = 20

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const adminSecret = Deno.env.get('PUSH_ADMIN_SECRET') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const providedSecret = req.headers.get('X-Admin-Secret') ?? ''
    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const authorised = (providedSecret !== '' && providedSecret === adminSecret) || (bearer !== '' && bearer === serviceKey)
    if (!authorised) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const { data: rows, error: rowsError } = await supabaseAdmin
      .from('call_windows')
      .select('user_id, windows, calls_per_day, persistence, sensei_name, timezone')
      .eq('enabled', true)

    if (rowsError) {
      console.error('call-scheduler: call_windows fetch failed')
      return json({ error: 'Failed to fetch call settings' }, 500)
    }

    const now = new Date()
    const windowMs = DISPATCH_WINDOW_MIN * 60000
    let dispatched = 0
    let alreadySent = 0
    let sendFailed = 0
    let notDue = 0

    for (const row of rows || []) {
      const tz = typeof row.timezone === 'string' && row.timezone ? row.timezone : 'UTC'
      let dateStr: string
      let slots: ReturnType<typeof todaysSlots>
      try {
        dateStr = localDateStr(now, tz)
        slots = todaysSlots(
          { windows: row.windows, callsPerDay: row.calls_per_day },
          dateStr,
          tz
        )
      } catch {
        // A bad timezone string in one row must not stop everyone else's calls.
        console.error(`call-scheduler: bad settings for user=${row.user_id} (skipped)`)
        continue
      }

      for (const slot of slots) {
        const slotMs = slot.atUtc.getTime()
        if (slotMs > now.getTime() || now.getTime() - slotMs > windowMs) { notDue++; continue }

        const slotId = slotIdFor(row.user_id, dateStr, slot.windowIndex)

        // Claim the slot first — the PK makes this the dedupe.
        const { data: claimed, error: claimError } = await supabaseAdmin
          .from('call_dispatches')
          .upsert(
            { slot_id: slotId, user_id: row.user_id, slot_date: dateStr, window_idx: slot.windowIndex, slot_at: slot.atUtc.toISOString(), status: 'sent' },
            { onConflict: 'slot_id', ignoreDuplicates: true }
          )
          .select('slot_id')

        if (claimError) {
          console.error(`call-scheduler: dispatch claim failed slot=${slotId}`)
          continue
        }
        if (!claimed || claimed.length === 0) { alreadySent++; continue }

        const senseiName = typeof row.sensei_name === 'string' && row.sensei_name ? row.sensei_name : 'Sensei'
        const url = `/#/sensei?call=${encodeURIComponent(slotId)}&date=${dateStr}&slot=${slot.windowIndex}`
        const sendRes = await fetch(`${supabaseUrl}/functions/v1/push-send`, {
          method: 'POST',
          headers: {
            'apikey': Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}`,
            'X-Admin-Secret': adminSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: row.user_id,
            title: '呼び出しの時間 — Yobidashi no Jikan',
            body: `${senseiName} is calling. You are being summoned — a few minutes of spoken Japanese.`,
            url,
            tag: `yobidashi-${dateStr}-${slot.windowIndex}`,
            kind: 'yobidashi-call',
            slotId,
            slotDate: dateStr,
            slotIdx: slot.windowIndex,
          }),
        })

        if (sendRes.ok) {
          dispatched++
        } else {
          sendFailed++
          await supabaseAdmin.from('call_dispatches').update({ status: 'failed' }).eq('slot_id', slotId)
          console.error(`call-scheduler: push-send failed slot=${slotId} status=${sendRes.status}`)
        }
      }
    }

    console.log(`call-scheduler: users=${(rows || []).length} dispatched=${dispatched} alreadySent=${alreadySent} sendFailed=${sendFailed} notDue=${notDue} at=${now.toISOString()}`)
    return json({ ok: true, users: (rows || []).length, dispatched, alreadySent, sendFailed, notDue })
  } catch (err) {
    console.error('call-scheduler error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
