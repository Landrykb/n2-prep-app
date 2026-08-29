import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

const N2_PERSONA = `You are a patient, encouraging JLPT N2 tutor. Your goal is to help the learner understand WHY an answer is right or wrong, not just give facts.

Rules:
- Answer in plain text only. Do NOT use Markdown, bold, italics, code fences, or bullet points. Use line breaks and simple numbered lists if needed.
- Keep answers concise (2-4 short paragraphs max).
- When explaining grammar or vocabulary, give one clear Japanese example sentence with romaji and English translation.
- If the user makes a mistake, gently correct it and then ask a short follow-up question to check understanding (Socratic style).
- Prefer the provided study context when it is relevant, but do not refuse to answer if it is missing. If you must use outside knowledge, clearly say so.`

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
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { message, history = [], mode = 'ask', context = '' } = await req.json()
    if (!message || typeof message !== 'string' || message.length > 2000) {
      return new Response(JSON.stringify({ error: 'Invalid message' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (typeof context !== 'string' || context.length > 120) {
      return new Response(JSON.stringify({ error: 'Invalid context' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (!['ask', 'quiz', 'review'].includes(mode)) {
      return new Response(JSON.stringify({ error: 'Invalid mode' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (!Array.isArray(history) || history.length > 20 || history.some((m: any) => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 2000)) {
      return new Response(JSON.stringify({ error: 'Invalid history' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY') ?? ''
    const referer = Deno.env.get('APP_URL') ?? 'https://jpn2easy.vercel.app'
    const chatModel = Deno.env.get('OPENROUTER_CHAT_MODEL') ?? 'openrouter/free'

    const contextBlock = context ? `\n\nThe user is currently on the ${context} page. Try to relate your answer to that area when it helps.` : ''
    let systemPrompt = N2_PERSONA + contextBlock
    let sources: any[] = []

    if (mode === 'review') {
      const { data: errors, error: errLogs } = await supabaseClient
        .from('error_logs')
        .select('section, mistake, cause, fix, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30)

      if (errLogs) {
        console.error('Error logs fetch:', errLogs)
      }

      const errorContext = (errors ?? [])
        .map((e: any, i: number) => `${i + 1}. [${e.section}] ${e.mistake}${e.cause ? ` (cause: ${e.cause})` : ''}${e.fix ? ` (fix: ${e.fix})` : ''}`)
        .join('\n') || 'No errors logged yet.'

      systemPrompt += `\n\nThe learner wants a review of their recent error log. Here are their most recent errors:\n${errorContext}\n\nAnalyze the patterns. Pick 2-3 weak areas and give concrete next steps. End with one follow-up question.`
    } else {
      // Embed the user question and do vector search
      const embedModel = Deno.env.get('OPENROUTER_EMBEDDING_MODEL') ?? 'liquid/lfm-2.5-embedding-350m:free'
      const embedRes = await fetch(`${OPENROUTER_BASE}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer,
          'X-Title': 'JPN2easy',
        },
        body: JSON.stringify({ model: embedModel, input: message }),
      })

      if (!embedRes.ok) {
        const err = await embedRes.text()
        console.error('Embedding error:', err)
        return new Response(JSON.stringify({ error: 'Failed to embed query' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const embedData = await embedRes.json()
      const embedding = embedData.data?.[0]?.embedding
      if (!Array.isArray(embedding)) {
        return new Response(JSON.stringify({ error: 'No embedding returned' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const { data: chunks, error: rpcError } = await supabaseClient.rpc('match_n2_chunks', {
        query_embedding: embedding,
        match_threshold: 0.4,
        match_count: 5,
      })

      if (rpcError) {
        console.error('Vector search error:', rpcError)
        return new Response(JSON.stringify({ error: 'Vector search failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      sources = chunks ?? []
      const context = sources
        .map((c: any) => `---\nSource: ${c.source}\nContent: ${c.content}`)
        .join('\n')

      if (mode === 'quiz') {
        systemPrompt += `\n\nUse the following N2 study context to create ONE JLPT N2 multiple-choice question with options labeled A, B, C, D. Do NOT reveal the correct answer yet. Ask the user to answer.\n\n${context}`
      } else {
        systemPrompt += `\n\nUse ONLY the following N2 study context to answer. If the context does not answer the question, say so honestly.\n\n${context}`
      }
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message },
    ]

    const chatRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': referer,
        'X-Title': 'JPN2easy',
      },
      body: JSON.stringify({
        model: chatModel,
        messages,
        temperature: 0.55,
        max_tokens: 1024,
      }),
    })

    if (!chatRes.ok) {
      const err = await chatRes.text()
      console.error('Chat error:', err)
      return new Response(JSON.stringify({ error: 'Failed to get AI response' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const chatData = await chatRes.json()
    const answer = chatData.choices?.[0]?.message?.content ?? 'No response.'

    return new Response(
      JSON.stringify({ answer, sources }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Edge function error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
