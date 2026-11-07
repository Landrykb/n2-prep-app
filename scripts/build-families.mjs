// Build the ATTESTED sound families for KanjiDB (docs/18).
//
// A sound family = one component C + one shared on-reading R, where R is
// the component's primary on-reading (components.json). Two evidence
// grades, kept strictly separate:
//
//   ATTESTED — two independent sources agree for this kanji:
//     (a) the derived rule from build-kanjidb.mjs fires: the kanji's
//         meta.soundComponent is C and R is among its on-readings; AND
//     (b) KanjiVG marks the C group in the kanji's own stroke tree with
//         a phonetic flag (kvg:phon, compact key `ph`).
//   COMPUTED — the derived rule (a) fires only. This is what the Kanji
//     Lens showed before this file existed; computed members of a
//     shipped family are listed as alsoComputed, rendered dimmed.
//
// Only families with >= 3 ATTESTED members ship. Families are ranked by
// the summed KANJIDIC2 frequency rank of their attested members
// (a missing rank costs FREQ_PENALTY), best first, capped at 200.
//
// Inputs are the already-generated KanjiDB artifacts (run
// `npm run build:kanjidb` first). No network.
//
// Outputs (public/data/kanjidb/):
//   families.json — { manifest, families: [{ component, reading,
//     members: [attested chars], alsoComputed: [derived-only chars] }] }
//
// Run: npm run build:families

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DB_DIR = path.join(ROOT, 'public', 'data', 'kanjidb')

const MIN_ATTESTED = 3
const MAX_FAMILIES = 200
const FREQ_PENALTY = 100000

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

/** All meta shards merged into one { char: meta } map. */
export function loadAllMeta(dbDir = DB_DIR) {
  const meta = {}
  for (const f of fs.readdirSync(path.join(dbDir, 'meta'))) {
    Object.assign(meta, readJson(path.join(dbDir, 'meta', f)))
  }
  return meta
}

/** All strokes shards merged into one { char: compactEntry } map. */
export function loadAllStrokes(dbDir = DB_DIR) {
  const strokes = {}
  for (const f of fs.readdirSync(path.join(dbDir, 'strokes'))) {
    Object.assign(strokes, readJson(path.join(dbDir, 'strokes', f)))
  }
  return strokes
}

/**
 * True when the kanji's KanjiVG tree marks a TOP-LEVEL component group
 * with element === component and a phonetic flag (ph). The derived
 * sound component is always a top-level part of the tree, so deeper
 * groups are not evidence for this family.
 */
export function treeMarksPhonetic(strokesEntry, component) {
  if (!strokesEntry || !strokesEntry.tree) return false
  const top = strokesEntry.tree.c || []
  return top.some((node) => node.e === component && !!node.ph)
}

const byFreqThenChar = (meta) => (a, b) => {
  const fa = meta[a]?.freq ?? Number.MAX_SAFE_INTEGER
  const fb = meta[b]?.freq ?? Number.MAX_SAFE_INTEGER
  if (fa !== fb) return fa - fb
  return a.codePointAt(0) - b.codePointAt(0)
}

function main() {
  const meta = loadAllMeta()
  const strokes = loadAllStrokes()
  const components = readJson(path.join(DB_DIR, 'components.json'))
  const kanjidbManifest = readJson(path.join(DB_DIR, 'manifest.json'))

  // Group every derived soundComponent kanji by (component, reading).
  const groups = new Map() // `${C}|${R}` -> { component, reading, attested: [], computed: [] }
  let derivedTotal = 0
  let readingMismatch = 0
  for (const [char, m] of Object.entries(meta)) {
    const c = m.soundComponent
    if (!c) continue
    derivedTotal++
    const reading = components[c]?.[1] ?? null
    if (!reading || !(m.on || []).includes(reading)) {
      // The derived rule guarantees this cannot happen (build-kanjidb
      // set soundComponent from this same primaryOn); count, never hide.
      readingMismatch++
      continue
    }
    const key = `${c}|${reading}`
    if (!groups.has(key)) groups.set(key, { component: c, reading, attested: [], computed: [] })
    const g = groups.get(key)
    if (treeMarksPhonetic(strokes[char], c)) g.attested.push(char)
    else g.computed.push(char)
  }

  const sortChars = byFreqThenChar(meta)
  const families = [...groups.values()]
    .filter((g) => g.attested.length >= MIN_ATTESTED)
    .map((g) => ({
      component: g.component,
      reading: g.reading,
      members: [...g.attested].sort(sortChars),
      alsoComputed: [...g.computed].sort(sortChars),
      freqSum: g.attested.reduce((s, ch) => s + (meta[ch]?.freq ?? FREQ_PENALTY), 0),
    }))
    .sort((a, b) =>
      a.freqSum - b.freqSum ||
      b.members.length - a.members.length ||
      a.component.codePointAt(0) - b.component.codePointAt(0))
    .slice(0, MAX_FAMILIES)

  const attestedMemberships = families.reduce((s, f) => s + f.members.length, 0)
  const computedMemberships = families.reduce((s, f) => s + f.alsoComputed.length, 0)
  const inFamily = new Set()
  for (const f of families) {
    for (const ch of f.members) inFamily.add(ch)
    for (const ch of f.alsoComputed) inFamily.add(ch)
  }

  const out = {
    manifest: {
      generatedAt: new Date().toISOString(),
      method: {
        family: 'component C + its primary on-reading R (components.json)',
        attested: 'meta.soundComponent == C and R in the kanji on-readings (derived rule, build-kanjidb.mjs) AND KanjiVG marks the top-level C group in the kanji stroke tree with a phonetic flag (kvg:phon)',
        computed: 'the derived rule alone — listed as alsoComputed, never as members',
      },
      counts: {
        derivedSoundComponentKanji: derivedTotal,
        attestedFamilies: families.length,
        attestedMemberships,
        computedOnlyMemberships: computedMemberships,
        // Of the derived soundComponent kanji, how many are attested
        // members of a shipped family, and how many sit in one at all
        // (attested member or alsoComputed).
        derivedAttestedInFamily: families.reduce((s, f) => s + f.members.length, 0),
        derivedInShippedFamily: inFamily.size,
        readingMismatches: readingMismatch,
      },
      validation: {
        derivedTotalMatchesKanjidbManifest: derivedTotal === kanjidbManifest.counts.soundComponentDerived,
      },
    },
    families: families.map(({ freqSum, ...f }) => f),
  }

  const outPath = path.join(DB_DIR, 'families.json')
  fs.writeFileSync(outPath, JSON.stringify(out))
  console.log(`families: ${families.length} attested families, ${attestedMemberships} attested memberships, ${computedMemberships} alsoComputed`)
  console.log(`derived soundComponent kanji: ${derivedTotal} (manifest says ${kanjidbManifest.counts.soundComponentDerived}); in a shipped family: ${inFamily.size}, attested members: ${out.manifest.counts.derivedAttestedInFamily}`)
  const top = families[0]
  if (top) console.log(`largest/first family: ${top.component}/${top.reading} — ${top.members.length} attested`)
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} kB)`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
