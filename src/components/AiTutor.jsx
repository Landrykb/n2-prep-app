import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { supabase } from '../lib/supabaseClient.js'
import RichText from './RichText.jsx'
import TtsButton from './TtsButton.jsx'
import { Send, Loader2, Sparkles, RotateCcw, Copy, Check } from 'lucide-react'

const QUICK_ACTIONS = [
  { label: 'Explain N2 grammar', prompt: 'Explain the difference between 〜わけがない and 〜わけではない with a Japanese example.', mode: 'ask' },
  { label: 'Explain BJT keigo', prompt: 'What is the difference between 尊敬語 and 謙譲語? Give a workplace example.', mode: 'ask' },
  { label: 'N2 vocab', prompt: 'Teach one high-value N2 business word and how to use it.', mode: 'ask' },
  { label: 'Quiz me N2', prompt: 'Give me one JLPT N2 multiple-choice question. Do not reveal the answer yet.', mode: 'quiz' },
  { label: 'BJT question', prompt: 'Give me one BJT business Japanese multiple-choice question. Do not reveal the answer yet.', mode: 'quiz' },
  { label: 'Review errors', prompt: 'Review my recent errors and recommend the next 3 things to study.', mode: 'review' },
  { label: '7-day plan', prompt: 'Based on my recent activity, suggest a focused 7-day study plan.', mode: 'review' },
  { label: 'Kanji story', prompt: 'Pick one N2 kanji and tell me a mnemonic story to remember it.', mode: 'ask' },
  { label: 'Listening tip', prompt: 'Give me one tip for improving JLPT N2 listening and a short example sentence.', mode: 'ask' },
  { label: 'Make a sentence', prompt: 'Give me one useful N2 example sentence and explain the grammar in it.', mode: 'ask' },
]

export default function AiTutor({ context = '', compact = false }) {
  const { isSupabaseConfigured } = useAuth()
  const STORAGE_KEY = `n2:tutor:${context || 'general'}`

  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        return JSON.parse(raw).map((m) => ({ ...m, pending: false }))
      }
    } catch {}
    return [{
      role: 'assistant',
      content: 'Hi! I am your JPN2easy AI tutor. I can help with JLPT N2, BJT business Japanese, kanji, grammar, reading, listening, or study strategy.\n\nType a question below or tap a quick topic to get started.',
      pending: false,
    }]
  })
  const [input, setInput] = useState('')
  const [mode, setMode] = useState('ask')
  const [loading, setLoading] = useState(false)
  const [displayed, setDisplayed] = useState('')
  const [copied, setCopied] = useState(null)
  const textareaRef = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (messages.some((m) => m.pending)) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  }, [messages, STORAGE_KEY])

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (displayed) scrollToBottom()
  }, [displayed])

  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || !last.pending) {
      setDisplayed('')
      return
    }
    const full = last.content
    if (!full) return
    setDisplayed('')
    let i = 0
    const id = setInterval(() => {
      i += 3
      if (i > full.length) i = full.length
      setDisplayed(full.slice(0, i))
      if (i >= full.length) {
        clearInterval(id)
        setMessages((m) => m.map((x, idx) => (idx === m.length - 1 ? { ...x, pending: false } : x)))
      }
    }, 6)
    return () => clearInterval(id)
  }, [messages])

  const send = async (text, { resend = false, historyBase } = {}) => {
    text = text.trim()
    if (!text || loading) return
    if (!resend) setInput('')

    if (!resend) {
      setMessages((m) => [...m, { role: 'user', content: text, mode, pending: false }])
    }
    setLoading(true)
    setTimeout(scrollToBottom, 50)

    if (!isSupabaseConfigured || !supabase) {
      setMessages((m) => [...m, { role: 'assistant', content: 'Supabase is not configured, so the AI tutor is unavailable. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env.', pending: false }])
      setLoading(false)
      scrollToBottom()
      return
    }

    try {
      const base = historyBase || messages
      const history = base.filter((msg) => msg.role === 'user' || msg.role === 'assistant').slice(-12).map(({ role, content }) => ({ role, content }))
      const { data, error } = await supabase.functions.invoke('chat', {
        body: { message: text, history, mode, context },
      })
      if (error) throw error
      setMessages((m) => [...m, { role: 'assistant', content: data.answer || 'No response.', sources: data.sources || [], pending: true }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${err.message || 'Could not reach the AI tutor.'}`, pending: false }])
    } finally {
      setLoading(false)
      scrollToBottom()
    }
  }

  const runQuick = (action) => {
    setMode(action.mode)
    send(action.prompt)
  }


  const copy = async (text, i) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i)
      setTimeout(() => setCopied(null), 1200)
    } catch {}
  }

  const regenerate = (i) => {
    const prior = messages.slice(0, i)
    const lastUser = prior.filter((m) => m.role === 'user').pop()
    if (!lastUser) return
    setMessages(prior)
    send(lastUser.content, { resend: true, historyBase: prior })
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  return (
    <div className={compact ? 'h-full flex flex-col space-y-3' : 'max-w-4xl mx-auto space-y-4'}>
      <div className="flex items-center gap-3">
        <Sparkles className="text-violet-400" size={22} />
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight">JPN2easy AI Tutor</h2>
          <p className="text-xs text-slate-400">N2 · BJT · Kanji · Grammar · Listening · Study strategy</p>
        </div>
      </div>

      {messages.length === 1 && (
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              onClick={() => runQuick(a)}
              className="px-3 py-1.5 rounded-full bg-bun-800 border border-bun-600/40 text-xs text-slate-300 hover:text-white hover:border-violet-500/40 transition"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className={compact ? 'flex-1 min-h-0 overflow-hidden rounded-2xl glass p-3 card-glow flex flex-col' : 'rounded-2xl glass p-3 card-glow h-[min(65vh,620px)] flex flex-col'}>
        <div className="flex-1 overflow-y-auto space-y-3 p-2">
          {messages.map((msg, i) => {
            const isLast = i === messages.length - 1
            const isStreaming = isLast && msg.role === 'assistant' && msg.pending
            return (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[92%] sm:max-w-[85%] w-full">
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-violet-600 text-white rounded-tr-sm'
                        : 'bg-bun-700/60 text-slate-200 rounded-tl-sm'
                    }`}
                  >
                    {msg.role === 'user' ? msg.content : isStreaming ? displayed : <RichText text={msg.content} />}
                    {isStreaming && <span className="inline-block w-2 h-4 ml-1 align-middle bg-violet-400 animate-pulse" />}
                  </div>
                  {msg.role === 'assistant' && !msg.pending && (
                    <div className="mt-1 flex items-center gap-1">
                      <TtsButton text={msg.content} className="p-1.5 rounded-lg bg-bun-800/50 hover:bg-bun-700 text-slate-400 hover:text-violet-300" />
                      <button onClick={() => copy(msg.content, i)} className="p-1.5 rounded-lg bg-bun-800/50 hover:bg-bun-700 text-slate-400 hover:text-violet-300" title="Copy">
                        {copied === i ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      </button>
                      <button onClick={() => regenerate(i)} className="p-1.5 rounded-lg bg-bun-800/50 hover:bg-bun-700 text-slate-400 hover:text-violet-300" title="Regenerate">
                        <RotateCcw size={13} />
                      </button>
                    </div>
                  )}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {msg.sources.map((s, j) => (
                        <span
                          key={j}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-bun-800 border border-bun-600/30 text-slate-400 truncate max-w-[150px]"
                          title={s.content}
                        >
                          {s.source}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {loading && !messages[messages.length - 1]?.pending && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3 bg-bun-700/60 text-slate-200 flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" /> Thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="mt-3 flex gap-2 items-end border-t border-bun-600/20 pt-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
            placeholder={
              mode === 'quiz'
                ? 'Ask for a question or answer the one above…'
                : mode === 'review'
                ? 'Review my error log and tell me what to study…'
                : 'Ask about N2, BJT, grammar, kanji, or study strategy…'
            }
            disabled={loading}
            className="flex-1 rounded-xl bg-bun-900 border border-bun-600/40 px-4 py-3 text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none resize-none overflow-hidden min-h-[48px] max-h-[160px]"
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition disabled:opacity-60"
          >
            {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          </button>
        </div>
      </div>
    </div>
  )
}
