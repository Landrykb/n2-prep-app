// Phase 2 node tests (run: TZ=UTC npm run test:phase2, or TZ=UTC node tests/phase2.test.mjs)
//
// 1. Slot determinism: the server port (supabase/functions/call-scheduler/
//    slot.ts) must agree with the client (src/lib/calls.js) on the exact
//    slot minute for every date/window — a one-minute disagreement means
//    the push rings for a slot the app doesn't have.
// 2. Timezone conversion: the UTC instant the scheduler computes must be
//    the same wall-clock minute in the user's timezone, incl. DST days.
// 3. Twin merge guard: an older/equal cloud Twin never overwrites local.

import assert from 'node:assert'

const client = await import('../src/lib/calls.js')
const port = await import('../supabase/functions/call-scheduler/slot.ts')
const { pickNewerTwin } = await import('../src/lib/twinMerge.js')
const { todayStr } = await import('../src/lib/session.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const WINDOWS = [
  { start: '08:00', end: '09:30' },
  { start: '12:30', end: '14:00' },
  { start: '19:00', end: '21:00' },
  { start: '07:15', end: '07:45' },
  { start: '22:00', end: '22:00' }, // degenerate: end <= start → 30 min rule
  { start: '06:00', end: '06:10' }, // tiny span (end-start-5 = 5)
]
const DATES = ['2026-11-05', '2026-01-01', '2026-03-08', '2026-11-01', '2027-06-30', '2026-02-28']

console.log('slot determinism (client vs server port, TZ=UTC):')
for (const date of DATES) {
  for (let w = 0; w < WINDOWS.length; w++) {
    check(`${date} window ${w}`, () => {
      const clientDate = client.slotDateFor(date, WINDOWS[w], w)
      const minute = port.slotMinuteOfDay(date, WINDOWS[w], w)
      assert.equal(clientDate.getUTCHours() * 60 + clientDate.getUTCMinutes(), minute)
      assert.equal(port.zonedSlotToUtc(date, minute, 'UTC').getTime(), clientDate.getTime())
      assert.equal(port.dateHash(`${date}|call|${w}`), client.dateHash(`${date}|call|${w}`))
    })
  }
}

console.log('timezone conversion (same wall-clock minute in the user tz):')
const wallMinute = (instant, tz) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(instant)
  const p = {}
  for (const part of parts) p[part.type] = part.value
  return (+p.hour) * 60 + (+p.minute)
}
for (const tz of ['Asia/Tokyo', 'America/New_York', 'Europe/Paris', 'Pacific/Auckland']) {
  for (const date of DATES) {
    check(`${tz} ${date}`, () => {
      const minute = port.slotMinuteOfDay(date, WINDOWS[0], 0)
      const instant = port.zonedSlotToUtc(date, minute, tz)
      assert.equal(wallMinute(instant, tz), minute)
      assert.equal(port.localDateStr(instant, tz), date)
    })
  }
}

console.log('todaysSlots mirrors ensureToday (count + instants):')
check('2 calls/day over 3 windows', () => {
  const now = new Date('2026-11-05T12:00:00Z')
  const state = { settings: { enabled: true, callsPerDay: 2, windows: WINDOWS.slice(0, 3), persistence: 'standard', senseiName: 'Sensei' }, days: {}, history: [] }
  const withDay = client.ensureToday(state, now)
  const day = withDay.days[todayStr(now)]
  const serverSlots = port.todaysSlots({ windows: WINDOWS.slice(0, 3), callsPerDay: 2 }, todayStr(now), 'UTC')
  assert.equal(day.slots.length, 2)
  assert.equal(serverSlots.length, 2)
  day.slots.forEach((slot, i) => {
    assert.equal(new Date(slot.at).getTime(), serverSlots[i].atUtc.getTime())
    assert.equal(slot.windowIndex, serverSlots[i].windowIndex)
  })
})
check('slot id is stable and namespaced', () => {
  assert.equal(port.slotIdFor('u1', '2026-11-05', 2), 'u1|2026-11-05|2')
})

console.log('twin merge guard (pickNewerTwin):')
const T = (iso) => (iso ? { updatedAt: iso } : {})
check('strictly newer cloud wins', () => assert.equal(pickNewerTwin(T('2026-11-05T10:00:00Z'), T('2026-11-05T11:00:00Z')), 'cloud'))
check('older cloud never overwrites local', () => assert.equal(pickNewerTwin(T('2026-11-05T11:00:00Z'), T('2026-11-05T10:00:00Z')), 'local'))
check('equal timestamps keep local', () => assert.equal(pickNewerTwin(T('2026-11-05T11:00:00Z'), T('2026-11-05T11:00:00Z')), 'local'))
check('no cloud row keeps local', () => assert.equal(pickNewerTwin(T('2026-11-05T11:00:00Z'), null), 'local'))
check('no local twin adopts cloud', () => assert.equal(pickNewerTwin(null, T('2026-11-05T11:00:00Z')), 'cloud'))
check('undated cloud never overwrites dated local', () => assert.equal(pickNewerTwin(T('2026-11-05T11:00:00Z'), T(null)), 'local'))
check('undated local yields to dated cloud', () => assert.equal(pickNewerTwin(T(null), T('2026-11-05T11:00:00Z')), 'cloud'))

console.log(`\n${passed} checks passed`)

// 4. Scheduler auth helper: legacy service_role JWT recognition.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (payload) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(payload)}.sig`
check('service_role JWT for this project is recognised', () =>
  assert.equal(port.isServiceRoleJwtForProject(jwt({ role: 'service_role', ref: 'rcckuxwvqgtyvovwpxaw' }), 'rcckuxwvqgtyvovwpxaw'), true))
check('anon JWT is not recognised as service_role', () =>
  assert.equal(port.isServiceRoleJwtForProject(jwt({ role: 'anon', ref: 'rcckuxwvqgtyvovwpxaw' }), 'rcckuxwvqgtyvovwpxaw'), false))
check('service_role JWT for ANOTHER project is rejected', () =>
  assert.equal(port.isServiceRoleJwtForProject(jwt({ role: 'service_role', ref: 'otherproject' }), 'rcckuxwvqgtyvovwpxaw'), false))
check('non-JWT values are rejected', () => {
  assert.equal(port.isServiceRoleJwtForProject('sb_secret_abc', 'rcckuxwvqgtyvovwpxaw'), false)
  assert.equal(port.isServiceRoleJwtForProject('', 'rcckuxwvqgtyvovwpxaw'), false)
  assert.equal(port.isServiceRoleJwtForProject('a.b.c', 'rcckuxwvqgtyvovwpxaw'), false)
})
console.log(`\nphase2: ${passed} checks passed (incl. scheduler-auth)`)
