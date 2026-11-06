import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, CheckCircle2, Pickaxe, RefreshCw } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'
import { useAuth } from '../hooks/useAuth.js'
import { useFurigana } from '../hooks/useFurigana.js'
import { collectLearnerState } from '../lib/learnerState.js'
import { addToQueue, loadQueue, queueItemId } from '../lib/queue.js'
import { loadDictionary } from '../lib/dictionary.js'
import { recordMetric } from '../lib/metrics.js'
import {
  BANDS, bandRank, buildKnownSet, countKnownContent, deckCreditSet,
  isColdStart, passageRatio, pickPassage, pickStarter, capCandidates,
  resolveBand, serveBandFor,
} from '../lib/readerFit.js'
import KanjiTapText from './KanjiTapText.jsx'
import Mascot from './Mascot.jsx'

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
// #2): it never claims fitting that did not happen.
const STARTER_FOOTER =
  'A starter, not a fitted pick — I do not know your level yet, so this one is from the easy shelf, with the new words kept few. ' +
  'Mine any words you like: every mined word teaches me what you know. ' +
  'Take the 10-minute checkup in Yonde and fitting switches on — from then on, every passage is measured against your words before it is sent.'

// Appended to the nothing-fits state when the learner has words but
// no band basis at all (reader-bot, same amendment): the checkup is
// named as the switch that turns level-fitting on.
const CHECKUP_SWITCH_LINE =
  'The checkup is the switch here: take the 10-minute checkup in Yonde, and Hori can fit to your level, not just your queue.'

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

function PassageText({ text, newWords }) {
  const { enabled: furiganaOn } = useFurigana()
  const segments = useMemo(() => splitSegments(text, newWords), [text, newWords])
  return (
    <p className="text-lg leading-loose text-slate-100">
      {segments.map((seg, i) => {
        if (!seg.word) return <KanjiTapText key={i} text={seg.text} />
        const reading = seg.word.reading
        return furiganaOn && reading && reading !== seg.text ? (
          <ruby key={i} className="font-bold text-[#FFA08D]">
            {seg.text}
            <rt className="text-[0.6em] font-normal text-[#FF8A75] select-none">{reading}</rt>
          </ruby>
        ) : (
          <strong key={i} className="font-bold text-[#FFA08D]">{seg.text}</strong>
        )
      })}
    </p>
  )
}

export default function Reader() {
  const { user } = useAuth()
  const [phase, setPhase] = useState('loading') // loading | guest | error | empty | ready
  const [emptyKind, setEmptyKind] = useState('nofit') // nofit | shelf
  const [bandSource, setBandSource] = useState('none')
  const [displayBand, setDisplayBand] = useState('N4')
  const [pick, setPick] = useState(null) // { passage, ratio, coldStart, newWords }
  const [note, setNote] = useState('')
  const [mineNote, setMineNote] = useState('')
  const [finished, setFinished] = useState(false)
  const [busy, setBusy] = useState(false)

  // The fitting context, computed once per sign-in and kept in refs so
  // Another Passage re-picks without re-reading the world. knownRef is
  // a live Set: mining grows it, exactly as the bot re-reads state on
  // every /read.
  const ctxRef = useRef(null)
  const excludedRef = useRef([])

  const doPick = (ctx, excluded) => {
    const recent = [...(ctx.recentIds || []), ...(excluded || [])]
    if (ctx.cold) {
      const starter = pickStarter(ctx.bank, ctx.known, recent)
      if (!starter) return null
      const candidates = capCandidates(withCandidateLevels(starter.passage, ctx.deckLevels))
      const newWords = candidates.filter((c) => c.word && !ctx.known.has(c.h || c.word))
      return { passage: starter.passage, ratio: passageRatio(starter.passage.tokens, ctx.known), coldStart: true, newWords, sentNewCount: newWords.length, stepLine: '' }
    }
    const fit = pickPassage(ctx.bank, ctx.known, ctx.serveBand, recent)
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
      ? `\nStretching you a little past ${basisLabel} today — Push Me works both ways: Too Hard brings us back.`
      : ctx.fitStep < 0
        ? `\nKeeping it a notch gentler than ${basisLabel} while it settles.`
        : ''
    return { passage: fit.passage, ratio: fit.ratio, coldStart: false, newWords, sentNewCount: newWords.length, stepLine }
  }

  const present = (next) => {
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
        let fitStep = 0
        const linkRes = await supabase
          .from('telegram_links')
          .select('declared_band, fit_step')
          .eq('user_id', user.id)
          .maybeSingle()
        if (!linkRes.error && linkRes.data) {
          declaredBand = linkRes.data.declared_band ?? null
          fitStep = Number(linkRes.data.fit_step ?? 0) || 0
        } else {
          const fallback = await supabase
            .from('telegram_links')
            .select('declared_band')
            .eq('user_id', user.id)
            .maybeSingle()
          if (!fallback.error && fallback.data) declaredBand = fallback.data.declared_band ?? null
        }

        const dict = await loadDictionary()
        const deckLevels = deckLevelsFrom(dict)

        // The known set, exactly as the bot's knownFor composes it:
        // queue fronts + personal vocab (no stored list yet — the
        // Twin's vocab is derived stats, so it contributes nothing
        // today, here as there) + below-band deck credit when a basis
        // exists. Diagnosis outranks the declared tap (resolveBand).
        const { band: resolvedBand, source } = resolveBand({ diagnosisBand, declaredBand })
        const hasDiagnosis = source === 'diagnosis'
        const band = resolvedBand ?? 'N4' // gentle default; the footer says so
        const credit = resolvedBand ? deckCreditSet(deckLevels, resolvedBand) : null
        const known = buildKnownSet(queue, [], credit)
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
        const ctx = { bank, known, deckLevels, serveBand, band, resolvedBand, fitStep, source, cold, recentIds, queueLength: queue.length }
        ctxRef.current = ctx
        excludedRef.current = []
        setBandSource(source)
        setDisplayBand(band)
        const first = doPick(ctx, [])
        if (first) { present(first); return }
        setEmptyKind(bank.length === 0 || cold ? 'shelf' : 'nofit')
        setPhase('empty')
      } catch {
        if (!cancelled) setPhase('error')
      }
    }
    load()
    return () => { cancelled = true }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps -- load reads the signed-in learner's world once per user

  const another = () => {
    const ctx = ctxRef.current
    if (!ctx || !pick || busy) return
    setBusy(true)
    const excluded = [...excludedRef.current, String(pick.passage.id)]
    const next = doPick(ctx, excluded)
    if (!next || String(next.passage.id) === String(pick.passage.id)) {
      setNote('Nothing else on the shelf fits right now — this one is your best fit today.')
    } else {
      excludedRef.current = excluded
      setNote('')
      present(next)
    }
    setBusy(false)
  }

  const mine = () => {
    if (!pick || pick.newWords.length === 0) return
    const passage = pick.passage
    // The bot's mining semantics, mirrored: the queue front is the
    // HEADWORD (it dedupes against the same word added anywhere via
    // the shared queueItemId hash, and FSRS teaches the dictionary
    // form); the passage's own sentence rides on the card as its note.
    const before = new Set(loadQueue().map((i) => i.id))
    const items = pick.newWords.map((c) => {
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
      if (ctx) for (const w of minedWords) ctx.known.add(w)
      const minedFronts = new Set(minedWords)
      setPick((cur) => (cur ? { ...cur, newWords: cur.newWords.filter((c) => !minedFronts.has(c.h || c.word)) } : cur))
    }
    setMineNote(added > 0
      ? `⛏ ${added} word${added === 1 ? '' : 's'} joined your review queue — they will surface in your sessions, with this passage's sentence on the card.`
      : 'Nothing new to mine — you already know, or have already queued, every bolded word in that passage.')
  }

  const finish = () => {
    if (!pick || finished) return
    recordMetric('passage_completed', { passageId: String(pick.passage.id), band: String(pick.passage.band), surface: 'web' })
    setFinished(true)
  }

  // The footer names the fitting basis — the reader-bot's three
  // variants plus the starter footer, verbatim (Doc 16 §5 labelling):
  // the copy never claims level fitting that did not happen, on a
  // basis that did not happen.
  const footerFor = (p) => {
    if (p.coldStart) return STARTER_FOOTER
    const pct = Math.round(p.ratio * 100)
    const n = p.sentNewCount ?? p.newWords.length
    const words = `${n} new word${n === 1 ? '' : 's'}`
    let text
    if (bandSource === 'diagnosis') {
      text = `Fitted to your ${displayBand} level and your queue: about ${pct}% of its words should already be familiar (an estimate) · ${words}`
    } else if (bandSource === 'declared') {
      text = `Fitted to the ${displayBand} you told me and your queue: about ${pct}% of its words should already be familiar (an estimate) · ${words}\nYour checkup in Yonde sharpens this whenever you want it.`
    } else {
      text = `Fitted to your queue: about ${pct}% of its words should already be familiar (an estimate) · ${words}\nBand N4 is a gentle default — take the 10-minute checkup in Yonde and I will fit to your real level.`
    }
    return text + (p.stepLine || '')
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <BookOpenText size={20} className="text-[#FF8A75]" />
          <h2 className="text-2xl font-bold text-white">Yonde Reader</h2>
          <Mascot agent="hori" size={34} />
        </div>
        <p className="text-xs text-slate-500 mb-1">Hori digs; what Hori finds is fitted to your words before you ever see it.</p>
        <p className="text-sm text-slate-400">A short passage measured against the words you actually know — the same shelf Hori serves in Telegram, fitted by the same rules. New words come bold; one tap mines them into your one queue.</p>
      </div>

      {phase === 'guest' && (
        <div className="rounded-2xl glass p-5 card-glow flex items-start gap-3">
          <span className="mt-0.5"><Mascot agent="hori" size={30} showName={false} /></span>
          <p className="text-sm text-slate-300">The Reader fits every passage to <span className="text-slate-100 font-medium">your</span> words — your queue, your level. Sign in and Hori can dig for you; a guest has no words to fit to, so there is honestly nothing to show yet.</p>
        </div>
      )}

      {phase === 'loading' && <p className="text-sm text-slate-400">Hori is digging through the shelf…</p>}

      {phase === 'error' && (
        <div className="rounded-2xl glass p-5 card-glow">
          <p className="text-sm text-slate-300">The reading shelf is empty on my side right now — try again a little later.</p>
        </div>
      )}

      {phase === 'empty' && (
        <div className="rounded-2xl glass p-5 card-glow space-y-2">
          {emptyKind === 'shelf' ? (
            <p className="text-sm text-slate-300">The easy shelf is empty on my side right now — try again a little later.</p>
          ) : (
            <>
              <p className="text-sm text-slate-300">Nothing in the bank fits your words today. Every passage is checked against what you know before it is shown, and Hori would rather show nothing than the wrong level. New words from your next session change the fit — try again after it.</p>
              {bandSource === 'none' && <p className="text-sm text-slate-300">{CHECKUP_SWITCH_LINE}</p>}
            </>
          )}
        </div>
      )}

      {phase === 'ready' && pick && (
        <>
          <section className="rounded-3xl glass p-6 sm:p-8 card-glow space-y-5">
            <p className="text-sm text-slate-400">🔍 Hori dug this up for you — {pick.passage.topic || 'Reading'} · {pick.passage.band}</p>
            <PassageText text={pick.passage.text} newWords={pick.newWords} />
            {pick.newWords.length > 0 && (
              <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
                <h3 className="text-sm font-bold text-[#FF8A75] mb-2">New Words In This Passage</h3>
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
                <Pickaxe size={15} /> Mine The New Words
              </button>
            )}
            <button onClick={another} disabled={busy} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 disabled:opacity-40 text-slate-100 text-sm font-medium flex items-center gap-1.5">
              <RefreshCw size={15} /> Another Passage
            </button>
            {finished ? (
              <span className="text-sm text-emerald-300 flex items-center gap-1.5"><CheckCircle2 size={15} /> Finished — logged. That read counts.</span>
            ) : (
              <button onClick={finish} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5">
                <CheckCircle2 size={15} /> Finished Reading
              </button>
            )}
          </div>
          {mineNote && <p className="text-sm text-emerald-300 flex items-center gap-2"><CheckCircle2 size={15} /> {mineNote}</p>}
          {note && <p className="text-sm text-slate-400">{note}</p>}
        </>
      )}
    </div>
  )
}
