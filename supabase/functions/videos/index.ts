import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { q } = await req.json()
    if (!q || typeof q !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing q' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const key = Deno.env.get('YOUTUBE_API_KEY')
    if (!key) {
      return new Response(JSON.stringify({ error: 'YOUTUBE_API_KEY not set' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/search')
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('type', 'video')
    url.searchParams.set('maxResults', '3')
    url.searchParams.set('q', q)
    url.searchParams.set('key', key)

    const res = await fetch(url.toString())
    const data = await res.json()

    if (!res.ok) {
      console.error('YouTube search error:', data)
      return new Response(JSON.stringify({ error: data?.error?.message || 'YouTube search failed' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const videos = (data.items || []).map((item: any) => ({
      id: item.id?.videoId,
      title: item.snippet?.title,
      channel: item.snippet?.channelTitle,
      embed: `https://www.youtube.com/embed/${item.id?.videoId}`,
      thumb: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url,
    }))

    return new Response(JSON.stringify({ videos }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('Videos function error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
