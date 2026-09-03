import { useMemo } from 'react'
import { useKanjiModal } from '../hooks/useKanjiModal.js'
import { studyItemByKey, findStudyItem } from '../lib/findStudyItem.js'
import { kanjiReadings } from '../lib/kanjiReadings.js'
import { useFurigana } from '../hooks/useFurigana.js'
import { segmentFurigana, cleanReading } from '../lib/furigana.js'

function isCJK(char) {
  const cp = char.codePointAt(0)
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2ebef)
  )
}

function makeItem(char) {
  const exact = studyItemByKey.get(char) || findStudyItem(char)
  if (exact) return exact
  const fallback = kanjiReadings[char] || { on: '', kun: '' }
  return {
    _type: 'Kanji',
    _key: char,
    char,
    word: char,
    title: char,
    on: fallback.on,
    kun: fallback.kun,
    meaning: '',
    image: '🦝',
    story: 'Visual breakdown not in the deck yet, but you can try the video search.',
  }
}

function makeWordItem(word, reading) {
  const exact = studyItemByKey.get(word) || findStudyItem(word)
  if (exact) return exact
  return { _type: 'Vocab', _key: word, word, reading, meaning: '', image: '📘' }
}

/** Same tap/click handlers, reused for both the ruby and plain-span variants. */
function tapHandlers(open, item) {
  const click = (e) => {
    e.stopPropagation()
    if (e.cancelable) e.preventDefault()
    open(item)
  }
  return {
    onClick: click,
    onTouchEnd: click,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open(item)
      }
    },
    role: 'button',
    tabIndex: 0,
  }
}

export default function KanjiTapText({ text, className = '' }) {
  const { open } = useKanjiModal()
  const { enabled, index } = useFurigana()
  const chars = useMemo(() => Array.from(text), [text])
  const parts = useMemo(() => (enabled ? segmentFurigana(text, index) : null), [text, enabled, index])

  if (parts) {
    return (
      <span className={`leading-relaxed whitespace-pre-wrap ${className}`}>
        {parts.map((p, i) => {
          if (p.type === 'w') {
            const item = makeWordItem(p.text, p.reading)
            return (
              <ruby
                key={i}
                {...tapHandlers(open, item)}
                className="cursor-pointer border-b border-dashed border-violet-500/40 hover:text-violet-300 transition touch-manipulation"
                title={item.meaning || 'Tap for detail'}
              >
                {p.text}
                {p.reading && <rt className="text-[0.6em] font-normal text-violet-300 select-none">{p.reading}</rt>}
              </ruby>
            )
          }
          const char = p.text
          if (!isCJK(char)) return <span key={i}>{char}</span>
          const item = makeItem(char)
          const reading = cleanReading(item.kun) || cleanReading(item.on)
          return (
            <ruby
              key={i}
              {...tapHandlers(open, item)}
              className="cursor-pointer border-b border-dashed border-violet-500/40 hover:text-violet-300 transition touch-manipulation"
              title={item.meaning || 'Tap for visual breakdown'}
            >
              {char}
              {reading && <rt className="text-[0.6em] font-normal text-violet-300 select-none">{reading}</rt>}
            </ruby>
          )
        })}
      </span>
    )
  }

  return (
    <span className={`leading-relaxed whitespace-pre-wrap ${className}`}>
      {chars.map((char, i) => {
        if (!isCJK(char)) return <span key={i}>{char}</span>
        const item = makeItem(char)
        const click = (e) => {
          e.stopPropagation()
          if (e.cancelable) e.preventDefault()
          open(item)
        }
        return (
          <span
            key={i}
            onClick={click}
            onTouchEnd={click}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(item) } }}
            role="button"
            tabIndex={0}
            className="cursor-pointer border-b border-dashed border-violet-500/40 hover:text-violet-300 transition touch-manipulation"
            title={item.meaning || 'Tap for visual breakdown'}
          >
            {char}
          </span>
        )
      })}
    </span>
  )
}
