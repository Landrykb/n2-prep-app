import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, RotateCcw, Loader2 } from 'lucide-react'
import { getKanjiMeta, getKanjiStrokes, loadComponents, loadKanjiIndex, getRadicals, loadFrenchLayer, loadFamilies, attestedFamilyFor, getKanjiVariants } from '../lib/kanjiDb.js'
import { flattenComponents, captionFor, strokeAnchor, familyFor, positionWords, pickQueueWord, queueHasFront } from '../lib/kanjiLens.js'
import { wordsForKanji, getAccent, getSentences, wordDisplayForm } from '../lib/wordsDb.js'
import { useKanjiModal } from '../hooks/useKanjiModal.js'
import { addToQueue, loadQueue } from '../lib/queue.js'
import { recordLensEncounters } from '../lib/encounters.js'
import { recordMetric } from '../lib/metrics.js'
import { useLanguage } from '../hooks/useLanguage.js'

// Kanji Lens — the evidence-based kanji visualization (docs/18).
// Components assemble first, with the job the data supports named for
// each; strokes then draw in order; the kanji is anchored to a real word;
// and Draw mode is a draw-from-memory self-check — the learner's own eyes
// are the judge, no score is computed. No emoji, no invented stories:
// every label traces to KanjiVG / KANJIDIC2 data.

const INK = '#F1F5F9'
const INK_ACTIVE = '#FF8A75'
const GUIDE = '#5B4A6B'

function useReducedMotion() {
  return useMemo(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
}

const DRAW_CSS = `
@keyframes lensDraw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.lens-draw { stroke-dasharray: 1; animation-name: lensDraw; animation-timing-function: ease-in-out; animation-fill-mode: forwards; }
`

function DrawPad({ paths, char, queueFront, queued, onAddToQueue, onSelfMark }) {
  const { t } = useLanguage()
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const lastRef = useRef(null)
  const [revealed, setRevealed] = useState(false)
  const [marked, setMarked] = useState(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const size = wrap.clientWidth
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.lineWidth = 5 * dpr
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#FF8A75'
    }
  }, [])

  const point = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr }
  }
  const onDown = (e) => {
    e.preventDefault()
    canvasRef.current.setPointerCapture?.(e.pointerId)
    drawingRef.current = true
    lastRef.current = point(e)
  }
  const onMove = (e) => {
    if (!drawingRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(lastRef.current.x, lastRef.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastRef.current = p
  }
  const onUp = () => { drawingRef.current = false }
  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setMarked(null)
  }
  const mark = (result) => {
    recordMetric('kanji_draw_attempt', { char, result })
    setMarked(result)
    onSelfMark?.(result)
  }

  return (
    <div>
      <div ref={wrapRef} className="relative w-full aspect-square rounded-xl bg-bun-900/60 border border-bun-600/20 overflow-hidden">
        <svg viewBox="0 0 109 109" className="absolute inset-0 w-full h-full" aria-hidden="true">
          <line x1="54.5" y1="0" x2="54.5" y2="109" stroke={GUIDE} strokeWidth="0.5" strokeDasharray="3 3" opacity="0.6" />
          <line x1="0" y1="54.5" x2="109" y2="54.5" stroke={GUIDE} strokeWidth="0.5" strokeDasharray="3 3" opacity="0.6" />
          <rect x="0.5" y="0.5" width="108" height="108" fill="none" stroke={GUIDE} strokeWidth="0.5" opacity="0.6" />
        </svg>
        {revealed && paths && (
          <svg viewBox="0 0 109 109" className="absolute inset-0 w-full h-full pointer-events-none">
            <style>{DRAW_CSS}</style>
            {paths.map((d, i) => (
              <path key={i} d={d} pathLength={1} className="lens-draw" style={{ animationDuration: '0.45s', animationDelay: `${i * 0.45}s` }}
                fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
            ))}
          </svg>
        )}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
      </div>
      <p className="text-xs text-slate-400 mt-3">
        {t('lens.drawHint')}
      </p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={() => setRevealed((v) => !v)} className="px-3 py-1.5 rounded-lg bg-bun-700 text-slate-200 text-sm font-medium hover:text-white">{revealed ? t('lens.hide') : t('lens.reveal')}</button>
        <button onClick={clear} className="px-3 py-1.5 rounded-lg bg-bun-700 text-slate-200 text-sm font-medium hover:text-white">{t('lens.clear')}</button>
        <button onClick={() => mark('got')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${marked === 'got' ? 'bg-emerald-600 text-white' : 'bg-bun-700 text-slate-200 hover:text-white'}`}>{t('lens.gotIt')}</button>
        <button onClick={() => mark('not_yet')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${marked === 'not_yet' ? 'bg-[#FF6B57] text-white' : 'bg-bun-700 text-slate-200 hover:text-white'}`}>{t('lens.notYet')}</button>
      </div>
      {marked && <p className="text-xs text-slate-400 mt-2">{marked === 'got' ? t('lens.markedGot') : t('lens.markedNotYet')}</p>}
      {marked === 'not_yet' && (
        <div className="mt-3">
          {queued ? (
            <button disabled className="px-3 py-1.5 rounded-lg bg-bun-700/50 text-slate-400 text-sm font-medium cursor-default">{t('lens.alreadyInQueue')}</button>
          ) : queueFront ? (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={onAddToQueue} className="px-3 py-1.5 rounded-lg bg-[#71368A] text-white text-sm font-medium">{t('lens.addWordToQueue')}</button>
              <span className="text-xs text-slate-400">{t('lens.addsWord', { queueFront })}</span>
            </div>
          ) : (
            <div>
              <button disabled className="px-3 py-1.5 rounded-lg bg-bun-700/50 text-slate-400 text-sm font-medium cursor-default">{t('lens.addWordToQueue')}</button>
              <p className="text-xs text-slate-500 mt-1.5">{t('lens.noCommonWord')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function KanjiLens({ char, item }) {
  const { t } = useLanguage()
  const reduced = useReducedMotion()
  const { close: closeModal } = useKanjiModal() || {}
  const [lensChar, setLensChar] = useState(char)
  const [data, setData] = useState(null)
  const [compMeta, setCompMeta] = useState({})
  const [familyData, setFamilyData] = useState(null)
  const [families, setFamilies] = useState(null)
  const [variants, setVariants] = useState(null)
  const [formIdx, setFormIdx] = useState(0)
  const [words, setWords] = useState(null)
  const [wordEntries, setWordEntries] = useState(null)
  const [frenchMap, setFrenchMap] = useState(null)
  const [queueVersion, setQueueVersion] = useState(0)
  const [mode, setMode] = useState('assemble')
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playKey, setPlayKey] = useState(0)
  const [showNumbers, setShowNumbers] = useState(false)
  const [strokeStep, setStrokeStep] = useState(0)

  useEffect(() => { setLensChar(char) }, [char])

  useEffect(() => {
    let cancelled = false
    setData(null)
    setCompMeta({})
    setStep(0)
    setStrokeStep(0)
    setMode('assemble')
    // Autoplay on open, always (Landry, 2026-11-07: "when you open
    // this it should trigger automatically"). The OS reduce-motion
    // flag used to gate this, which left the stage sitting still —
    // or, in Assemble, empty — until a tap. The animation IS the
    // lesson here; Pause is one tap away in the stage controls.
    setPlaying(true)
    Promise.all([getKanjiMeta(lensChar), getKanjiStrokes(lensChar)]).then(([meta, strokes]) => {
      if (cancelled) return
      setData({ meta, strokes })
      const elements = new Set()
      const collect = (n) => { if (!n) return; if (n.element) elements.add(n.element); (n.children || []).forEach(collect) }
      collect(strokes?.tree)
      elements.delete(lensChar)
      for (const el of elements) {
        if ([...el].length !== 1) continue
        getKanjiMeta(el).then((m) => { if (!cancelled && m) setCompMeta((prev) => ({ ...prev, [el]: m })) }).catch(() => {})
      }
    }).catch(() => { if (!cancelled) setData({ meta: null, strokes: null }) })
    return () => { cancelled = true }
  }, [lensChar])

  useEffect(() => {
    let cancelled = false
    Promise.all([loadComponents(), loadKanjiIndex(), getRadicals()]).then(([components, index, radicals]) => {
      if (!cancelled) setFamilyData({ components, index, radicals })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Words Layer (JMdict common words + Kanjium pitch accents, docs/19).
  // Loads a deep list (50): the first 10 are displayed, and the full
  // list feeds pickQueueWord — the word the loop-closing actions use.
  useEffect(() => {
    let cancelled = false
    setWords(null)
    setWordEntries(null)
    wordsForKanji(lensChar, 50).then(async (entries) => {
      if (cancelled) return
      setWordEntries(entries)
      const shown = entries.slice(0, 10)
      const withAccents = await Promise.all(shown.map(async (entry) => ({
        entry,
        accent: await getAccent(entry),
        sentence: (await getSentences(entry.id).catch(() => null))?.[0] || null,
      })))
      if (!cancelled) setWords(withAccents)
    }).catch(() => { if (!cancelled) { setWords([]); setWordEntries([]) } })
    return () => { cancelled = true }
  }, [lensChar])

  // French curriculum layer (docs/18): theme tags + radical French
  // names for the 814 Licence-list kanji. Reference data, loaded once.
  // The attested sound families (docs/18) load alongside it.
  useEffect(() => {
    let cancelled = false
    loadFrenchLayer().then((map) => { if (!cancelled) setFrenchMap(map) }).catch(() => {})
    loadFamilies().then((list) => { if (!cancelled) setFamilies(list) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // KanjiVG variant forms for this kanji (docs/18), when any ship.
  useEffect(() => {
    let cancelled = false
    setVariants(null)
    setFormIdx(0)
    getKanjiVariants(lensChar).then((list) => { if (!cancelled) setVariants(list) }).catch(() => {})
    return () => { cancelled = true }
  }, [lensChar])

  const meta = data?.meta || null
  const strokes = data?.strokes || null
  const paths = strokes?.paths || null
  const flat = useMemo(() => flattenComponents(strokes?.tree || null, meta), [strokes, meta])
  const topComps = useMemo(() => {
    const tops = flat.filter((n) => n.depth === 1)
    return tops.length ? tops : flat.filter((n) => n.depth === 0)
  }, [flat])
  const strokeComp = useMemo(() => {
    const map = new Map()
    topComps.forEach((node, ci) => node.strokes.forEach((si) => map.set(si, ci)))
    return map
  }, [topComps])

  const family = useMemo(() => {
    if (!familyData || !meta) return null
    const byChar = new Map(familyData.index.map((r) => [r.char, r]))
    const radicalMembers = meta.radical != null ? familyData.index.filter((r) => r.radical === meta.radical).map((r) => r.char) : []
    return familyFor(lensChar, meta, strokes?.tree || null, {
      components: familyData.components,
      metaOf: (c) => byChar.get(c) || null,
      radicalMembers,
      attested: attestedFamilyFor(families, meta.soundComponent),
    })
  }, [familyData, meta, strokes, lensChar, families])

  // Variant forms: the stage can draw a variant's own path set. The
  // component assembly belongs to the standard form's tree — when the
  // selected variant has a different stroke count, Assemble falls
  // back to Stroke Order for that form (and says so under the stage).
  const activeVariant = formIdx > 0 ? variants?.[formIdx - 1] || null : null
  const activePaths = activeVariant ? activeVariant.paths : paths
  const formStrokeMismatch = !!(activeVariant && paths && activeVariant.paths.length !== paths.length)
  const stageMode = mode === 'assemble' && formStrokeMismatch ? 'strokes' : mode
  const pickForm = (idx) => {
    setFormIdx(idx)
    setStep(0)
    setStrokeStep(0)
    setPlayKey((k) => k + 1)
    setPlaying(true)
  }

  // Loop-closing (docs/18): the word this kanji acts through, chosen
  // by the pure preference rule (first 2-kanji compound containing
  // the char, else the first entry). Opening the Lens records that
  // word as an encounter — it was on the screen in front of the
  // learner — and a Draw self-mark records it again (the union store
  // dedupes). A Not Yet offers the same word to the one queue.
  const queuePick = useMemo(() => pickQueueWord(lensChar, wordEntries), [lensChar, wordEntries])
  const queued = useMemo(
    () => (queuePick ? queueHasFront(loadQueue(), queuePick.front) : false),
    // queueVersion is the refresh tick bumped after a queue add.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queuePick, queueVersion],
  )

  useEffect(() => {
    if (queuePick?.front) recordLensEncounters([queuePick.front])
  }, [queuePick])

  const addWordToQueue = () => {
    if (!queuePick || queued) return
    addToQueue([{
      front: queuePick.front,
      back: queuePick.entry.gloss?.[0] || '',
      reading: queuePick.entry.kana || '',
      note: t('lens.queueNote', { char: lensChar }),
      source: 'lens',
      level: meta?.level ? String(meta.level) : '',
    }])
    setQueueVersion((v) => v + 1)
  }

  const onDrawSelfMark = () => {
    if (queuePick?.front) recordLensEncounters([queuePick.front])
  }

  // French layer display facts: this kanji's curriculum row, and the
  // breakdown row its booklet radical name belongs to (the row whose
  // element IS the booklet radical char; else the radical-flagged
  // row). French glosses ride as secondary annotations in this app
  // (KanjiModal shows item.meaningFr the same way) — there is no
  // UI-language switch to gate on, so the name shows the same way.
  const fr = frenchMap?.[lensChar] || null
  const frRadicalTarget = useMemo(() => {
    if (!fr?.radicalNameFr) return null
    const rows = flat.filter((n) => n.depth >= 1)
    if (fr.radicalChar && rows.some((n) => n.element === fr.radicalChar)) return fr.radicalChar
    return rows.find((n) => n.role === 'radical')?.element || null
  }, [fr, flat])

  // Assemble playback: advance one component at a time while playing.
  useEffect(() => {
    if (stageMode !== 'assemble' || !playing || !activePaths) return
    if (step >= topComps.length) { setPlaying(false); return }
    const count = topComps[step]?.strokes.length || 1
    const id = setTimeout(() => setStep((s) => s + 1), 320 + count * 300)
    return () => clearTimeout(id)
  }, [stageMode, playing, step, topComps, activePaths])

  if (!data) {
    return (
      <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4 flex items-center gap-2 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin" /> {t('lens.loading')}
      </div>
    )
  }
  if (!meta && !strokes) {
    return (
      <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4 text-sm text-slate-400">
        {t('lens.notInDatabase', { char: lensChar })}
      </div>
    )
  }

  const radicalInfo = familyData?.radicals?.find((r) => r.n === meta?.radical) || null
  const currentComp = stageMode === 'assemble' && topComps.length ? topComps[Math.min(step, topComps.length - 1)] : null
  const currentCaption = currentComp
    ? captionFor(currentComp, {
        meaning: compMeta[currentComp.element]?.meanings?.[0] || '',
        soundOn: currentComp.role === 'sound' ? (family?.soundOn || familyData?.components?.[currentComp.element]?.[1] || '') : '',
      })
    : ''

  const wordExample = (() => {
    if (!item) return null
    let word = item.word || ''
    if (!word && Array.isArray(item.examples) && item.examples[0]) {
      const e = item.examples[0]
      word = e.reading ? `${e.word}（${e.reading}）` : e.word || ''
    }
    const sentence = item.example || ''
    if (!word && !sentence) return null
    return { word, sentence }
  })()

  const swap = (el) => { if (el && el !== lensChar) setLensChar(el) }

  const renderPath = (d, i) => {
    if (!activePaths) return null
    if (stageMode === 'assemble') {
      const ci = strokeComp.get(i) ?? 0
      if (ci < step) return <path key={i} d={d} pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 0 }} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      if (ci === step) {
        const within = topComps[ci].strokes.indexOf(i)
        return (
          <path key={`${playKey}-${step}-${i}`} d={d} pathLength={1}
            className={playing ? 'lens-draw' : undefined}
            style={{ strokeDasharray: 1, strokeDashoffset: playing ? undefined : 1, animationDuration: '0.3s', animationDelay: `${within * 0.3}s`, animationPlayState: playing ? 'running' : 'paused' }}
            fill="none" stroke={INK_ACTIVE} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        )
      }
      return <path key={i} d={d} pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 1 }} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    }
    // Stroke Order mode
    if (reduced) {
      const shown = i < strokeStep
      return <path key={i} d={d} pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: shown ? 0 : 1 }} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    }
    return (
      <path key={`${playKey}-${i}`} d={d} pathLength={1}
        className={playing ? 'lens-draw' : undefined}
        style={{ strokeDasharray: 1, strokeDashoffset: playing ? undefined : 0, animationDuration: '0.45s', animationDelay: `${i * 0.45}s` }}
        fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    )
  }

  return (
    <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
      <style>{DRAW_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="text-xs uppercase tracking-wider text-slate-400">{t('lens.title')}</h4>
        {lensChar !== char && (
          <button onClick={() => setLensChar(char)} className="text-xs px-2 py-1 rounded-lg bg-bun-700 text-slate-300 hover:text-white">{t('lens.backTo', { char })}</button>
        )}
      </div>

      {fr?.themes?.length > 0 && (
        <div className="mb-4">
          <div className="flex flex-wrap gap-1.5">
            {fr.themes.map((t, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-bun-700/60 border border-bun-600/30 text-slate-300">{t.theme}</span>
            ))}
          </div>
          <p className="text-[10px] text-slate-500 mt-1">{t('lens.themeTagsNote')}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {[['assemble', t('lens.modeAssemble')], ['strokes', t('lens.modeStrokeOrder')], ['draw', t('lens.modeDraw')]].map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); if (m !== 'draw') { setPlaying(true); setPlayKey((k) => k + 1) } }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${mode === m ? 'bg-[#FF6B57] text-white' : 'bg-bun-700 text-slate-300 hover:text-white'}`}>
            {label}
          </button>
        ))}
        {mode === 'strokes' && (
          <button onClick={() => setShowNumbers((v) => !v)} aria-pressed={showNumbers}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${showNumbers ? 'bg-[#71368A] text-white' : 'bg-bun-700 text-slate-300 hover:text-white'}`}>
            {t('lens.numbers')}
          </button>
        )}
      </div>

      {variants && variants.length > 0 && mode !== 'draw' && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs uppercase tracking-wider text-slate-400">{t('lens.forms')}</span>
          {[t('lens.formStandard'), ...variants.map((v) => v.variant)].map((name, i) => (
            <button key={name} onClick={() => pickForm(i)} aria-pressed={formIdx === i}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium ${formIdx === i ? 'bg-[#71368A] text-white' : 'bg-bun-700 text-slate-300 hover:text-white'}`}>
              {name}
            </button>
          ))}
        </div>
      )}

      {mode === 'draw' ? (
        <div className="max-w-[320px] mx-auto w-full">
          <DrawPad key={lensChar} paths={paths} char={lensChar}
            queueFront={queuePick?.front || null} queued={queued}
            onAddToQueue={addWordToQueue} onSelfMark={onDrawSelfMark} />
        </div>
      ) : activePaths ? (
        <div>
          <div className="max-w-[320px] mx-auto w-full rounded-xl bg-bun-900/60 border border-bun-600/20">
            <svg viewBox="0 0 109 109" className="w-full h-auto block">
              {activePaths.map((d, i) => (
                <path key={`g-${i}`} d={d} fill="none" stroke={GUIDE} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
              ))}
              {activePaths.map((d, i) => renderPath(d, i))}
              {stageMode === 'strokes' && showNumbers && activePaths.map((d, i) => {
                const a = strokeAnchor(d)
                if (!a) return null
                return <text key={`n-${i}`} x={Math.max(1, a.x - 4)} y={Math.max(6, a.y - 2)} fontSize="6" fill="#94A3B8">{i + 1}</text>
              })}
            </svg>
          </div>
          <p className="text-center text-sm text-slate-300 mt-3 min-h-[1.25rem]">
            {stageMode === 'assemble'
              ? (step >= topComps.length ? t(topComps.length === 1 ? 'lens.assembledOne' : 'lens.assembledMany', { char: lensChar, count: topComps.length }) : currentCaption)
              : t(showNumbers ? 'lens.strokeOrderCaptionNumbers' : 'lens.strokeOrderCaption', { count: activePaths.length })}
          </p>
          {activeVariant && (
            <p className="text-center text-xs text-slate-500 mt-1">
              {activeVariant.note ? t('lens.variantFormNote', { variant: activeVariant.variant, note: activeVariant.note }) : t('lens.variantForm', { variant: activeVariant.variant })}
              {formStrokeMismatch && t('lens.variantMismatch', { variantCount: activeVariant.paths.length, standardCount: paths.length })}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2 mt-2">
            <button onClick={() => setPlaying((p) => !p)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bun-700 text-slate-200 text-sm font-medium hover:text-white">
              {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? t('lens.pause') : t('lens.play')}
            </button>
            <button onClick={() => { if (stageMode === 'assemble') setStep((s) => Math.min(s + 1, topComps.length)); else setStrokeStep((s) => Math.min(s + 1, activePaths.length)) }}
              className="px-3 py-1.5 rounded-lg bg-bun-700 text-slate-200 text-sm font-medium hover:text-white">{t('lens.stepForward')}</button>
            <button onClick={() => { setStep(0); setStrokeStep(0); setPlayKey((k) => k + 1); setPlaying(true) }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bun-700 text-slate-200 text-sm font-medium hover:text-white">
              <RotateCcw size={14} /> {t('lens.replay')}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-4">
          <p className="text-7xl font-bold text-white">{lensChar}</p>
          <p className="text-xs text-slate-400 mt-3">{t('lens.noStrokeData')}</p>
        </div>
      )}

      {wordExample && (
        <p className="text-sm text-slate-300 mt-4 text-center">
          <span className="text-slate-500">{t('lens.inAWord')}</span>{' '}
          <span className="text-slate-100 font-medium">{wordExample.word}</span>
          {wordExample.sentence && <span className="block text-xs text-slate-400 mt-1">{wordExample.sentence}</span>}
        </p>
      )}

      {words && words.length > 0 && (
        <div className="mt-5">
          <h5 className="text-xs uppercase tracking-wider text-slate-400 mb-2">{t('lens.wordsWithKanji')}</h5>
          <div className="space-y-1.5">
            {words.map(({ entry, accent, sentence }) => (
              <div key={entry.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg px-2 py-1.5 bg-bun-700/30">
                <span className="text-base font-bold text-white">{wordDisplayForm(entry, lensChar)}</span>
                <span className="text-sm text-slate-300">
                  {entry.kana}
                  {accent != null && <sup className="ml-0.5 text-[10px] text-[#FF8A75] font-semibold">{accent}</sup>}
                </span>
                {entry.gloss[0] && <span className="text-xs text-slate-400">{entry.gloss[0]}</span>}
                {sentence && (
                  <span className="basis-full text-xs text-slate-400 mt-0.5">
                    {sentence.jp} <span className="text-slate-500">{sentence.en}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
          {words.some((w) => w.accent != null) && (
            <p className="text-[11px] text-slate-500 mt-2">{t('lens.pitchAccentAttribution')}</p>
          )}
          {words.some((w) => w.sentence) && (
            <p className="text-[11px] text-slate-500 mt-1">{t('lens.exampleSentencesAttribution')}</p>
          )}
        </div>
      )}

      {flat.length > 1 && (
        <div className="mt-5">
          <h5 className="text-xs uppercase tracking-wider text-slate-400 mb-2">{t('lens.builtFrom')}</h5>
          <div className="space-y-1.5">
            {flat.filter((n) => n.depth >= 1).map((n, i) => {
              const cm = compMeta[n.element]
              const shared = family?.parts?.[n.element]?.count || 0
              return (
                <button key={i} onClick={() => swap(n.element)} disabled={[...String(n.element || '')].length !== 1}
                  className="w-full text-left flex items-baseline gap-2 rounded-lg px-2 py-1.5 hover:bg-bun-700/60 disabled:hover:bg-transparent"
                  style={{ marginLeft: `${(n.depth - 1) * 18}px` }}>
                  <span className="text-xl font-bold text-white">{n.element}</span>
                  {n.role === 'radical' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#71368A] text-white">{t('lens.badgeRadical')}</span>}
                  {n.role === 'sound' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#FF6B57] text-white">{t('lens.badgeSound')}</span>}
                  <span className="text-xs text-slate-400">
                    {[positionWords(n.position), cm?.meanings?.[0] || '', cm?.on?.[0] || '', shared > 1 ? t('lens.sharedPart', { count: shared }) : ''].filter(Boolean).join(' · ')}
                  </span>
                  {fr?.radicalNameFr && n.element === frRadicalTarget && (
                    <span className="text-[11px] text-slate-500">FR · {fr.radicalNameFr}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {family?.soundComponent && family.sound.length > 0 && (
        <div className="mt-5">
          <h5 className="text-xs uppercase tracking-wider text-slate-400 mb-2">
            {family.soundOn ? t('lens.soundFamilyWithOn', { component: family.soundComponent, on: family.soundOn }) : t('lens.soundFamily', { component: family.soundComponent })}
            {family.attested && (
              <span className="ml-2 normal-case tracking-normal px-1.5 py-0.5 rounded-full bg-[#71368A] text-white text-[10px]">{t('lens.confirmedTwoSources')}</span>
            )}
          </h5>
          <div className="flex flex-wrap gap-2">
            {family.sound.map((m) => (
              <button key={m.char} onClick={() => swap(m.char)}
                className={`px-2.5 py-1.5 rounded-lg bg-bun-700/60 text-left ${m.matches && m.attested !== false ? '' : 'opacity-45'}`}>
                <span className="text-lg font-bold text-white">{m.char}</span>
                {m.on && <span className="block text-[10px] text-slate-400">{m.on}</span>}
              </button>
            ))}
          </div>
          {family.attested && family.sound.some((m) => m.attested === false) && (
            <p className="text-[11px] text-slate-500 mt-2">{t('lens.dimmedAttested')}</p>
          )}
          {family.sound.some((m) => !m.matches) && (
            <p className="text-[11px] text-slate-500 mt-2">{t('lens.dimmedDrifted')}</p>
          )}
        </div>
      )}

      {family && family.radical.length > 0 && (
        <div className="mt-5">
          <h5 className="text-xs uppercase tracking-wider text-slate-400 mb-2">
            {radicalInfo ? t('lens.sameRadicalWith', { char: radicalInfo.char, number: meta.radical }) : t('lens.sameRadical')}
          </h5>
          <div className="flex flex-wrap gap-2">
            {family.radical.map((c) => (
              <button key={c} onClick={() => swap(c)} className="px-2.5 py-1.5 rounded-lg bg-bun-700/60">
                <span className="text-lg font-bold text-white">{c}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2 mt-5">
        <p className="text-[10px] text-slate-500">{t('lens.sourcesAttribution')}</p>
        <button
          onClick={() => { closeModal?.(); window.location.hash = '#/sources' }}
          className="text-[11px] px-2 py-1 rounded-lg bg-bun-700 text-slate-300 hover:text-white shrink-0">
          {t('lens.allSources')}
        </button>
      </div>
    </div>
  )
}
