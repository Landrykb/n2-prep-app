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
import {
  BANDS, bandRank, buildKnownSet, countKnownContent, currentBatchWords, deckCreditSet,
  isColdStart, kanjiReadings, passageNewKanji, passageRatio, passageRecyclesBatch,
  pickPassage, pickStarter, capCandidates,
  resolveBand, seenKanjiSet, serveBandFor, applyFeedback,
} from '../lib/readerFit.js'
import {
  READ_ALOUD_PASS_SCORE, normalizeSpeechText, scoreReadAloud, firstMissedCandidate,
} from '../lib/readAloud.js'
import KanjiTapText from './KanjiTapText.jsx'
import KanjiChips from './KanjiChips.jsx'
import TtsButton from './TtsButton.jsx'
import Mascot from './Mascot.jsx'
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
  const [aloud, setAloud] = useState(null) // listening | scored | empty | error
  const recogRef = useRef(null)
  const finalTextRef = useRef('')
  const listeningRef = useRef(false)
  const discardRef = useRef(false) // an aborted session's onend must not score
  const creditedRef = useRef(new Set()) // passages a voice proof already comfy-credited
  const completedRef = useRef(new Set()) // passages already logged passage_completed
  const speechSupported = typeof window !== 'undefined'
    && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  function stopListening() {
    discardRef.current = true
    listeningRef.current = false
    try { recogRef.current?.abort() } catch { /* not running */ }
    recogRef.current = null
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
      return shapeServed(ctx, data.passage, data.ratio, data.coldStart === true)
    } catch { return null }
  }

  const present = (next) => {
    stopListening()
    setAloud(null)
    setPulseWord('')
    setPick(next)
    setFinished(false)
    setMineNote('')
    setPhase('ready')
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
        const first = doPick(ctx, [])
        if (first) { present(first); return }
        // Bank miss: before declaring the shelf empty, ask the
        // server pipeline (amendment #16) — it can fit from the
        // full bank and generate a fitted passage, like the bot.
        if (!cold && bank.length > 0) {
          setPhase('digging')
          const served = await tryServe(ctx, [])
          if (cancelled) return
          if (served && !served.needLevel) { present(served); return }
          // need_level: the empty state below renders the one-tap
          // level question (bandSource is 'none' in that world).
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

  const scoreTranscript = (target, transcript) => {
    const passage = target.passage
    const text = String(transcript || '')
    if (!normalizeSpeechText(text)) { setAloud({ status: 'empty' }); return }
    const { score } = scoreReadAloud(String(passage.text), text)
    recordMetric('shadow_attempted', {
      passageId: String(passage.id),
      score: Math.round(score * 1000) / 1000,
      method: 'webspeech',
    })
    const passed = score >= READ_ALOUD_PASS_SCORE
    if (passed) {
      logCompleted(passage, 'webspeech')
      void applyComfyRead(passage)
    }
    // Nao's one fix: the first new word the voice never reached.
    setAloud({ status: 'scored', pct: Math.round(score * 100), passed, fix: firstMissedCandidate(target.newWords, text) })
  }

  const startAloud = () => {
    if (!pick || listeningRef.current) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return // unsupported browsers render the plain note instead of this button
    const target = pick // the session is bound to THIS passage; present() aborts it on change
    finalTextRef.current = ''
    discardRef.current = false
    const recog = new SR()
    recog.lang = 'ja-JP'
    recog.continuous = true
    recog.interimResults = false
    recog.onresult = (e) => {
      let finals = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finals += e.results[i][0].transcript
      }
      if (finals) finalTextRef.current += finals
    }
    recog.onerror = (e) => {
      if (e?.error === 'aborted') return
      listeningRef.current = false
      recogRef.current = null
      setAloud({
        status: 'error',
        message: e?.error === 'not-allowed'
          ? t('reader.micBlocked')
          : t('reader.recogStopped'),
      })
    }
    recog.onend = () => {
      recogRef.current = null
      if (discardRef.current) { discardRef.current = false; return }
      if (!listeningRef.current) return
      listeningRef.current = false
      scoreTranscript(target, finalTextRef.current)
    }
    recogRef.current = recog
    listeningRef.current = true
    setAloud({ status: 'listening' })
    try {
      recog.start()
    } catch {
      listeningRef.current = false
      recogRef.current = null
      setAloud({ status: 'error', message: t('reader.recogCantStart') })
    }
  }

  const stopAndScore = () => {
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
    return kanjiReadings(pick.passage.tokens, readingOf).map((r) => {
      const head = headOf.get(r.word) || r.word
      const candidate = pick.newWords.find((c) => c.word === r.word || (c.h || c.word) === head) || null
      return {
        ...r,
        meaning: candidate?.meaning || gloss.get(head)?.meaning || byWord.get(head)?.meaning || '',
        candidate,
      }
    })
  }, [pick])

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
        <div className="flex flex-col items-center pt-10 pb-4" role="status">
          <div className="relative">
            <div className="hori-search">
              <Mascot agent="hori" size={96} showName={false} motion="none" />
            </div>
            <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-32 rounded-full bg-white/10" />
          </div>
          <p className="text-sm text-slate-400 mt-5">{t('reader.loading')}</p>
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
        </div>
      )}

      {phase === 'ready' && pick && (
        <>
          <section className="rounded-3xl glass p-6 sm:p-8 card-glow space-y-5">
            <p className="text-sm text-slate-400">{t('reader.dugUp', { topic: pick.passage.topic || t('reader.defaultTopic'), band: pick.passage.band })}</p>
            <PassageText text={pick.passage.text} newWords={pick.newWords} highlightWord={pulseWord} />
            {/* The listen step (audit P2-6): the bot sends a voice
                note with every passage; the web surface had no way
                to hear the passage at all. Same order as the bot:
                listen first, then read it back. */}
            <div>
              <TtsButton text={pick.passage.text} className="px-4 py-2 text-sm font-medium" />
            </div>
            <KanjiChips key={String(pick.passage.id)} chips={chips} activeWord={pulseWord} onHighlight={setPulseWord} onMineWord={mineCandidates} />
            {pick.newWords.length > 0 && (
              <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
                <h3 className="text-sm font-bold text-[#FF8A75] mb-2">{t('reader.newWordsHeading')}</h3>
                <ul className="space-y-1">
                  {pick.newWords.map((c, i) => (
                    <li key={i} className="text-sm text-slate-200">
                      <span className="font-semibold text-white">{c.h || c.word}</span>
                      {c.reading && c.reading !== (c.h || c.word) && <span className="text-cyan-300"> （{c.reading}）</span>}
                      {c.meaning && <span className="text-slate-400"> — {c.meaning}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-slate-400 whitespace-pre-line">{footerFor(pick)}</p>
          </section>

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

          <section className="rounded-3xl glass p-6 card-glow space-y-3">
            <h3 className="text-base font-bold text-white">{t('reader.readAloudTitle')}</h3>
            <p className="text-sm text-slate-400">{t('reader.readAloudIntro')}<span className="text-slate-200">{t('reader.readAloudIntroEmphasis')}</span></p>
            {!speechSupported ? (
              <p className="text-sm text-slate-300">{t('reader.readAloudUnsupported')}</p>
            ) : aloud?.status === 'listening' ? (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={stopAndScore} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold flex items-center gap-1.5">
                  <Square size={15} /> {t('reader.stopAndScore')}
                </button>
                <span className="text-sm text-slate-300">{t('reader.listening')}</span>
              </div>
            ) : (
              <button onClick={startAloud} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5">
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
          </section>
        </>
      )}
    </div>
  )
}
