// Deterministic shuffle helpers.
//
// Using Math.random() inside a render (or inside useMemo) makes the output
// unstable across re-renders. Passing an explicit numeric seed keeps the render
// pure while still letting the UI reshuffle on demand by bumping the seed.

/** Small, fast, deterministic PRNG (mulberry32). */
export function seededRandom(seed) {
  let a = (seed | 0) + 0x6d2b79f5
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates using a seeded PRNG. Returns a new array. */
export function shuffleWithSeed(items, seed = 0) {
  const out = [...items]
  const rand = seededRandom(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
