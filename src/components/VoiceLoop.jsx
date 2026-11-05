import { useMemo, useRef, useState } from 'react'
import { Mic, MicOff, Volume2, CheckCircle2, RotateCcw, Save, Ear, MessageSquare, Sparkles } from 'lucide-react'
import { scenes, SCENE_DOMAINS } from '../data/scenes.js'
import { addToQueue } from '../lib/queue.js'
import { loadProfile } from '../lib/profile.js'
import { recordVoiceAttempt } from '../lib/twin.js'
import Mascot from './Mascot.jsx'
import TtsButton from './TtsButton.jsx'
import KanjiTapText from './KanjiTapText.jsx'

const MASTERED_KEY = 'jpn:voice:mastered'
const MASTERY = 85

function normalise(s) {
  return (s || '').replace(/[\s。、！？!?・「」『』（）()]/g, '').replace(/です/g, 'です').trim()
}
function bigrams(s) {
  const out = new Map()
  for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); out.set(b, (out.get(b) || 0) + 1) }
  return out
}
function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (!m) return n; if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}
/** Similarity 0–100: blend of char-bigram Dice and edit-distance ratio. */
export function similarity(aRaw, bRaw) {
  const a = normalise(aRaw), b = normalise(bRaw)
  if (!a || !b) return 0
  if (a === b) return 100
  const A = bigrams(a), B = bigrams(b)
  let hit = 0
  for (const [bg, c] of A) hit += Math.min(c, B.get(bg) || 0)
  const dice = (2 * hit) / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1))
  const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length)
  return Math.round(100 * (0.55 * dice + 0.45 * Math.max(0, edit)))
}
export function bestScore(input, scene) {
  return Math.max(similarity(input, scene.model), ...(scene.alternatives || []).map((alt) => similarity(input, alt)))
}
export function missingPhrases(input, scene) {
  const n = normalise(input)
  return (scene.keyPhrases || []).filter((p) => !n.includes(normalise(p)))
}
function loadMastered() {
  try { return new Set(JSON.parse(localStorage.getItem(MASTERED_KEY) || '[]')) } catch { return new Set() }
}

export default function VoiceLoop() {
  const profile = useMemo(loadProfile, [])
  // Problem-first ordering: scenes matching the learner's pains come first.
  const ordered = useMemo(() => {
    const pains = new Set(profile?.pains || [])
    const persona = profile?.persona
    const score = (s) => (s.for || []).reduce((acc, tag) => acc + (pains.has(tag) || tag === persona || (persona === 'parent' && tag === 'life-admin') || (persona === 'business' && tag === 'keigo') ? 1 : 0), 0)
    return [...scenes].sort((a, b) => score(b) - score(a))
  }, [profile])

  const [domain, setDomain] = useState('all')
  const [idx, setIdx] = useState(0)
  const [mode, setMode] = useState('roleplay') // roleplay | shadow
  const [input, setInput] = useState('')
  const [attempts, setAttempts] = useState([]) // { text, score, missing }
  const [listening, setListening] = useState(false)
  const [savedNote, setSavedNote] = useState('')
  const [shadowChecks, setShadowChecks] = useState({ heard: false, matched: false, meaning: false })
  const [mastered, setMastered] = useState(loadMastered)
  const recogRef = useRef(null)

  const filtered = useMemo(() => (domain === 'all' ? ordered : ordered.filter((s) => s.domain === domain)), [ordered, domain])
  const scene = filtered[Math.min(idx, filtered.length - 1)] || ordered[0]
  const last = attempts[attempts.length - 1]
  const isMastered = mastered.has(scene.id) || (last && last.score >= MASTERY)
  const speechSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const pickScene = (i) => { setIdx(i); setAttempts([]); setInput(''); setSavedNote(''); setShadowChecks({ heard: false, matched: false, meaning: false }) }

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    recogRef.current = rec
    rec.lang = 'ja-JP'; rec.interimResults = false; rec.maxAlternatives = 1
    rec.onresult = (e) => { setInput(e.results[0][0].transcript || ''); setListening(false) }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    setListening(true)
    try { rec.start() } catch { setListening(false) }
  }

  const check = () => {
    const text = input.trim()
    if (!text) return
    const score = bestScore(text, scene)
    const missing = missingPhrases(text, scene)
    const attempt = { text, score, missing }
    const next = [...attempts, attempt]
    setAttempts(next)
    // The Twin's error fingerprint learns from every attempt (heuristic
    // classification over local signals — Doc 05 §4 fallback Corrector).
    recordVoiceAttempt({ scene, text, score, missing })
    if (score >= MASTERY) {
      const wasImperfect = next.slice(0, -1).some((a) => a.score < MASTERY) || missing.length > 0
      setMastered((cur) => {
        const s = new Set(cur); s.add(scene.id)
        try { localStorage.setItem(MASTERED_KEY, JSON.stringify([...s])) } catch { /* ignore */ }
        return s
      })
      // Mastered-after-error: the error pattern itself joins the ONE queue.
      if (wasImperfect) {
        const first = next[0]
        addToQueue([{
          front: `${scene.title} — say it right: ${scene.promptEn}`,
          back: scene.model,
          reading: '',
          note: `Your earlier version: 「${first.text}」 (${first.score}%). Missing: ${first.missing.join('、') || scene.targetPattern}. ${scene.commonError}`,
          source: 'voice', level: scene.level,
        }])
        setSavedNote('Mastered — and your earlier mistake was saved to your review queue, so it comes back spaced, in a new scene, until it stays fixed.')
      }
    }
  }

  const saveMistakeNow = () => {
    if (!last) return
    const { added } = addToQueue([{
      front: `${scene.title} — say it right: ${scene.promptEn}`,
      back: scene.model,
      note: `Your version: 「${last.text}」 (${last.score}%). Missing: ${last.missing.join('、') || scene.targetPattern}. ${scene.commonError}`,
      source: 'voice', level: scene.level,
    }])
    setSavedNote(added ? 'Saved to your review queue (Today → review).' : 'That mistake is already in your queue.')
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1"><MessageSquare size={20} className="text-violet-400" /><h2 className="text-2xl font-bold text-white">Voice Loop</h2></div>
        <p className="text-sm text-slate-400">Your version first. Correction second. Repeat until it’s clean — then your mistakes join your review queue. {mastered.size}/{scenes.length} scenes mastered.{profile?.pains?.length ? ' Scenes matching your problem are listed first.' : ''}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex p-1 rounded-xl bg-bun-700/60 border border-bun-600/40">
          <button onClick={() => setMode('roleplay')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === 'roleplay' ? 'bg-violet-600 text-white' : 'text-slate-400'}`}>Roleplay: say your version</button>
          <button onClick={() => setMode('shadow')} className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 ${mode === 'shadow' ? 'bg-violet-600 text-white' : 'text-slate-400'}`}><Ear size={13} /> Shadowing</button>
        </div>
        <select value={domain} onChange={(e) => { setDomain(e.target.value); setIdx(0) }} className="bg-bun-900 border border-bun-600/40 rounded-lg px-2 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500">
          <option value="all">All domains</option>
          {SCENE_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {filtered.map((s, i) => (
          <button key={s.id} onClick={() => pickScene(i)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${scene.id === s.id ? 'bg-violet-600 text-white' : 'bg-bun-700 text-slate-300 hover:bg-bun-600'}`}>
            {mastered.has(s.id) ? '✓ ' : ''}{s.title} <span className="text-slate-400">· {s.level}</span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl glass p-5 card-glow space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-white">{scene.title}</h3>
            <p className="text-xs text-slate-400">{scene.domain} · {scene.level} · target pattern: {scene.targetPattern}</p>
          </div>
          {isMastered && <span className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"><CheckCircle2 size={13} /> Mastered</span>}
        </div>

        <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
          <p className="text-xs text-slate-400 mb-1">Your partner says:</p>
          <div className="flex items-start gap-2">
            <p className="text-slate-100 leading-loose flex-1"><KanjiTapText text={scene.partner} /></p>
            <TtsButton text={scene.partner} />
          </div>
        </div>

        {mode === 'roleplay' && (
          <>
            <p className="text-sm text-slate-200"><span className="text-violet-300 font-semibold">Your turn — say this, your way:</span> {scene.promptEn}</p>
            <div className="flex gap-2">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder="Speak with the mic, or type your Japanese here…"
                className="flex-1 rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none" />
              <div className="flex flex-col gap-2">
                <button onClick={startListening} disabled={!speechSupported || listening} className="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5">
                  {listening ? <MicOff size={14} /> : <Mic size={14} />} {listening ? 'Listening…' : 'Speak'}
                </button>
                <button onClick={check} disabled={!input.trim()} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium">Check me</button>
              </div>
            </div>
            {!speechSupported && <p className="text-xs text-slate-500">Voice recognition isn’t available in this browser — typing your version works exactly the same way here.</p>}

            {attempts.map((a, i) => (
              <div key={i} className={`rounded-xl border p-4 space-y-2 ${a.score >= MASTERY ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-bun-700/40 border-bun-600/20'}`}>
                <p className="text-sm text-slate-200">Attempt {i + 1}: 「{a.text}」 <span className={`font-bold ${a.score >= MASTERY ? 'text-emerald-300' : 'text-amber-300'}`}>{a.score}%</span></p>
                {a.score < MASTERY && <p className="text-xs text-slate-400">Repeat until you reach {MASTERY}% — that repetition, not the first try, is the learning.</p>}
              </div>
            ))}

            {last && (
              <div className="rounded-xl bg-bun-900/50 border border-violet-500/20 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-white flex items-center gap-2"><Mascot agent="nao" size={28} showName={false} /><Sparkles size={15} className="text-violet-300" /> Correction — from Nao, your fixer</p>
                  <div className="flex items-center gap-2"><TtsButton text={scene.model} /><span className="text-xs text-slate-400 flex items-center gap-1"><Volume2 size={12} /> hear the model</span></div>
                </div>
                <p className="text-slate-100 leading-loose"><KanjiTapText text={scene.model} /></p>
                {scene.alternatives?.[0] && <p className="text-xs text-slate-400">Also natural: {scene.alternatives[0]}</p>}
                {last.missing.length > 0 && <p className="text-sm text-amber-200">Missing key phrase{last.missing.length > 1 ? 's' : ''}: {last.missing.join('、')}</p>}
                <p className="text-xs text-slate-300"><span className="text-violet-300 font-semibold">Keigo / register:</span> {scene.keigoNote}</p>
                <p className="text-xs text-rose-200"><span className="font-semibold">Common error:</span> {scene.commonError}</p>
                {savedNote && <p className="text-xs text-emerald-300">{savedNote}</p>}
                <div className="flex flex-wrap gap-2">
                  {!isMastered && <button onClick={() => setInput('')} className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium flex items-center gap-1"><RotateCcw size={13} /> Say it again</button>}
                  {last.score < MASTERY && <button onClick={saveMistakeNow} className="px-3 py-1.5 rounded-lg bg-bun-700 hover:bg-bun-600 text-slate-200 text-xs font-medium flex items-center gap-1"><Save size={13} /> Save this mistake to my queue</button>}
                </div>
              </div>
            )}
          </>
        )}

        {mode === 'shadow' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">Shadowing: first make sure you <em>understand</em> the line — shadowing words you don’t understand is just parroting. Listen twice, then speak along, almost simultaneously, matching rhythm and pitch.</p>
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4 flex items-start gap-2">
              <p className="text-slate-100 leading-loose flex-1"><KanjiTapText text={scene.model} /></p>
              <TtsButton text={scene.model} />
            </div>
            <div className="flex gap-2">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder="After shadowing, type what you actually said — self-check honestly…"
                className="flex-1 rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none" />
              <div className="flex flex-col gap-2">
                <button onClick={startListening} disabled={!speechSupported || listening} className="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5">{listening ? <MicOff size={14} /> : <Mic size={14} />} {listening ? 'Listening…' : 'Speak'}</button>
                <button onClick={check} disabled={!input.trim()} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium">Self-check</button>
              </div>
            </div>
            {last && <p className="text-sm text-slate-200">Shadow match: <span className={`font-bold ${last.score >= MASTERY ? 'text-emerald-300' : 'text-amber-300'}`}>{last.score}%</span>{last.missing.length ? <> · missing: {last.missing.join('、')}</> : ''}</p>}
            <div className="space-y-2">
              {[['heard', 'I listened twice and understood every word first'], ['matched', 'I matched the timing and intonation, not just the words'], ['meaning', 'I could explain what this line means and when to use it']].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={shadowChecks[key]} onChange={(e) => setShadowChecks((c) => ({ ...c, [key]: e.target.checked }))} className="accent-violet-500" /> {label}
                </label>
              ))}
            </div>
            {shadowChecks.heard && shadowChecks.matched && shadowChecks.meaning && last && last.score >= 60 && (
              <p className="text-sm text-emerald-300 flex items-center gap-2"><CheckCircle2 size={15} /> Shadowing round complete. Do the same 30–60 seconds again tomorrow — that’s where it becomes automatic.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
