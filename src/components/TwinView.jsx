import { useEffect, useState } from 'react'
import { Download, Trash2, Mail, ChevronRight, X, Send, BookOpenText } from 'lucide-react'
import { brand } from '../lib/brand.js'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'
import {
  refreshTwin, loadTwin, deleteTwin, topPatterns, removePattern,
  learningStyleRows, diagnosisDeltas, patternById,
} from '../lib/twin.js'
import { detectMode } from '../lib/modes.js'
import { PERSONAS, PAINS, PROOF_TARGETS } from '../lib/profile.js'
import { SECTION_KEYS } from '../lib/levels.js'
import Mascot from './Mascot.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { useLanguage } from '../hooks/useLanguage.js'
import { downloadAllLocalData, wipeAllLocalData, requestServerAccountDeletion } from '../lib/accountDeletion.js'
import { getTwinSyncState, subscribeTwinSync, TWIN_SYNC_EVENT } from '../lib/twinSync.js'
import { getStateSyncState, subscribeStateSync } from '../lib/stateSync.js'
import { validateExport, planRestore } from '../lib/restore.js'
import { loadMetrics, summariseMetrics } from '../lib/metrics.js'
import { estimateWorkingLevel } from '../lib/twinEstimate.js'
import { collectLearnerState, loadDeclaredLevel, saveDeclaredLevel } from '../lib/learnerState.js'
import { resolveLevelBasis } from '../lib/levelBasis.js'
import FeedbackBox from './FeedbackBox.jsx'
import { Upload } from 'lucide-react'

// THE TWIN VIEW — "What your fleet knows about you" (Doc 06 §4, Doc 10 §3).
// The Twin is VISIBLE on purpose: a learner who can inspect what the app
// believes about them can correct it, and a corrected Twin teaches better.
// Everything here is the learner's own local data. Export downloads it;
// Delete removes the fleet's memory (Twin + plans + coach letters) — the
// queue, profile and diagnosis stay, and the fleet simply starts learning
// again from the next session, which the copy says out loud.

// Method labels are chrome — resolved via i18n (twin.method.*) inside TwinView.

// Yonde Reader on Telegram (Doc 16, R0). The working bot name from
// Doc 16 §6 — Landry still owes the handle confirmation, so it lives in
// exactly one constant. Linking flow: this card mints a one-time code
// into telegram_links (owner-only RLS, migration 00009); the reader-bot
// function claims it when the learner taps the deep link and presses
// Start. Honest scope copy: R0 is /read on demand — the morning passage
// is R1 and is NOT promised here.
const READER_BOT_USERNAME = 'YondeReaderBot'
const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L — codes get read aloud

function makeLinkCode() {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => LINK_CODE_ALPHABET[b % LINK_CODE_ALPHABET.length]).join('')
}

function ReaderLinkCard({ user, setActive }) {
  const { t } = useLanguage()
  const [status, setStatus] = useState('loading') // loading | setup | unlinked | pending | linked
  const [link, setLink] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    if (!isSupabaseConfigured || !supabase || !user) { setStatus('setup'); return }
    const { data, error } = await supabase
      .from('telegram_links')
      .select('chat_id, username, link_code, link_expires_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) { setStatus('setup'); return } // table not migrated yet, or unreachable — stay quiet
    setLink(data)
    if (data?.chat_id) setStatus('linked')
    else if (data?.link_code && data.link_expires_at && new Date(data.link_expires_at) > new Date()) setStatus('pending')
    else setStatus('unlinked')
  }

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => { if (!cancelled) refresh() })
    return () => { cancelled = true }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps
  // While a code is waiting, re-check when the learner comes back from
  // Telegram — the claim happens there, not here.
  useEffect(() => {
    if (status !== 'pending') return undefined
    const onFocus = () => { refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    if (!user || busy) return
    setBusy(true)
    const code = makeLinkCode()
    const expires = new Date(Date.now() + 30 * 60000).toISOString()
    const { error } = await supabase
      .from('telegram_links')
      .upsert({ user_id: user.id, link_code: code, link_expires_at: expires }, { onConflict: 'user_id' })
    setBusy(false)
    if (error) { setStatus('setup'); return }
    setLink({ chat_id: null, username: null, link_code: code, link_expires_at: expires })
    setStatus('pending')
  }

  const unlink = async () => {
    if (!user || busy) return
    setBusy(true)
    const { error } = await supabase
      .from('telegram_links')
      .update({ chat_id: null, username: null, linked_at: null })
      .eq('user_id', user.id)
    setBusy(false)
    if (!error) { setLink(null); setStatus('unlinked') }
  }

  return (
    <Section title={t('twin.reader.title')} hint={t('twin.reader.hint')}>
      {status === 'loading' && <p className="text-sm text-slate-400">{t('twin.reader.checking')}</p>}
      {status === 'setup' && (
        <p className="text-sm text-slate-300">
          {user
            ? t('twin.reader.setupSignedIn')
            : t('twin.reader.setupSignedOut')}
        </p>
      )}
      {status === 'unlinked' && (
        <div className="space-y-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5"><Mascot agent="hori" size={28} showName={false} /></span>
            <p className="text-sm text-slate-300">{t('twin.reader.unlinkedIntro')} <span className="text-slate-100 font-medium">/read</span>{t('twin.reader.unlinkedOutro')}</p>
          </div>
          <button onClick={connect} disabled={busy} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] disabled:opacity-40 text-white text-sm font-semibold flex items-center gap-1.5"><Send size={15} /> {t('twin.reader.connect')}</button>
        </div>
      )}
      {status === 'pending' && link?.link_code && (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">{t('twin.reader.pendingTap')} <span className="text-slate-100 font-medium">{t('twin.reader.openTelegram')}</span>{t('twin.reader.pendingThenPress')} <span className="text-slate-100 font-medium">{t('twin.reader.pendingStart')}</span> {t('twin.reader.pendingRest', { bot: READER_BOT_USERNAME })} <span className="font-mono text-slate-100">/start {link.link_code}</span>.</p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`https://t.me/${READER_BOT_USERNAME}?start=${link.link_code}`} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold flex items-center gap-1.5"><Send size={15} /> {t('twin.reader.openTelegram')}</a>
            <span className="font-mono text-sm text-slate-200 bg-bun-800 border border-bun-600/40 rounded-lg px-2.5 py-1.5">{link.link_code}</span>
            <button onClick={refresh} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">{t('twin.reader.refreshStatus')}</button>
          </div>
        </div>
      )}
      {status === 'linked' && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-300 flex-1 min-w-[220px]">
            {t('twin.reader.connected')}{link?.username ? <> {t('twin.reader.connectedAs')} <span className="text-slate-100 font-medium">@{link.username}</span></> : ''} {t('twin.reader.connectedSuffix')} <span className="text-slate-100 font-medium">/read</span> {t('twin.reader.connectedOutro')}
          </p>
          <button onClick={unlink} disabled={busy} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 disabled:opacity-40 text-slate-100 text-sm font-medium">{t('twin.reader.unlink')}</button>
        </div>
      )}
      {status !== 'loading' && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <p className="text-sm text-slate-400 flex-1 min-w-[220px]">{t('twin.reader.shelf')}</p>
          <button onClick={() => setActive?.('reader')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5"><BookOpenText size={15} /> {t('twin.reader.openHere')}</button>
        </div>
      )}
    </Section>
  )
}

// Working level (Doc 04 §5 note; src/lib/twinEstimate.js): between
// checkups, the learner's activity — queue mastery by level, call
// scores, the Reader's proven fit — adds up to a working level. It is
// computed on read from evidence already held, stored NOWHERE, and it
// never overwrites the diagnosis, the promise, or any stored band:
// those stay exactly what their own code paths wrote.
function WorkingLevelCard({ user }) {
  const { t } = useLanguage()
  const [readerEvidence, setReaderEvidence] = useState({ declaredBand: null, lastGoodStep: 0 })
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!isSupabaseConfigured || !supabase || !user) return
      const res = await supabase
        .from('telegram_links')
        .select('declared_band, last_good_step')
        .eq('user_id', user.id)
        .maybeSingle()
      if (cancelled) return
      if (!res.error && res.data) {
        setReaderEvidence({ declaredBand: res.data.declared_band ?? null, lastGoodStep: Number(res.data.last_good_step ?? 0) || 0 })
        return
      }
      const fallback = await supabase
        .from('telegram_links')
        .select('declared_band')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!cancelled && !fallback.error && fallback.data) {
        setReaderEvidence({ declaredBand: fallback.data.declared_band ?? null, lastGoodStep: 0 })
      }
    }
    load()
    return () => { cancelled = true }
  }, [user])

  const state = collectLearnerState()
  const twinNow = loadTwin()
  const est = estimateWorkingLevel({
    diagnosisBand: typeof state.diagnosis?.jlptEstimate === 'string' ? state.diagnosis.jlptEstimate : null,
    queueItems: state.queue,
    speaking: twinNow.speaking,
    declaredBand: readerEvidence.declaredBand,
    lastGoodStep: readerEvidence.lastGoodStep,
  })
  const confidenceLine = {
    low: t('twin.working.confLow'),
    medium: t('twin.working.confMedium'),
    high: t('twin.working.confHigh'),
  }[est.confidence]
  const confidenceWord = {
    low: t('twin.working.confWordLow'),
    medium: t('twin.working.confWordMedium'),
    high: t('twin.working.confWordHigh'),
  }[est.confidence]

  return (
    <Section title={t('twin.working.title')} hint={t('twin.working.hint')}>
      {est.band ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="text-3xl font-bold text-white">{est.band}</p>
          <p className="text-sm text-slate-300">{t('twin.working.confidenceLabel')} <span className="text-[#FF8A75] font-medium">{confidenceWord}</span> — {confidenceLine}.</p>
        </div>
      ) : (
        <p className="text-sm text-slate-300">{t('twin.working.empty')}</p>
      )}
      <p className="text-xs text-slate-500">{t('twin.working.footnote')}</p>
    </Section>
  )
}

// Your Level (2026-11-07): the level question gets a home in the app.
// Until now the one-tap declaration existed only in Telegram (Doc 16
// §5 amendment #3). This card asks the same question here and writes
// the SAME contract the bot reads — state.declaredLevel = { band, at }
// via learnerState.saveDeclaredLevel — resolved by lib/levelBasis.js:
// diagnosis > declaration > none, 'N7' floored to N5 with foundations
// pace while it is the winning basis. "Not Sure" records nothing and
// points at the checkup, the real answer.
function YourLevelCard({ setActive }) {
  const { t } = useLanguage()
  const [declared, setDeclared] = useState(() => loadDeclaredLevel())
  const [justPicked, setJustPicked] = useState(null)
  const [notSure, setNotSure] = useState(false)
  const state = collectLearnerState()
  const diagnosisBand = typeof state.diagnosis?.jlptEstimate === 'string' ? state.diagnosis.jlptEstimate : null
  const basis = resolveLevelBasis({ diagnosisBand, declaredLevel: declared })
  const declaredDisplay = basis.rawBand === 'N7' ? 'N7+ 😂' : basis.rawBand

  const pick = (band) => {
    setDeclared(saveDeclaredLevel(band))
    setJustPicked(band)
    setNotSure(false)
  }
  const pickNotSure = () => { setNotSure(true); setJustPicked(null) }

  const bandButton = (band, label) => {
    const active = declared?.band === band
    return (
      <button
        key={band}
        onClick={() => pick(band)}
        aria-pressed={active}
        className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${active
          ? 'bg-[#FF6B57]/15 border-[#FF6B57] text-white'
          : 'bg-bun-700 hover:bg-bun-600 border-white/10 text-slate-200'}`}
      >
        {label}
      </button>
    )
  }

  return (
    <Section title={t('twin.level.title')} hint={t('twin.level.hint')}>
      {basis.source === 'diagnosis' && (
        <div className="space-y-1">
          <p className="text-3xl font-bold text-white">{basis.band}</p>
          <p className="text-sm text-slate-300">{t('twin.level.fromCheckup')}</p>
          <p className="text-sm text-slate-400">{t('twin.level.checkupOutranks')}</p>
          {declared && <p className="text-xs text-slate-500">{t('twin.level.onRecord', { band: declaredDisplay })}</p>}
        </div>
      )}
      {basis.source === 'declared' && basis.rawBand === 'N7' && (
        <div className="space-y-1">
          <p className="text-3xl font-bold text-white">N7+ 😂</p>
          <p className="text-sm text-slate-300">{t('twin.level.n7Heard')}</p>
          <p className="text-sm text-slate-300"><span className="text-[#FF8A75] font-medium">{t('twin.level.foundationsPace')}</span> {t('twin.level.foundationsRest')}</p>
        </div>
      )}
      {basis.source === 'declared' && basis.rawBand !== 'N7' && (
        <div className="space-y-1">
          <p className="text-3xl font-bold text-white">{basis.band}</p>
          <p className="text-sm text-slate-300">{t('twin.level.youToldUs', { band: declaredDisplay })}</p>
        </div>
      )}
      {basis.source === 'none' && (
        <div className="space-y-1">
          <p className="text-xl font-bold text-white">{t('twin.level.notSet')}</p>
          <p className="text-sm text-slate-300">{t('twin.level.notSetHint')}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {['N5', 'N4', 'N3', 'N2', 'N1'].map((b) => bandButton(b, b))}
        {bandButton('N7', 'N7+ 😂')}
        <button
          onClick={pickNotSure}
          className="px-3.5 py-2 rounded-xl text-sm font-medium border border-white/10 bg-transparent hover:bg-white/5 text-slate-300 transition-colors"
        >
          {t('twin.level.notSure')}
        </button>
      </div>

      {justPicked === 'N7' && (
        <p className="text-sm text-[#FF8A75]">{t('twin.level.n7Picked')}</p>
      )}
      {justPicked && justPicked !== 'N7' && (
        <p className="text-sm text-[#FF8A75]">{basis.source === 'diagnosis'
          ? t('twin.level.notedDiagnosis', { band: justPicked })
          : t('twin.level.noted', { band: justPicked })}</p>
      )}
      {notSure && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">{t('twin.level.notSureLine')}</p>
          <button onClick={() => setActive?.('diagnosis')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium inline-flex items-center gap-1">
            {t('twin.level.takeCheckup')} <ChevronRight size={14} />
          </button>
        </div>
      )}
      <p className="text-xs text-slate-500">{t('twin.level.footer')}</p>
    </Section>
  )
}

function Section({ title, children, hint }) {
  return (
    <section className="rounded-2xl glass p-5 card-glow space-y-3">
      <div>
        <h3 className="text-lg font-bold text-white">{title}</h3>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export default function TwinView({ setActive }) {
  const { lang, setLang, languages, t } = useLanguage()
  const [twin, setTwin] = useState(() => refreshTwin())
  // Quiet sync state (Doc 04 §3): signed out, the Twin lives on this
  // device only; signed in, it mirrors to the learner's account. Shown as
  // one plain line under the header — never a badge, never a nag.
  const [syncState, setSyncState] = useState(() => getTwinSyncState())
  useEffect(() => subscribeTwinSync(setSyncState), [])
  const [stateSyncState, setStateSyncState] = useState(() => getStateSyncState())
  useEffect(() => subscribeStateSync(setStateSyncState), [])
  const [restoreReport, setRestoreReport] = useState(null)
  const [restoreError, setRestoreError] = useState('')
  useEffect(() => {
    const onSynced = () => setTwin(refreshTwin())
    window.addEventListener(TWIN_SYNC_EVENT, onSynced)
    return () => window.removeEventListener(TWIN_SYNC_EVENT, onSynced)
  }, [])
  const { user, signOut } = useAuth()
  const [delStep, setDelStep] = useState('idle') // idle | confirm | working | done
  const [delAgreed, setDelAgreed] = useState(false)
  const [delResult, setDelResult] = useState(null)
  const [deleted, setDeleted] = useState(false)
  const { meta } = detectMode()
  const methodLabels = {
    voice: t('twin.method.voice'),
    mining: t('twin.method.mining'),
    listening: t('twin.method.listening'),
    reading: t('twin.method.reading'),
  }
  const patterns = topPatterns(twin, 8)
  const rows = learningStyleRows(twin)
  const deltas = diagnosisDeltas()
  const persona = PERSONAS.find((p) => p.id === twin.life?.persona)
  const target = PROOF_TARGETS.find((t) => t.id === twin.life?.proofTarget)
  const kept = twin.rhythm.callsKept || 0
  const missed = twin.rhythm.callsMissed || 0

  const exportTwin = () => {
    const blob = new Blob([JSON.stringify(loadTwin(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'my-learner-twin.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Backup restore (P0-1): the export used to be a dead end. Restoring
  // MERGES (restore.js): the queue unions, newer documents win, other
  // keys only fill gaps — a backup can never shrink what this device has
  // learned. Counts are reported before the learner reloads.
  const runRestore = async (file) => {
    setRestoreError(''); setRestoreReport(null)
    if (!file) return
    let parsed
    try { parsed = JSON.parse(await file.text()) } catch { setRestoreError(t('twin.privacy.restoreUnreadable')); return }
    const v = validateExport(parsed)
    if (!v.ok) { setRestoreError(v.reason); return }
    const { writes, report } = planRestore(collectAllLocalData(), v.data)
    try {
      for (const [k, val] of Object.entries(writes)) localStorage.setItem(k, JSON.stringify(val))
    } catch { setRestoreError(t('twin.privacy.restoreRefused')); return }
    setRestoreReport(report)
  }

  // Full account + data deletion (Doc 15 — Apple 5.1.1(v), Play deletion
  // policy). Export is offered first; the wipe removes EVERY app key on
  // this device; the server account delete is attempted honestly and its
  // real result is reported in the result panel.
  const runAccountDeletion = async () => {
    setDelStep('working')
    const server = await requestServerAccountDeletion()
    const removed = wipeAllLocalData()
    if (user) { try { await signOut() } catch { /* already gone */ } }
    setDelResult({ removed, server })
    setDelStep('done')
  }

  const wipe = () => {
    if (!window.confirm(t('twin.fleet.confirmDelete'))) return
    deleteTwin()
    setDeleted(true)
  }

  if (deleted) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-4">
        <h2 className="text-2xl font-bold text-white">{t('twin.deleted.title')}</h2>
        <p className="text-sm text-slate-300 max-w-md mx-auto">{t('twin.deleted.body')}</p>
        <button onClick={() => setActive?.('dashboard')} className="px-5 py-2.5 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold">{t('twin.backToToday')}</button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('twin.header.title')}</h2>
        <p className="text-sm text-slate-400 mt-1">{t('twin.header.intro', { brand: brand.name })} <span className="text-slate-300">{brand.tagline}.</span></p>
        <p className="text-xs text-slate-500 mt-1.5">{t('twin.header.fleetMemory')} {syncState === 'local-only'
          ? t('twin.header.syncLocalOnly')
          : syncState === 'synced'
            ? t('twin.header.syncSynced')
            : syncState === 'syncing'
              ? t('twin.header.syncSyncing')
              : t('twin.header.syncRetry')}</p>
        <p className="text-xs text-slate-500 mt-1">{t('twin.header.queueLine')} {stateSyncState === 'local-only'
          ? t('twin.header.stateLocalOnly')
          : stateSyncState === 'synced'
            ? t('twin.header.stateSynced')
            : stateSyncState === 'syncing'
              ? t('twin.header.syncSyncing')
              : t('twin.header.syncRetry')}</p>
      </div>

      {/* The Loop entry (Doc 05 §11): the fleet-togetherness view. The
          line-up below says WHO the fleet is; the Loop shows them
          WORKING — one cycle around the Twin, with live numbers. */}
      <button
        onClick={() => setActive?.('loop')}
        className="w-full text-left rounded-2xl glass p-5 card-glow flex items-center gap-4 hover:bg-white/[0.04] transition-colors"
      >
        <Mascot agent="michi" size={46} showName={false} motion="none" />
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold text-white">{t('twin.loopEntry.title')}</span>
          <span className="block text-sm text-slate-400 mt-0.5">{t('twin.loopEntry.hint')}</span>
        </span>
        <ChevronRight size={18} className="text-slate-400 shrink-0" />
      </button>

      {/* Fleet line-up (Doc 06 §3: the line-up belongs here and on the letter) */}
      <section className="rounded-2xl glass p-5 card-glow">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {brand.fleet.map((m) => (
            <div key={m.id} className="flex items-start gap-2.5">
              <Mascot agent={m.id} size={38} showName={false} />
              <div>
                <p className="text-sm font-bold text-white">{m.name} <span className="text-slate-400 font-medium">· {m.kanji}</span></p>
                <p className="text-xs text-[#FF8A75]">{m.role}</p>
                <p className="text-xs text-slate-400 mt-0.5">{m.job}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <ReaderLinkCard user={user} setActive={setActive} />

      <Section title={t('twin.stands.title')} hint={t('twin.stands.hint')}>
        {Object.keys(twin.sections || {}).length ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {SECTION_KEYS.map((s) => {
              const sec = twin.sections[s.id]
              if (!sec) return null
              return (
                <div key={s.id} className="rounded-xl bg-bun-700/40 border border-bun-600/30 p-4">
                  <p className="text-xs text-slate-400">{s.label}</p>
                  <p className="text-2xl font-bold text-white">{sec.score}<span className="text-sm text-slate-400">/60</span></p>
                  {sec.trend?.length > 1 && <p className="text-xs text-slate-400 mt-1">{t('twin.stands.trend', { trend: sec.trend.join(' → ') })}</p>}
                  <p className="text-xs mt-1">{sec.score < 19 ? <span className="text-amber-300">{t('twin.stands.belowLine')}</span> : <span className="text-emerald-300">{t('twin.stands.aboveLine')}</span>}</p>
                </div>
              )
            })}
          </div>
        ) : <p className="text-sm text-slate-300">{t('twin.stands.empty')}</p>}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-300">
          <p>{t('twin.stands.speaking', { scenes: twin.speaking.masteredScenes || 0, avg: twin.speaking.avgBest ?? '—' })}</p>
          <p>{t('twin.stands.register', { bjt: twin.register.bjtBand ? (twin.register.bjtScore ? t('twin.stands.bjtWithScore', { band: twin.register.bjtBand, score: twin.register.bjtScore }) : t('twin.stands.bjt', { band: twin.register.bjtBand })) : '', attempts: twin.register.keigoAttempts || 0 })}</p>
        </div>
        {deltas && <p className="text-xs text-slate-500">{t('twin.stands.deltas', { total: deltas.total > 0 ? `+${deltas.total}` : deltas.total })}</p>}
      </Section>

      <YourLevelCard setActive={setActive} />

      <WorkingLevelCard user={user} />

      <Section title={t('twin.trips.title')} hint={t('twin.trips.hint')}>
        {patterns.length ? (
          <ul className="space-y-2">
            {patterns.map((p) => (
              <li key={p.id} className="flex items-start gap-3 rounded-xl bg-bun-700/40 border border-bun-600/20 p-3.5">
                <span className="mt-0.5"><Mascot agent="nao" size={26} showName={false} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{p.label} <span className="text-xs font-normal text-slate-400">{t('twin.trips.seen', { count: p.count, date: p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleDateString() : '—' })}</span></p>
                  <p className="text-xs text-slate-400 mt-0.5">{patternById(p.id)?.plain}</p>
                  {p.example && <p className="text-xs text-slate-500 mt-1 truncate">{t('twin.trips.yourWords', { example: p.example })}</p>}
                </div>
                <button onClick={() => setTwin(removePattern(p.id))} className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-bun-800 border border-bun-600/40 text-slate-400 hover:text-white transition"><X size={12} /> {t('twin.trips.remove')}</button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-300">{t('twin.trips.empty')}</p>}
      </Section>

      <Section title={t('twin.learn.title')} hint={t('twin.learn.hint')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl bg-bun-700/40 border border-bun-600/30 p-3.5">
              <p className="text-sm font-semibold text-white">{methodLabels[r.id] || r.id}</p>
              <p className="text-xs text-slate-400 mt-1">{t('twin.learn.rowStats', { trials: r.trials, proof: r.proof })}{r.proofPerHour !== null ? ` · ${t('twin.learn.perHour', { perHour: r.proofPerHour })}` : ''}</p>
              <p className="text-xs mt-0.5"><span className="text-[#FF8A75]">{t('twin.learn.confidence', { confidence: r.confidence })}</span></p>
            </div>
          ))}
        </div>
        {twin.learningStyle?.note && (
          <div className="rounded-xl bg-sky-500/10 border border-sky-500/25 p-3.5 flex items-start gap-2.5">
            <Mascot agent="saki" size={28} showName={false} />
            <p className="text-sm text-slate-200"><span className="font-semibold text-white">{t('twin.learn.sakiNote')}</span> {twin.learningStyle.note}</p>
          </div>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t('twin.life.title')} hint={t('twin.life.hint')}>
          <ul className="text-sm text-slate-300 space-y-1.5">
            <li><span className="text-slate-500">{t('twin.life.youAre')}</span> {persona?.label || t('twin.life.notSet')}</li>
            <li><span className="text-slate-500">{t('twin.life.whatHurts')}</span> {(twin.life?.pains || []).map((id) => PAINS.find((p) => p.id === id)?.label).filter(Boolean).join(' · ') || t('twin.life.notSet')}</li>
            <li><span className="text-slate-500">{t('twin.life.climbing')}</span> {target?.label || t('twin.life.notSet')}</li>
          </ul>
          <button onClick={() => setActive?.('dashboard')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1">{t('twin.life.changeProblem')} <ChevronRight size={14} /></button>
        </Section>

        <Section title={t('twin.rhythm.title')} hint={t('twin.rhythm.hint')}>
          <ul className="text-sm text-slate-300 space-y-1.5">
            <li><span className="text-slate-500">{t('twin.rhythm.sessions')}</span> {t('twin.rhythm.sessionsValue', { count: (twin.rhythm.sessionLog || []).length, date: twin.rhythm.lastSessionAt ? new Date(twin.rhythm.lastSessionAt).toLocaleDateString() : '—' })}</li>
            <li><span className="text-slate-500">{t('twin.rhythm.calls')}</span> {kept + missed ? t('twin.rhythm.callsValue', { kept, total: kept + missed }) : t('twin.rhythm.callsNone')}</li>
            <li><span className="text-slate-500">{t('twin.rhythm.feltEffort')}</span> {(twin.rhythm.feltEffortRecent || []).slice(-3).join(' · ') || t('twin.rhythm.notAnswered')}</li>
            {(() => { const m = summariseMetrics(loadMetrics()); return (
              <li><span className="text-slate-500">{t('twin.rhythm.proofPace')}</span> {m.minutesPerProofPoint !== null
                ? <>{t(m.sessions === 1 ? 'twin.rhythm.proofValueOne' : 'twin.rhythm.proofValue', { per: m.minutesPerProofPoint, minutes: m.minutes, sessions: m.sessions, proof: m.proofPoints, kept: m.callsKept, partial: m.callsPartial, missed: m.callsMissed })}</>
                : t('twin.rhythm.proofNone')}</li>) })()}
            <li className="flex items-center gap-2 pt-1"><Mascot agent="michi" size={28} showName={false} /><span><span className="text-slate-500">{t('twin.rhythm.rightNow')}</span> {meta.label} {t('twin.rhythm.rightNowSuffix')}</span></li>
          </ul>
          <button onClick={() => setActive?.('coach')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1"><Mail size={14} /> {t('twin.rhythm.readLetter')}</button>
        </Section>
      </div>

      <Section title={t('twin.words.title')} hint={t('twin.words.hint')}>
        <p className="text-sm text-slate-300">{t('twin.words.stats', { total: twin.vocab.queueTotal, graduated: twin.vocab.graduated, fresh: twin.vocab.fresh })}</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(twin.vocab.bySource || {}).map(([src, n]) => (
            <span key={src} className="text-xs px-2 py-1 rounded-full bg-bun-800 border border-bun-600/40 text-slate-300">{src}: {n}</span>
          ))}
        </div>
      </Section>

      <section className="rounded-2xl border border-bun-600/30 p-5 flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-300 flex-1 min-w-[220px]">{t('twin.fleet.text')}</p>
        <button onClick={exportTwin} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5"><Download size={15} /> {t('twin.fleet.export')}</button>
        <button onClick={wipe} className="px-4 py-2 rounded-xl bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/30 text-rose-200 text-sm font-medium flex items-center gap-1.5"><Trash2 size={15} /> {t('twin.fleet.delete')}</button>
      </section>

      <Section title={t('settings.language')} hint={t('settings.languageHint')}>
        <div className="flex flex-wrap gap-2">
          {languages.map((entry) => {
            const active = lang === entry.id
            return (
              <button
                key={entry.id}
                onClick={() => setLang(entry.id)}
                aria-pressed={active}
                className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${active
                  ? 'bg-[#FF6B57]/15 border-[#FF6B57] text-white'
                  : 'bg-bun-700 hover:bg-bun-600 border-white/10 text-slate-200'}`}
              >
                {entry.label}
              </button>
            )
          })}
        </div>
      </Section>

      <section className="rounded-2xl border border-bun-600/30 p-5 space-y-4">
        <div>
          <h3 className="text-lg font-bold text-white">{t('twin.privacy.title')}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{t('twin.privacy.hint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setActive?.('privacy')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">{t('twin.privacy.policy')}</button>
          <button onClick={() => setActive?.('terms')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">{t('twin.privacy.terms')}</button>
          <button onClick={downloadAllLocalData} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5"><Download size={15} /> {t('twin.privacy.exportAll')}</button>
          <label className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5 cursor-pointer">
            <Upload size={15} /> {t('twin.privacy.restore')}
            <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { runRestore(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        </div>
        <p className="text-xs text-slate-500">{t('twin.privacy.restoreNote')}</p>
        {restoreError && <p className="text-sm text-rose-300">{restoreError}</p>}
        {restoreReport && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 space-y-2">
            <p className="text-sm font-bold text-white">{t('twin.privacy.mergedTitle')}</p>
            <p className="text-sm text-slate-300">
              {t('twin.privacy.queueMerged', { before: restoreReport.queueBefore, after: restoreReport.queueAfter, added: restoreReport.queueAdded })}
              {restoreReport.historyAfter > restoreReport.historyBefore && <> {t('twin.privacy.historyGrew', { n: restoreReport.historyAfter - restoreReport.historyBefore })}</>}
              {restoreReport.twin === 'updated' && <> {t('twin.privacy.twinUpdated')}</>}
              {restoreReport.slicesUpdated.length > 0 && <> {t('twin.privacy.updated', { list: restoreReport.slicesUpdated.map((k) => k.replace('jpn:', '').replace(':v1', '')).join(', ') })}</>}
              {restoreReport.restoredKeys > 0 && <> {t(restoreReport.restoredKeys === 1 ? 'twin.privacy.otherFilled' : 'twin.privacy.otherFilledPlural', { n: restoreReport.restoredKeys })}</>}
            </p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold">{t('twin.privacy.reload')}</button>
          </div>
        )}

        <FeedbackBox context="fleet-account" />

        {delStep === 'idle' && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-300 flex-1 min-w-[220px]">{t('twin.account.leaving', { brand: brand.name })}</p>
            <button onClick={() => setDelStep('confirm')} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold">{t('twin.account.deleteButton')}</button>
          </div>
        )}

        {delStep === 'confirm' && (
          <div className="rounded-xl bg-rose-600/10 border border-rose-500/30 p-4 space-y-3">
            <p className="text-sm font-bold text-white">{t('twin.account.whatHappens')}</p>
            <ul className="text-sm text-slate-300 space-y-1.5 list-disc pl-5">
              <li>{t('twin.account.liDevice')}</li>
              <li>{user ? t('twin.account.liServerUser') : t('twin.account.liServerGuest')} {t('twin.account.liCaveat')}</li>
              <li>{t('twin.account.liUndo')}</li>
            </ul>
            <label className="flex items-start gap-2 text-sm text-slate-200 cursor-pointer">
              <input type="checkbox" checked={delAgreed} onChange={(e) => setDelAgreed(e.target.checked)} className="mt-0.5" />
              {t('twin.account.checkbox')}
            </label>
            <div className="flex flex-wrap gap-2">
              <button onClick={downloadAllLocalData} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">{t('twin.account.exportFirst')}</button>
              <button onClick={runAccountDeletion} disabled={!delAgreed} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-semibold">{t('twin.account.yesDelete')}</button>
              <button onClick={() => setDelStep('idle')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">{t('twin.account.keep')}</button>
            </div>
          </div>
        )}

        {delStep === 'working' && <p className="text-sm text-slate-300">{t('twin.account.deleting')}</p>}

        {delStep === 'done' && delResult && (
          <div className="rounded-xl bg-bun-700/40 border border-bun-600/30 p-4 space-y-2">
            <p className="text-sm font-bold text-white">{t('twin.account.doneTitle')}</p>
            <p className="text-sm text-slate-300">{t(delResult.removed === 1 ? 'twin.account.doneDeviceOne' : 'twin.account.doneDevice', { n: delResult.removed })}</p>
            <p className="text-sm text-slate-300">
              {delResult.server === 'deleted' && t('twin.account.serverDeleted')}
              {delResult.server === 'not-signed-in' && t('twin.account.serverNotSignedIn')}
              {delResult.server === 'not-configured' && t('twin.account.serverNotConfigured')}
              {delResult.server === 'pending-server' && t('twin.account.serverPending')}
            </p>
            <button onClick={() => setActive?.('dashboard')} className="px-4 py-2 rounded-xl bg-[#FF6B57] hover:bg-[#FF7F6E] text-white text-sm font-semibold">{t('twin.backToToday')}</button>
          </div>
        )}
      </section>
    </div>
  )
}
