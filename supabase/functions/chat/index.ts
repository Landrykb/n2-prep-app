import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

const JPN2EASY_PERSONA = `You are JPN2easy's expert AI Japanese-language tutor. You teach across the whole app: JLPT N5–N2, BJT business Japanese (J1–J5), kanji, grammar, reading, listening, keigo, and SRS/Anki review. Your goal is to help the learner level up efficiently and keep them motivated.

What you know about the platform:
- JPN2easy is a PWA with tabs: Dashboard (daily actions, JLPT countdown, habit check), Drills (N2 filtered questions), Anki (SRS cards), Lessons (kanji / vocab / grammar), Reading (passages with Furigana), N2 Listening (TTS audio + Japanese questions), BJT (J1–J5 score map, business vocab, keigo, reading, listening, daily drills), Videos, Resources, and an Error Log.
- N2 study covers ~150 kanji lessons, grammar patterns (e.g. 〜わけがない, 〜ざるを得ない, 〜ものだ, 〜ことになっている), N2 vocabulary, common words, reading passages, and multiple-choice drills.
- BJT study covers J1–J5 business vocabulary, honorifics (sonkeigo / kenjougo), Japanese reading passages with Japanese questions, and listening scripts.
- SRS uses an Anki-style scheduler; the error log records mistakes and their fixes.
- The dashboard shows the next JLPT date and daily actions (SRS, grammar, reading, AI tutor, error review, BJT drill).

Teaching rules:
- Answer in plain text only. Do NOT use Markdown, bold, italics, code fences, or tables. Use line breaks and simple numbered or lettered lists if needed.
- Keep answers concise (2-4 short paragraphs). For step-by-step advice, use short numbered steps.
- Always give at least one clear Japanese example sentence when explaining grammar, vocabulary, or keigo. Provide romaji and a natural English translation with it.
- Adjust your explanation depth to the user's level. If the user is weak, simplify; if they are strong, be precise and use N1-level nuance when useful.
- If the user makes a mistake, gently correct it, explain why, and ask a short follow-up to check understanding (Socratic style).
- If the user asks about app navigation or study strategy, be specific to JPN2easy and suggest which tab / action to use next.
- If the requested topic is not covered by the provided study context, use your general knowledge and say so honestly. Do not make up app data.`

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
      return new Response(JSON.stringify({ error: 'Invalid context' }), { status: 400, headers: { ...corsHeaders, 'Type': 'application/json' } })
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

    const contextBlock = context
      ? `\n\nThe user is currently on the "${context}" page of JPN2easy. Try to relate your answer to that area when it helps. If the page is BJT, n2listening, or n2-specific, adapt examples and quiz questions to that test type.`
      : ''

    let systemPrompt = JPN2EASY_PERSONA + contextBlock
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

      systemPrompt += `\n\nThe learner wants a review of their recent error log. Here are their most recent errors:\n${errorContext}\n\nAnalyze the patterns. Pick 2-3 weak areas, explain each briefly with a Japanese example, and give concrete next steps using JPN2easy tabs. End with one follow-up question.`
    } else if (context !== 'bjt' && !context.startsWith('n2listening')) {
      // Use N2 vector search for N2-study pages
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
      const n2Context = sources
        .map((c: any) => `---\nSource: ${c.source}\nContent: ${c.content}`)
        .join('\n')

      if (mode === 'quiz') {
        systemPrompt += `\n\nUse the following N2 study context to create ONE JLPT N2 multiple-choice question with options labeled A, B, C, D. Do NOT reveal the correct answer yet. Ask the user to answer.\n\n${n2Context}`
      } else {
        systemPrompt += `\n\nUse the following N2 study context to answer when it is relevant. If it does not answer the question, use your general knowledge and say so honestly.\n\n${n2Context}`
      }
    } else {
      systemPrompt += `\n\nThe user is focusing on ${context === 'bjt' ? 'BJT business Japanese' : 'N2 listening'}. Use your knowledge of that test and the JPN2easy material to help them. If they ask for a quiz, produce one appropriate question with Japanese options labeled A, B, C, D and do NOT reveal the answer yet.`
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
