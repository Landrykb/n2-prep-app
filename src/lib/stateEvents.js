// Tiny save-event bus for the learner state (queue / profile / diagnosis /
// promise). The writers (queue.js, profile.js, promise.js) emit; the sync
// layer (stateSync.js) subscribes. Kept import-free so no module cycle can
// form: writers never need to know sync exists.

const listeners = new Set()

export function emitLearnerStateSaved() {
  for (const fn of listeners) { try { fn() } catch { /* a listener must never break a save */ } }
}

export function onLearnerStateSaved(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
