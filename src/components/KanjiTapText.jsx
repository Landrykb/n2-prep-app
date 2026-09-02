import { useKanjiModal } from '../hooks/useKanjiModal.js'
import { studyItemByKey, findStudyItem } from '../lib/findStudyItem.js'

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
  return {
    _type: 'Kanji',
    _key: char,
    char,
    word: char,
    title: char,
    meaning: '',
    image: '🦝',
    story: 'Visual breakdown not in the deck yet, but you can try the video search.',
  }
}

export default function KanjiTapText({ text, className = '' }) {
  const { open } = useKanjiModal()
  const chars = Array.from(text)

  return (
    <span className={`leading-relaxed ${className}`}>
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
