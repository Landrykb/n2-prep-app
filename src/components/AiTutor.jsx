import { useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { supabase } from '../lib/supabaseClient.js'
import RichText from './RichText.jsx'
import { Send, Loader2, Sparkles, Lightbulb, HelpCircle, BookOpen, RotateCcw } from 'lucide-react'

const MODES = {
  ask: { label: 'Ask', icon: Sparkles, desc: 'Ask any N2 question' },
  quiz: { label: 'Quiz', icon: HelpCircle, desc: 'Generate a practice question' },
  review: { label: 'Review', icon: BookOpen, desc: 'Analyze your error log' },
}

const QUICK_ACTIONS = [
  { label: 'Explain a pattern', prompt: 'Explain the difference between 〜わけがない and 〜わけではない with examples.', mode: 'ask', icon: Lightbulb },
  { label: 'Quiz me', prompt: 'Create one JLPT N2 multiple-choice question for me.', mode: 'quiz', icon: HelpCircle },
  { label: 'Past question', prompt: 'Generate one JLPT N2 past-style multiple-choice question. Do not reveal the answer. After I answer, explain each option.', mode: 'quiz', icon: BookOpen },
  { label: 'Review errors', prompt: 'Review my recent errors and recommend what to study next.', mode: 'review', icon: BookOpen },
]

export default function AiTutor({ context = '' }) {
  const { isSupabaseConfigured } = useAuth()
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'I am your N2 tutor. Ask me anything, or pick a quick action below.\n\nI will explain the rule, give a Japanese example, and then ask a short follow-up to check your understanding.' },
  ])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState('ask')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const send = async (e) => {
    e?.preventDefault()
    const text = (typeof e === 'string' ? e : input).trim()
    if (!text || loading) return
    setInput('')

    const userMsg = { role: 'user', content: text, mode }
    setMessages((m) => [...m, userMsg])
    setLoading(true)
    scrollToBottom()

    if (!isSupabaseConfigured || !supabase) {
      setMessages((m) => [...m, { role: 'assistant', content: 'Supabase is not configured, so the AI tutor is unavailable. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env.' }])
      setLoading(false)
      scrollToBottom()
      return
    }

    try {
      const history = messages.filter((msg) => msg.role === 'user' || msg.role === 'assistant').slice(-12).map(({ role, content }) => ({ role, content }))
      const { data, error } = await supabase.functions.invoke('chat', {
        body: { message: text, history, mode, context },
      })
      if (error) throw error
      setMessages((m) => [...m, { role: 'assistant', content: data.answer || 'No response.', sources: data.sources || [] }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${err.message || 'Could not reach the AI tutor.'}` }])
    } finally {
      setLoading(false)
      scrollToBottom()
    }
  }

  const runQuick = (action) => {
    setMode(action.mode)
    setInput(action.prompt)
    send(action.prompt)
  }

  const clearChat = () => {
    setMessages([{ role: 'assistant', content: 'Chat cleared. What should we focus on?' }])
  }

  const currentMode = MODES[mode]

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <currentMode.icon className="text-violet-400" size={24} />
          <div>
            <h2 className="text-2xl font-bold text-white leading-tight">{currentMode.label} — N2 AI Tutor</h2>
            <p className="text-xs text-slate-400">{currentMode.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {Object.entries(MODES).map(([k, m]) => {
            const Icon = m.icon
            return (
              <button
                key={k}
                onClick={() => setMode(k)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  mode === k ? 'bg-violet-600 text-white' : 'bg-bun-800 text-slate-400 hover:text-white border border-bun-600/40'
                }`}
              >
                <Icon size={14} /> {m.label}
              </button>
            )
          })}
          <button onClick={clearChat} title="Clear chat" className="p-1.5 rounded-lg bg-bun-800 text-slate-400 hover:text-white border border-bun-600/40">
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {messages.length === 1 && (
        <div className="grid sm:grid-cols-3 gap-3">
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon
            return (
              <button
                key={a.label}
                onClick={() => runQuick(a)}
                className="text-left rounded-2xl glass p-4 card-glow hover:border-violet-500/40 transition group"
              >
                <div className="w-9 h-9 rounded-xl bg-bun-700 flex items-center justify-center text-violet-300 mb-3 group-hover:scale-105 transition">
                  <Icon size={18} />
                </div>
                <p className="font-semibold text-white text-sm">{a.label}</p>
                <p className="text-xs text-slate-400 mt-1">{a.prompt}</p>
              </button>
            )
          })}
        </div>
      )}

      <div className="rounded-3xl glass p-4 card-glow h-[min(60vh,560px)] flex flex-col">
        <div className="flex-1 overflow-y-auto space-y-4 p-2">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[88%] sm:max-w-[80%] w-full">
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-violet-600 text-white rounded-tr-sm'
                      : 'bg-bun-700/60 text-slate-200 rounded-tl-sm'
                  }`}
                >
                  {msg.role === 'user' ? msg.content : <RichText text={msg.content} />}
                </div>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {msg.sources.map((s, j) => (
                      <span
                        key={j}
                        className="text-[10px] px-2 py-1 rounded-full bg-bun-800 border border-bun-600/30 text-slate-400 truncate max-w-[160px]"
                        title={s.content}
                      >
                        {s.source}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3 bg-bun-700/60 text-slate-200 flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" /> Thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={send} className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              mode === 'quiz'
                ? 'Ask for a question or answer the one shown above…'
                : mode === 'review'
                ? 'Review my error log and tell me what to study…'
                : 'e.g. Explain 〜わけにはいかない vs 〜ざるを得ない'
            }
            disabled={loading}
            className="flex-1 rounded-xl bg-bun-900 border border-bun-600/40 px-4 py-3 text-slate-100 placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium transition disabled:opacity-60"
          >
            {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-slate-500">
        Answers are grounded in the N2 study library and your error log using OpenRouter + Supabase vector search.
      </p>
    </div>
  )
}
