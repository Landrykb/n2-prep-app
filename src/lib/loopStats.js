// THE LOOP — data derivation (pure, node-tested in tests/phase2.test.mjs).
//
// GrowthLoop.jsx renders the fleet as one growth cycle (Doc 05 §11).
// Every number it shows comes from here, and every number here comes
// from a real Twin field or a real local metrics event — the same
// stores TwinView reads. Where a fleet member has no honest number on
// this device yet, the stat is null and the surface shows the member's
// role line instead. Inventing a stat is banned (Doc 00 honesty rule);
// Tsuku is the standing example: the passage_sent payload carries no
// source field, so foundry output is not counted locally and Tsuku
// shows no number until a real one exists.
//
// Sources, exactly:
//   michi.stat   — metrics_events `diagnosis_completed` count (the
//                  checkups Michi's direction is read from)
//   michi.detail — twin.mode (code-written, modes.js) + the working
//                  level estimate band when one exists
//   saki.stat    — the SAVED plan for tomorrow (planner state), read
//                  only — this module never builds a plan
//   koe.stat     — twin.rhythm.callsKept, falling back to
//                  twin.speaking.attempts; detail: masteredScenes
//   nao.stat     — sum of twin.fingerprint pattern counts (slips the
//                  Corrector has spotted); detail: the top pattern
//   hori.stat    — twin.vocab.bySource reader + mining queue items
//   tsuku        — no local source exists: always null (see above)
//   centre       — twin.vocab queueTotal / graduated / fresh
//   week strip   — metrics events inside the last 7 days only:
//                  session_completed (minutes, proof), word_mined
//                  (payload.count, else 1 per event), call_outcome
//                  kept. Nothing older is ever folded in.

export const LOOP_ORDER = ['michi', 'saki', 'koe', 'nao', 'hori', 'tsuku']

const MODE_LABELS = {
  surge: 'Surge',
  cruise: 'Cruise',
  slump: 'Slump',
  badweek: 'Bad Week',
  event: 'Event Approach',
}

const plural = (n, one, many) => (n === 1 ? one : many)

/**
 * Per-agent live stat + "in your loop right now" detail.
 * Inputs are plain data so the function stays node-testable:
 *   twin         — a loaded Twin (twin.js shape)
 *   metrics      — local metrics events (metrics.js loadMetrics)
 *   tomorrowPlan — the saved plan object for tomorrow, or null
 *   topPattern   — { label } of the Twin's top error pattern, or null
 *   workingLevel — { band } from twinEstimate, or null
 */
export function agentLoopStats({ twin, metrics = [], tomorrowPlan = null, topPattern = null, workingLevel = null } = {}) {
  const t = twin || {}
  const events = Array.isArray(metrics) ? metrics : []
  const vocab = t.vocab || {}
  const bySource = vocab.bySource || {}

  const diagnoses = events.filter((e) => e.type === 'diagnosis_completed').length
  const modeLabel = MODE_LABELS[t.mode] || 'Cruise'
  const michiDetail = workingLevel?.band
    ? `Mode: ${modeLabel} · working level ${workingLevel.band} (an estimate, from your activity)`
    : `Mode: ${modeLabel}`

  const kept = t.rhythm?.callsKept || 0
  const attempts = t.speaking?.attempts || 0
  const mastered = t.speaking?.masteredScenes || 0

  const fingerprint = t.fingerprint || {}
  const slips = Object.values(fingerprint).reduce((s, p) => s + (Number(p?.count) || 0), 0)

  const fromReader = bySource.reader || 0
  const fromMining = bySource.mining || 0
  const mined = fromReader + fromMining
  const horiParts = []
  if (fromReader > 0) horiParts.push(`${fromReader} from the Reader`)
  if (fromMining > 0) horiParts.push(`${fromMining} from your documents`)

  return {
    michi: {
      stat: diagnoses > 0 ? `${diagnoses} ${plural(diagnoses, 'checkup', 'checkups')} read` : null,
      detail: michiDetail,
    },
    saki: {
      stat: tomorrowPlan ? `~${tomorrowPlan.minutes} min planned for tomorrow` : null,
      detail: tomorrowPlan?.note || null,
    },
    koe: {
      stat: kept > 0
        ? `${kept} ${plural(kept, 'call', 'calls')} taken`
        : attempts > 0
          ? `${attempts} speaking ${plural(attempts, 'attempt', 'attempts')}`
          : null,
      detail: mastered > 0 ? `${mastered} ${plural(mastered, 'scene', 'scenes')} mastered in Voice Loop` : null,
    },
    nao: {
      stat: slips > 0 ? `${slips} ${plural(slips, 'slip', 'slips')} spotted` : null,
      detail: topPattern?.label ? `Your current one fix: ${topPattern.label}` : null,
    },
    hori: {
      stat: mined > 0 ? `${mined} words mined into your queue` : null,
      detail: horiParts.length ? horiParts.join(' · ') : null,
    },
    // No honest local count exists for foundry output (see header).
    tsuku: { stat: null, detail: null },
  }
}

/** The flywheel at the centre of the loop: the one review queue. */
export function loopCentre(twin) {
  const vocab = twin?.vocab || {}
  return {
    queueTotal: vocab.queueTotal || 0,
    graduated: vocab.graduated || 0,
    fresh: vocab.fresh || 0,
  }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const TILE_ORDER = [
  { id: 'proof', label: 'Proof Points' },
  { id: 'minutes', label: 'Minutes Of Practice' },
  { id: 'mined', label: 'Words Mined' },
  { id: 'calls', label: 'Calls Taken' },
]

/**
 * "Your Japanese this week" — only events inside the last 7 days,
 * only tiles with a real non-zero value, at most three, in the fixed
 * priority order above. hasData false means the surface must say
 * "not enough data yet" rather than show flattering zeroes.
 */
export function weekStrip(metrics = [], now = new Date()) {
  const list = Array.isArray(metrics) ? metrics : []
  const cutoff = now.getTime() - WEEK_MS
  const inWeek = list.filter((e) => {
    const at = new Date(e?.at || 0).getTime()
    return Number.isFinite(at) && at >= cutoff && at <= now.getTime()
  })
  const sums = { proof: 0, minutes: 0, mined: 0, calls: 0 }
  for (const e of inWeek) {
    if (e.type === 'session_completed') {
      sums.proof += Number(e.proof) || 0
      sums.minutes += Number(e.minutes) || 0
    } else if (e.type === 'word_mined') {
      sums.mined += Number(e.count) > 0 ? Number(e.count) : 1
    } else if (e.type === 'call_outcome' && e.outcome === 'kept') {
      sums.calls += 1
    }
  }
  sums.minutes = Math.round(sums.minutes)
  const tiles = TILE_ORDER
    .filter((t) => sums[t.id] > 0)
    .slice(0, 3)
    .map((t) => ({ id: t.id, label: t.label, value: sums[t.id] }))
  return { tiles, hasData: tiles.length > 0, sums }
}
