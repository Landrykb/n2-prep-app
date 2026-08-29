import { useState } from 'react'
import AiTutor from './AiTutor.jsx'
import { MessageCircle, X, Bot } from 'lucide-react'

export default function ChatBubble({ context }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-violet-600 hover:bg-violet-500 text-white font-medium shadow-lg shadow-violet-600/30 transition hover:-translate-y-1"
      >
        <Bot size={20} />
        <span className="hidden sm:inline text-sm">Ask JPN2easy</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 h-[85vh] max-h-[720px] rounded-t-3xl sm:rounded-none sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[min(480px,100vw)] sm:h-auto sm:max-h-none bg-bun-900/95 sm:bg-bun-900 border-t sm:border-t-0 sm:border-l border-bun-600/30 flex flex-col pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-bun-600/30 bg-bun-800/50">
              <div className="flex items-center gap-2 text-violet-200">
                <MessageCircle size={18} />
                <span className="font-bold text-sm">N2 AI Tutor</span>
                <span className="text-xs text-slate-400">· {context || 'general'}</span>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 rounded-lg bg-bun-700 text-slate-300 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden p-4">
              <AiTutor context={context} compact />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
