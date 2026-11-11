// Readings (and meanings) for heard words, resolved WIDE
// (Landry, 2026-11-11: "some of the words in listen do not
// have their furigana like others (in parentheses)").
//
// The Listen surfaces used to resolve readings from the app's
// deck alone — but Heard Words MATCHES against the full
// JMdict wordbook, so most matched words live outside the
// deck and showed with no reading at all. Resolution is now
// layered, widest book last:
//   1. the deck dictionary (the components already load it) —
//      reading + meaning;
//   2. the WordsDB search index (the common-words JMdict
//      subset, one cached fetch) — reading + gloss;
//   3. the full wordbook shards (the same book the matcher
//      uses) — reading only; fetched once, only when items
//      are still unresolved, and cached for the page's life.
// A word no layer knows shows without a reading — never a
// guessed one. This module deliberately does NOT reuse
// heardMatch's loadHeardDict: that promise is cached with
// the auto-listen lane's deck entries, and readings lookup
// must never narrow the matcher's dictionary.

import { loadWordSearchIndex } from './wordsDb.js'

let indexPromise = null
function loadFormIndex() {
  if (!indexPromise) {
    indexPromise = loadWordSearchIndex().then((rows) => {
      const byForm = new Map()
      for (const row of Array.isArray(rows) ? rows : []) {
        const [, forms, kana, gloss] = row || []
        if (!kana) continue
        for (const form of String(forms || '').split('/')) {
          const f = form.trim()
          if (f && !byForm.has(f)) byForm.set(f, { reading: kana, meaning: gloss || null })
        }
      }
      return byForm
    }).catch(() => new Map())
  }
  return indexPromise
}

let wordbookPromise = null
function loadWordbookReadings() {
  if (!wordbookPromise) {
    wordbookPromise = (async () => {
      const map = new Map()
      try {
        const manifestRes = await fetch('/data/wordbook/manifest.json')
        const manifest = manifestRes.ok ? await manifestRes.json() : null
        const names = Array.isArray(manifest?.shards) ? manifest.shards : []
        const shards = await Promise.all(names.map(async (name) => {
          const res = await fetch(`/data/wordbook/${name}`)
          if (!res.ok) return null
          const shard = await res.json()
          return Array.isArray(shard?.heads) ? shard : null
        }))
        for (const shard of shards) {
          if (!shard) continue
          const heads = shard.heads || []
          const readings = shard.readings || []
          for (let i = 0; i < heads.length; i++) {
            const head = heads[i]
            const reading = readings[i]
            if (head && reading && reading !== head && !map.has(head)) map.set(head, reading)
          }
        }
      } catch { /* a failed wide fetch just narrows resolution */ }
      return map
    })()
  }
  return wordbookPromise
}

/**
 * Resolve { reading, meaning } for a list of heard items.
 * `deckDict` is the loaded deck dictionary (its byWord map),
 * or null. Returns a Map item -> { reading, meaning } with
 * either field possibly null.
 */
export async function resolveHeardInfo(items, deckDict = null) {
  const out = new Map()
  const wanted = [...new Set((items || []).filter((w) => typeof w === 'string' && w))]
  if (wanted.length === 0) return out
  for (const item of wanted) {
    const d = deckDict?.byWord?.get(item)
    out.set(item, { reading: d?.reading || null, meaning: d?.meaning || null })
  }
  const needReading = () => wanted.filter((item) => !out.get(item).reading)
  if (needReading().length > 0) {
    const byForm = await loadFormIndex()
    for (const item of needReading()) {
      const hit = byForm.get(item)
      if (hit) {
        const cur = out.get(item)
        out.set(item, { reading: hit.reading, meaning: cur.meaning || hit.meaning })
      }
    }
  }
  if (needReading().length > 0) {
    const wide = await loadWordbookReadings()
    for (const item of needReading()) {
      const reading = wide.get(item)
      if (reading) out.get(item).reading = reading
    }
  }
  return out
}
