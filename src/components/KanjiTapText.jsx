import { useKanjiModal } from '../hooks/useKanjiModal.js'
import { studyItemByKey } from '../lib/findStudyItem.js'

function isCJK(char) {
  const cp = char.codePointAt(0)
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2ebef)
  )
}

export default function KanjiTapText({ text, className = '' }) {
  const { open } = useKanjiModal()
  const chars = Array.from(text)

  return (
    <span className={`leading-relaxed ${className}`}>
      {chars.map((char, i) => {
        if (!isCJK(char)) return <span key={i}>{char}</span>
        const item = studyItemByKey.get(char)
        if (!item) return <span key={i}>{char}</span>
        return (
          <span
            key={i}
            onClick={(e) => { e.stopPropagation(); open(item) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(item) } }}
            role="button"
            tabIndex={0}
            className="cursor-pointer border-b border-dashed border-violet-500/40 hover:text-violet-300 transition touch-manipulation"
            title={item.meaning}
          >
            {char}
          </span>
        )
      })}
    </span>
  )
}
