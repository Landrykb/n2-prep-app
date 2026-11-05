import { useState } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { saveFeedback, feedbackMailto } from '../lib/feedback.js'
import { useAuth } from '../hooks/useAuth.js'

// Feedback entry (P1-8). Honest delivery states only: the note is kept
// on this device always; "sent" is shown only when the feedback table
// actually received it; otherwise the mailto door is offered instead of
// a fake success.
export default function FeedbackBox({ context = '' }) {
  const { user } = useAuth()
  const [body, setBody] = useState('')
  const [state, setState] = useState(null) // null | 'sending' | 'sent' | 'local'
  return (
    <div className="rounded-2xl glass p-5 card-glow space-y-3">
      <h3 className="font-bold text-white flex items-center gap-2"><MessageSquare size={16} className="text-[#FF8A75]" /> Tell The Fleet</h3>
      <p className="text-sm text-slate-400">What helped, what confused you, what broke — in your own words. It goes to a human (Landry), not a bot queue.</p>
      <textarea
        value={body}
        onChange={(e) => { setBody(e.target.value); setState(null) }}
        rows={3}
        placeholder="e.g. The call came while I was on the train and…"
        className="w-full rounded-xl bg-bun-800/70 border border-bun-600/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={!body.trim() || state === 'sending'}
          onClick={async () => { setState('sending'); const r = await saveFeedback(body.trim(), context); setState(r.sent ? 'sent' : 'local'); if (r.sent) setBody('') }}
          className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] disabled:opacity-40 text-white text-sm font-semibold flex items-center gap-1.5"
        ><Send size={14} /> Send Feedback</button>
        {state === 'sent' && <p className="text-sm text-emerald-300">Sent — thank you. It is also kept on this device.</p>}
        {state === 'local' && (
          <p className="text-sm text-amber-200">
            Kept on this device{user ? ' — sending will retry is not automatic; ' : ' (you are signed out, so it cannot reach the inbox directly). '}
            <a className="underline text-[#FF8A75]" href={feedbackMailto(body)}>Email It Instead</a>
          </p>
        )}
      </div>
    </div>
  )
}
