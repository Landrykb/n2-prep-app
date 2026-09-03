// Generates public/data/kanji.json from authoritative sources.
//
//   Readings / meanings / stroke counts / frequency : KANJIDIC2
//     http://www.edrdg.org/wiki/index.php/KANJIDIC_Project  (CC BY-SA 3.0)
//   Radical decomposition                           : KanjiVG
//     https://kanjivg.tagaini.net/                        (CC BY-SA 3.0)
//   JLPT level lists                                : `kanji` npm package
//   Example vocabulary                              : public/data/ankiVocab.json (OpenJLPT, CC BY-SA 4.0)
//
// Nothing here is invented: every meaning and reading is looked up, and the
// "structure" line is assembled from the real KanjiVG components plus the
// KANJIDIC meaning of each component. Kanji that already have a hand-written
// mnemonic in src/data.js are left untouched by the app (see kanjiLessons).
//
// Run: npm run build:kanji

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import kanjiPkg from 'kanji'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const DIC_DIR = path.join(root, 'node_modules/kanji/dist/data/kanjidic')

const LEVELS = ['n5', 'n4', 'n3', 'n2', 'n1']

// Radical variant forms that KANJIDIC has no entry for. Each maps to the parent
// radical whose KANJIDIC meaning genuinely applies, so no meaning is guessed.
const VARIANT_PARENT = {
  '⻌': '辵', '⻖': '阜', '⺨': '犬', '⻏': '邑', '⺌': '小',
  '⺍': '小', '⺤': '爪', '⺕': '彐', '⺗': '心', '㔾': '卩',
}

const GRADIENTS = [
  'from-violet-500 to-fuchsia-600', 'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600', 'from-indigo-500 to-violet-600',
  'from-sky-500 to-cyan-600', 'from-teal-500 to-emerald-600',
  'from-orange-500 to-red-600', 'from-fuchsia-500 to-purple-600',
]

const dicCache = new Map()
function dic(ch) {
  if (!ch) return null
  if (dicCache.has(ch)) return dicCache.get(ch)
  const file = path.join(DIC_DIR, `${ch.codePointAt(0).toString(16)}.json`)
  let data = null
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { data = null }
  dicCache.set(ch, data)
  return data
}

const rmgroup = (ch) => dic(ch)?.reading_meaning?.[0]?.rmgroup?.[0] || null

/** English meanings (KANJIDIC stores plain strings for English). */
function englishMeanings(ch) {
  const g = rmgroup(ch)
  if (!g) return []
  return (g.meaning || [])
    .filter((m) => typeof m === 'string')
    // Drop self-referential radical notes like "road radical (no. 162)".
    .filter((m) => !/radical\s*(variant)?\s*\(no\./i.test(m))
}

function frenchMeanings(ch) {
  const g = rmgroup(ch)
  if (!g) return []
  return (g.meaning || []).filter((m) => m && typeof m === 'object' && m.m_lang === 'fr').map((m) => m.$t)
}

/**
 * KANJIDIC writes kun readings as "おく.れる" (dot = okurigana boundary) and uses
 * a leading/trailing hyphen for prefix/suffix-only forms. The hand-written
 * lessons in src/data.js use "おく(れる)", so normalise to that and drop the
 * affix-only variants that are noise for a learner.
 */
function formatKun(raw) {
  if (raw.startsWith('-') || raw.endsWith('-')) return null
  const [stem, tail] = raw.split('.')
  return tail ? `${stem}(${tail})` : stem
}

function readings(ch) {
  const g = rmgroup(ch)
  if (!g) return { on: [], kun: [] }
  const list = g.reading || []
  return {
    on: list.filter((r) => r.r_type === 'ja_on').map((r) => r.$t).slice(0, 4),
    kun: list
      .filter((r) => r.r_type === 'ja_kun')
      .map((r) => formatKun(r.$t))
      .filter(Boolean)
      .slice(0, 4),
  }
}

function misc(ch) {
  const m = dic(ch)?.misc?.[0] || {}
  const strokeRaw = m.stroke_count?.[0]
  return {
    strokes: strokeRaw ? Number(strokeRaw) : null,
    freq: m.freq?.[0] ? Number(m.freq[0]) : null,
    grade: m.grade?.[0] ? Number(m.grade[0]) : null,
  }
}

/** Name for a component: its own KANJIDIC meaning, or its parent radical's. */
function componentName(ch) {
  const direct = englishMeanings(ch)
  if (direct.length) return direct.slice(0, 2).join(' / ')
  const parent = VARIANT_PARENT[ch]
  if (parent) {
    const viaParent = englishMeanings(parent)
    if (viaParent.length) return viaParent.slice(0, 2).join(' / ')
  }
  return ''
}

// ---------------------------------------------------------------- emoji icons
const doodle = JSON.parse(fs.readFileSync(path.join(root, 'public/data/doodleData.json'), 'utf8'))
const { kanjiEmoji = {}, meaningEmoji = {} } = doodle

function iconFor(ch, name) {
  if (kanjiEmoji[ch]) return kanjiEmoji[ch]
  for (const word of (name || '').toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
    if (meaningEmoji[word]) return meaningEmoji[word]
  }
  return '◻️'
}

// ------------------------------------------------------------ example words
const deck = JSON.parse(fs.readFileSync(path.join(root, 'public/data/ankiVocab.json'), 'utf8'))
const BACK_RE = /^(.+?)\s*(?:[（(]([^）)]*)[）)])?\s*—\s*(.+)$/s
const KANA_ONLY = /^[\u3040-\u309f\u30a0-\u30ff゛゜ーぁ-ん・/、，,\s]+$/

const vocab = []
for (const row of deck) {
  const m = row.back?.match(BACK_RE)
  if (!m) continue
  const word = (row.front || '').trim()
  const readingRaw = (m[2] || '').replace(/[（()）]/g, '').trim()
  const reading = KANA_ONLY.test(readingRaw) && readingRaw ? readingRaw : ''
  const meaning = (m[3] || '').trim()
  if (!word || !meaning) continue
  vocab.push({ word, reading, meaning, level: row.level || '' })
}

// Index vocabulary by each kanji it contains, so examples are real words.
const LEVEL_RANK = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 }
const byKanji = new Map()
for (const v of vocab) {
  for (const ch of new Set([...v.word].filter((c) => /[\u4e00-\u9faf]/.test(c)))) {
    if (!byKanji.has(ch)) byKanji.set(ch, [])
    byKanji.get(ch).push(v)
  }
}

function examplesFor(ch, level) {
  const pool = byKanji.get(ch) || []
  const rank = LEVEL_RANK[level] ?? 4
  return [...pool]
    .sort((a, b) => {
      // Prefer words at/below the kanji's level, then shorter, then has reading.
      const ra = Math.abs((LEVEL_RANK[a.level] ?? 4) - rank)
      const rb = Math.abs((LEVEL_RANK[b.level] ?? 4) - rank)
      if (ra !== rb) return ra - rb
      if (!!b.reading !== !!a.reading) return b.reading ? 1 : -1
      return a.word.length - b.word.length
    })
    .slice(0, 3)
}

// ------------------------------------------------------------------- build
const seen = new Set()
const out = []

for (const lv of LEVELS) {
  const level = lv.toUpperCase()
  for (const ch of kanjiPkg.jlpt[lv]()) {
    if (seen.has(ch)) continue
    seen.add(ch)

    const en = englishMeanings(ch)
    const fr = frenchMeanings(ch)
    const { on, kun } = readings(ch)
    const { strokes, freq, grade } = misc(ch)

    const tree = kanjiPkg.kanjiTree(ch)
    const radicals = (tree?.g || [])
      .map((c) => c.element)
      .filter(Boolean)
      .filter((part) => part !== ch)
      .map((part) => {
        const name = componentName(part)
        return { part, name, icon: iconFor(part, name) }
      })
      // Keep only components we can actually describe.
      .filter((r) => r.name)

    const named = radicals.map((r) => `${r.part} (${r.name})`).join(' + ')
    const structure = named
      ? `${ch} is built from ${named}.`
      : `${ch} has no simpler parts to break down — learn it as one shape.`

    const examples = examplesFor(ch, level)
    const headword = examples[0]

    out.push({
      char: ch,
      level,
      on: on.join('・'),
      kun: kun.join('・'),
      meaning: en.slice(0, 4).join(', ') || '(no gloss)',
      meaningFr: fr.slice(0, 3).join(', ') || '',
      strokes,
      freq,
      grade,
      radicals,
      story: structure,
      word: headword ? (headword.reading ? `${headword.word}（${headword.reading}）` : headword.word) : '',
      examples,
      emoji: iconFor(ch, en[0] || ''),
      doodle: radicals.length ? radicals.map((r) => r.icon).join('') : iconFor(ch, en[0] || ''),
      gradient: GRADIENTS[ch.codePointAt(0) % GRADIENTS.length],
      source: 'KANJIDIC2 / KanjiVG',
    })
  }
}

// Most common kanji first within a level, so study order is useful by default.
out.sort((a, b) => (a.freq ?? 99999) - (b.freq ?? 99999))

// One file per JLPT level: a learner studying N2 should not download N1 too.
const outDir = path.join(root, 'public/data/kanji')
fs.mkdirSync(outDir, { recursive: true })

const manifest = {}
for (const lv of LEVELS) {
  const level = lv.toUpperCase()
  const rows = out.filter((e) => e.level === level)
  const file = path.join(outDir, `${level}.json`)
  fs.writeFileSync(file, JSON.stringify(rows))
  manifest[level] = { count: rows.length, file: `/data/kanji/${level}.json`, bytes: fs.statSync(file).size }
  console.log(`${level}: ${String(rows.length).padStart(4)} kanji  ${(manifest[level].bytes / 1024).toFixed(0).padStart(4)} kB`)
}

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({
  levels: manifest,
  attribution: 'Readings and meanings: KANJIDIC2 (EDRDG, CC BY-SA 3.0). Decomposition: KanjiVG (CC BY-SA 3.0). Example words: OpenJLPT (CC BY-SA 4.0).',
}, null, 2))

const noMeaning = out.filter((e) => e.meaning === '(no gloss)')
const noRadicals = out.filter((e) => !e.radicals.length).length
const noExample = out.filter((e) => !e.examples.length).length
const noOn = out.filter((e) => !e.on && !e.kun).length

console.log(`\ntotal ${out.length} kanji`)
console.log(`without english gloss: ${noMeaning.length}${noMeaning.length ? ` (${noMeaning.map((e) => e.char).join(' ')})` : ''}`)
console.log(`without decomposition: ${noRadicals} | without example word: ${noExample} | without any reading: ${noOn}`)
