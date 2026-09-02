import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function base64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function base64urlEncode(buf: Uint8Array): string {
  let b64 = ''
  for (const b of buf) b64 += String.fromCharCode(b)
  return btoa(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function rawVapidToJwk(publicB64: string, privateB64: string): webpush.ExportedVapidKeys {
  const pub = base64urlDecode(publicB64)
  if (pub.length !== 65 || pub[0] !== 4) {
    throw new Error('VAPID public key must be 65-byte uncompressed P-256 point')
  }
  const x = base64urlEncode(pub.slice(1, 33))
  const y = base64urlEncode(pub.slice(33, 65))
  const d = base64urlEncode(base64urlDecode(privateB64))
  return {
    publicKey: { kty: 'EC', crv: 'P-256', x, y },
    privateKey: { kty: 'EC', crv: 'P-256', x, y, d },
  }
}

let appServer: webpush.ApplicationServer | null = null

async function getAppServer(): Promise<webpush.ApplicationServer> {
  if (appServer) return appServer
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@jpn2easy.vercel.app'
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set')
  }
  const vapidKeys = await webpush.importVapidKeys(rawVapidToJwk(publicKey, privateKey))
  appServer = await webpush.ApplicationServer.new({ contactInformation: subject, vapidKeys })
  return appServer
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  try {
    const adminSecret = Deno.env.get('PUSH_ADMIN_SECRET') ?? ''
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
    )

    let userId: string | null = null
    const providedAdminSecret = req.headers.get('X-Admin-Secret') ?? ''

    if (providedAdminSecret && providedAdminSecret === adminSecret) {
      const body = await req.json()
      userId = body.user_id ?? null
    } else {
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      userId = user.id
    }

    const { title = 'Time to study N2!', body = 'Keep your streak alive.', url = '/', tag = 'study-reminder', user_id } = await req.json()
    if (providedAdminSecret) userId = user_id ?? userId
    if (typeof title !== 'string' || title.length > 120 || typeof body !== 'string' || body.length > 240) {
      return new Response(JSON.stringify({ error: 'Invalid title or body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    let query = supabaseAdmin.from('push_subscriptions').select('endpoint, keys')
    if (userId && userId !== 'all') query = query.eq('user_id', userId)
    const { data: subs, error: subsError } = await query

    if (subsError) {
      console.error('Push subscriptions fetch error:', subsError)
      return new Response(JSON.stringify({ error: 'Failed to fetch subscriptions' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const server = await getAppServer()
    const payload = JSON.stringify({ title, body, url, tag })
    let sent = 0
    const failed: string[] = []

    for (const sub of subs || []) {
      try {
        const subscriber = server.subscribe(sub as any)
        await subscriber.pushTextMessage(payload, { ttl: 3600, urgency: webpush.Urgency.High })
        sent++
      } catch (err: any) {
        console.error('Push send error:', err)
        if (err?.isGone?.()) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        } else {
          failed.push(sub.endpoint)
        }
      }
    }

    return new Response(JSON.stringify({ sent, failed: failed.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('Push-send error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
