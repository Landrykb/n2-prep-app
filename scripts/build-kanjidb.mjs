// Builds KanjiDB v2 — the full kanji database — into public/data/kanjidb/.
//
// Sources (nothing is invented; every field traces to one of these):
//   Metadata (readings, meanings, grades, frequency, radical numbers,
//   dictionary references, radical names) : KANJIDIC2 via the `kanji` npm
//     package's per-kanji JSON files (node_modules/kanji/dist/data/kanjidic).
//     http://www.edrdg.org/wiki/index.php/KANJIDIC_Project  (CC BY-SA 3.0)
//   Stroke paths + nested component trees : KanjiVG release XML
//     (kanjivg-<release>.xml.gz), cached outside the repo in
//     ~/workspace/kanjivg-cache/ and downloaded from the KanjiVG GitHub
//     release when the cache is empty.
//     https://kanjivg.tagaini.net/                        (CC BY-SA 3.0)
//
// Derived data (labelled as derived wherever it appears):
//   - components.json: component -> kanji index, from the KanjiVG trees.
//   - meta.soundComponent: a top-level component whose primary on-reading
//     equals one of the kanji's on-readings (computed signal, not a
//     dictionary fact; cross-checked against KanjiVG's kvg:phon marks).
//   - radicals.json chars/names: assembled from KANJIDIC2's own radical
//     annotations ("... radical (no. N)" meanings, misc.rad_name entries,
//     classical radical classifications) combined with KanjiVG's radical
//     flags; per-entry provenance fields say which signal produced the char.
//     The only non-dictionary fallback is the Unicode Kangxi Radicals block
//     (U+2F00..U+2FD5), which encodes the 214 radicals in order by definition.
//
// The existing generator (scripts/build-kanji.mjs) and its level files under
// public/data/kanji/ are untouched by this script.
//
// Run: npm run build:kanjidb

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import kanjiPkg from 'kanji'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const DIC_DIR = path.join(root, 'node_modules/kanji/dist/data/kanjidic')
const OUT_DIR = path.join(root, 'public/data/kanjidb')
const CACHE_DIR = path.join(root, '..', '..', 'kanjivg-cache')
const STROKES_TOTAL_CAP = 40 * 1024 * 1024

// ---------------------------------------------------------------- utilities
const cpOf = (ch) => ch.codePointAt(0)
const hexOf = (ch) => cpOf(ch).toString(16)

/** Round every long decimal in a KanjiVG path `d` string to 2 places. */
function roundPath(d) {
  return d.replace(/\d+\.\d{3,}/g, (m) => {
    const v = Math.round(parseFloat(m) * 100) / 100
    return String(v)
  })
}

// ------------------------------------------------------------- KANJIDIC2 in
const dicFiles = fs.readdirSync(DIC_DIR).filter((f) => f.endsWith('.json')).sort()
const dicByChar = new Map()
for (const f of dicFiles) {
  const data = JSON.parse(fs.readFileSync(path.join(DIC_DIR, f), 'utf8'))
  const ch = data.literal?.[0]
  if (ch) dicByChar.set(ch, data)
}

function rmGroups(ch) {
  const rm = dicByChar.get(ch)?.reading_meaning || []
  const groups = []
  for (const entry of rm) for (const g of entry.rmgroup || []) groups.push(g)
  return groups
}
function nanoriOf(ch) {
  const rm = dicByChar.get(ch)?.reading_meaning || []
  const out = []
  for (const entry of rm) for (const n of entry.nanori || []) out.push(n)
  return [...new Set(out)]
}
function readingsOf(ch, type) {
  const out = []
  for (const g of rmGroups(ch)) {
    for (const r of g.reading || []) {
      if (r.r_type === type && r.$t && !out.includes(r.$t)) out.push(r.$t)
    }
  }
  return out
}
function meaningsOf(ch, lang) {
  // lang: null = English (plain strings), otherwise m_lang code ('fr', ...)
  const out = []
  for (const g of rmGroups(ch)) {
    for (const m of g.meaning || []) {
      if (lang === null && typeof m === 'string' && !out.includes(m)) out.push(m)
      if (lang !== null && m && typeof m === 'object' && m.m_lang === lang && !out.includes(m.$t)) out.push(m.$t)
    }
  }
  return out
}
function miscOf(ch) {
  const m = dicByChar.get(ch)?.misc?.[0] || {}
  const num = (v) => (v?.[0] ? Number(v[0]) : null)
  return {
    grade: num(m.grade),
    strokes: num(m.stroke_count),
    strokeCounts: (m.stroke_count || []).map(Number),
    freq: num(m.freq),
    jlpt: num(m.jlpt),
    radName: m.rad_name?.[0] || null,
  }
}
function radicalNumberOf(ch) {
  const rv = dicByChar.get(ch)?.radical?.[0]?.rad_value || []
  const classical = rv.find((r) => r.rad_type === 'classical')
  return classical ? Number(classical.$t) : null
}
const DIC_REF_TYPES = [
  'nelson_c', 'nelson_n', 'halpern_njecd', 'halpern_kkd', 'halpern_kkld',
  'halpern_kkld_2ed', 'heisig', 'heisig6', 'oneill_kk', 'oneill_names',
  'moro', 'henshall', 'henshall3', 'sh_kk', 'sh_kk2', 'sakade', 'jf_cards',
  'tuttle_cards', 'kodansha_compact', 'kanji_in_context', 'busy_people',
  'crowley', 'maniette',
]
function dicRefsOf(ch) {
  const refs = {}
  const list = dicByChar.get(ch)?.dic_number?.[0]?.dic_ref || []
  for (const r of list) {
    if (DIC_REF_TYPES.includes(r.dr_type) && r.$t && !(r.dr_type in refs)) refs[r.dr_type] = r.$t
  }
  return refs
}
/** Same kun formatting as build-kanji.mjs: drop affix-only, dot -> parens. */
function formatKun(raw) {
  if (raw.startsWith('-') || raw.endsWith('-')) return null
  const [stem, tail] = raw.split('.')
  return tail ? `${stem}(${tail})` : stem
}

// JLPT level (the app's N5..N1 labels) from the same lists build-kanji uses.
const levelOf = new Map()
for (const lv of ['n5', 'n4', 'n3', 'n2', 'n1']) {
  for (const ch of kanjiPkg.jlpt[lv]()) if (!levelOf.has(ch)) levelOf.set(ch, lv.toUpperCase())
}

// --------------------------------------------------------------- KanjiVG in
async function loadKanjiVgXml() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const cached = fs.readdirSync(CACHE_DIR).find((f) => /^kanjivg-.*\.xml\.gz$/.test(f))
  if (cached) {
    return {
      xml: zlib.gunzipSync(fs.readFileSync(path.join(CACHE_DIR, cached))).toString('utf8'),
      release: cached.replace(/^kanjivg-/, '').replace(/\.xml\.gz$/, ''),
    }
  }
  const rel = await (await fetch('https://api.github.com/repos/KanjiVG/kanjivg/releases/latest')).json()
  const asset = (rel.assets || []).find((a) => /^kanjivg-.*\.xml\.gz$/.test(a.name))
  if (!asset) throw new Error('KanjiVG release has no xml.gz asset')
  const buf = Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer())
  fs.writeFileSync(path.join(CACHE_DIR, asset.name), buf)
  return { xml: zlib.gunzipSync(buf).toString('utf8'), release: rel.tag_name }
}

/**
 * Parse the KanjiVG XML with a tag tokenizer (the format is regular: only
 * <kanji>, <g> and self-closing <path> elements carry data).
 * Returns Map char -> { paths: [d,...], tree: node } where node uses compact
 * keys: e element, r radical flag, p position, ph phonetic mark, pt part,
 * o original (for variant forms), c children, s direct stroke indices.
 */
function parseKanjiVg(xml) {
  const byChar = new Map()
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g
  const attrRe = /([\w:.-]+)="([^"]*)"/g
  let cur = null // { char, paths, stack, roots }
  let m
  while ((m = tagRe.exec(xml)) !== null) {
    const [, closing, tag, attrStr, selfClose] = m
    if (tag === 'kanji') {
      if (!closing) {
        const attrs = Object.fromEntries([...attrStr.matchAll(attrRe)].map((a) => [a[1], a[2]]))
        const hex = (attrs.id || '').replace('kvg:kanji_', '')
        const ch = String.fromCodePoint(parseInt(hex, 16))
        cur = { char: ch, paths: [], stack: [], roots: [] }
      } else if (cur) {
        let tree = null
        if (cur.roots.length === 1) tree = cur.roots[0]
        else if (cur.roots.length > 1) tree = { e: cur.char, c: cur.roots, s: [] }
        if (tree && !byChar.has(cur.char)) byChar.set(cur.char, { paths: cur.paths, tree })
        cur = null
      }
      continue
    }
    if (!cur) continue
    if (tag === 'g') {
      if (!closing) {
        const attrs = Object.fromEntries([...attrStr.matchAll(attrRe)].map((a) => [a[1], a[2]]))
        const node = { e: attrs['kvg:element'] || null, c: [], s: [] }
        if (attrs['kvg:radical']) node.r = attrs['kvg:radical']
        if (attrs['kvg:position']) node.p = attrs['kvg:position']
        if (attrs['kvg:phon']) node.ph = attrs['kvg:phon']
        if (attrs['kvg:part']) node.pt = Number(attrs['kvg:part'])
        if (attrs['kvg:original']) node.o = attrs['kvg:original']
        if (attrs['kvg:variant']) node.v = true
        const parent = cur.stack[cur.stack.length - 1]
        if (parent) parent.c.push(node)
        else cur.roots.push(node)
        if (!selfClose) cur.stack.push(node)
      } else {
        cur.stack.pop()
      }
    } else if (tag === 'path' && !closing) {
      const attrs = Object.fromEntries([...attrStr.matchAll(attrRe)].map((a) => [a[1], a[2]]))
      if (attrs.d) {
        const idx = cur.paths.length
        cur.paths.push(roundPath(attrs.d))
        const parent = cur.stack[cur.stack.length - 1]
        if (parent) parent.s.push(idx)
      }
    }
  }
  return byChar
}

function walkTree(node, fn) {
  fn(node)
  for (const c of node.c || []) walkTree(c, fn)
}


// ------------------------------------------------------------------- build
const { xml, release } = await loadKanjiVgXml()
const vg = parseKanjiVg(xml)
console.log(`KanjiVG ${release}: ${vg.size} kanji parsed`)

const allChars = [...dicByChar.keys()].sort((a, b) => cpOf(a) - cpOf(b))

// KanjiVG covers a handful of glyphs KANJIDIC2 has no entry for (variant /
// compatibility forms). The database universe is the KANJIDIC2 set, so those
// are excluded from the derived data and reported, never silently mixed in.
const vgOnlyChars = [...vg.keys()].filter((ch) => !dicByChar.has(ch))

// Component membership per kanji (from KanjiVG trees), reused below.
const componentsOf = new Map() // char -> Set of component elements (excl. root)
for (const [ch, entry] of vg) {
  if (!dicByChar.has(ch)) continue
  const set = new Set()
  if (entry.tree) {
    for (const child of entry.tree.c || []) {
      walkTree(child, (n) => { if (n.e && n.e !== ch) set.add(n.e) })
    }
  }
  componentsOf.set(ch, set)
}

// Sound component (derived): exactly one top-level component whose primary
// on-reading equals one of this kanji's on-readings.
const primaryOn = new Map(allChars.map((ch) => [ch, readingsOf(ch, 'ja_on')[0] || null]))
let soundDerived = 0
let phonChecked = 0
let phonAgree = 0
const soundComponentOf = new Map()
for (const ch of allChars) {
  const entry = vg.get(ch)
  if (!entry?.tree) continue
  const ons = readingsOf(ch, 'ja_on')
  if (!ons.length) continue
  const tops = [...new Set((entry.tree.c || []).map((n) => n.e).filter(Boolean))]
  const qualifying = tops.filter((el) => primaryOn.get(el) && ons.includes(primaryOn.get(el)))
  // Cross-check against KanjiVG's own phonetic marks (validation only).
  const phonMarks = tops.filter((el) => (entry.tree.c || []).some((n) => n.e === el && n.ph))
  if (phonMarks.length === 1) {
    phonChecked++
    if (qualifying.includes(phonMarks[0])) phonAgree++
  }
  if (qualifying.length === 1) {
    soundComponentOf.set(ch, qualifying[0])
    soundDerived++
  }
}

// ------------------------------------------------------------- index + meta
const META_BUCKET = (ch) => (cpOf(ch) >> 10).toString(16)
const STROKE_BUCKET = (ch) => (cpOf(ch) >> 8).toString(16)

const indexRows = []
const metaShards = new Map()
for (const ch of allChars) {
  const on = readingsOf(ch, 'ja_on')
  const kunRaw = readingsOf(ch, 'ja_kun')
  const kun = kunRaw.map(formatKun).filter(Boolean)
  const en = meaningsOf(ch, null)
  const fr = meaningsOf(ch, 'fr')
  const misc = miscOf(ch)
  const radNum = radicalNumberOf(ch)

  indexRows.push([
    ch, hexOf(ch), on.slice(0, 3).join('・'), kun.slice(0, 2).join('・'),
    (en[0] || '').slice(0, 40), misc.strokes, misc.freq, misc.grade, misc.jlpt, radNum,
  ])

  const meta = {
    char: ch, cp: hexOf(ch),
    on, kun: kunRaw, nanori: nanoriOf(ch),
    meanings: en, meaningsFr: fr,
    strokes: misc.strokes, strokeCounts: misc.strokeCounts,
    freq: misc.freq, grade: misc.grade, jlpt: misc.jlpt,
    level: levelOf.get(ch) || null,
    radical: radNum,
    refs: dicRefsOf(ch),
  }
  const sc = soundComponentOf.get(ch)
  if (sc) meta.soundComponent = sc
  const bucket = META_BUCKET(ch)
  if (!metaShards.has(bucket)) metaShards.set(bucket, {})
  metaShards.get(bucket)[ch] = meta
}

// ----------------------------------------------------------------- strokes
const strokeShards = new Map()
let strokesBytes = 0
let strokesCapped = false
for (const ch of allChars) {
  const entry = vg.get(ch)
  if (!entry) continue
  const bucket = STROKE_BUCKET(ch)
  if (!strokeShards.has(bucket)) strokeShards.set(bucket, {})
  strokeShards.get(bucket)[ch] = { paths: entry.paths, tree: entry.tree }
  strokesBytes += JSON.stringify(strokeShards.get(bucket)[ch]).length + ch.length + 2
  if (strokesBytes > STROKES_TOTAL_CAP) { strokesCapped = true; break }
}

// -------------------------------------------------------------- components
const compMap = new Map() // element -> Set of chars
for (const [ch, set] of componentsOf) {
  for (const el of set) {
    if (!compMap.has(el)) compMap.set(el, new Set())
    compMap.get(el).add(ch)
  }
}
const components = {}
for (const el of [...compMap.keys()].sort((a, b) => cpOf(a) - cpOf(b))) {
  const chars = [...compMap.get(el)].sort((a, b) => cpOf(a) - cpOf(b)).join('')
  components[el] = [chars, primaryOn.get(el) || '']
}

// ---------------------------------------------------------------- radicals
// Signal A: "... radical (no. N)" EN meaning -> char + English radical name.
// Signal B: misc.rad_name entries -> Japanese radical name + form chars.
// Signal C: KANJIDIC2 classical classification + KanjiVG radical flags
//          (vote among kanji classified under N for their flagged element).
const noteRe = /(.+?)\s*radical \(no\.\s*(\d+)\)/i
const noteByNum = new Map()
const radNameForms = new Map() // num -> [{char, radName}]
for (const ch of allChars) {
  for (const meaning of meaningsOf(ch, null)) {
    const mm = meaning.match(noteRe)
    if (mm) {
      const n = Number(mm[2])
      if (!noteByNum.has(n)) noteByNum.set(n, { char: ch, nameEn: mm[1].trim() })
    }
  }
  const misc = miscOf(ch)
  if (misc.radName) {
    const n = radicalNumberOf(ch)
    if (n) {
      if (!radNameForms.has(n)) radNameForms.set(n, [])
      radNameForms.get(n).push({ char: ch, radName: misc.radName })
    }
  }
}
const flagVotes = new Map() // num -> Map(element -> count)
for (const [ch, entry] of vg) {
  const n = radicalNumberOf(ch)
  if (!n || !entry.tree) continue
  walkTree(entry.tree, (node) => {
    if (node.r && node.e) {
      if (!flagVotes.has(n)) flagVotes.set(n, new Map())
      const votes = flagVotes.get(n)
      votes.set(node.e, (votes.get(node.e) || 0) + 1)
    }
  })
}
// KanjiVG variant forms: element -> original element (for radical variants).
const variantOf = new Map()
for (const entry of vg.values()) {
  if (!entry.tree) continue
  walkTree(entry.tree, (node) => {
    if (node.v && node.o && node.e && !variantOf.has(node.e)) variantOf.set(node.e, node.o)
  })
}

const radicals = []
for (let n = 1; n <= 214; n++) {
  const kangxiChar = String.fromCodePoint(0x2f00 + n - 1)
  const note = noteByNum.get(n)
  const forms = radNameForms.get(n) || []
  const votes = flagVotes.get(n)
  let char = null
  let charSource = null
  if (note) { char = note.char; charSource = 'kanjidic2-radical-note' }
  // Prefer a voted KanjiVG radical form that is itself classified under n
  // and differs from the note char only when the note char is absent.
  if (!char && votes) {
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1])
    const own = ranked.filter(([el]) => radicalNumberOf(el) === n)
    const pool = own.length ? own : ranked
    // Variant forms (亻, 扌, 犭...) are flagged far more often than the
    // standalone radical char; exclude elements KanjiVG itself marks as
    // variants of another element so the standalone form wins.
    const standalone = pool.filter(([el]) => !variantOf.has(el))
    const pick = (standalone.length ? standalone : pool)[0]
    if (pick) {
      char = pick[0]
      charSource = own.length ? 'kanjivg-radical-flag+kanjidic2-classification' : 'kanjivg-radical-flag'
    }
  }
  if (!char && forms.length) { char = forms[0].char; charSource = 'kanjidic2-rad-name' }
  if (!char) { char = kangxiChar; charSource = 'unicode-kangxi-block' }
  // KANJIDIC2 often puts the "(no. N)" note on the variant form itself
  // (e.g. 扌 "hand radical (no. 64)"). When the chosen char is a variant
  // whose original is classified under the same number, the original is
  // the standalone radical char; the variant joins the variants list.
  const resolvedOriginal = variantOf.get(char)
  if (resolvedOriginal && radicalNumberOf(resolvedOriginal) === n) {
    char = resolvedOriginal
    charSource += '+variant-resolved'
  }

  const nameJa = forms.find((f) => f.char === char)?.radName || forms[0]?.radName || null
  const nameEn = note?.nameEn || null
  const meta = dicByChar.has(char) ? miscOf(char) : null
  const variantSet = new Set(forms.map((f) => f.char))
  for (const [variant, original] of variantOf) {
    if (original === char || variantSet.has(original)) variantSet.add(variant)
  }
  variantSet.delete(char)
  radicals.push({
    n, char, kangxiChar,
    nameEn, nameJa,
    nameSourced: Boolean(nameEn || nameJa),
    charSource,
    meanings: dicByChar.has(char) ? meaningsOf(char, null).filter((x) => !noteRe.test(x)).slice(0, 3) : [],
    strokes: meta?.strokes ?? null,
    forms,
    variants: [...variantSet],
  })
}

// -------------------------------------------------------------------- write
fs.rmSync(OUT_DIR, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT_DIR, 'meta'), { recursive: true })
fs.mkdirSync(path.join(OUT_DIR, 'strokes'), { recursive: true })

const indexJson = JSON.stringify(indexRows)
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), indexJson)

let metaBytes = 0
const metaFiles = []
for (const [bucket, shard] of [...metaShards.entries()].sort()) {
  const file = `meta/meta-${bucket}.json`
  const json = JSON.stringify(shard)
  fs.writeFileSync(path.join(OUT_DIR, file), json)
  metaBytes += json.length
  metaFiles.push({ file, kanji: Object.keys(shard).length, bytes: json.length })
}

let strokesFileBytes = 0
const strokeFiles = []
for (const [bucket, shard] of [...strokeShards.entries()].sort()) {
  const file = `strokes/strokes-${bucket}.json`
  const json = JSON.stringify(shard)
  fs.writeFileSync(path.join(OUT_DIR, file), json)
  strokesFileBytes += json.length
  strokeFiles.push({ file, kanji: Object.keys(shard).length, bytes: json.length })
}

const componentsJson = JSON.stringify(components)
fs.writeFileSync(path.join(OUT_DIR, 'components.json'), componentsJson)
const radicalsJson = JSON.stringify(radicals, null, 1)
fs.writeFileSync(path.join(OUT_DIR, 'radicals.json'), radicalsJson)

// -------------------------------------------------------------- validation
const disagreements = []
let strokeChecked = 0
for (const [ch, entry] of vg) {
  const dicStrokes = miscOf(ch).strokes
  if (dicStrokes == null) continue
  strokeChecked++
  if (entry.paths.length !== dicStrokes) {
    disagreements.push({ char: ch, kanjivg: entry.paths.length, kanjidic2: dicStrokes })
  }
}
// 語 tree: 言 flagged radical, nesting 五 and 口 under 吾.
let goTreeOk = false
{
  const go = vg.get('語')
  if (go && go.paths.length === 14) {
    const tops = go.tree.c || []
    const gon = tops.find((t) => t.e === '言' && t.r)
    const go5 = tops.find((t) => t.e === '吾')
    const go5children = go5 ? (go5.c || []).map((c) => c.e) : []
    goTreeOk = Boolean(gon) && go5children.includes('五') && go5children.includes('口')
      && (gon.c || []).some((c) => c.e === '口')
  }
}
// Every components.json kanji exists in the index.
const indexChars = new Set(allChars)
let componentsIntegrity = true
for (const [chars] of Object.values(components)) {
  for (const ch of [...chars]) {
    if (!indexChars.has(ch)) { componentsIntegrity = false; break }
  }
  if (!componentsIntegrity) break
}

const totalBytes = indexJson.length + metaBytes + strokesFileBytes + componentsJson.length + radicalsJson.length
const manifest = {
  generatedAt: new Date().toISOString(),
  sources: {
    kanjidic2: { files: dicFiles.length, licence: 'CC BY-SA 3.0', holder: 'EDRDG' },
    kanjivg: { release, entries: vg.size, licence: 'CC BY-SA 3.0', holder: 'KanjiVG / Ulrich Apel' },
  },
  counts: {
    kanjidicKanji: allChars.length,
    kanjivgEntries: vg.size,
    kanjivgCovered: strokeFiles.reduce((sum, f) => sum + f.kanji, 0),
    kanjivgOnlyChars: vgOnlyChars,
    components: Object.keys(components).length,
    radicals: radicals.length,
    radicalsWithSourcedName: radicals.filter((r) => r.nameSourced).length,
    soundComponentDerived: soundDerived,
  },
  shards: {
    meta: { pattern: 'meta/meta-{hex(codepoint >> 10)}.json', files: metaFiles },
    strokes: { pattern: 'strokes/strokes-{hex(codepoint >> 8)}.json', files: strokeFiles },
  },
  sizes: {
    indexBytes: indexJson.length,
    metaBytes, strokesBytes: strokesFileBytes,
    componentsBytes: componentsJson.length, radicalsBytes: radicalsJson.length,
    totalBytes,
  },
  validation: {
    metaCountMatchesDicFiles: allChars.length === dicFiles.length,
    strokeCountsChecked: strokeChecked,
    strokeCountDisagreements: disagreements,
    goTreeOk,
    componentsIntegrity,
    soundComponentPhonCrossCheck: { checked: phonChecked, agreed: phonAgree },
    strokesCapped,
  },
  attribution:
    'Readings, meanings, grades, frequency and radical data: KANJIDIC2 (EDRDG, CC BY-SA 3.0). ' +
    'Stroke paths and component decomposition: KanjiVG (CC BY-SA 3.0, https://kanjivg.tagaini.net). ' +
    'components.json and soundComponent are derived from those sources (see Doc 18).',
}
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1))

console.log(`index: ${allChars.length} rows, ${(indexJson.length / 1024).toFixed(0)} kB`)
console.log(`meta: ${metaFiles.length} shards, ${(metaBytes / 1024 / 1024).toFixed(2)} MB, largest ${(Math.max(...metaFiles.map((f) => f.bytes)) / 1024).toFixed(0)} kB`)
console.log(`strokes: ${manifest.counts.kanjivgCovered} kanji in ${strokeFiles.length} shards, ${(strokesFileBytes / 1024 / 1024).toFixed(2)} MB, largest ${(Math.max(...strokeFiles.map((f) => f.bytes)) / 1024).toFixed(0)} kB (KanjiVG-only glyphs excluded: ${vgOnlyChars.length})`)
console.log(`components: ${Object.keys(components).length} elements, ${(componentsJson.length / 1024).toFixed(0)} kB`)
console.log(`radicals: 214, names sourced for ${manifest.counts.radicalsWithSourcedName}`)
console.log(`soundComponent derived for ${soundDerived} kanji (phon cross-check ${phonAgree}/${phonChecked})`)
console.log(`stroke-count disagreements: ${disagreements.length} of ${strokeChecked} checked`)
console.log(`語 tree ok: ${goTreeOk} | components integrity: ${componentsIntegrity}`)
console.log(`TOTAL payload: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
