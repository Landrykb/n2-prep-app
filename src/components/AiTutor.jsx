import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { supabase } from '../lib/supabaseClient.js'
import { consumeAiPrefill } from '../lib/aiPrefill.js'
import { loadDiagnosis } from '../lib/profile.js'
import { loadTwin, topPatterns } from '../lib/twin.js'
import { loadQueue } from '../lib/queue.js'
import RichText from './RichText.jsx'
import TtsButton from './TtsButton.jsx'
import { Send, Loader2, Sparkles, RotateCcw, Copy, Check, Flag } from 'lucide-react'

// Fleet coherence (Landry, 2026-11-08): four doors, not ten —
// everything else is a free-text ask away in the input below.
function quickActions(level) {
  const L = level || 'N2'
  return [
    { label: `Quiz Me ${L}`, prompt: `Give me one JLPT ${L} multiple-choice question. Do not reveal the answer yet.`, mode: 'quiz' },
    { label: 'Review My Errors', prompt: 'Review my recent errors and recommend the next 3 things to study.', mode: 'review' },
    { label: '7-Day Plan', prompt: 'Based on my recent activity, suggest a focused 7-day study plan.', mode: 'review' },
    { label: 'Kanji Story', prompt: `Pick one ${L} kanji and tell me a mnemonic story to remember it.`, mode: 'ask' },
  ]
}

function tutorGreeting(level) {
  const base = 'Hi! I am your Yonde tutor — I can see what your fleet has been learning about you, so my answers are pitched to your real weak points.'
  const pitch = level ? ` Your last diagnosis put you around ${level}.` : ''
  return `${base}${pitch}`
}

// What the fleet knows, in one compact block for the chat
// function: the Twin's top recurring slips, the diagnosis and
// its weakest section, and the state of the one review queue.
// The tutor READS the fleet through this; free chat does not
// write back (unstructured answers are not measurements).
function tutorContext() {
  try {
    const lines = []
    const diagnosis = loadDiagnosis()
    if (diagnosis?.jlptEstimate) {
      lines.push(`Diagnosis estimate: ${diagnosis.jlptEstimate}${diagnosis.total ? ` (${diagnosis.total}/180)` : ''}.`)
      const sections = diagnosis.sections && typeof diagnosis.sections === 'object' ? Object.entries(diagnosis.sections).filter(([, v]) => typeof v === 'number') : []
      if (sections.length) {
        const weakest = sections.reduce((a, b) => (b[1] < a[1] ? b : a))
        lines.push(`Weakest diagnosis section: ${weakest[0]} (${weakest[1]}/60).`)
      }
    }
    const twin = loadTwin()
    const patterns = topPatterns(twin, 3).map((p) => p.plain || p.label || p.id).filter(Boolean)
    if (patterns.length) lines.push(`Top recurring slips right now: ${patterns.join('; ')}.`)
    const queue = loadQueue()
    if (queue.length) {
      const now = Date.now()
      const due = queue.filter((i) => i.fsrs?.due && new Date(i.fsrs.due).getTime() <= now).length
      lines.push(`Review queue: ${queue.length} cards, ${due} due now.`)
    }
    return lines.join('\n')
  } catch { return '' }
}
export default function AiTutor({ context = '', compact = false }) {
  const level = (() => { try { return loadDiagnosis()?.jlptEstimate || null } catch { return null } })()
  const QUICK_ACTIONS = quickActions(level)
  const { isSupabaseConfigured } = useAuth()
  const [reported, setReported] = useState({})
  // Report/flag for AI-generated replies (Google Play AI-Generated Content
  // policy + Apple 1.2 posture — Doc 15 §1). Flags are kept on-device today
  // (jpn:ai-flags:v1); they move to the moderation inbox with the server
  // step in Doc 15 §6. Reports inform the fleet's filters (Doc 05).
  const reportReply = (i, content) => {
    try {
      const key = 'jpn:ai-flags:v1'
      const flags = JSON.parse(localStorage.getItem(key) || '[]')
      flags.push({ at: new Date().toISOString(), surface: 'ai-tutor', content: String(content).slice(0, 500) })
      localStorage.setItem(key, JSON.stringify(flags))
    } catch { /* ignore */ }
    setReported((r) => ({ ...r, [i]: true }))
  }
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
      content: tutorGreeting(level),
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
      setMessages((m) => [...m, { role: 'assistant', content: 'The tutor cannot connect right now — please try again in a little while. Everything else in Yonde keeps working.', pending: false }])
      console.error('[tutor] backend not configured on this deployment')
      setLoading(false)
      scrollToBottom()
      return
    }

    try {
      const base = historyBase || messages
      const history = base.filter((msg) => msg.role === 'user' || msg.role === 'assistant').slice(-12).map(({ role, content }) => ({ role, content }))
      const { data, error } = await supabase.functions.invoke('chat', {
        body: { message: text, history, mode, context, learner: tutorContext() },
      })
      if (error) throw error
      setMessages((m) => [...m, { role: 'assistant', content: data.answer || 'No response.', sources: data.sources || [], pending: true }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: 'The tutor could not answer just now — please try again in a moment.', pending: false }])
      console.error('[tutor] request failed', err)
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

  // One-shot prefill from elsewhere in the app (e.g. "Ask AI to explain" on
  // the mock exam review). Deferred so send() runs outside the effect body.
  useEffect(() => {
    if (compact) return
    const msg = consumeAiPrefill()
    if (!msg) return
    const t = setTimeout(() => send(msg), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, compact])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  return (
    <div className={compact ? 'h-full flex flex-col space-y-3' : 'max-w-4xl mx-auto space-y-4'}>
      <div className="flex items-center gap-3">
        <Sparkles className="text-[#FF8A75]" size={22} />
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight">Yonde AI Tutor</h2>
          <p className="text-xs text-slate-400">N5–N1 & Beyond · BJT · Kanji · Grammar · Listening · Study Strategy</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            onClick={() => runQuick(a)}
            className="px-3 py-1.5 rounded-full bg-bun-800 border border-bun-600/40 text-xs text-slate-300 hover:text-white hover:border-[#FF6B57]/40 transition"
          >
            {a.label}
          </button>
        ))}
      </div>

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
                        ? 'bg-[#FF6B57] text-white rounded-tr-sm'
                        : 'bg-bun-700/60 text-slate-200 rounded-tl-sm'
                    }`}
                  >
                    {msg.role === 'user' ? msg.content : isStreaming ? displayed : <RichText text={msg.content} />}
                    {isStreaming && <span className="inline-block w-2 h-4 ml-1 align-middle bg-[#FF8A75] animate-pulse" />}
                  </div>
                  {msg.role === 'assistant' && !msg.pending && (
                    <div className="mt-1 flex items-center gap-1">
                      <TtsButton text={msg.content} className="p-1.5 rounded-lg bg-bun-800/50 hover:bg-bun-700 text-slate-400 hover:text-[#FF8A75]" />
                      <button onClick={() => copy(msg.content, i)} className="p-1.5 rounded-lg bg-bun-800/50 hover:bg-bun-700 text-slate-400 hover:text-[#FF8A75]" title="Copy">
                        {copied === i ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      </button>
                      <button onClick={() => regenerate(i)} className="p-1.5 rounded-lg bg-bun-800/50 hover:bg-bun-700 text-slate-400 hover:text-[#FF8A75]" title="Regenerate">
                        <RotateCcw size={13} />
                      </button>
                      {reported[i]
                        ? <span className="text-[11px] text-emerald-300 px-1.5 py-1">Reported — thank you, reports teach the fleet what to fix</span>
                        : <button onClick={() => reportReply(i, msg.content)} className="p-1.5 rounded-lg bg-bun-800/50 hover:bg-bun-700 text-slate-400 hover:text-rose-300" title="Report this AI reply — wrong or offensive content">
                            <Flag size={13} />
                          </button>}
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
                : 'Ask about any level, BJT, grammar, kanji, or study strategy…'
            }
            disabled={loading}
            className="flex-1 rounded-xl bg-bun-900 border border-bun-600/40 px-4 py-3 text-slate-100 placeholder-slate-500 focus:border-[#FF6B57] focus:outline-none resize-none overflow-hidden min-h-[48px] max-h-[160px]"
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="px-4 py-3 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white font-medium transition disabled:opacity-60"
          >
            {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          </button>
        </div>
      </div>
    </div>
  )
}
