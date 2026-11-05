import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Account deletion (Doc 15 §6 — Apple 5.1.1(v), Google Play account
// deletion policy). Implements the spec exactly:
//   - POST, requires the caller's JWT (pattern copied from `chat`).
//   - The user id comes from the verified token, NEVER from the body.
//   - Service role deletes the user's rows from every app table, then the
//     auth user itself. All user tables reference auth.users
//     `on delete cascade` (migrations 00001/00003/00005), so the final
//     deleteUser cascades anything the explicit deletes missed.
//   - Responds { deleted: true, user_id }. Logs ONLY user id + timestamp —
//     never content (Doc 10 §6).
//   - Idempotent: row deletes are no-ops when nothing matches, a missing
//     auth user is a successful "already deleted", and a repeat call with
//     the same (now-dead) token reports alreadyDeleted instead of erroring.
// There is deliberately NO admin-secret variant: a user deletes only
// themselves.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Every table that holds per-user rows. Kept in sync with Doc 04 §2/§3 and
// migrations 00001–00005. FK cascades from auth.users cover these too; the
// explicit deletes make the intent (and the row counts) auditable, and keep
// deletion correct even if a future table forgets its cascade.
const USER_TABLES = [
  'error_logs',
  'user_progress',
  'push_subscriptions',
  'learner_twin',
  'call_windows',
  'call_dispatches',
]

// The `sub` claim of a JWT whose signature we could NOT verify. Used only
// on the already-deleted path: we act on it solely to CONFIRM, via the
// admin API, that no such user exists. If a user with that id does exist,
// the unverified claim proves nothing and the call is rejected.
function unverifiedSub(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const payload = token.split('.')[1]
    if (!payload) return null
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4)
    const claims = JSON.parse(atob(b64))
    return typeof claims?.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''

    const supabaseClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    )

    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      // Idempotent repeat: the token's user may already be gone (a first
      // call deleted them, then the client retried). Confirm via the admin
      // API that the claimed id truly has no auth user before reporting
      // success — never delete or confirm on an unverified claim alone.
      const sub = unverifiedSub(authHeader)
      if (sub) {
        const { data: existing, error: lookupError } = await supabaseAdmin.auth.admin.getUserById(sub)
        if (!lookupError && !existing?.user) {
          console.log(`delete-account: already deleted user=${sub} at=${new Date().toISOString()}`)
          return json({ deleted: true, user_id: sub, alreadyDeleted: true })
        }
      }
      return json({ error: 'Unauthorized' }, 401)
    }

    const userId = user.id

    for (const table of USER_TABLES) {
      const { error } = await supabaseAdmin.from(table).delete().eq('user_id', userId)
      if (error) {
        // Fail closed: report and stop rather than half-delete silently.
        // The client reports 'pending-server' and the user can retry —
        // deletes are idempotent, so a retry is safe.
        console.error(`delete-account: row delete failed user=${userId} table=${table} at=${new Date().toISOString()}`)
        return json({ error: `Failed to delete data from ${table}` }, 500)
      }
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (deleteError) {
      // "User not found" on the auth row is success-by-another-name:
      // the rows are gone and there is no account left to delete.
      const msg = String((deleteError as { message?: string })?.message ?? '')
      if (!/not found/i.test(msg)) {
        console.error(`delete-account: auth delete failed user=${userId} at=${new Date().toISOString()}`)
        return json({ error: 'Failed to delete account' }, 500)
      }
      console.log(`delete-account: deleted user=${userId} (auth row already gone) at=${new Date().toISOString()}`)
      return json({ deleted: true, user_id: userId, alreadyDeleted: true })
    }

    console.log(`delete-account: deleted user=${userId} at=${new Date().toISOString()}`)
    return json({ deleted: true, user_id: userId })
  } catch (err) {
    console.error('delete-account error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
