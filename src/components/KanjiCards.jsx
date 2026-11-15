import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useLanguage } from '../hooks/useLanguage.js'
import {
  CARD_TOTAL,
  fetchKanjiCards,
  loadKanjiCardData,
  markCardForgot,
  markCardShown,
} from '../lib/kanjiCards.js'

// Kanji flash cards (Doc 16, 2026-11-15) — the app door of
// the Telegram deck. Same rows, same echo schedule: the
// question face first (say the reading and meaning), then
// the full card, then Got it / Forgot it — exactly the bot's
// flow, so reviewing here moves the Telegram echoes too.

const INK = '#F5F2EA'
const DONE = '#787C96'
const CORAL = '#FF6B57'

function Glyph({ paths, char, size = 220, upto = null, hot = false }) {
  const shown = upto == null ? paths : paths.slice(0, upto)
  if (!paths.length) {
    return (
      <span
        className="font-bold text-[#F5F2EA] leading-none"
        style={{ fontSize: size * 0.72 }}
      >
        {char}
      </span>
    )
  }
  return (
    <svg viewBox="0 0 109 109" width={size} height={size} aria-hidden="true">
      {shown.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={hot && i === shown.length - 1 ? CORAL : upto == null ? INK : DONE}
          strokeWidth={upto == null ? 3.4 : 5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}

function StrokeStrip({ paths }) {
  if (!paths.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {paths.map((_, k) => (
        <div key={k} className="relative rounded-md bg-[#20203A] p-1">
          <Glyph paths={paths} char="" size={40} upto={k + 1} hot />
          <span className="absolute bottom-0 right-1 text-[9px] font-semibold text-slate-500">
            {k + 1}
          </span>
        </div>
      ))}
    </div>
  )
}

function WordRow({ entry, char, t }) {
  return (
    <div>
      <p className="text-2xl font-bold leading-tight">
        {[...entry.word].map((c, i) => (
          <span key={i} className={c === char ? 'text-[#FF6B57]' : 'text-white'}>
            {c}
          </span>
        ))}
        <span className="ml-3 align-middle text-base font-medium text-[#FFA08D]">
          {entry.reading}
        </span>
      </p>
      {entry.meaning && <p className="text-sm text-slate-400">{entry.meaning}</p>}
    </div>
  )
}

function DeckCard({ row, index, total, onNext, t }) {
  const [face, setFace] = useState('question')
  const [data, setData] = useState(null)
  const [shownRow, setShownRow] = useState(row)
  const shownOnce = useRef(false)

  // A presentation counts as the showing — the same moment
  // Telegram counts at send. Once per card.
  useEffect(() => {
    if (shownOnce.current) return
    shownOnce.current = true
    markCardShown(row).then((advanced) => {
      if (advanced) setShownRow(advanced)
    })
    loadKanjiCardData(row.kanji).then(setData)
  }, [row])

  const forgot = async () => {
    await markCardForgot(shownRow)
    onNext()
  }

  return (
    <div className="space-y-5">
      <p className="text-center text-xs font-semibold tracking-wide text-slate-400">
        {t('cards.progress', { current: index + 1, total })}
        {' · '}
        {row.kanji} · {shownRow.sends}/{CARD_TOTAL}
      </p>
      {face === 'question' ? (
        <div className="space-y-6 pt-2">
          <div className="flex justify-center">
            <Glyph paths={data?.paths ?? []} char={row.kanji} size={250} />
          </div>
          <p className="text-center text-lg font-bold tracking-wide text-[#FFA08D]">
            {t('cards.prompt')}
          </p>
          <button
            onClick={() => setFace('answer')}
            className="w-full rounded-xl bg-[#FF6B57] py-3 text-base font-bold text-white"
          >
            {t('cards.showAnswer')}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex justify-center">
            <Glyph paths={data?.paths ?? []} char={row.kanji} size={170} />
          </div>
          {(data?.on || data?.kun) && (
            <p className="text-center text-xl text-white">
              {data?.on && (
                <>
                  <span className="mr-2 text-xs font-bold text-[#FFA08D]">{t('cards.on')}</span>
                  {data.on}
                </>
              )}
              {data?.kun && (
                <>
                  <span className="ml-4 mr-2 text-xs font-bold text-[#FFA08D]">{t('cards.kun')}</span>
                  {data.kun}
                </>
              )}
            </p>
          )}
          {data?.meaning && (
            <p className="text-center text-2xl font-bold text-white">{data.meaning}</p>
          )}
          {data?.paths?.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold tracking-widest text-slate-500">
                {t('cards.strokeOrder')}
              </p>
              <StrokeStrip paths={data.paths} />
            </div>
          )}
          {data?.words?.length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-bold tracking-widest text-slate-500">
                {t('cards.commonWords')}
              </p>
              {data.words.map((w) => (
                <WordRow key={w.word} entry={w} char={row.kanji} t={t} />
              ))}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onNext}
              className="flex-1 rounded-xl bg-[#FF6B57] py-3 text-base font-bold text-white"
            >
              {t('cards.gotIt')}
            </button>
            <button
              onClick={forgot}
              className="flex-1 rounded-xl border border-white/15 py-3 text-base font-semibold text-slate-200"
            >
              {t('cards.forgotIt')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function KanjiCards() {
  const { t } = useLanguage()
  const [summary, setSummary] = useState(null)
  const [open, setOpen] = useState(false)
  const [deck, setDeck] = useState([])
  const [index, setIndex] = useState(0)
  const [reviewed, setReviewed] = useState(0)

  const refresh = useCallback(async () => {
    setSummary(await fetchKanjiCards())
  }, [])

  useEffect(() => {
    refresh()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  if (!summary) return null
  const dueCount = summary.due.length
  const total = summary.rows.length
  const nextRow = summary.rows.find((r) => r.sends < CARD_TOTAL)
  const nextWhen = nextRow
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(nextRow.next_due_at))
    : null

  const startReview = () => {
    setDeck(summary.due)
    setIndex(0)
    setReviewed(0)
    setOpen(true)
  }

  const next = () => {
    setReviewed((n) => n + 1)
    if (index + 1 < deck.length) {
      setIndex(index + 1)
    } else {
      setOpen(false)
      refresh()
    }
  }

  return (
    <section className="rounded-3xl bg-[#151129] border border-white/5 p-4 sm:p-6 space-y-4">
      <div>
        <p className="text-[11px] font-bold tracking-widest text-slate-500">
          {t('cards.eyebrow')}
        </p>
        <h3 className="text-lg font-bold text-white leading-snug mt-0.5">
          {t('cards.title')}
        </h3>
      </div>
      {total === 0 ? (
        <p className="text-sm text-slate-400">{t('cards.empty')}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-4xl font-extrabold tabular-nums text-white">
            {dueCount}
            <span className="ml-2 align-middle text-sm font-semibold text-slate-400">
              {t('cards.due')}
            </span>
          </p>
          <p className="text-sm text-slate-400">
            {t('cards.inRotation', { count: total })}
            {dueCount === 0 && nextWhen
              ? ` · ${t('cards.nextEcho', { when: nextWhen })}`
              : ''}
          </p>
          {dueCount > 0 && (
            <button
              onClick={startReview}
              className="w-full rounded-xl bg-[#FF6B57] py-2.5 text-sm font-bold text-white"
            >
              {t('cards.review')}
            </button>
          )}
        </div>
      )}

      {open && deck.length > 0 && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0D0B1A]/97">
          <div className="mx-auto max-w-md px-4 py-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold text-white">{t('cards.title')}</p>
              <button
                onClick={() => {
                  setOpen(false)
                  refresh()
                }}
                aria-label={t('cards.close')}
                className="rounded-lg bg-white/5 p-2 text-slate-300"
              >
                <X size={18} />
              </button>
            </div>
            <DeckCard
              key={`${deck[index].kanji}-${index}`}
              row={deck[index]}
              index={index}
              total={deck.length}
              onNext={next}
              t={t}
            />
            {reviewed > 0 && index === 0 && (
              <p className="mt-4 text-center text-xs text-slate-500">
                {t('cards.doneLine', { count: reviewed })}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
