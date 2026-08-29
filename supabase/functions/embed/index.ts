import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const BATCH_SIZE = 10

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
    )
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const { data: rows, error: rowsError } = await supabaseAdmin
      .from('n2_chunks')
      .select('id, content')
      .is('embedding', null)
      .limit(100)

    if (rowsError) {
      return new Response(JSON.stringify({ error: rowsError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ indexed: 0, message: 'No rows with null embedding found. Make sure supabase/seed.sql was run.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY') ?? ''
    const referer = Deno.env.get('APP_URL') ?? 'https://jpn2easy.vercel.app'
    const embedModel = Deno.env.get('OPENROUTER_EMBEDDING_MODEL') ?? 'liquid/lfm-2.5-embedding-350m:free'
    let indexed = 0

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const inputs = batch.map((r: any) => r.content)

      const embedRes = await fetch(`${OPENROUTER_BASE}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer,
          'X-Title': 'JPN2easy',
        },
        body: JSON.stringify({ model: embedModel, input: inputs }),
      })

      if (!embedRes.ok) {
        const err = await embedRes.text()
        console.error('Batch embedding error:', err)
        continue
      }

      const embedData = await embedRes.json()
      const embeddings: number[][] = embedData.data?.map((d: any) => d.embedding) ?? []

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j]
        const vector = embeddings[j]
        if (!vector) continue
        const { error } = await supabaseAdmin
          .from('n2_chunks')
          .update({ embedding: vector })
          .eq('id', row.id)
        if (!error) indexed++
      }
    }

    return new Response(JSON.stringify({ indexed }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('Embed function error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
