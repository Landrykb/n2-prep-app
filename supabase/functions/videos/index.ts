// @ts-nocheck
// deno-lint-ignore-file

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
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

    const { q } = await req.json()
    const query = typeof q === 'string' ? q.trim() : ''
    if (!query || query.length > 120) {
      return new Response(JSON.stringify({ error: 'Invalid q' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const key = Deno.env.get('YOUTUBE_API_KEY')
    if (!key) {
      return new Response(JSON.stringify({ error: 'YOUTUBE_API_KEY not set' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/search')
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('type', 'video')
    url.searchParams.set('maxResults', '3')
    url.searchParams.set('q', query)
    url.searchParams.set('key', key)

    const res = await fetch(url.toString())
    const data = await res.json()

    if (!res.ok) {
      console.error('YouTube search error:', data)
      return new Response(JSON.stringify({ error: data?.error?.message || 'YouTube search failed' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const videos = (data.items || [])
      .filter((item: any) => item?.id?.videoId && item?.snippet)
      .map((item: any) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        embed: `https://www.youtube-nocookie.com/embed/${item.id.videoId}?modestbranding=1&rel=0&iv_load_policy=3`,
        thumb: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      }))

    return new Response(JSON.stringify({ videos }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('Videos function error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
