// One-time adoption of guest data by a new account (P1-4, legacy half).
//
// Legacy surfaces key their data `n2:anon:<name>` while signed out and
// `n2:<userId>:<name>` once signed in — and nothing ever bridged the two,
// so a week of guest study vanished from view the moment the learner
// created the account the app itself asked for. This runs on sign-in
// (AuthContext): every anon key is adopted into the user's namespace.
//
// Rules: if the user already has a value under their own key, THEIRS
// wins (account data is the shared truth across their devices) and the
// anon copy is retired; if not, the anon value moves over. Either way
// the anon key is removed, which makes the pass naturally idempotent —
// a second sign-in finds nothing to adopt. The new-layer data (jpn:*)
// needs no key bridge: it is device-global and stateSync merges it
// into the account instead.

export function adoptAnonKeys(userId, storage = localStorage) {
  if (!userId) return 0
  const anonPrefix = 'n2:anon:'
  const anonKeys = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && k.startsWith(anonPrefix)) anonKeys.push(k)
    }
  } catch { return 0 }
  let adopted = 0
  for (const k of anonKeys) {
    const target = `n2:${userId}:${k.slice(anonPrefix.length)}`
    try {
      if (storage.getItem(target) === null) {
        storage.setItem(target, storage.getItem(k))
        adopted++
      }
      storage.removeItem(k)
    } catch { /* storage trouble: leave the anon key for a later pass */ }
  }
  return adopted
}
