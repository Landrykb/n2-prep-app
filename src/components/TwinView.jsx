import { useEffect, useState } from 'react'
import { Download, Trash2, Mail, ChevronRight, X } from 'lucide-react'
import { brand } from '../lib/brand.js'
import {
  refreshTwin, loadTwin, deleteTwin, topPatterns, removePattern,
  learningStyleRows, diagnosisDeltas, patternById,
} from '../lib/twin.js'
import { detectMode } from '../lib/modes.js'
import { PERSONAS, PAINS, PROOF_TARGETS } from '../lib/profile.js'
import { SECTION_KEYS } from '../lib/levels.js'
import Mascot from './Mascot.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { downloadAllLocalData, wipeAllLocalData, requestServerAccountDeletion } from '../lib/accountDeletion.js'
import { getTwinSyncState, subscribeTwinSync, TWIN_SYNC_EVENT } from '../lib/twinSync.js'
import { getStateSyncState, subscribeStateSync } from '../lib/stateSync.js'
import { validateExport, planRestore } from '../lib/restore.js'
import { loadMetrics, summariseMetrics } from '../lib/metrics.js'
import FeedbackBox from './FeedbackBox.jsx'
import { Upload } from 'lucide-react'

// THE TWIN VIEW — "What your fleet knows about you" (Doc 06 §4, Doc 10 §3).
// The Twin is VISIBLE on purpose: a learner who can inspect what the app
// believes about them can correct it, and a corrected Twin teaches better.
// Everything here is the learner's own local data. Export downloads it;
// Delete removes the fleet's memory (Twin + plans + coach letters) — the
// queue, profile and diagnosis stay, and the fleet simply starts learning
// again from the next session, which the copy says out loud.

const METHOD_LABELS = {
  voice: 'Speaking — scenes & calls',
  mining: 'Cards from your own documents',
  listening: 'Listening bites',
  reading: 'Reading checks',
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
    try { parsed = JSON.parse(await file.text()) } catch { setRestoreError('That file could not be read as JSON — nothing was restored.'); return }
    const v = validateExport(parsed)
    if (!v.ok) { setRestoreError(v.reason); return }
    const { writes, report } = planRestore(collectAllLocalData(), v.data)
    try {
      for (const [k, val] of Object.entries(writes)) localStorage.setItem(k, JSON.stringify(val))
    } catch { setRestoreError('This device refused part of the restore (storage may be full) — some items may not have been written. Nothing was deleted.'); return }
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
    if (!window.confirm('Delete what your fleet has learned about you? Your queue, your problem profile and your diagnosis stay. The fleet starts learning again from your next session.')) return
    deleteTwin()
    setDeleted(true)
  }

  if (deleted) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-4">
        <h2 className="text-2xl font-bold text-white">Fleet memory deleted</h2>
        <p className="text-sm text-slate-300 max-w-md mx-auto">Your Twin, Saki’s plans and Michi’s letters on this device are gone. Your queue, your problem and your diagnosis are untouched. From your next session, the fleet starts learning you again — that is the whole deal, and it is yours to restart or not.</p>
        <button onClick={() => setActive?.('dashboard')} className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">Back To Today</button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-white">What Your Fleet Knows About You</h2>
        <p className="text-sm text-slate-400 mt-1">{brand.name} keeps a model of your Japanese — your Twin — so every session is built for you, not for an average learner. It lives on this device, it is yours to inspect, correct, export or delete. <span className="text-slate-300">{brand.tagline}.</span></p>
        <p className="text-xs text-slate-500 mt-1.5">Fleet memory: {syncState === 'local-only'
          ? 'this device only'
          : syncState === 'synced'
            ? 'synced to your account'
            : syncState === 'syncing'
              ? 'syncing to your account…'
              : 'on this device — sync will retry'}</p>
        <p className="text-xs text-slate-500 mt-1">Your queue, problem, diagnosis and promise: {stateSyncState === 'local-only'
          ? 'on this device only — sign in and they follow you'
          : stateSyncState === 'synced'
            ? 'synced to your account — a new phone picks up where this one left off'
            : stateSyncState === 'syncing'
              ? 'syncing to your account…'
              : 'on this device — sync will retry'}</p>
      </div>

      {/* Fleet line-up (Doc 06 §3: the line-up belongs here and on the letter) */}
      <section className="rounded-2xl glass p-5 card-glow">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {brand.fleet.map((m) => (
            <div key={m.id} className="flex items-start gap-2.5">
              <Mascot agent={m.id} size={38} showName={false} />
              <div>
                <p className="text-sm font-bold text-white">{m.name} <span className="text-slate-400 font-medium">· {m.kanji}</span></p>
                <p className="text-xs text-violet-300">{m.role}</p>
                <p className="text-xs text-slate-400 mt-0.5">{m.job}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Section title="Where Your Japanese Stands" hint="Section scores come only from your health checks (estimates from short samples — never official scores). Speaking and register are labelled heuristic: patterns counted, not sounds judged.">
        {Object.keys(twin.sections || {}).length ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {SECTION_KEYS.map((s) => {
              const sec = twin.sections[s.id]
              if (!sec) return null
              return (
                <div key={s.id} className="rounded-xl bg-bun-700/40 border border-bun-600/30 p-4">
                  <p className="text-xs text-slate-400">{s.label}</p>
                  <p className="text-2xl font-bold text-white">{sec.score}<span className="text-sm text-slate-400">/60</span></p>
                  {sec.trend?.length > 1 && <p className="text-xs text-slate-400 mt-1">Trend: {sec.trend.join(' → ')}</p>}
                  <p className="text-xs mt-1">{sec.score < 19 ? <span className="text-amber-300">Below the 19/60 survival line — the rescue target</span> : <span className="text-emerald-300">Above the survival line</span>}</p>
                </div>
              )
            })}
          </div>
        ) : <p className="text-sm text-slate-300">No health check yet — run the 10-minute Diagnosis once and this fills in with your real sections, not a guess.</p>}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-300">
          <p>Speaking (heuristic): {twin.speaking.masteredScenes || 0} scenes mastered · average attempt score {twin.speaking.avgBest ?? '—'}%</p>
          <p>Register (heuristic): {twin.register.bjtBand ? `BJT estimate ${twin.register.bjtBand}${twin.register.bjtScore ? ` (~${twin.register.bjtScore})` : ''} · ` : ''}{twin.register.keigoAttempts || 0} business/keigo attempts counted</p>
        </div>
        {deltas && <p className="text-xs text-slate-500">Latest movement between checks: total {deltas.total > 0 ? `+${deltas.total}` : deltas.total} — the full trend lives in Diagnosis and in Michi’s letters.</p>}
      </Section>

      <Section title="What Trips You Up" hint="Your error fingerprint — counted from your own attempts by simple local rules (a heuristic: it spots likely patterns, it does not grade like a teacher). Wrong about one? Remove it; your correction outranks the counting, permanently.">
        {patterns.length ? (
          <ul className="space-y-2">
            {patterns.map((p) => (
              <li key={p.id} className="flex items-start gap-3 rounded-xl bg-bun-700/40 border border-bun-600/20 p-3.5">
                <span className="mt-0.5"><Mascot agent="nao" size={26} showName={false} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{p.label} <span className="text-xs font-normal text-slate-400">· seen {p.count}× · last {p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleDateString() : '—'}</span></p>
                  <p className="text-xs text-slate-400 mt-0.5">{patternById(p.id)?.plain}</p>
                  {p.example && <p className="text-xs text-slate-500 mt-1 truncate">Your words: 「{p.example}」</p>}
                </div>
                <button onClick={() => setTwin(removePattern(p.id))} className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-bun-800 border border-bun-600/40 text-slate-400 hover:text-white transition"><X size={12} /> Not Me — Remove</button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-300">Nothing counted yet. As you speak scenes and review cards, the slips that repeat will gather here — that list is what Saki plans around.</p>}
      </Section>

      <Section title="How You Learn Best — So Far" hint="Proof points are a plain proxy: scenes mastered, mined cards graduated, items answered right. Points per hour is shown only as a guide — the confidence words matter more than the decimals.">
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl bg-bun-700/40 border border-bun-600/30 p-3.5">
              <p className="text-sm font-semibold text-white">{METHOD_LABELS[r.id] || r.id}</p>
              <p className="text-xs text-slate-400 mt-1">{r.trials} sessions · {r.proof} proof points{r.proofPerHour !== null ? ` · ~${r.proofPerHour} pts/hour (proxy)` : ''}</p>
              <p className="text-xs mt-0.5"><span className="text-violet-300">Confidence: {r.confidence}</span></p>
            </div>
          ))}
        </div>
        {twin.learningStyle?.note && (
          <div className="rounded-xl bg-sky-500/10 border border-sky-500/25 p-3.5 flex items-start gap-2.5">
            <Mascot agent="saki" size={28} showName={false} />
            <p className="text-sm text-slate-200"><span className="font-semibold text-white">Saki’s method note:</span> {twin.learningStyle.note}</p>
          </div>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Your Life, As The App Knows It" hint="From the problem you named on day one. If life changed, the plan should too.">
          <ul className="text-sm text-slate-300 space-y-1.5">
            <li><span className="text-slate-500">You are:</span> {persona?.label || 'not set yet'}</li>
            <li><span className="text-slate-500">What hurts:</span> {(twin.life?.pains || []).map((id) => PAINS.find((p) => p.id === id)?.label).filter(Boolean).join(' · ') || 'not set yet'}</li>
            <li><span className="text-slate-500">Climbing toward:</span> {target?.label || 'not set yet'}</li>
          </ul>
          <button onClick={() => setActive?.('dashboard')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1">Change My Problem <ChevronRight size={14} /></button>
        </Section>

        <Section title="Your Rhythm" hint="How the days actually go — the fleet plans around this, never against it.">
          <ul className="text-sm text-slate-300 space-y-1.5">
            <li><span className="text-slate-500">Sessions logged:</span> {(twin.rhythm.sessionLog || []).length} recent · last {twin.rhythm.lastSessionAt ? new Date(twin.rhythm.lastSessionAt).toLocaleDateString() : '—'}</li>
            <li><span className="text-slate-500">Calls:</span> {kept + missed ? `${kept} kept of ${kept + missed} recorded` : 'none recorded yet'}</li>
            <li><span className="text-slate-500">Recent felt effort:</span> {(twin.rhythm.feltEffortRecent || []).slice(-3).join(' · ') || 'not answered yet'}</li>
            {(() => { const m = summariseMetrics(loadMetrics()); return (
              <li><span className="text-slate-500">Proof pace (North Star):</span> {m.minutesPerProofPoint !== null
                ? <>{m.minutesPerProofPoint} minutes per proof point — {m.minutes} minutes across {m.sessions} finished session{m.sessions === 1 ? '' : 's'}, {m.proofPoints} proof points. Calls: {m.callsKept} kept · {m.callsPartial} partial · {m.callsMissed} missed (missed costs nothing, ever).</>
                : 'not enough data yet — it is computed from your finished sessions only, never estimated.'}</li>) })()}
            <li className="flex items-center gap-2 pt-1"><Mascot agent="michi" size={28} showName={false} /><span><span className="text-slate-500">Right now:</span> {meta.label} — the plan on Today already matches this.</span></li>
          </ul>
          <button onClick={() => setActive?.('coach')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1"><Mail size={14} /> Read Michi’s Letter</button>
        </Section>
      </div>

      <Section title="Your Words" hint="The ONE queue — every personal card you own, whatever made it.">
        <p className="text-sm text-slate-300">{twin.vocab.queueTotal} cards total · {twin.vocab.graduated} graduated (reviewed 3+ times and holding) · {twin.vocab.fresh} brand new.</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(twin.vocab.bySource || {}).map(([src, n]) => (
            <span key={src} className="text-xs px-2 py-1 rounded-full bg-bun-800 border border-bun-600/40 text-slate-300">{src}: {n}</span>
          ))}
        </div>
      </Section>

      <section className="rounded-2xl border border-bun-600/30 p-5 flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-300 flex-1 min-w-[220px]">This model is yours. Take it with you, or erase the fleet’s memory — the queue, your problem and your diagnosis stay either way.</p>
        <button onClick={exportTwin} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5"><Download size={15} /> Export My Twin</button>
        <button onClick={wipe} className="px-4 py-2 rounded-xl bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/30 text-rose-200 text-sm font-medium flex items-center gap-1.5"><Trash2 size={15} /> Delete Fleet Memory</button>
      </section>

      <section className="rounded-2xl border border-bun-600/30 p-5 space-y-4">
        <div>
          <h3 className="text-lg font-bold text-white">Privacy, Terms And Your Account</h3>
          <p className="text-xs text-slate-500 mt-0.5">Different from Delete Fleet Memory above: that erases only what the fleet learned. This section is everything — all of your data, and your account itself.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setActive?.('privacy')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">Privacy Policy</button>
          <button onClick={() => setActive?.('terms')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">Terms Of Use</button>
          <button onClick={downloadAllLocalData} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5"><Download size={15} /> Export Everything On This Device</button>
          <label className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium flex items-center gap-1.5 cursor-pointer">
            <Upload size={15} /> Restore From A Backup
            <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { runRestore(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        </div>
        <p className="text-xs text-slate-500">Restoring merges with what is on this device — your queue can only grow, newer records win, and nothing here is ever deleted by a restore.</p>
        {restoreError && <p className="text-sm text-rose-300">{restoreError}</p>}
        {restoreReport && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 space-y-2">
            <p className="text-sm font-bold text-white">Backup merged in</p>
            <p className="text-sm text-slate-300">
              Queue: {restoreReport.queueBefore} → {restoreReport.queueAfter} cards ({restoreReport.queueAdded} added).
              {restoreReport.historyAfter > restoreReport.historyBefore && <> Diagnosis history grew by {restoreReport.historyAfter - restoreReport.historyBefore}.</>}
              {restoreReport.twin === 'updated' && <> Your Twin was updated from the backup (it was newer).</>}
              {restoreReport.slicesUpdated.length > 0 && <> Updated: {restoreReport.slicesUpdated.map((k) => k.replace('jpn:', '').replace(':v1', '')).join(', ')}.</>}
              {restoreReport.restoredKeys > 0 && <> {restoreReport.restoredKeys} other saved item{restoreReport.restoredKeys === 1 ? '' : 's'} filled in.</>}
            </p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">Reload To See It Everywhere</button>
          </div>
        )}

        <FeedbackBox context="fleet-account" />

        {delStep === 'idle' && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-300 flex-1 min-w-[220px]">Leaving for good? Delete your account and every piece of data {brand.name} holds about you.</p>
            <button onClick={() => setDelStep('confirm')} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold">Delete My Account And Data</button>
          </div>
        )}

        {delStep === 'confirm' && (
          <div className="rounded-xl bg-rose-600/10 border border-rose-500/30 p-4 space-y-3">
            <p className="text-sm font-bold text-white">What happens, exactly</p>
            <ul className="text-sm text-slate-300 space-y-1.5 list-disc pl-5">
              <li>Everything stored on this device is erased: your Twin, queue, profile, diagnosis, plans, letters, call settings and history — all of it.</li>
              <li>{user ? 'Your server account deletion is requested and your rows are removed with it.' : 'You are not signed in on this device, so there is no server account attached to this data.'} One honest caveat: the server-side delete step is still being finished — if it cannot complete today, the result screen will tell you plainly, and your local data is still fully erased.</li>
              <li>This cannot be undone. If you might come back, export first.</li>
            </ul>
            <label className="flex items-start gap-2 text-sm text-slate-200 cursor-pointer">
              <input type="checkbox" checked={delAgreed} onChange={(e) => setDelAgreed(e.target.checked)} className="mt-0.5" />
              I exported my data, or I am sure I don't need it
            </label>
            <div className="flex flex-wrap gap-2">
              <button onClick={downloadAllLocalData} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">Export Everything First</button>
              <button onClick={runAccountDeletion} disabled={!delAgreed} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-semibold">Yes — Delete Everything</button>
              <button onClick={() => setDelStep('idle')} className="px-4 py-2 rounded-xl bg-bun-700 hover:bg-bun-600 text-slate-100 text-sm font-medium">Keep My Account</button>
            </div>
          </div>
        )}

        {delStep === 'working' && <p className="text-sm text-slate-300">Deleting…</p>}

        {delStep === 'done' && delResult && (
          <div className="rounded-xl bg-bun-700/40 border border-bun-600/30 p-4 space-y-2">
            <p className="text-sm font-bold text-white">Done — here is exactly what happened</p>
            <p className="text-sm text-slate-300">On this device: {delResult.removed} stored item{delResult.removed === 1 ? '' : 's'} erased. Nothing about you remains in this app on this device.</p>
            <p className="text-sm text-slate-300">
              {delResult.server === 'deleted' && 'On the server: your account and its data were deleted.'}
              {delResult.server === 'not-signed-in' && 'On the server: you were not signed in, so there was no account to delete.'}
              {delResult.server === 'not-configured' && 'On the server: this build has no account server connected, so nothing existed there.'}
              {delResult.server === 'pending-server' && 'On the server: the account deletion step could not complete — that part is still being finished on our side. Your data on this device is fully erased; to complete the server deletion, contact us from the Privacy Policy page and we will finish it for you.'}
            </p>
            <button onClick={() => setActive?.('dashboard')} className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">Back To Today</button>
          </div>
        )}
      </section>
    </div>
  )
}
