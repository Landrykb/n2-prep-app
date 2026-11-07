// Build the KanjiVG variant forms for KanjiDB (docs/18).
//
// Investigation (2026-11-07, recorded in the output manifest + Doc 18):
// the KanjiVG release XML (kanjivg-<rel>.xml.gz) holds 6,703 glyph
// entries, but the project's own Files page states the XML is built
// "from the individual kanji files, excluding the variant forms". The
// full file set ships as kanjivg-<rel>-all.zip: 11,662 SVG files =
// 6,703 main forms + 4,959 variant files (suffix-named, e.g.
// 076f4-Kaisho.svg) covering 4,076 base codepoints — every one of them
// inside the 6,417 kanji our strokes shards cover.
//
// This script extracts the ordered stroke paths from each variant SVG
// (same document-order rule as build-kanjidb.mjs) and writes the ones
// that fit the payload budget, most valuable first:
//   tier 1: JLPT-level kanji by KANJIDIC2 frequency rank
//   tier 2: the rest by frequency rank (unranked last)
// Variant order inside a kanji: Kaisho, Insatsu, Hyougai, Jinmei, then
// alphabetical. A kanji is kept whole or not at all; the budget is
// ~2.9 MB of JSON. Coverage is reported honestly in the manifest —
// the cap binds, most variant files do NOT ship.
//
// The `note` on a variant is composed ONLY from KanjiVG's documented
// suffix vocabulary (Variants page): each token's gloss is theirs;
// a suffix that does not fully parse into glossed tokens gets null.
//
// Outputs (public/data/kanjidb/):
//   variants.json — { manifest, variants: { char: [{ variant, note,
//     paths }] } }
//
// Run: npm run build:variants   (cache: ~/workspace/kanjivg-cache/)

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DB_DIR = path.join(ROOT, 'public', 'data', 'kanjidb')
const CACHE_DIR = path.join(ROOT, '..', '..', 'kanjivg-cache')

const BUDGET_BYTES = 2_900_000

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

// ------------------------------------------------------------ zip reader
// Minimal read-only ZIP access (central directory + inflate), enough
// for the KanjiVG release archive. No external dependency.

export function zipEntries(buf) {
  // End Of Central Directory: scan the tail for the signature.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('zip: EOCD not found')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip: bad central header')
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    entries.set(name, { method, compSize, localOff })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

export function zipRead(buf, entry) {
  const off = entry.localOff
  if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('zip: bad local header')
  const nameLen = buf.readUInt16LE(off + 26)
  const extraLen = buf.readUInt16LE(off + 28)
  const dataOff = off + 30 + nameLen + extraLen
  const raw = buf.subarray(dataOff, dataOff + entry.compSize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return zlib.inflateRawSync(raw)
  throw new Error(`zip: unsupported method ${entry.method}`)
}

// ------------------------------------------------------- path extraction

// Coordinates are rounded to 2 decimals — identical rule to
// build-kanjidb.mjs, so variant and standard paths share one precision.
function roundPath(d) {
  return d.replace(/-?\d+\.\d+/g, (m) => {
    const r = Math.round(parseFloat(m) * 100) / 100
    return Object.is(r, -0) ? '0' : String(r)
  })
}

/** Ordered stroke paths of one KanjiVG SVG file (document order). */
export function svgStrokePaths(svgText) {
  const start = svgText.indexOf('StrokePaths')
  const end = svgText.indexOf('StrokeNumbers')
  const region = start >= 0 && end > start ? svgText.slice(start, end) : svgText
  const paths = []
  const re = /<path[^>]*\sd="([^"]+)"/g
  let m
  while ((m = re.exec(region)) !== null) paths.push(roundPath(m[1]))
  return paths
}

// ---------------------------------------------------------- suffix notes
// Glosses are KanjiVG's own words from the Variants page, shortened
// only by dropping their examples. A suffix is tokenised greedily
// (longest token first); the note joins the token glosses. Any token
// without a documented gloss (the 饗-only Le/Left/NoDot family, digit
// shorthands like VtLst's compounds we cannot ground) -> note null.

const TOKEN_GLOSS = new Map([
  ['HzFstLeRi', 'stroke order: horizontal first, left to right'],
  ['HzFstRiLe', 'stroke order: horizontal first, right to left'],
  ['Kaisho', 'Kaisho (regular script) form'],
  ['Insatsu', 'printed form'],
  ['Hyougai', 'hyougai variant form'],
  ['Jinmei', 'jinmei (name list) form'],
  ['HzFst', 'stroke order: horizontal first'],
  ['HzLst', 'stroke order: horizontal last'],
  ['VtFst', 'stroke order: vertical first'],
  ['VtLst', 'stroke order: vertical last'],
  ['MdFst', 'stroke order: middle first'],
  ['MidFst', 'stroke order: middle first'],
  ['MdLst', 'stroke order: middle last'],
  ['MidLst', 'stroke order: middle last'],
  ['DgLst', 'stroke order variant (for the 癶 element)'],
  ['TenLst', 'stroke order variant (for the 卵 element)'],
  ['Dg3', 'stroke order variant (for the 癶 element)'],
  ['Ten3', 'stroke order variant (for the 必 element)'],
  ['Vt3', 'stroke order: vertical as the 3rd stroke'],
  ['Vt4', 'stroke order: vertical as the 4th stroke'],
  ['Vt6', 'stroke order: vertical as the 6th stroke'],
])
const TOKENS = [...TOKEN_GLOSS.keys()].sort((a, b) => b.length - a.length)

export function variantNote(suffix) {
  let rest = suffix
  const parts = []
  while (rest.length > 0) {
    const tok = TOKENS.find((t) => rest.startsWith(t))
    if (!tok) return null
    parts.push(TOKEN_GLOSS.get(tok))
    rest = rest.slice(tok.length)
  }
  return parts.length ? parts.join('; ') : null
}

const VARIANT_ORDER = new Map([['Kaisho', 0], ['Insatsu', 1], ['Hyougai', 2], ['Jinmei', 3]])
const variantRank = (s) => VARIANT_ORDER.get(s) ?? 4

async function ensureZip(release) {
  const zipPath = path.join(CACHE_DIR, `kanjivg-${release}-all.zip`)
  if (!fs.existsSync(zipPath)) {
    const url = `https://github.com/KanjiVG/kanjivg/releases/download/r${release}/kanjivg-${release}-all.zip`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`)
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))
  }
  return zipPath
}

async function main() {
  const kanjidbManifest = readJson(path.join(DB_DIR, 'manifest.json'))
  const release = kanjidbManifest.sources.kanjivg.release

  const meta = {}
  for (const f of fs.readdirSync(path.join(DB_DIR, 'meta'))) Object.assign(meta, readJson(path.join(DB_DIR, 'meta', f)))
  const covered = new Set()
  for (const f of fs.readdirSync(path.join(DB_DIR, 'strokes'))) {
    for (const ch of Object.keys(readJson(path.join(DB_DIR, 'strokes', f)))) covered.add(ch)
  }

  const zipPath = await ensureZip(release)
  const buf = fs.readFileSync(zipPath)
  const entries = zipEntries(buf)

  // Inventory: main files vs variant files, suffix vocabulary.
  const byChar = new Map() // char -> [{ suffix, entryName }]
  const suffixCounts = new Map()
  let mainFiles = 0
  for (const name of entries.keys()) {
    const m = name.match(/^kanji\/([0-9a-f]{5})(?:-(.+))?\.svg$/)
    if (!m) continue
    if (!m[2]) { mainFiles++; continue }
    const ch = String.fromCodePoint(parseInt(m[1], 16))
    suffixCounts.set(m[2], (suffixCounts.get(m[2]) || 0) + 1)
    if (!byChar.has(ch)) byChar.set(ch, [])
    byChar.get(ch).push({ suffix: m[2], entryName: name })
  }
  const variantFileCount = [...suffixCounts.values()].reduce((a, b) => a + b, 0)
  const basesInDb = [...byChar.keys()].filter((ch) => covered.has(ch))

  // Priority: level kanji by freq, then the rest by freq, unranked last.
  const rankOf = (ch) => meta[ch]?.freq ?? Number.MAX_SAFE_INTEGER
  const candidates = basesInDb.sort((a, b) => {
    const la = meta[a]?.level ? 0 : 1
    const lb = meta[b]?.level ? 0 : 1
    if (la !== lb) return la - lb
    if (rankOf(a) !== rankOf(b)) return rankOf(a) - rankOf(b)
    return a.codePointAt(0) - b.codePointAt(0)
  })

  const kept = {}
  let bytes = 200 // braces + manifest headroom accounted at the end
  let keptVariants = 0
  let skippedKanji = 0
  for (const ch of candidates) {
    const list = byChar.get(ch)
      .sort((a, b) => variantRank(a.suffix) - variantRank(b.suffix) || a.suffix.localeCompare(b.suffix))
      .map(({ suffix, entryName }) => {
        const svg = zipRead(buf, entries.get(entryName)).toString('utf8')
        const paths = svgStrokePaths(svg)
        const note = variantNote(suffix)
        return note ? { variant: suffix, note, paths } : { variant: suffix, paths }
      })
      .filter((v) => v.paths.length > 0)
    if (!list.length) continue
    const entryJson = JSON.stringify(ch) + ':' + JSON.stringify(list) + ','
    if (bytes + entryJson.length > BUDGET_BYTES) { skippedKanji++; continue }
    kept[ch] = list
    bytes += entryJson.length
    keptVariants += list.length
  }

  const out = {
    manifest: {
      generatedAt: new Date().toISOString(),
      source: {
        dataset: 'KanjiVG',
        release,
        file: `kanjivg-${release}-all.zip`,
        note: 'The release XML excludes variant forms (KanjiVG Files page); variants come from the per-file SVG set in the -all archive.',
        licence: 'CC BY-SA 3.0',
      },
      investigation: {
        svgFilesTotal: entries.size,
        mainFormFiles: mainFiles,
        variantFiles: variantFileCount,
        distinctVariantSuffixes: suffixCounts.size,
        variantBaseKanji: byChar.size,
        variantBaseKanjiInOurStrokes: basesInDb.length,
      },
      counts: {
        kanjiWithVariantsShipped: Object.keys(kept).length,
        variantsShipped: keptVariants,
        kanjiSkippedOverBudget: skippedKanji,
        payloadBytes: bytes,
        budgetBytes: BUDGET_BYTES,
      },
    },
    variants: kept,
  }

  const outPath = path.join(DB_DIR, 'variants.json')
  fs.writeFileSync(outPath, JSON.stringify(out))
  console.log(`zip inventory: ${entries.size} files, ${mainFiles} main, ${variantFileCount} variants, ${suffixCounts.size} suffixes, ${byChar.size} base kanji (${basesInDb.length} in our strokes)`)
  console.log(`shipped: ${Object.keys(kept).length} kanji / ${keptVariants} variants in ${(bytes / 1024).toFixed(0)} kB; skipped over budget: ${skippedKanji} kanji`)
  console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} kB)`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) await main()
