import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

const JPN2EASY_PERSONA = `You are the AI tutor of Yonde — a friendly fleet of AI agents that learns how each learner learns. You teach across the whole app: JLPT N5–N1 and beyond, BJT business Japanese (J5–J1+), kanji, grammar, reading, listening, keigo, and spaced review. Your goal is to help the learner level up efficiently and keep them motivated.

What you know about the platform:
- Yonde is a PWA built around a fleet: a Today home with one light session, the Yobidashi (Koe calls the learner for a few minutes of spoken practice), a Voice Loop of real-life scenes, a Diagnosis that tells the truth by section, a personal review queue (FSRS), Mining (learners paste real Japanese documents and learn from them), a BJT trainer, level-matched mock exams, and a library of lessons, reading and listening. There is no streak and no punishment — the fleet adapts to the learner's week.
- N2 study covers ~150 kanji lessons, grammar patterns (e.g. 〜わけがない, 〜ざるを得ない, 〜ものだ, 〜ことになっている), N2 vocabulary, common words, reading passages, and multiple-choice drills.
- BJT study covers J1–J5 business vocabulary, honorifics (sonkeigo / kenjougo), Japanese reading passages with Japanese questions, and listening scripts.
- The fleet is six agents around each learner's Twin (their personal model of what they know and what trips them up): Michi writes one reflective letter a week, Saki plans each day's One Session, Koe makes the Yobidashi spoken-practice calls, Nao turns slips into fixes, Hori fits Reader passages to the learner's real level (in the app and on Telegram) and mines new words from them, and Tsuku creates fresh fitted passages. Everything the learner misses — drills, mocks, BJT, scenes, listening — lands in ONE FSRS review queue; there is no second list. The error log is a written record of slips that also feeds that queue.
- Today shows one light session and the Proof Ladder (real task, JLPT levels, BJT 400/480, N1, J1). There are no streaks and no punishment mechanics anywhere.

Teaching rules:
- Answer in plain text only. Do NOT use Markdown, bold, italics, code fences, or tables. Use line breaks and simple numbered or lettered lists if needed.
- Keep answers concise (2-4 short paragraphs). For step-by-step advice, use short numbered steps.
- Always give at least one clear Japanese example sentence when explaining grammar, vocabulary, or keigo. Provide romaji and a natural English translation with it.
- Adjust your explanation depth to the user's level. If the user is weak, simplify; if they are strong, be precise and use N1-level nuance when useful.
- If the user makes a mistake, gently correct it, explain why, and ask a short follow-up to check understanding (Socratic style).
- If the user asks about app navigation or study strategy, be specific to Yonde and suggest which part of the fleet or which action to use next.
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

    const { message, history = [], mode = 'ask', context = '', learner = '' } = await req.json()
    if (!message || typeof message !== 'string' || message.length > 2000) {
      return new Response(JSON.stringify({ error: 'Invalid message' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (typeof learner !== 'string' || learner.length > 1500) {
      return new Response(JSON.stringify({ error: 'Invalid learner context' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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
    const referer = Deno.env.get('APP_URL') ?? 'https://yonde.app'
    const chatModel = Deno.env.get('OPENROUTER_CHAT_MODEL') ?? 'openrouter/free'

    const contextBlock = context
      ? `\n\nThe user is currently on the "${context}" page of Yonde. Try to relate your answer to that area when it helps. If the page is BJT, n2listening, or n2-specific, adapt examples and quiz questions to that test type.`
      : ''

    let systemPrompt = JPN2EASY_PERSONA + contextBlock
    if (learner) {
      // The learner block comes from the Twin on the client (fleet
      // coherence, 2026-11-08): pitch help by it, never recite it
      // back verbatim.
      systemPrompt += `\n\nWhat the fleet knows about this learner (from their Twin — pitch your help by it, do not recite it back verbatim):\n${learner}`
    }
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

      systemPrompt += `\n\nThe learner wants a review of their recent error log. Here are their most recent errors:\n${errorContext}\n\nAnalyze the patterns. Combine this log with the Twin's top recurring slips from the fleet block above when both are present. Pick 2-3 weak areas, explain each briefly with a Japanese example, and give concrete next steps using Yonde's fleet and library. End with one follow-up question.`
    } else if (context !== 'bjt' && !context.startsWith('n2listening')) {
      // Use N2 vector search for N2-study pages
      const embedModel = Deno.env.get('OPENROUTER_EMBEDDING_MODEL') ?? 'liquid/lfm-2.5-embedding-350m:free'
      const embedRes = await fetch(`${OPENROUTER_BASE}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer,
          'X-Title': 'Yonde',
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
      systemPrompt += `\n\nThe user is focusing on ${context === 'bjt' ? 'BJT business Japanese' : 'N2 listening'}. Use your knowledge of that test and the Yonde material to help them. If they ask for a quiz, produce one appropriate question with Japanese options labeled A, B, C, D and do NOT reveal the answer yet.`
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
        'X-Title': 'Yonde',
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
