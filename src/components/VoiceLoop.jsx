import { useMemo, useRef, useState } from 'react'
import { Mic, MicOff, Volume2, CheckCircle2, RotateCcw, Save, Ear, MessageSquare, Sparkles } from 'lucide-react'
import { scenes, SCENE_DOMAINS } from '../data/scenes.js'
import { addToQueue } from '../lib/queue.js'
import { loadProfile } from '../lib/profile.js'
import { recordVoiceAttempt } from '../lib/twin.js'
import Mascot from './Mascot.jsx'
import MicPrompt from './MicPrompt.jsx'
import { micExplained, markMicExplained } from '../lib/micConsent.js'
import { micErrorCopy } from '../lib/speechErrors.js'
import { useLanguage } from '../hooks/useLanguage.js'
import TtsButton from './TtsButton.jsx'
import KanjiTapText from './KanjiTapText.jsx'

const MASTERED_KEY = 'jpn:voice:mastered'
const MASTERY = 85

function normalise(s) {
  return (s || '').replace(/[\s。、！？!?・「」『』（）()]/g, '').trim()
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
  const { t } = useLanguage()
  const profile = useMemo(loadProfile, [])
  // Problem-first ordering: scenes matching the learner's pains come first.
  const ordered = useMemo(() => {
    const pains = new Set(profile?.pains || [])
    const persona = profile?.persona
    const score = (s) => (s.for || []).reduce((acc, tag) => acc + (pains.has(tag) || tag === persona || (persona === 'parent' && tag === 'life-admin') || (persona === 'business' && tag === 'keigo') ? 1 : 0), 0)
    return [...scenes].sort((a, b) => score(b) - score(a))
  }, [profile])

  const [domain, setDomain] = useState('all')
  const [showMicPrompt, setShowMicPrompt] = useState(false)
  const [idx, setIdx] = useState(0)
  const [mode, setMode] = useState('roleplay') // roleplay | shadow
  const [input, setInput] = useState('')
  const [attempts, setAttempts] = useState([]) // { text, score, missing }
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState(null)
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

  // First mic use on this device shows the plain-language explanation
  // BEFORE the browser prompt (Doc 15 — Apple 2.5.14 / Play disclosure).
  const requestListening = () => {
    if (micExplained()) startListening()
    else setShowMicPrompt(true)
  }
  const confirmMic = () => { markMicExplained(); setShowMicPrompt(false); startListening() }

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    recogRef.current = rec
    rec.lang = 'ja-JP'; rec.interimResults = false; rec.maxAlternatives = 1
    rec.onresult = (e) => { setInput(e.results[0][0].transcript || ''); setListening(false); setMicError(null) }
    rec.onerror = (e) => { setListening(false); setMicError(micErrorCopy(e?.error)) }
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
        setSavedNote(t('voice.savedMastered'))
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
    setSavedNote(added ? t('voice.savedQueue') : t('voice.savedAlready'))
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1"><MessageSquare size={20} className="text-[#FF8A75]" /><h2 className="text-2xl font-bold text-white">{t('voice.title')}</h2></div>
        <p className="text-sm text-slate-400">{t('voice.subtitle', { mastered: mastered.size, total: scenes.length })}{profile?.pains?.length ? t('voice.subtitlePains') : ''}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex p-1 rounded-xl bg-bun-700/60 border border-bun-600/40">
          <button onClick={() => setMode('roleplay')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === 'roleplay' ? 'bg-[#FF6B57] text-white' : 'text-slate-400'}`}>{t('voice.modeRoleplay')}</button>
          <button onClick={() => setMode('shadow')} className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 ${mode === 'shadow' ? 'bg-[#FF6B57] text-white' : 'text-slate-400'}`}><Ear size={13} /> {t('voice.modeShadow')}</button>
        </div>
        <select value={domain} onChange={(e) => { setDomain(e.target.value); setIdx(0) }} className="bg-bun-900 border border-bun-600/40 rounded-lg px-2 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#FF6B57]">
          <option value="all">{t('voice.allDomains')}</option>
          {SCENE_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {filtered.map((s, i) => (
          <button key={s.id} onClick={() => pickScene(i)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${scene.id === s.id ? 'bg-[#FF6B57] text-white' : 'bg-bun-700 text-slate-300 hover:bg-bun-600'}`}>
            {mastered.has(s.id) ? '✓ ' : ''}{s.title} <span className="text-slate-400">· {s.level}</span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl glass p-5 card-glow space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-white">{scene.title}</h3>
            <p className="text-xs text-slate-400">{t('voice.sceneMeta', { domain: scene.domain, level: scene.level, pattern: scene.targetPattern })}</p>
          </div>
          {isMastered && <span className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"><CheckCircle2 size={13} /> {t('voice.mastered')}</span>}
        </div>

        <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4">
          <p className="text-xs text-slate-400 mb-1">{t('voice.partnerSays')}</p>
          <div className="flex items-start gap-2">
            <p className="text-slate-100 leading-loose flex-1"><KanjiTapText text={scene.partner} /></p>
            <TtsButton text={scene.partner} cast={scene.partnerVoice || undefined} audioSrc={scene.partnerAudio || undefined} />
          </div>
        </div>

        {mode === 'roleplay' && (
          <>
            <p className="text-sm text-slate-200"><span className="text-[#FF8A75] font-semibold">{t('voice.yourTurn')}</span> {scene.promptEn}</p>
            {showMicPrompt && <MicPrompt onUseMic={confirmMic} onTypeInstead={() => setShowMicPrompt(false)} />}
            <div className="flex gap-2">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder={t('call.inputPlaceholder')}
                className="flex-1 rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
              <div className="flex flex-col gap-2">
                <button onClick={requestListening} disabled={!speechSupported || listening} className="px-3 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5">
                  {listening ? <MicOff size={14} /> : <Mic size={14} />} {listening ? t('call.listeningBtn') : t('voice.speak')}
                </button>
                <button onClick={check} disabled={!input.trim()} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium">{t('voice.checkMe')}</button>
              </div>
            </div>
            {micError && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-sm font-semibold text-amber-200">{micError.titleKey ? t(micError.titleKey) : micError.title}</p>
                <p className="text-xs text-amber-100/80 mt-0.5">{micError.bodyKey ? t(micError.bodyKey) : micError.body}</p>
              </div>
            )}
            {!speechSupported && <p className="text-xs text-slate-500">{t('voice.noVoice')}</p>}

            {attempts.map((a, i) => (
              <div key={i} className={`rounded-xl border p-4 space-y-2 ${a.score >= MASTERY ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-bun-700/40 border-bun-600/20'}`}>
                <p className="text-sm text-slate-200">{t('voice.attemptPrefix', { n: i + 1, text: a.text })} <span className={`font-bold ${a.score >= MASTERY ? 'text-emerald-300' : 'text-amber-300'}`}>{a.score}%</span></p>
                {a.score < MASTERY && <p className="text-xs text-slate-400">{t('voice.repeatHint', { mastery: MASTERY })}</p>}
              </div>
            ))}

            {last && (
              <div className="rounded-xl bg-bun-900/50 border border-[#FF6B57]/20 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-white flex items-center gap-2"><Mascot agent="nao" size={28} showName={false} /><Sparkles size={15} className="text-[#FF8A75]" /> {t('voice.correctionTitle', { name: 'Nao' })}</p>
                  <div className="flex items-center gap-2"><TtsButton text={scene.model} /><span className="text-xs text-slate-400 flex items-center gap-1"><Volume2 size={12} /> {t('voice.hearModel')}</span></div>
                </div>
                <p className="text-slate-100 leading-loose"><KanjiTapText text={scene.model} /></p>
                {scene.alternatives?.[0] && <p className="text-xs text-slate-400">{t('voice.alsoNatural', { text: scene.alternatives[0] })}</p>}
                {last.missing.length > 0 && <p className="text-sm text-amber-200">{t(last.missing.length > 1 ? 'voice.missingMany' : 'voice.missingOne', { list: last.missing.join('、') })}</p>}
                <p className="text-xs text-slate-300"><span className="text-[#FF8A75] font-semibold">{t('voice.keigoLabel')}</span> {scene.keigoNote}</p>
                <p className="text-xs text-rose-200"><span className="font-semibold">{t('voice.commonErrorLabel')}</span> {scene.commonError}</p>
                {savedNote && <p className="text-xs text-emerald-300">{savedNote}</p>}
                <div className="flex flex-wrap gap-2">
                  {!isMastered && <button onClick={() => setInput('')} className="px-3 py-1.5 rounded-lg bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-xs font-medium flex items-center gap-1"><RotateCcw size={13} /> {t('voice.sayAgain')}</button>}
                  {last.score < MASTERY && <button onClick={saveMistakeNow} className="px-3 py-1.5 rounded-lg bg-bun-700 hover:bg-bun-600 text-slate-200 text-xs font-medium flex items-center gap-1"><Save size={13} /> {t('voice.saveMistake')}</button>}
                </div>
              </div>
            )}
          </>
        )}

        {mode === 'shadow' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">{t('voice.shadowIntroA')}<em>{t('voice.shadowIntroEm')}</em>{t('voice.shadowIntroB')}</p>
            <div className="rounded-xl bg-bun-700/40 border border-bun-600/20 p-4 flex items-start gap-2">
              <p className="text-slate-100 leading-loose flex-1"><KanjiTapText text={scene.model} /></p>
              <TtsButton text={scene.model} />
            </div>
            {showMicPrompt && <MicPrompt onUseMic={confirmMic} onTypeInstead={() => setShowMicPrompt(false)} />}
            <div className="flex gap-2">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder={t('voice.shadowPlaceholder')}
                className="flex-1 rounded-xl bg-bun-800 border border-bun-600/40 px-3 py-2.5 text-sm text-slate-100 focus:border-[#FF6B57] focus:outline-none" />
              <div className="flex flex-col gap-2">
                <button onClick={requestListening} disabled={!speechSupported || listening} className="px-3 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5">{listening ? <MicOff size={14} /> : <Mic size={14} />} {listening ? t('call.listeningBtn') : t('voice.speak')}</button>
                <button onClick={check} disabled={!input.trim()} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium">{t('voice.selfCheck')}</button>
              </div>
            </div>
            {micError && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-sm font-semibold text-amber-200">{micError.titleKey ? t(micError.titleKey) : micError.title}</p>
                <p className="text-xs text-amber-100/80 mt-0.5">{micError.bodyKey ? t(micError.bodyKey) : micError.body}</p>
              </div>
            )}
            {last && <p className="text-sm text-slate-200">{t('voice.shadowMatch')} <span className={`font-bold ${last.score >= MASTERY ? 'text-emerald-300' : 'text-amber-300'}`}>{last.score}%</span>{last.missing.length ? <>{t('voice.shadowMissing', { list: last.missing.join('、') })}</> : ''}</p>}
            <div className="space-y-2">
              {[['heard', 'voice.shadowCheckHeard'], ['matched', 'voice.shadowCheckMatched'], ['meaning', 'voice.shadowCheckMeaning']].map(([key, labelKey]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={shadowChecks[key]} onChange={(e) => setShadowChecks((c) => ({ ...c, [key]: e.target.checked }))} className="accent-[#FF6B57]" /> {t(labelKey)}
                </label>
              ))}
            </div>
            {shadowChecks.heard && shadowChecks.matched && shadowChecks.meaning && last && last.score >= 60 && (
              <p className="text-sm text-emerald-300 flex items-center gap-2"><CheckCircle2 size={15} /> {t('voice.shadowComplete')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
