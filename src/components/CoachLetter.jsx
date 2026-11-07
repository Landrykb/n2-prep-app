import { useEffect, useMemo, useState } from 'react'
import { Mail, PenLine } from 'lucide-react'
import { refreshTwin, topPatterns, diagnosisDeltas, loadDiagnosisHistory } from '../lib/twin.js'
import { shadowCoachLetter } from '../lib/coachShadow.js'
import { loadCallState } from '../lib/calls.js'
import { detectMode } from '../lib/modes.js'
import { SECTION_KEYS } from '../lib/levels.js'
import Mascot from './Mascot.jsx'

// MICHI'S WEEKLY LETTER (Doc 05 §9) — rule-based v1, written from REAL
// Twin deltas only: session log, call history, diagnosis history, the
// error fingerprint. Every number in the letter is computed here from
// stored data and echoed in `citedNumbers`; if a thing didn't happen,
// the letter says so plainly instead of inventing a good week.
// Stored one per ISO week at jpn:coach:v1. The Tier-A Coach later
// replaces the prose generation — the data contract stays this shape.

export const COACH_KEY = 'jpn:coach:v1'

function weekStart(now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - dow)
  return d
}
export function isoWeekKey(now = new Date()) {
  const s = weekStart(now)
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`
}
function loadLetters() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COACH_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}
function saveLetter(key, letter) {
  const all = loadLetters()
  all[key] = letter
  try { localStorage.setItem(COACH_KEY, JSON.stringify(all)) } catch { /* ignore */ }
  return all
}

export function generateCoachLetter(now = new Date()) {
  const twin = refreshTwin()
  const { mode, meta } = detectMode(now)
  const start = weekStart(now)
  const startMs = start.getTime()
  const inWeek = (iso) => iso && new Date(iso).getTime() >= startMs

  const sessions = (twin.rhythm.sessionLog || []).filter((s) => inWeek(`${s.date}T12:00:00`))
  const sessionCount = sessions.length
  const minutes = sessions.reduce((a, s) => a + (s.minutes || 0), 0)
  const proof = sessions.reduce((a, s) => a + (s.proof || 0), 0)

  const calls = (loadCallState().history || []).filter((h) => inWeek(h.at))
  const callsKept = calls.filter((h) => h.status === 'completed').length
  const callsTotal = calls.length

  const deltas = diagnosisDeltas()
  const history = loadDiagnosisHistory()
  const top = topPatterns(twin, 1)[0]

  const cited = { sessionCount, minutes, proof, callsKept, callsTotal }
  const paragraphs = []

  if (sessionCount === 0 && callsKept === 0) {
    paragraphs.push('This week is quiet in the record — no sessions and no calls kept. That happens; weeks like this are exactly what this app was built to survive. Nothing piled up while you were away, and nothing needs catching up. Your place is exactly where you left it.')
  } else {
    paragraphs.push(`This week you showed up ${sessionCount} time${sessionCount === 1 ? '' : 's'} for about ${minutes} minute${minutes === 1 ? '' : 's'} of practice, and those sessions earned ${proof} proof point${proof === 1 ? '' : 's'} — the app's plain count of things that actually stuck: scenes mastered in your own voice and cards answered clean. Small and kept beats large and abandoned; this was kept.`)
  }
  if (callsTotal > 0) {
    paragraphs.push(`Koe, your sensei, reached you ${callsTotal} time${callsTotal === 1 ? '' : 's'} and you kept ${callsKept} of those calls. ${callsKept === callsTotal ? 'Every single one — that is the requirement working exactly as designed.' : 'The ones that slipped away cost nothing and broke nothing; the callback and the kind message did their quiet job.'}`)
  }
  if (deltas && history.length >= 2) {
    const parts = SECTION_KEYS.map((s) => {
      const d = deltas.sections[s.id] || 0
      return `${s.label.split(' (')[0]} ${d > 0 ? `up ${d}` : d < 0 ? `down ${-d}` : 'steady'}`
    }).join(' · ')
    cited.diagnosisTotalDelta = deltas.total
    paragraphs.push(`Between your last two health checks, the movement is: ${parts} — total ${deltas.total > 0 ? `up ${deltas.total}` : deltas.total < 0 ? `down ${-deltas.total}` : 'unchanged'} at ${deltas.to.total}/180 (estimate, as always — the check is a short sample, not an official score). ${deltas.total >= 0 ? 'That is the direction doing its work.' : 'A slide in a short sample is information, not a verdict — and it is exactly what next week’s plan is built from.'}`)
  }
  if (top) {
    cited.topPatternCount = top.count
    paragraphs.push(`The slip Nao, your fixer, keeps meeting most is: ${top.label}. ${top.plain} It has shown up ${top.count} time${top.count === 1 ? '' : 's'} so far. Saki is already choosing scenes that meet it head-on — you will not be asked to drill it like homework; it will simply keep appearing inside real scenes until it stops appearing in your mistakes.`)
  }
  if (twin.learningStyle?.note) {
    paragraphs.push(twin.learningStyle.note)
  }
  paragraphs.push(
    mode === 'slump'
      ? 'Honestly: the recent days slid a little, so next week is deliberately smaller — re-wins first, nothing new. That is not the plan failing; that is the plan working. Walk with me at that size and the size grows back on its own.'
      : mode === 'badweek'
        ? 'Next week asks for one tiny win a day, from your strongest ground. When life settles, we re-check where you stand and rebuild the plan from there — never from where an old plan left you.'
        : mode === 'event'
          ? 'Your exam is close, so next week is rehearsal-shaped: your level, your weakest section, timed the way the real thing is timed. Everything else waits, without penalty, on the other side of it.'
          : mode === 'surge'
            ? 'You are climbing, so next week has a little more room in it — offered, never owed. Keep answering Koe’s calls; that is where the climb is coming from.'
            : 'Next week is the same shape as this one, on purpose: one scene, a few of your own cards, one listening bite. Steadiness is not the boring option — for a resident whose life does not require Japanese, steadiness IS the method.',
  )
  paragraphs.push('— Michi, your coach. I walk the road with you; the numbers above are your checkup’s and your fleet’s, quoted exactly.')

  return {
    weekStart: isoWeekKey(now),
    generatedAt: now.toISOString(),
    mode,
    modeLabel: meta.label,
    paragraphs,
    citedNumbers: cited,
    source: 'rules-v1',
  }
}

export default function CoachLetter() {
  const key = isoWeekKey()
  const [letters, setLetters] = useState(loadLetters)
  const current = letters[key]
  const past = useMemo(
    () => Object.values(letters).filter((l) => l.weekStart !== key).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)),
    [letters, key],
  )

  const writeMine = () => setLetters(saveLetter(key, generateCoachLetter()))

  // Coach SHADOW MODE (Doc 05 §9.1): when this week's rules letter is
  // on screen — freshly written or re-opened — Michi's AI shadow
  // writes its own letter from the same facts, once per week, and
  // the pair is logged for comparison. Invisible by design: it can
  // never change what renders here.
  useEffect(() => {
    if (current) shadowCoachLetter(current)
  }, [current])

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Mail size={22} className="text-[#FF8A75]" /> Your Weekly Letter</h2>
        <p className="text-sm text-slate-400 mt-1">From Michi, your coach — written from what your fleet actually recorded this week. Every number in it is a real count from your own app, quoted exactly.</p>
      </div>

      {current ? (
        <article className="rounded-3xl glass p-6 sm:p-8 card-glow space-y-4">
          <div className="flex items-center gap-3 border-b border-bun-600/30 pb-4">
            <Mascot agent="michi" size={44} />
            <div>
              <p className="text-sm font-bold text-white">Week of {new Date(`${current.weekStart}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
              <p className="text-xs text-slate-400">Mode this week: {current.modeLabel} · written {new Date(current.generatedAt).toLocaleDateString()}</p>
            </div>
          </div>
          {current.paragraphs.map((p, i) => (
            <p key={i} className="text-[15px] text-slate-200 leading-relaxed">{p}</p>
          ))}
        </article>
      ) : (
        <div className="rounded-3xl glass p-6 sm:p-8 card-glow space-y-4 text-center">
          <span className="inline-flex justify-center"><Mascot agent="michi" size={52} /></span>
          <p className="text-sm text-slate-300 max-w-md mx-auto">No letter yet for this week. Michi writes from your real record — sessions, calls kept, checkup movement — and invents nothing. Ask, and this week’s letter is written from what is actually there.</p>
          <button onClick={writeMine} className="px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold inline-flex items-center gap-1.5"><PenLine size={15} /> Write This Week’s Letter</button>
        </div>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Earlier letters</h3>
          {past.map((l) => (
            <details key={l.weekStart} className="rounded-2xl glass p-5 card-glow">
              <summary className="cursor-pointer text-sm font-semibold text-white">Week of {new Date(`${l.weekStart}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} · {l.modeLabel}</summary>
              <div className="space-y-3 mt-3">
                {l.paragraphs.map((p, i) => <p key={i} className="text-sm text-slate-300 leading-relaxed">{p}</p>)}
              </div>
            </details>
          ))}
        </section>
      )}
    </div>
  )
}
