// Pure Twin merge (Doc 04 §3/§7) — no imports, so it is directly
// node-testable (tests/phase2.test.mjs) and reusable from twinSync.js.
//
// History: this module used to be a whole-document last-writer-wins
// guard (pickNewerTwin below — kept, its rule still describes the
// tie-break for scalar fields). The integration audit (#3) showed
// the cost of applying it to the whole document: the Twin is
// written by recorders on every device, so whichever device saved
// last silently discarded the other's fingerprint, session log and
// counters wholesale — and merely VIEWING the Twin restamped it
// (refreshTwin saves), so two devices alternately overwrote each
// other without either learner doing anything.
//
// mergeTwins replaces the guard on the sync path: the Twin is
// merged BY COLLECTION, the way stateMerge merges the learner-state
// document — monotonic counters take the max, logs union by their
// natural key, per-pattern and per-section entries keep the
// stronger/newer copy, and scalar state (mode, life) follows the
// copy that actually moved most recently (modeSince / updatedAt).
// Nothing either device recorded is lost; derived slices (vocab)
// are recomputed by refreshTwin after the merge anyway.

export function twinTimestamp(twin) {
  const t = Date.parse(twin?.updatedAt || '')
  return Number.isFinite(t) ? t : 0
}

/** Returns 'cloud' when the cloud Twin should be adopted locally, else 'local'. */
export function pickNewerTwin(localTwin, cloudTwin) {
  if (!cloudTwin) return 'local'
  if (!localTwin) return 'cloud'
  return twinTimestamp(cloudTwin) > twinTimestamp(localTwin) ? 'cloud' : 'local'
}

const tsOf = (v) => {
  const t = Date.parse(v || '')
  return Number.isFinite(t) ? t : 0
}
const maxNum = (a, b) => Math.max(Number(a) || 0, Number(b) || 0)

function mergeFingerprint(a = {}, b = {}) {
  const out = { ...(a || {}) }
  for (const [id, entry] of Object.entries(b || {})) {
    const cur = out[id]
    if (!cur) { out[id] = entry; continue }
    const bWins = (entry.count || 0) > (cur.count || 0)
      || ((entry.count || 0) === (cur.count || 0) && tsOf(entry.lastSeenAt) > tsOf(cur.lastSeenAt))
    const winner = bWins ? entry : cur
    out[id] = { ...winner, recentWeight: Math.max(cur.recentWeight || 0, entry.recentWeight || 0) }
  }
  return out
}

function mergeSessionLog(a = [], b = []) {
  const seen = new Set()
  const out = []
  for (const e of [...(a || []), ...(b || [])]) {
    if (!e || typeof e !== 'object') continue
    const key = `${e.date}|${e.minutes}|${e.accuracy01}|${e.lapseRate}|${e.proof}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  out.sort((x, y) => String(x.date).localeCompare(String(y.date)))
  return out.slice(-21)
}

function mergeAccuracy(a = [], b = []) {
  const seen = new Set()
  const out = []
  for (const e of [...(a || []), ...(b || [])]) {
    if (!e || typeof e !== 'object') continue
    const key = `${e.at}|${e.kind}|${e.score01}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  out.sort((x, y) => tsOf(x.at) - tsOf(y.at))
  return out.slice(-60)
}

function mergeSections(a = {}, b = {}) {
  const out = { ...(a || {}) }
  for (const [k, entry] of Object.entries(b || {})) {
    const cur = out[k]
    if (!cur || tsOf(entry?.updatedAt) >= tsOf(cur?.updatedAt)) out[k] = entry
  }
  return out
}

function mergeMethods(a = {}, b = {}) {
  const out = {}
  for (const id of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = a?.[id] || {}
    const y = b?.[id] || {}
    out[id] = {
      sessions: maxNum(x.sessions, y.sessions),
      minutes: maxNum(x.minutes, y.minutes),
      proof: maxNum(x.proof, y.proof),
    }
  }
  return out
}

/** Merge two Twin documents by collection. Either may be null. */
export function mergeTwins(localTwin, cloudTwin) {
  if (!localTwin) return cloudTwin || null
  if (!cloudTwin) return localTwin
  const localNewer = twinTimestamp(localTwin) >= twinTimestamp(cloudTwin)
  const newer = localNewer ? localTwin : cloudTwin
  const older = localNewer ? cloudTwin : localTwin

  // Speaking counters travel as a pair (avgBest is scoreSum/attempts):
  // keep the pair from the copy with more attempts, never a mix.
  const speakingBase = (cloudTwin.speaking?.attempts || 0) > (localTwin.speaking?.attempts || 0)
    ? cloudTwin.speaking
    : localTwin.speaking

  const modeWinner = tsOf(cloudTwin.modeSince) > tsOf(localTwin.modeSince) ? cloudTwin : localTwin

  const corrections = []
  {
    const seen = new Set()
    for (const c of [...(localTwin.userCorrections || []), ...(cloudTwin.userCorrections || [])]) {
      if (!c || typeof c !== 'object') continue
      const key = `${c.at}|${c.kind}|${c.patternId}`
      if (seen.has(key)) continue
      seen.add(key)
      corrections.push(c)
    }
    corrections.sort((x, y) => tsOf(x.at) - tsOf(y.at))
  }

  return {
    ...older,
    ...newer,
    version: Math.max(localTwin.version || 1, cloudTwin.version || 1),
    createdAt: (tsOf(localTwin.createdAt) && (!tsOf(cloudTwin.createdAt) || tsOf(localTwin.createdAt) <= tsOf(cloudTwin.createdAt)))
      ? localTwin.createdAt
      : (cloudTwin.createdAt || localTwin.createdAt),
    updatedAt: newer.updatedAt || older.updatedAt,
    sections: mergeSections(localTwin.sections, cloudTwin.sections),
    speaking: {
      ...newer.speaking,
      attempts: speakingBase?.attempts || 0,
      scoreSum: speakingBase?.scoreSum || 0,
      avgBest: speakingBase?.avgBest ?? null,
      masteredEvents: maxNum(localTwin.speaking?.masteredEvents, cloudTwin.speaking?.masteredEvents),
      masteredScenes: maxNum(localTwin.speaking?.masteredScenes, cloudTwin.speaking?.masteredScenes),
    },
    register: {
      ...newer.register,
      keigoAttempts: maxNum(localTwin.register?.keigoAttempts, cloudTwin.register?.keigoAttempts),
      bjtBand: newer.register?.bjtBand ?? older.register?.bjtBand ?? null,
      bjtScore: newer.register?.bjtScore ?? older.register?.bjtScore ?? null,
    },
    fingerprint: mergeFingerprint(localTwin.fingerprint, cloudTwin.fingerprint),
    life: newer.life ?? older.life ?? null,
    rhythm: {
      ...newer.rhythm,
      sessionLog: mergeSessionLog(localTwin.rhythm?.sessionLog, cloudTwin.rhythm?.sessionLog),
      lastSessionAt: tsOf(cloudTwin.rhythm?.lastSessionAt) > tsOf(localTwin.rhythm?.lastSessionAt)
        ? cloudTwin.rhythm.lastSessionAt
        : (localTwin.rhythm?.lastSessionAt ?? null),
      callsKept: maxNum(localTwin.rhythm?.callsKept, cloudTwin.rhythm?.callsKept),
      callsMissed: maxNum(localTwin.rhythm?.callsMissed, cloudTwin.rhythm?.callsMissed),
      feltEffortRecent: (newer.rhythm?.feltEffortRecent?.length ? newer.rhythm.feltEffortRecent : older.rhythm?.feltEffortRecent) || [],
    },
    accuracyRecent: mergeAccuracy(localTwin.accuracyRecent, cloudTwin.accuracyRecent),
    learningStyle: {
      ...newer.learningStyle,
      methods: mergeMethods(localTwin.learningStyle?.methods, cloudTwin.learningStyle?.methods),
      lastExperiment: newer.learningStyle?.lastExperiment ?? older.learningStyle?.lastExperiment ?? null,
      note: newer.learningStyle?.note ?? older.learningStyle?.note ?? null,
    },
    mode: modeWinner.mode || 'cruise',
    modeSince: modeWinner.modeSince || newer.modeSince,
    userCorrections: corrections,
  }
}
