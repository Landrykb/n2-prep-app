import { useState } from 'react'

// Kanji In This Passage (Doc 16 §5 amendment #10, Fit v2): the web
// Reader's animated face of the Telegram readings block. The bot
// folds its readings into an expandable quote; the app can do
// better — every distinct kanji word of the passage as a chip that
// fades and slides in on mount (staggered; static under
// prefers-reduced-motion via the chipIn media rule in index.css).
//
// Tapping a chip selects it: the word pulses in the passage above
// (Reader's highlightWord + anchor scroll) and a small card under
// the strip shows the word, its reading, and its meaning when the
// dictionary has one. The Mine This Word action appears ONLY when
// the word is one of the passage's new-word candidates — and only
// while it is still unmined, because Reader rebuilds these rows
// from pick.newWords on every pick change.
//
// Props:
//   chips      [{ word, reading, meaning, candidate }] — candidate
//              is the passage's new-word candidate object or null.
//   activeWord the currently highlighted surface ('' for none)
//   onHighlight(word) — pulse/scroll the word in the passage
//   onMineWord(candidates) — Reader's single-word mine flow
export default function KanjiChips({ chips, activeWord, onHighlight, onMineWord }) {
  // Reader keys this component by passage id, so a new passage
  // remounts it: selection (and the mount stagger) start fresh.
  const [selected, setSelected] = useState(null)

  if (!chips || chips.length === 0) return null
  const active = chips.find((c) => c.word === selected) || null

  return (
    <div className="mt-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Kanji In This Passage</p>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip, i) => (
          <button
            key={chip.word}
            type="button"
            onClick={() => { setSelected(chip.word); onHighlight?.(chip.word) }}
            className={`kanji-chip rounded-full border px-3 py-1.5 text-sm transition-colors ${
              selected === chip.word || activeWord === chip.word
                ? 'border-[#FF6B57] bg-[#FF6B57]/15 text-slate-100'
                : 'border-white/15 bg-white/5 text-slate-200 hover:border-white/30'
            }`}
            style={{ animationDelay: `${Math.min(i, 24) * 45}ms` }}
          >
            <span className="font-bold">{chip.word}</span>
            {chip.reading && <span className="ml-1.5 text-xs text-slate-400">{chip.reading}</span>}
          </button>
        ))}
      </div>
      {active && (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-slate-100">
            <span className="text-lg font-bold">{active.word}</span>
            {active.reading && <span className="ml-2 text-sm text-slate-400">{active.reading}</span>}
          </p>
          {active.meaning && <p className="mt-1 text-sm text-slate-300">{active.meaning}</p>}
          {active.candidate && (
            <button
              type="button"
              onClick={() => onMineWord?.([active.candidate])}
              className="mt-2 rounded-full bg-[#FF6B57] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#ff7f6e]"
            >
              Mine This Word
            </button>
          )}
        </div>
      )}
    </div>
  )
}
