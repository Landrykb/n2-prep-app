import { useMemo } from 'react'
import { useKanjiModal } from '../hooks/useKanjiModal.js'
import { studyItems } from '../lib/findStudyItem.js'
import KanjiTapText from './KanjiTapText.jsx'

export default function RichText({ text }) {
  const { open } = useKanjiModal()

  const parts = useMemo(() => {
    const out = []
    let rest = text
    while (rest.length > 0) {
      const item = studyItems.find((i) => rest.startsWith(i._key))
      if (item) {
        out.push({ type: 'term', item })
        rest = rest.slice(item._key.length)
      } else {
        let nextIndex = -1
        let nextItem = null
        for (let i = 1; i < rest.length; i++) {
          const found = studyItems.find((s) => rest.slice(i).startsWith(s._key))
          if (found) {
            nextIndex = i
            nextItem = found
            break
          }
        }
        if (nextItem) {
          if (nextIndex > 0) out.push({ type: 'text', text: rest.slice(0, nextIndex) })
          out.push({ type: 'term', item: nextItem })
          rest = rest.slice(nextIndex + nextItem._key.length)
        } else {
          out.push({ type: 'text', text: rest })
          rest = ''
        }
      }
    }
    return out
  }, [text])

  return (
    <span className="leading-relaxed whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.type === 'text' ? (
          <KanjiTapText key={i} text={p.text} />
        ) : (
          <span
            key={i}
            onClick={(e) => { e.stopPropagation(); open(p.item) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(p.item) } }}
            role="button"
            tabIndex={0}
            className="cursor-pointer border-b border-dashed border-violet-500/40 hover:text-violet-300 transition touch-manipulation"
            title={p.item.meaning}
          >
            {p.item._key}
          </span>
        )
      )}
    </span>
  )
}
