import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, CheckCircle2, Mic, Pickaxe, RefreshCw, Square } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'
import { useAuth } from '../hooks/useAuth.js'
import { useLanguage } from '../hooks/useLanguage.js'
import { useFurigana } from '../hooks/useFurigana.js'
import { collectLearnerState, saveDeclaredLevel } from '../lib/learnerState.js'
import { addToQueue, loadQueue, queueItemId } from '../lib/queue.js'
import { loadDictionary } from '../lib/dictionary.js'
import { recordMetric } from '../lib/metrics.js'
import { loadWordSearchIndex } from '../lib/wordsDb.js'
import { prewarmNeuralAudio } from '../lib/neuralVoice.js'
import { modelCast } from '../lib/voicePreference.js'
import {
  BANDS, bandRank, buildKnownSet, countKnownContent, currentBatchWords, deckCreditSet,
  isColdStart, kanjiReadings, passageNewKanji, passageRatio, passageRecyclesBatch,
  pickPassage, pickStarter, capCandidates,
  resolveBand, seenKanjiSet, serveBandFor, applyFeedback,
} from '../lib/readerFit.js'
import {
  READ_ALOUD_PASS_SCORE, normalizeSpeechText, scoreReadAloud, firstMissedCandidate,
  candidatesInText, missedSentences, passageHalves, splitPassageSentences,
} from '../lib/readAloud.js'
import KanjiTapText from './KanjiTapText.jsx'
import KanjiChips from './KanjiChips.jsx'
import TtsButton from './TtsButton.jsx'
import Mascot from './Mascot.jsx'
import HeardPitch from './HeardPitch.jsx'
import HeardVault from './HeardVault.jsx'
import KanjiCards from './KanjiCards.jsx'
import { PassageSkeleton } from './Skeleton.jsx'

// THE READER (Doc 16 §2/§7 R1) — the web surface of Hori's Reader, the
// same shelf the Telegram bot serves from. Fitting happens HERE, in
// the browser, with the same deterministic core the bot uses
// (src/lib/readerFit.js — the bot's fit.ts is its twin): known set,
// band basis, the 0.93–0.97 gate, the cold-start starter track and
// the footer labelling are the bot's, mirrored line for line where
// the surfaces share copy, so Telegram and the app never disagree
// about what fits a learner or why.
//
// Data flow mirrors Mining.jsx (the queue writes: loadQueue /
// addToQueue from queue.js — the ONE queue, synced by the learner
// state write path) and TwinView.jsx's Reader card (the authed
// telegram_links read). The bank itself is read through the authed
// client (migration 00015: passages are shared content, SELECT for
// signed-in users; writes stay service-role only).

const RECENT_DAYS = 14

// The starter footer — verbatim from reader-bot (Doc 16 §5 amendment
// #2): it never claims fitting that did not happen. It lives in the
// i18n catalog as reader.starterFooter (Doc 20).

// Appended to the nothing-fits state when the learner has words but
// no band basis at all (reader-bot, same amendment): the checkup is
// named as the switch that turns level-fitting on. Catalog key:
// reader.checkupSwitch.

// The first sentence of `text` containing `word` — the mined card's
// context line, the reader-bot's own helper (Doc 16 §3).
function sentenceWith(text, word) {
  const sentences = String(text).split(/(?<=[。！？\n])/)
  const hit = sentences.find((s) => s.includes(word))
  const chosen = (hit ?? text).trim()
  return chosen.length > 120 ? `${chosen.slice(0, 117)}...` : chosen
}

// word → deck level for the credit set and candidate levelling. The
// deck lists ~245 words at two levels; duplicates take the LOWER
// level, exactly as the bot's generated deck module resolves them.
function deckLevelsFrom(dict) {
  const levels = new Map()
  for (const e of dict?.entries || []) {
    if (!e?.word || !BANDS.includes(e.level)) continue
    const cur = levels.get(e.word)
    if (!cur || bandRank(e.level) < bandRank(cur)) levels.set(e.word, e.level)
  }
  return levels
}

// Stored bank candidates carry { word, reading, meaning, h } — no
// level of their own. capCandidates orders by deck level, so resolve
// each candidate's level here: the deck first, then the passage's own
// tokens, else null (capCandidates sorts null last). The reader-bot's
// withCandidateLevels, mirrored.
function withCandidateLevels(passage, deckLevels) {
  const cands = Array.isArray(passage?.new_word_candidates) ? passage.new_word_candidates : []
  const tokenLevel = new Map()
  for (const t of Array.isArray(passage?.tokens) ? passage.tokens : []) {
    if (t && typeof t.h === 'string' && !tokenLevel.has(t.h)) tokenLevel.set(t.h, t.l ?? null)
  }
  return cands.map((c) => {
    const head = c.h || c.word
    const level = deckLevels.get(head) ?? tokenLevel.get(head) ?? c.level ?? null
    return { ...c, level }
  })
}

// Split the passage around its new words (longest match wins, the
// reader-bot's renderPassage scan): plain runs render through
// KanjiTapText (tap-a-word + furigana, as everywhere); a new word
// renders bold with its reading — the bot's **word**（reading） in
// this surface's visual language.
function splitSegments(text, newWords) {
  const words = [...(newWords || [])]
    .filter((w) => w?.word)
    .sort((a, b) => b.word.length - a.word.length)
  const segs = []
  let rest = String(text || '')
  while (rest.length > 0) {
    let bestIdx = -1
    let best = null
    for (const w of words) {
      const idx = rest.indexOf(w.word)
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx || (idx === bestIdx && w.word.length > best.word.length))) {
        bestIdx = idx
        best = w
      }
    }
    if (!best) { segs.push({ text: rest }); break }
    if (bestIdx > 0) segs.push({ text: rest.slice(0, bestIdx) })
    segs.push({ text: best.word, word: best })
    rest = rest.slice(bestIdx + best.word.length)
  }
  return segs
}

function PassageText({ text, newWords, highlightWord }) {
  const { enabled: furiganaOn } = useFurigana()
  const segments = useMemo(() => splitSegments(text, newWords), [text, newWords])
  // The kanji strip's pulse (KanjiChips): the tapped word lights up
  // HERE, in the passage, so the eye travels from chip to context.
  // The first occurrence carries the scroll anchor. Plain runs are
  // split around the word (KanjiTapText keeps the rest tappable);
  // a new-word segment that IS the word wraps in place.
  let anchored = false
  const anchorProps = () => {
    if (anchored) return {}
    anchored = true
    return { 'data-kanji-anchor': 'true' }
  }
  return (
    <p className="text-lg leading-loose text-slate-100">
      {segments.map((seg, i) => {
        if (!seg.word) {
          if (!highlightWord || !seg.text.includes(highlightWord)) return <KanjiTapText key={i} text={seg.text} />
          const parts = seg.text.split(highlightWord)
          return (
            <span key={i}>
              {parts.map((part, j) => (
                <Fragment key={j}>
                  {j > 0 && <mark {...anchorProps()} className="kanji-pulse rounded-md bg-transparent text-inherit">{highlightWord}</mark>}
                  {part && <KanjiTapText text={part} />}
                </Fragment>
              ))}
            </span>
          )
        }
        const reading = seg.word.reading
        const body = furiganaOn && reading && reading !== seg.text ? (
          <ruby className="font-bold text-[#FFA08D]">
            {seg.text}
            <rt className="text-[0.6em] font-normal text-[#FF8A75] select-none">{reading}</rt>
          </ruby>
        ) : (
          <strong className="font-bold text-[#FFA08D]">{seg.text}</strong>
        )
        return seg.text === highlightWord ? (
          <span key={i} {...anchorProps()} className="kanji-pulse rounded-md">{body}</span>
        ) : (
          <Fragment key={i}>{body}</Fragment>
        )
      })}
    </p>
  )
}

export default function Reader({ setActive, onSignIn }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const [phase, setPhase] = useState('loading') // loading | digging | guest | error | empty | ready
  const [emptyKind, setEmptyKind] = useState('nofit') // nofit | shelf
  const [bandSource, setBandSource] = useState('none')
  const [displayBand, setDisplayBand] = useState('N4')
  const [pick, setPick] = useState(null) // { passage, ratio, coldStart, newWords }
  const [note, setNote] = useState('')
  const [mineNote, setMineNote] = useState('')
  const [finished, setFinished] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0) // error retry / level tap re-runs load
  const [canFit, setCanFit] = useState(false) // fit verdicts persist only on a linked row (for now)
  // Wide word index for the kanji strip's compound pass (the
  // readings law, amendment #14, web twin): the deck alone does
  // not carry every compound the segmenter can cut — 面談 was
  // served as 面 めん because nothing injected a compound
  // source on this surface (the bot has had one since #14).
  // The WordsDB common index resolves them; loaded once,
  // through the same loader the Heard panel uses.
  const [wordIndex, setWordIndex] = useState(null)
  useEffect(() => {
    let live = true
    loadWordSearchIndex()
      .then((rows) => {
        if (!live || !Array.isArray(rows)) return
        const m = new Map()
        for (const row of rows) {
          const w = row?.[1]
          const r = row?.[2]
          if (!w || !r) continue
          for (const v of String(w).split('/')) {
            if (v && !m.has(v)) m.set(v, { reading: r, meaning: typeof row?.[3] === 'string' ? row[3] : '' })
          }
        }
        setWordIndex(m)
      })
      .catch(() => {})
    return () => { live = false }
  }, [])

  // The fitting context, computed once per sign-in and kept in refs so
  // Another Passage re-picks without re-reading the world. knownRef is
  // a live Set: mining grows it, exactly as the bot re-reads state on
  // every /read.
  const ctxRef = useRef(null)
  const excludedRef = useRef([])

  // Read-aloud proof (Doc 16 §5 amendment #5): the browser's free Web
  // Speech API transcribes on-device; readAloud.js scores the
  // transcript against the passage in code. One recognition session
  // per passage — present() aborts it, so a stale transcript can
  // never be scored against a new passage.
  const [pulseWord, setPulseWord] = useState('') // kanji strip tap → passage highlight
  const [aloud, setAloud] = useState(null) // listening | scored | chunk | repairDone | empty | error
  const recogRef = useRef(null)
  const finalTextRef = useRef('')
  const listeningRef = useRef(false)
  const discardRef = useRef(false) // an aborted session's onend must not score
  const sessionRef = useRef(0) // capture generation — stale handlers of a reused recognizer go silent
  const wantRef = useRef(false) // the learner is still reading: an engine-ended session restarts
  const errorRef = useRef(null) // a recognition error the onend handler must honour
  const restartsRef = useRef(0) // engine-restart budget for one capture
  const targetRef = useRef(null) // the capture's grading target { passage, newWords, kind, text }
  const creditedRef = useRef(new Set()) // passages a voice proof already comfy-credited
  const completedRef = useRef(new Set()) // passages already logged passage_completed
  const speechSupported = typeof window !== 'undefined'
    && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  function stopListening() {
    discardRef.current = true
    wantRef.current = false
    listeningRef.current = false
    sessionRef.current += 1 // in-flight handlers of the reused recognizer go silent
    try { recogRef.current?.abort() } catch { /* not running */ }
    // The recognizer itself is KEPT (One Session's reuse law,
    // amendment #34): a fresh object per attempt re-asks the OS
    // for the microphone every time.
  }

  // The repair ladder's state for one passage (Doc 16 amendment
  // #34): { stage, sentences, queue, total } — stage 'sentences'
  // serves sentences[queue[0]], 'half1'/'half2' the passage's
  // halves, 'full' the whole passage. It persists in localStorage
  // per passage, so leaving the Reader and coming back resumes
  // the repair where it stopped; a stored state whose sentences
  // no longer join to the passage's sentences is discarded.
  const [repair, setRepair] = useState(null)
  const repairRef = useRef(null)
  const repairStoreKey = (id) => `yonde.reader.repair.${id}`
  const storeRepair = (id, r) => {
    repairRef.current = r
    setRepair(r)
    try {
      if (r) localStorage.setItem(repairStoreKey(id), JSON.stringify(r))
      else localStorage.removeItem(repairStoreKey(id))
    } catch { /* storage is a convenience; the ladder lives in state regardless */ }
  }
  const recallRepair = (passage) => {
    try {
      const raw = localStorage.getItem(repairStoreKey(passage.id))
      if (!raw) return null
      const r = JSON.parse(raw)
      if (!r || !Array.isArray(r.sentences) || !Array.isArray(r.queue)) return null
      if (r.sentences.join('') !== splitPassageSentences(String(passage.text)).join('')) return null
      return r
    } catch { return null }
  }

  useEffect(() => () => stopListening(), [])

  const doPick = (ctx, excluded) => {
    const recent = [...(ctx.recentIds || []), ...(excluded || [])]
    if (ctx.cold) {
      const starter = pickStarter(ctx.bank, ctx.known, recent)
      if (!starter) return null
      const candidates = capCandidates(withCandidateLevels(starter.passage, ctx.deckLevels))
      const newWords = candidates.filter((c) => c.word && !ctx.known.has(c.h || c.word))
      return { passage: starter.passage, ratio: passageRatio(starter.passage.tokens, ctx.known), coldStart: true, newWords, sentNewCount: newWords.length, stepLine: '', newKanjiCount: passageNewKanji(starter.passage.tokens, ctx.seenKanji).length, recycledBatch: false }
    }
    // Fit v2 (amendment #10): the gated pick reads the rank keys —
    // batch recycle above the new-kanji dose — and the pick records
    // its dose so the footer can say it out loud.
    const fit = pickPassage(ctx.bank, ctx.known, ctx.serveBand, recent, { seenKanji: ctx.seenKanji, batchWords: ctx.batchWords })
    if (!fit) return null
    const rawCandidates = Array.isArray(fit.passage.new_word_candidates) ? fit.passage.new_word_candidates : []
    const newWords = rawCandidates.filter((c) => c.word && !ctx.known.has(c.h || c.word))
    // The footer's numbers are frozen at pick time (the bot freezes
    // them at send time): mining shrinks newWords, never the record
    // of what this passage carried. The adaptive-fit step line rides
    // along the same way (amendment #4) — a stretch is named as a
    // stretch, a gentler notch as settling.
    const basisLabel = ctx.resolvedBand ?? ctx.band
    const stepLine = ctx.fitStep > 0
      ? t('reader.stepStretch', { band: basisLabel })
      : ctx.fitStep < 0
        ? t('reader.stepGentler', { band: basisLabel })
        : ''
    return {
      passage: fit.passage,
      ratio: fit.ratio,
      coldStart: false,
      newWords,
      sentNewCount: newWords.length,
      stepLine,
      newKanjiCount: passageNewKanji(fit.passage.tokens, ctx.seenKanji).length,
      recycledBatch: passageRecyclesBatch(fit.passage.tokens, ctx.batchWords),
    }
  }

  // Web serve (Doc 16 amendment #16): when the local bank fits
  // nothing, the reader-serve function runs the bot's full
  // pipeline server-side — the same fit, plus fitted generation
  // when the bank misses. The pick it returns is shaped exactly
  // like a local doPick result, so present() and mining never
  // know the difference.
  const shapeServed = (ctx, passage, ratio, coldStart) => {
    if (coldStart) {
      const candidates = capCandidates(withCandidateLevels(passage, ctx.deckLevels))
      const newWords = candidates.filter((c) => c.word && !ctx.known.has(c.h || c.word))
      return { passage, ratio, coldStart: true, newWords, sentNewCount: newWords.length, stepLine: '', newKanjiCount: passageNewKanji(passage.tokens, ctx.seenKanji).length, recycledBatch: false }
    }
    const rawCandidates = Array.isArray(passage.new_word_candidates) ? passage.new_word_candidates : []
    const newWords = rawCandidates.filter((c) => c.word && !ctx.known.has(c.h || c.word))
    const basisLabel = ctx.resolvedBand ?? ctx.band
    const stepLine = ctx.fitStep > 0
      ? t('reader.stepStretch', { band: basisLabel })
      : ctx.fitStep < 0
        ? t('reader.stepGentler', { band: basisLabel })
        : ''
    return {
      passage,
      ratio,
      coldStart: false,
      newWords,
      sentNewCount: newWords.length,
      stepLine,
      newKanjiCount: passageNewKanji(passage.tokens, ctx.seenKanji).length,
      recycledBatch: passageRecyclesBatch(passage.tokens, ctx.batchWords),
    }
  }

  const tryServe = async (ctx, excluded) => {
    if (!isSupabaseConfigured || !supabase) return null
    try {
      const { data, error } = await supabase.functions.invoke('reader-serve', {
        body: { excludeIds: (excluded || []).map(String) },
      })
      if (error || !data) return null
      // The server's need_level verdict is INFORMATION, not a miss
      // (audit P1-1): it means "ask the one-tap level question",
      // exactly as the bot does. Surface it instead of collapsing
      // into the generic empty state.
      if (data.status === 'nofit' && data.reason === 'need_level') return { needLevel: true }
      if (data.status !== 'picked' || !data.passage) return null
      const shaped = shapeServed(ctx, data.passage, data.ratio, data.coldStart === true)
      shaped.generated = data.generated === true
      shaped.seededWords = Array.isArray(data.seededWords) ? data.seededWords : []
      return shaped
    } catch { return null }
  }

  const present = (next) => {
    stopListening()
    setAloud(null)
    setPulseWord('')
    const restoredRepair = next ? recallRepair(next.passage) : null
    repairRef.current = restoredRepair
    setRepair(restoredRepair)
    setPick(next)
    setFinished(false)
    setMineNote('')
    setPhase('ready')
    // Voice pre-warm (2026-11-15): synthesis at serve time, not
    // at tap time. The bot synthesizes a passage's voice when it
    // sends it; the web asks the voice function for this text in
    // the background now, so the learner's tap on play meets a
    // hot cache (~1s) instead of the synthesizer (~10s).
    prewarmNeuralAudio(next.passage.text, modelCast())
    // Doc 16 §8: reading_opened is THIS surface's event (the bot logs
    // passage_sent only); passage_sent is logged too, in the bot's
    // payload shape, so the 14-day exclusion spans both surfaces and
    // neither re-sends what the other just served.
    recordMetric('reading_opened', { passageId: String(next.passage.id), band: String(next.passage.band), surface: 'web' })
    recordMetric('passage_sent', {
      passageId: String(next.passage.id),
      band: String(next.passage.band),
      ratio: Math.round(next.ratio * 1000) / 1000,
      newWords: next.newWords.length,
      ...(next.coldStart ? { coldStart: true } : {}),
    })
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!isSupabaseConfigured || !supabase || !user) { setPhase('guest'); return }
      setPhase('loading')
      try {
        // The learner's own state document, the app's local-first
        // pattern (learnerState.js) — the same document the bot reads
        // server-side after sync.
        const state = collectLearnerState()
        const queue = Array.isArray(state.queue) ? state.queue : []
        const diagnosisBand = typeof state.diagnosis?.jlptEstimate === 'string' ? state.diagnosis.jlptEstimate : null

        // The declared band lives on the learner's own telegram_links
        // row (owner-only RLS — TwinView's card reads the same row).
        // fit_step rides along: the bot aims its picks at the serve
        // band (basis shifted by the step, amendment #4), and this
        // surface aims the same way. Any read failure degrades to no
        // declaration and no step — never to a block.
        let declaredBand = null
        let declaredAt = null
        let fitStep = 0
        let fitState = { fit_step: 0, last_good_step: 0, comfy_streak: 0 }
        let hasLink = false
        const linkRes = await supabase
          .from('telegram_links')
          .select('declared_band, declared_at, fit_step, last_good_step, comfy_streak')
          .eq('user_id', user.id)
          .maybeSingle()
        if (!linkRes.error && linkRes.data) {
          hasLink = true
          declaredBand = linkRes.data.declared_band ?? null
          declaredAt = linkRes.data.declared_at ?? null
          fitStep = Number(linkRes.data.fit_step ?? 0) || 0
          fitState = {
            fit_step: fitStep,
            last_good_step: Number(linkRes.data.last_good_step ?? 0) || 0,
            comfy_streak: Number(linkRes.data.comfy_streak ?? 0) || 0,
          }
        } else {
          const fallback = await supabase
            .from('telegram_links')
            .select('declared_band, fit_step')
            .eq('user_id', user.id)
            .maybeSingle()
          if (!fallback.error && fallback.data) {
            hasLink = true
            declaredBand = fallback.data.declared_band ?? null
            fitStep = Number(fallback.data.fit_step ?? 0) || 0
            fitState = { fit_step: fitStep, last_good_step: 0, comfy_streak: 0 }
          } else {
            const lastResort = await supabase
              .from('telegram_links')
              .select('declared_band')
              .eq('user_id', user.id)
              .maybeSingle()
            if (!lastResort.error && lastResort.data) {
              hasLink = true
              declaredBand = lastResort.data.declared_band ?? null
            }
          }
        }

        const dict = await loadDictionary()
        const deckLevels = deckLevelsFrom(dict)

        // The known set, exactly as the bot's knownFor composes it:
        // queue fronts + personal vocab (no stored list yet — the
        // Twin's vocab is derived stats, so it contributes nothing
        // today, here as there) + below-band deck credit when a basis
        // exists. Diagnosis outranks the declared tap (resolveBand).
        // BOTH declaration stores count (integration audit #2): a
        // level declared inside the app lives in the state document —
        // this surface used to read only the Telegram row, so an
        // in-app declaration was invisible here while the bot and
        // reader-serve both honoured it. All five inputs, freshest
        // declaration wins, exactly as reader-serve resolves it.
        const stateDeclaredBand = typeof state.declaredLevel?.band === 'string' ? state.declaredLevel.band : null
        const stateDeclaredAt = typeof state.declaredLevel?.at === 'string' ? state.declaredLevel.at : null
        const { band: resolvedBand, source } = resolveBand({ diagnosisBand, declaredBand, declaredAt, stateDeclaredBand, stateDeclaredAt })
        const hasDiagnosis = source === 'diagnosis'
        const band = resolvedBand ?? 'N4' // gentle default; the footer says so
        const credit = resolvedBand ? deckCreditSet(deckLevels, resolvedBand) : null
        // Fit v2 (amendment #10), exactly as the bot's knownFor:
        // encounters — words genuinely met outside the queue (Anki
        // ratings, Speed Cards answers, synced in this same state
        // document) — earn FULL proven credit, and proven words
        // (queue fronts ∪ encounters) define the seen-kanji set.
        const encounters = (Array.isArray(state.encounters) ? state.encounters : [])
          .filter((w) => typeof w === 'string')
        const known = buildKnownSet(queue, encounters, credit)
        const seenKanji = seenKanjiSet([
          ...queue.map((i) => (typeof i?.front === 'string' ? i.front : '')),
          ...encounters,
        ])
        const batchWords = currentBatchWords(queue)
        const dictByWord = new Map()
        for (const e of dict?.entries || []) {
          if (e?.word && !dictByWord.has(e.word)) dictByWord.set(e.word, e)
        }
        const serveBand = serveBandFor(resolvedBand, fitStep) ?? band
        const cold = source === 'none' && isColdStart(hasDiagnosis, countKnownContent(known))

        const { data: bank, error: bankError } = await supabase
          .from('reading_passages')
          .select('id, band, topic, text, tokens, new_word_candidates, source')
        if (bankError || !bank) { if (!cancelled) setPhase('error'); return }

        // The 14-day exclusion, read from the learner's passage_sent
        // events (the bot's RECENT_DAYS rule). Unavailable read →
        // no exclusion, never a block.
        let recentIds = []
        try {
          const since = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
          const { data: sentRows, error: sentError } = await supabase
            .from('metrics_events')
            .select('payload')
            .eq('user_id', user.id)
            .eq('type', 'passage_sent')
            .gte('created_at', since)
          if (!sentError && Array.isArray(sentRows)) {
            recentIds = sentRows
              .map((r) => r.payload?.passageId)
              .filter((x) => typeof x === 'string')
          }
        } catch { recentIds = [] }

        if (cancelled) return
        const ctx = { bank, known, deckLevels, serveBand, band, resolvedBand, fitStep, fitState, hasLink, source, cold, recentIds, queueLength: queue.length, encounters, seenKanji, batchWords, dictByWord }
        ctxRef.current = ctx
        excludedRef.current = []
        setBandSource(source)
        setDisplayBand(band)
        setCanFit(hasLink)
        // Cooked from Heard Words (Doc 22): the Heard panel's
        // door sets this flag — go straight to the server
        // pipeline, whose generation is seeded with the words
        // the learner actually heard, and fall back to the
        // shelf only if it serves nothing.
        let cook = false
        try {
          cook = sessionStorage.getItem('jpn:reader-cook') === '1'
          if (cook) sessionStorage.removeItem('jpn:reader-cook')
        } catch { /* storage unavailable: the flag is a nicety */ }
        if (!cook) {
          const first = doPick(ctx, [])
          if (first) { present(first); return }
        }
        // Bank miss (or a cook request): ask the server pipeline
        // (amendment #16) — it can fit from the full bank and
        // generate a fitted passage, like the bot.
        if (!cold && bank.length > 0) {
          setPhase('digging')
          const served = await tryServe(ctx, [])
          if (cancelled) return
          if (served && !served.needLevel) {
            if (cook) { dispatchCookResult(true); if (served.generated) sendCookedToDm(served) }
            present(served); return
          }
          // need_level: the empty state below renders the one-tap
          // level question (bandSource is 'none' in that world).
        }
        if (cook) {
          const first = doPick(ctx, [])
          if (first) { dispatchCookResult(true); present(first); return }
          dispatchCookResult(false)
        }
        setEmptyKind(bank.length === 0 || cold ? 'shelf' : 'nofit')
        setPhase('empty')
      } catch {
        if (!cancelled) setPhase('error')
      }
    }
    load()
    return () => { cancelled = true }
  }, [user, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps -- load reads the signed-in learner's world once per user (+ explicit retries)

  const another = async () => {
    const ctx = ctxRef.current
    if (!ctx || !pick || busy) return
    setBusy(true)
    const excluded = [...excludedRef.current, String(pick.passage.id)]
    let next = doPick(ctx, excluded)
    if ((!next || String(next.passage.id) === String(pick.passage.id)) && !ctx.cold) {
      // The local shelf is exhausted for this learner — the
      // server pipeline may still fit or generate one.
      setNote(t('reader.loading'))
      next = await tryServe(ctx, excluded)
      if (next?.needLevel) next = null // a level question mid-book helps nobody; the note below stands
    }
    if (!next || String(next.passage.id) === String(pick.passage.id)) {
      setNote(t('reader.nothingElse'))
    } else {
      excludedRef.current = excluded
      setNote('')
      present(next)
    }
    setBusy(false)
  }

  // Cooked from Heard Words (Doc 22): the panel on THIS page
  // fires 'yonde:cook' — serve generation-first, because the
  // server's generation is the one seeded with heard words;
  // the local shelf is the fallback, not the lead.
  // The DM mirror (2026-11-10, his words: the two sides work
  // together — the words pass into the reading panel AND the
  // passage is sent to the DM chat too). After a GENERATED
  // cook serve, the passage is posted to reader-bot's ?dm=1
  // route, which delivers it to the linked Telegram chat.
  // Fire-and-forget: the panel is the primary surface, and a
  // failed mirror never breaks the serve (the outcome is
  // logged server-side as passage_dm either way).
  const sendCookedToDm = async (servedPick) => {
    try {
      if (!supabase) return
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return
      await fetch(`${supabase.supabaseUrl}/functions/v1/reader-bot?dm=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          text: String(servedPick.passage.text || ''),
          seeded: Array.isArray(servedPick.seededWords) ? servedPick.seededWords : [],
        }),
      })
    } catch { /* the mirror is a courtesy copy, never a blocker */ }
  }
  const dispatchCookResult = (ok) => {
    try { window.dispatchEvent(new CustomEvent('yonde:cook-result', { detail: { ok } })) } catch { /* odd surfaces */ }
  }

  const cookServe = async () => {
    const ctx = ctxRef.current
    if (!ctx || busy) return
    const prevPick = pick
    setBusy(true)
    // The tap must be VISIBLE (2026-11-10: "the button does
    // not do anything or does not show it is doing anything"):
    // the reading column switches to the digging state for the
    // whole attempt, and the outcome is announced to the panel
    // that holds the door ('yonde:cook-result'), success or
    // failure alike. The old path set a note that renders only
    // in the ready phase — in the empty state, a forty-second
    // failed serve looked exactly like a dead button.
    setPhase('digging')
    const excluded = [...excludedRef.current, ...(pick ? [String(pick.passage.id)] : [])]
    setNote(t('reader.loading'))
    let next = !ctx.cold ? await tryServe(ctx, excluded) : null
    if (next?.needLevel) next = null
    if (!next) next = doPick(ctx, excluded)
    if (!next || (prevPick && String(next.passage.id) === String(prevPick.passage.id))) {
      setNote(t('reader.nothingElse'))
      if (prevPick) { setPick(prevPick); setPhase('ready') } else { setPhase('empty') }
      dispatchCookResult(false)
    } else {
      excludedRef.current = excluded
      setNote('')
      present(next)
      dispatchCookResult(true)
      if (next.generated) sendCookedToDm(next)
    }
    setBusy(false)
  }
  const cookServeRef = useRef(cookServe)
  cookServeRef.current = cookServe
  useEffect(() => {
    const onCook = () => { cookServeRef.current() }
    window.addEventListener('yonde:cook', onCook)
    return () => window.removeEventListener('yonde:cook', onCook)
  }, [])

  // Mining — the queue front is the HEADWORD (it dedupes against the
  // same word added anywhere via the shared queueItemId hash, and
  // FSRS teaches the dictionary form); the passage's own sentence
  // rides on the card as its note. One flow, two doors: the Mine
  // button mines the passage's new words; a kanji chip's Mine This
  // Word mines exactly one (Fit v2) — same queue-item shape either way.
  const mineCandidates = (cands) => {
    if (!pick || !cands || cands.length === 0) return
    const passage = pick.passage
    const before = new Set(loadQueue().map((i) => i.id))
    const items = cands.map((c) => {
      const front = c.h || c.word
      return {
        front,
        back: c.meaning || '',
        reading: c.reading || '',
        note: `From Hori's Reader passage: 「${sentenceWith(String(passage.text), c.word)}」`,
        source: 'reader',
        level: String(passage.band),
      }
    })
    const { added } = addToQueue(items)
    const minedWords = items.filter((it) => !before.has(queueItemId('reader', it.front))).map((it) => it.front)
    if (added > 0) {
      recordMetric('word_mined', { passageId: String(passage.id), count: added, words: minedWords })
      const ctx = ctxRef.current
      if (ctx) {
        for (const w of minedWords) ctx.known.add(w)
        // The just-mined words ARE the current batch now — refresh
        // the rank key so the next pick can recycle them at once.
        ctx.batchWords = [...new Set([...(ctx.batchWords || []), ...minedWords])]
      }
      const minedFronts = new Set(minedWords)
      setPick((cur) => (cur ? { ...cur, newWords: cur.newWords.filter((c) => !minedFronts.has(c.h || c.word)) } : cur))
    }
    setMineNote(added > 0
      ? t(added === 1 ? 'reader.minedOne' : 'reader.minedMany', { count: added })
      : t('reader.mineNothing'))
  }

  const mine = () => { if (pick) mineCandidates(pick.newWords) }

  // passage_completed is logged once per passage per session, from
  // whichever door earned it — the Finished Reading tap or a passed
  // read-aloud — never twice for the same read.
  const logCompleted = (passage, method) => {
    const id = String(passage.id)
    if (!completedRef.current.has(id)) {
      completedRef.current.add(id)
      recordMetric('passage_completed', {
        passageId: id,
        band: String(passage.band),
        surface: 'web',
        ...(method ? { method } : {}),
      })
    }
    setFinished(true)
  }

  const finish = () => {
    if (!pick || finished) return
    logCompleted(pick.passage)
    // Finishing a read IS a comfortable read (audit P2-7): it earns
    // the same fit transition a passed read-aloud earns — the web
    // surface used to log the completion and move nothing.
    void applyFitFeedback(pick.passage, 'read', 'webfinish')
  }

  // Fit feedback, one door for every kind (Doc 16 §5 amendment #4):
  // a passed web read-aloud, the Finished Reading tap, and the
  // Push Me / Too Hard verdict buttons all run the same
  // applyFeedback the bot runs — persisted to the learner's own
  // telegram_links row (owner RLS allows the write). 'read' credits
  // once per passage across every door (creditedRef); verdicts
  // dedupe per passage too (verdictRef) — one tap per passage,
  // the bot's own rule. Any failure degrades quietly: the
  // passage_completed metric already landed, and the step simply
  // moves next time on the surface that can. (Fit state still lives
  // on the Telegram row — audit P2-9; unlinked learners' verdicts
  // have nowhere to persist yet, so the buttons render only when a
  // link row exists.)
  const verdictRef = useRef(new Set())
  const applyFitFeedback = async (passage, kind, via) => {
    const id = String(passage.id)
    if (kind === 'read') {
      if (creditedRef.current.has(id)) return
      creditedRef.current.add(id)
    } else {
      if (verdictRef.current.has(id)) return
      verdictRef.current.add(id)
    }
    const ctx = ctxRef.current
    if (!ctx?.hasLink || !ctx.fitState) return
    const next = applyFeedback(ctx.fitState, kind)
    ctx.fitState = { fit_step: next.fit_step, last_good_step: next.last_good_step, comfy_streak: next.comfy_streak }
    ctx.fitStep = next.fit_step
    ctx.serveBand = serveBandFor(ctx.resolvedBand, next.fit_step) ?? ctx.serveBand
    recordMetric('reading_feedback', { passageId: id, kind, via, fitStepAfter: next.fit_step })
    if (isSupabaseConfigured && supabase && user) {
      try {
        await supabase
          .from('telegram_links')
          .update({ fit_step: next.fit_step, last_good_step: next.last_good_step, comfy_streak: next.comfy_streak })
          .eq('user_id', user.id)
      } catch { /* best effort — the metric above is this session's record */ }
    }
  }
  const applyComfyRead = (passage) => applyFitFeedback(passage, 'read', 'webspeech')

  // Push Me / Too Hard (the bot's verdict pair, now on the web too):
  // the step moves, then the next passage is served AT the new step —
  // the lesson continues, exactly as the bot continues it.
  const verdict = async (kind) => {
    if (!pick || busy) return
    await applyFitFeedback(pick.passage, kind, 'webbuttons')
    await another()
  }

  // The one-tap level question, the bot's ask on this surface too:
  // a tap stores the declaration in the state document (the same
  // store TwinView's Your Level card writes) and the Reader reloads
  // against the new basis at once.
  const declareLevel = (band) => {
    saveDeclaredLevel(band)
    setReloadKey((k) => k + 1)
  }

  // The score-and-effect tail of a finished capture. The target
  // carries its own grading text (amendment #34): a plain passage
  // read grades against the passage; a repair chunk grades against
  // the chunk ALONE — never the whole passage.
  const scoreTranscript = (target, transcript) => {
    const passage = target.passage
    const text = String(transcript || '')
    if (!normalizeSpeechText(text)) { setAloud({ status: 'empty' }); return }
    const { score } = scoreReadAloud(target.text, text)
    const pct = Math.round(score * 100)
    recordMetric('shadow_attempted', {
      passageId: String(passage.id),
      score: Math.round(score * 1000) / 1000,
      method: 'webspeech',
      target: target.kind,
    })
    const passed = score >= READ_ALOUD_PASS_SCORE
    if (target.kind === 'passage') {
      if (passed) {
        logCompleted(passage, 'webspeech')
        void applyComfyRead(passage)
      }
      // Nao's one fix: the first new word the voice never reached.
      // Ladder entry (amendment #34): any missed sentence —
      // including the one holding the skipped word — opens the
      // repair panel; the next capture grades a chunk, never the
      // whole passage.
      const queue = missedSentences(String(passage.text), text, target.newWords)
      if (queue.length > 0) {
        storeRepair(String(passage.id), {
          stage: 'sentences',
          sentences: splitPassageSentences(String(passage.text)),
          queue,
          total: queue.length,
        })
      } else if (passed) {
        // A clean full read proves the whole passage — any repair
        // still open for it is finished by definition.
        storeRepair(String(passage.id), null)
      }
      setAloud({ status: 'scored', pct, passed, fix: firstMissedCandidate(target.newWords, text) })
      return
    }
    advanceRepair(target, pct, passed, text)
  }

  // One graded chunk later: advance the ladder, or hold the chunk
  // for another try. Chunks only ever clear or stay — a miss marks
  // nothing and moves nothing backwards.
  const advanceRepair = (target, pct, passed, transcript) => {
    const passage = target.passage
    const r = repairRef.current
    if (!r) { setAloud({ status: 'scored', pct, passed, fix: null }); return }
    const passageText = String(passage.text)
    if (target.kind === 'sentence') {
      if (!passed) {
        setAloud({
          status: 'chunk', pct, passed: false, kind: 'sentence',
          fix: firstMissedCandidate(candidatesInText(target.newWords, target.text), transcript),
          fixText: target.text,
        })
        return
      }
      const queue = r.queue.slice(1)
      if (queue.length > 0) {
        storeRepair(String(passage.id), { ...r, queue })
        setAloud({ status: 'chunk', pct, passed: true, kind: 'sentence' })
        return
      }
      const halves = passageHalves(passageText)
      storeRepair(String(passage.id), { ...r, stage: halves ? 'half1' : 'full', queue: [] })
      setAloud({ status: 'chunk', pct, passed: true, kind: 'sentence', sentencesDone: true })
      return
    }
    if (target.kind === 'half') {
      if (!passed) {
        setAloud({
          status: 'chunk', pct, passed: false, kind: 'half',
          fix: firstMissedCandidate(candidatesInText(target.newWords, target.text), transcript),
          fixText: target.text,
        })
        return
      }
      storeRepair(String(passage.id), { ...r, stage: r.stage === 'half1' ? 'half2' : 'full' })
      setAloud({ status: 'chunk', pct, passed: true, kind: 'half' })
      return
    }
    // 'full' — the whole passage at once, graded as a normal full read.
    if (!passed) {
      const queue = missedSentences(passageText, transcript, target.newWords)
      if (queue.length > 0) {
        storeRepair(String(passage.id), {
          stage: 'sentences',
          sentences: splitPassageSentences(passageText),
          queue,
          total: queue.length,
        })
      }
      setAloud({
        status: 'chunk', pct, passed: false, kind: 'full',
        fix: firstMissedCandidate(target.newWords, transcript),
        fixText: passageText,
      })
      return
    }
    storeRepair(String(passage.id), null)
    logCompleted(passage, 'webspeech')
    void applyComfyRead(passage)
    setAloud({ status: 'repairDone', pct })
  }

  const startAloud = (target) => {
    if (!pick || listeningRef.current) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return // unsupported browsers render the plain note instead of this button
    // ONE recognizer for this surface, reused across attempts —
    // One Session's law (2026-11-08): a fresh object per tap
    // re-asks the OS for the microphone every time. It is dropped
    // only when the OS refuses it (not-allowed), so the next tap
    // builds a clean one.
    let recog = recogRef.current
    if (!recog) {
      recog = new SR()
      recogRef.current = recog
    }
    const mySession = ++sessionRef.current
    targetRef.current = target
    finalTextRef.current = ''
    discardRef.current = false
    errorRef.current = null
    restartsRef.current = 0
    wantRef.current = true
    recog.lang = 'ja-JP'
    recog.continuous = true
    recog.interimResults = true
    recog.onresult = (e) => {
      if (mySession !== sessionRef.current) return
      let finals = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finals += e.results[i][0].transcript
      }
      if (finals) finalTextRef.current += finals
    }
    recog.onerror = (e) => {
      if (mySession !== sessionRef.current) return
      if (e?.error === 'aborted') return
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') recogRef.current = null
      // A no-speech cut after real speech is a pause, not a
      // failure: onend restarts capture. With nothing heard yet
      // it stays the honest error path.
      if (e?.error === 'no-speech' && finalTextRef.current) return
      errorRef.current = e?.error || 'error'
    }
    recog.onend = () => {
      if (mySession !== sessionRef.current) return
      if (discardRef.current) { discardRef.current = false; listeningRef.current = false; return }
      if (!listeningRef.current) return
      // The engine ended the session itself — phone engines cut
      // recognition at pauses and session limits, long before a
      // whole passage is read. While the learner is still reading
      // (no Stop tap, no error), restart and keep the transcript:
      // a passage is one read, however many engine sessions it
      // takes. This is the divergence that made the Reader's
      // voice feel broken while One Session's one-sentence turns
      // worked on the same engine (amendment #34, Step 0).
      if (wantRef.current && !errorRef.current && restartsRef.current < 40) {
        restartsRef.current += 1
        try { recog.start(); return } catch { /* fall through and score what we have */ }
      }
      listeningRef.current = false
      wantRef.current = false
      if (errorRef.current && errorRef.current !== 'no-speech') {
        const err = errorRef.current
        errorRef.current = null
        setAloud({
          status: 'error',
          message: err === 'not-allowed' ? t('reader.micBlocked') : t('reader.recogStopped'),
        })
        return
      }
      errorRef.current = null
      scoreTranscript(targetRef.current, finalTextRef.current)
    }
    listeningRef.current = true
    setAloud({ status: 'listening', kind: target.kind })
    try {
      recog.start()
    } catch {
      listeningRef.current = false
      wantRef.current = false
      setAloud({ status: 'error', message: t('reader.recogCantStart') })
    }
  }

  const stopAndScore = () => {
    wantRef.current = false // the learner's Stop is what ends a capture — then onend scores
    try { recogRef.current?.stop() } catch { /* onend does the scoring */ }
  }

  // The footer names the fitting basis — the reader-bot's three
  // variants plus the starter footer, verbatim (Doc 16 §5 labelling):
  // the copy never claims level fitting that did not happen, on a
  // basis that did not happen.
  const footerFor = (p) => {
    if (p.coldStart) return t('reader.starterFooter')
    const pct = Math.round(p.ratio * 100)
    const n = p.sentNewCount ?? p.newWords.length
    const words = t(n === 1 ? 'reader.newWordOne' : 'reader.newWordsMany', { count: n })
    let text
    if (bandSource === 'diagnosis') {
      text = t('reader.footerDiagnosis', { band: displayBand, pct, words })
    } else if (bandSource === 'declared') {
      text = t('reader.footerDeclared', { band: displayBand, pct, words })
    } else {
      text = t('reader.footerQueue', { pct, words })
    }
    // Fit v2 honesty (amendment #10), the bot footer's family: the
    // new-kanji dose is said out loud (the kanji strip below the
    // passage is where those kanji wait), and a batch-recycle pick
    // says so — only when true.
    let extra = ''
    if (p.newKanjiCount === 1) extra += t('reader.newKanjiOne')
    else if (p.newKanjiCount > 1) extra += t('reader.newKanjiMany', { count: p.newKanjiCount })
    if (p.recycledBatch) extra += t('reader.recycledBatch')
    return text + (p.stepLine || '') + extra
  }

  // The kanji strip's data (Fit v2): every distinct kanji word in
  // the passage (kanjiReadings — the readings block's own
  // derivation), readings and meanings from the passage's candidate
  // glosses first, then the app's dictionary, and the matching
  // still-unmined new-word candidate when there is one — only a
  // candidate can be mined, and only while pick.newWords holds it.
  const chips = useMemo(() => {
    if (!pick) return []
    const ctx = ctxRef.current
    const byWord = ctx?.dictByWord || new Map()
    const gloss = new Map()
    for (const c of Array.isArray(pick.passage.new_word_candidates) ? pick.passage.new_word_candidates : []) {
      const head = c.h || c.word
      if (head && !gloss.has(head)) gloss.set(head, c)
      if (c.word && !gloss.has(c.word)) gloss.set(c.word, c)
    }
    const headOf = new Map()
    for (const t of Array.isArray(pick.passage.tokens) ? pick.passage.tokens : []) {
      if (t && typeof t.s === 'string' && !headOf.has(t.s)) headOf.set(t.s, typeof t.h === 'string' && t.h ? t.h : t.s)
    }
    const readingOf = (h) => gloss.get(h)?.reading || byWord.get(h)?.reading || undefined
    // Compound + meaning sources, widest truth last-resort in
    // the right order: the passage's own gloss first, then the
    // WordsDB common index (JMdict readings — 心配 is しんぱい
    // there, not the deck's しんぱいする）, then the deck.
    const meaningOf = (h) => gloss.get(h)?.meaning || wordIndex?.get(h)?.meaning || byWord.get(h)?.meaning || undefined
    const compoundOf = (w) => gloss.get(w) || wordIndex?.get(w) || byWord.get(w) || undefined
    return kanjiReadings(pick.passage.tokens, readingOf, meaningOf, compoundOf).map((r) => {
      const head = headOf.get(r.word) || r.word
      const candidate = pick.newWords.find((c) => c.word === r.word || (c.h || c.word) === head) || null
      return {
        ...r,
        meaning: candidate?.meaning || gloss.get(head)?.meaning || byWord.get(head)?.meaning || '',
        candidate,
      }
    })
  }, [pick, wordIndex])

  // The repair ladder's current chunk (amendment #34): the one
  // piece the next capture is graded against.
  const repairChunk = repair && pick ? (() => {
    const passageText = String(pick.passage.text)
    if (repair.stage === 'sentences') return { kind: 'sentence', text: repair.sentences[repair.queue[0]] ?? passageText }
    if (repair.stage === 'half1') return { kind: 'half', text: passageHalves(passageText)?.first ?? passageText }
    if (repair.stage === 'half2') return { kind: 'half', text: passageHalves(passageText)?.second ?? passageText }
    return { kind: 'full', text: passageText }
  })() : null

  // A strip tap pulses the word in the passage and scrolls the
  // first occurrence into view.
  useEffect(() => {
    if (!pulseWord) return
    const el = document.querySelector('[data-kanji-anchor="true"]')
    try { el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch { /* the anchor alone still highlights */ }
  }, [pulseWord])

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <BookOpenText size={20} className="text-[#FF8A75]" />
          <h2 className="text-2xl font-bold text-white">{t('reader.title')}</h2>
          <Mascot agent="hori" size={34} />
        </div>
        <p className="text-xs text-slate-500 mb-1">{t('reader.tagline')}</p>
        <p className="text-sm text-slate-400">{t('reader.intro')}</p>
      </div>

      {/* Reading and listening, together (his layout call,
          2026-11-09, refined 2026-11-10 after his verdict on
          the first attempt — "Not well designed. Study and
          find a better way"): two content columns at phone
          width crushed both sides below readability — the
          passage starved to a sliver, the words wrapped into
          a tower. The studied answer: side by side only where
          the width earns it (≥720px: passage left, Hori's
          panel right at 340px). On a phone the pair STACKS,
          Hori's strip first — a slim bar carrying the Start
          door in the first screen — and every content block
          keeps the full width it needs to be read. */}
      <div className="flex flex-col gap-6 min-[720px]:grid min-[720px]:grid-cols-[minmax(0,1fr)_340px] min-[720px]:items-start">
        <div className="order-2 min-[720px]:order-1 space-y-6 min-w-0">
      {phase === 'guest' && (
        <div className="rounded-2xl glass p-5 card-glow space-y-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5"><Mascot agent="hori" size={30} showName={false} /></span>
            <p className="text-sm text-slate-300">{t('reader.guestBefore')}<span className="text-slate-100 font-medium">{t('reader.guestYour')}</span>{t('reader.guestAfter')}</p>
          </div>
          {onSignIn && (
            <button onClick={onSignIn} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold">
              {t('auth.signIn')}
            </button>
          )}
        </div>
      )}

      {phase === 'loading' && <PassageSkeleton />}

      {phase === 'digging' && (
        // Compact wait row (2026-11-09): the digging scene used to
        // be a 96px hero that filled the Mini App's first screen
        // and pushed every action out of sight. The search motion
        // stays; the size now matches what it is — a wait, not a
        // destination.
        <div className="flex items-center gap-3 py-2" role="status">
          <div className="hori-search shrink-0">
            <Mascot agent="hori" size={44} showName={false} motion="none" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-slate-300">{t('reader.loading')}</p>
            <div aria-hidden="true" className="mt-2 h-1.5 w-32 rounded-full bg-white/10" />
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="rounded-2xl glass p-5 card-glow space-y-3">
          <p className="text-sm text-slate-300">{t('reader.errorShelf')}</p>
          <button onClick={() => setReloadKey((k) => k + 1)} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">
            {t('reader.tryAgain')}
          </button>
        </div>
      )}

      {phase === 'empty' && (
        <div className="rounded-2xl glass p-5 card-glow space-y-3">
          {emptyKind === 'shelf' ? (
            <>
              <p className="text-sm text-slate-300">{t('reader.emptyShelf')}</p>
              <button onClick={() => setReloadKey((k) => k + 1)} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">
                {t('reader.tryAgain')}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-300">{t('reader.emptyNofit')}</p>
              {bandSource === 'none' ? (
                <>
                  <p className="text-sm text-slate-300">{t('reader.checkupSwitch')}</p>
                  {/* The one-tap level question (the bot's ask): no
                      basis → declare once, here, and fitting turns
                      on. Not Sure leads to the checkup, the measured
                      answer. */}
                  <p className="text-sm font-medium text-slate-200">{t('reader.levelAsk')}</p>
                  <div className="flex flex-wrap gap-2">
                    {[...BANDS, 'N7'].map((b) => (
                      <button key={b} onClick={() => declareLevel(b)} className="px-3 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-semibold">
                        {b === 'N7' ? 'N7+' : b}
                      </button>
                    ))}
                    <button onClick={() => setActive?.('diagnosis')} className="px-3 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold">
                      {t('twin.level.takeCheckup')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setActive?.('session')} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold">
                    {t('reader.goSession')}
                  </button>
                  <button onClick={() => setReloadKey((k) => k + 1)} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">
                    {t('reader.tryAgain')}
                  </button>
                </div>
              )}
            </>
          )}
          {/* Serve notes render in the empty state too
              (2026-11-10): a failed serve's only trace was a
              note bound to the ready phase, so from the empty
              state a long failed attempt was indistinguishable
              from a dead button. */}
          {note && <p className="text-sm text-slate-400">{note}</p>}
        </div>
      )}

      {phase === 'ready' && pick && (
        <>
          <section className="rounded-3xl bg-[#151129] p-4 sm:p-8 space-y-5">
            <div className="flex items-center gap-3">
              <Mascot agent="hori" size={38} showName={false} />
              <h2 className="text-base font-bold text-white leading-snug">{t('reader.dugUp', { topic: pick.passage.topic || t('reader.defaultTopic'), band: pick.passage.band })}</h2>
            </div>
            <PassageText text={pick.passage.text} newWords={pick.newWords} highlightWord={pulseWord} />
            {/* The listen step (audit P2-6): the bot sends a voice
                note with every passage; the web surface had no way
                to hear the passage at all. Same order as the bot:
                listen first, then read it back. */}
            <div>
              <TtsButton text={pick.passage.text} browserTimeoutMs={2500} className="px-4 py-2 text-sm font-medium" />
            </div>
            {/* Actions sit directly under the passage (hierarchy:
                the passage is the job, these are its one tier of
                actions) — never below the detail blocks, so acting
                never needs a scroll (2026-11-09, the first user:
                "the website should be easy to see actions"). The
                chips, the word list and the footer are tier-3
                detail and follow below. */}
            <div className="flex flex-wrap items-center gap-2">
              {pick.newWords.length > 0 && (
                <button onClick={mine} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold flex items-center gap-1.5">
                  <Pickaxe size={15} /> {t('reader.mineNewWords')}
                </button>
              )}
              <button onClick={another} disabled={busy} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 disabled:opacity-40 text-slate-100 text-sm font-medium flex items-center gap-1.5">
                <RefreshCw size={15} /> {t('reader.anotherPassage')}
              </button>
              {finished ? (
                <span className="text-sm text-emerald-300 flex items-center gap-1.5"><CheckCircle2 size={15} /> {t('reader.finishedLogged')}</span>
              ) : (
                <button onClick={finish} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5">
                  <CheckCircle2 size={15} /> {t('reader.finishedReading')}
                </button>
              )}
              {/* The fit verdict pair (the bot's Push Me / Too Hard):
                  one tap moves the step and the next passage arrives
                  at the new step. Only when a link row can persist the
                  fit state (audit P2-9). */}
              {canFit && (
                <>
                  <button onClick={() => verdict('up')} disabled={busy} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 disabled:opacity-40 text-slate-100 text-sm font-medium">
                    {t('reader.pushMe')}
                  </button>
                  <button onClick={() => verdict('hard')} disabled={busy} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 disabled:opacity-40 text-slate-100 text-sm font-medium">
                    {t('reader.tooHard')}
                  </button>
                </>
              )}
            </div>
            {mineNote && <p className="text-sm text-emerald-300 flex items-center gap-2"><CheckCircle2 size={15} /> {mineNote}</p>}
            {note && <p className="text-sm text-slate-400">{note}</p>}
            <KanjiChips key={String(pick.passage.id)} chips={chips} activeWord={pulseWord} onHighlight={setPulseWord} onMineWord={mineCandidates} />
            {pick.newWords.length > 0 && (
              <div className="rounded-xl bg-white/5 p-4">
                <h3 className="text-sm font-bold text-[#FF8A75] mb-2">{t('reader.newWordsHeading')}</h3>
                <ul className="space-y-1">
                  {pick.newWords.map((c, i) => (
                    <li key={i} className="text-sm text-slate-200">
                      <span className="font-semibold text-white">{c.h || c.word}</span>
                      {c.reading && c.reading !== (c.h || c.word) && <span className="text-[#FFB59D]"> （{c.reading}）</span>}
                      {c.meaning && <span className="text-slate-400"> — {c.meaning}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-slate-400 whitespace-pre-line">{footerFor(pick)}</p>
          </section>

          <section className="rounded-3xl bg-[#151129] p-4 sm:p-6 space-y-3">
            <h3 className="text-base font-bold text-white">{t('reader.readAloudTitle')}</h3>
            <p className="text-sm text-slate-400">{t('reader.readAloudIntro')}<span className="text-slate-200">{t('reader.readAloudIntroEmphasis')}</span></p>
            {!speechSupported ? (
              <p className="text-sm text-slate-300">{t('reader.readAloudUnsupported')}</p>
            ) : aloud?.status === 'listening' ? (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={stopAndScore} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold flex items-center gap-1.5">
                  <Square size={15} /> {t('reader.stopAndScore')}
                </button>
                <span className="text-sm text-slate-300">{aloud.kind && aloud.kind !== 'passage' ? t('reader.listeningChunk') : t('reader.listening')}</span>
              </div>
            ) : (
              <button onClick={() => startAloud({ passage: pick.passage, newWords: pick.newWords, kind: 'passage', text: String(pick.passage.text) })} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5">
                <Mic size={15} /> {t('reader.readAloudButton')}
              </button>
            )}
            {aloud?.status === 'empty' && (
              <p className="text-sm text-slate-300">{t('reader.aloudEmpty')}</p>
            )}
            {aloud?.status === 'error' && <p className="text-sm text-rose-300">{aloud.message}</p>}
            {aloud?.status === 'scored' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-300">
                  {t('reader.readingMatch')} <span className="text-lg font-bold text-white">{aloud.pct}%</span> {t('reader.readingMatchCovered')}
                  {aloud.passed ? t('reader.readingMatchPassedSuffix') : '.'}
                </p>
                {aloud.fix ? (
                  <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4 flex items-start gap-3">
                    <span className="mt-0.5"><Mascot agent="nao" size={28} showName={false} /></span>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-white">{t('reader.oneFixTitle')}</p>
                      <p className="text-sm text-slate-200">
                        <span className="font-semibold text-white">{aloud.fix.h || aloud.fix.word}</span>
                        {aloud.fix.reading && aloud.fix.reading !== (aloud.fix.h || aloud.fix.word) && <span className="text-cyan-300"> （{aloud.fix.reading}）</span>}
                        {aloud.fix.meaning && <span className="text-slate-400"> — {aloud.fix.meaning}</span>}
                      </p>
                      <p className="text-sm text-slate-300">{t('reader.fixSayLine', { sentence: sentenceWith(String(pick.passage.text), aloud.fix.word) })}</p>
                    </div>
                  </div>
                ) : !aloud.passed ? (
                  <p className="text-sm text-slate-400">{t('reader.fixNone')}</p>
                ) : null}
              </div>
            )}
            {aloud?.status === 'chunk' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-300">
                  {aloud.passed
                    ? t('reader.repairChunkPassed', { pct: aloud.pct })
                    : t('reader.repairChunkMissed', { pct: aloud.pct })}
                </p>
                {aloud.sentencesDone && <p className="text-sm text-slate-300">{t('reader.repairAllSentencesDone')}</p>}
                {!aloud.passed && aloud.fix && (
                  <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4 flex items-start gap-3">
                    <span className="mt-0.5"><Mascot agent="nao" size={28} showName={false} /></span>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-white">{t('reader.oneFixTitle')}</p>
                      <p className="text-sm text-slate-200">
                        <span className="font-semibold text-white">{aloud.fix.h || aloud.fix.word}</span>
                        {aloud.fix.reading && aloud.fix.reading !== (aloud.fix.h || aloud.fix.word) && <span className="text-cyan-300"> （{aloud.fix.reading}）</span>}
                        {aloud.fix.meaning && <span className="text-slate-400"> — {aloud.fix.meaning}</span>}
                      </p>
                      <p className="text-sm text-slate-300">{t('reader.fixSayLine', { sentence: sentenceWith(aloud.fixText || '', aloud.fix.word) })}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {aloud?.status === 'repairDone' && (
              <p className="text-sm text-slate-300">
                {t('reader.readingMatch')} <span className="text-lg font-bold text-white">{aloud.pct}%</span> {t('reader.readingMatchCovered')} {t('reader.repairComplete')}
              </p>
            )}
            {repair && repairChunk && (
              <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4 space-y-3">
                <p className="text-sm font-bold text-white">{t('reader.repairTitle')}</p>
                <p className="text-sm text-slate-300">{t('reader.repairIntro')}</p>
                <p className="text-sm text-slate-400">
                  {repair.stage === 'sentences'
                    ? t('reader.repairSentenceProgress', { done: repair.total - repair.queue.length + 1, total: repair.total })
                    : repair.stage === 'half1'
                      ? t('reader.repairHalfLabel', { n: 1 })
                      : repair.stage === 'half2'
                        ? t('reader.repairHalfLabel', { n: 2 })
                        : t('reader.repairFullLabel')}
                </p>
                <p className="text-base text-slate-100 leading-relaxed">「{repairChunk.text}」</p>
                {aloud?.status !== 'listening' && (
                  <button onClick={() => startAloud({ passage: pick.passage, newWords: pick.newWords, kind: repairChunk.kind, text: repairChunk.text })} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5">
                    <Mic size={15} /> {repairChunk.kind === 'sentence' ? t('reader.repairReadSentence') : repairChunk.kind === 'half' ? t('reader.repairReadHalf') : t('reader.repairReadFull')}
                  </button>
                )}
              </div>
            )}
          </section>
        </>
      )}

        </div>

        {/* Heard Words (Doc 22): Hori's other ear — the right
            column on wide screens, the strip at the top on
            phones (see the layout note above). */}
        <div className="order-1 min-[720px]:order-2 min-w-0 space-y-4">
          <HeardPitch variant="compact" />
          {/* The Vault (Doc 22): the collection itself, always
              visible under Hori's panel — today's words reset
              at midnight; the vault does not. */}
          <HeardVault />
          {/* Kanji cards (Doc 16, 2026-11-15): the app door of
              the Telegram flash-card deck — same rows, same
              echo schedule. */}
          <KanjiCards />
        </div>
      </div>
    </div>
  )
}
