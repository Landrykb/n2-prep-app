// Builds the French curriculum layer — public/data/kanjidb/french.json —
// by merging Landry's Licence curriculum extraction (a personal study
// resource kept OUTSIDE the repo, in ~/workspace/jpn2easy/french-curriculum/)
// against KanjiDB v2.
//
// RIGHTS RULE (binding): the INALCO booklet text is a personal reference
// layer. This script uses it ONLY as (i) a cross-check signal against
// KANJIDIC2's French meanings and (ii) short factual tags — the semester
// theme names and the radical French names. NO booklet compounds, example
// sentences, or French gloss lines are copied into app data. The booklet's
// meaningFr is read here solely to compute the check verdict; the gloss
// itself never lands in the output.
//
// Per kanji (only the 814 of the curriculum index):
//   themes         [{ list: 'S5'|'S6', theme, n }] — the semester theme
//                  lists' own groupings, as factual tags.
//   lesson         the INALCO booklet lesson (19–25) teaching the kanji,
//                  or null when it appears only in the theme lists.
//   radicalChar / radicalNameFr — the booklet radical's char and its
//                  French name (e.g. 囗 « de l'enceinte »), when the
//                  booklet entry prints one.
//   meaningFrCheck 'agrees' | 'differs' | null — the cross-check signal
//                  defined below. It is a data-QA signal, NOT a verdict
//                  on either source: the booklet and KANJIDIC2 often say
//                  the same thing in different French words, which this
//                  token rule scores as 'differs' (e.g. 勝 booklet
//                  « triompher, vaincre » vs dictionary « victoire,
//                  gagner »). It exists so a human can eyeball the
//                  genuinely divergent entries, nothing more.
//
// THE CHECK RULE (meaningFrCheckFor): both sides are normalised to
// content-token sets — lowercase, accents stripped, split on
// non-letters, French stopwords and single letters dropped. The
// verdict is 'agrees' when the overlap coefficient
// |A ∩ B| / min(|A|, |B|) is at least 0.5, else 'differs'. When either
// side has no French text at all, the verdict is null (no signal).
//
// Run: npm run build:french

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const FRENCH_DIR = path.join(root, '..', '..', 'jpn2easy', 'french-curriculum')
const DB_DIR = path.join(root, 'public/data/kanjidb')
const OUT_FILE = path.join(DB_DIR, 'french.json')

// ------------------------------------------------------------- the check
const FR_STOPWORDS = new Set([
  'a', 'au', 'aux', 'ce', 'cette', 'd', 'dans', 'de', 'des', 'du', 'elle',
  'en', 'est', 'et', 'etre', 'il', 'l', 'la', 'le', 'les', 'on', 'par',
  'pour', 'que', 'qui', 's', 'sa', 'ses', 'son', 'sur', 'un', 'une', 'y',
])

/** French text → set of content tokens (see the rule above). */
export function frTokens(text) {
  const norm = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  const out = new Set()
  for (const w of norm.split(/[^a-z]+/)) {
    if (w.length > 1 && !FR_STOPWORDS.has(w)) out.add(w)
  }
  return out
}

/**
 * Cross-check one booklet French gloss against KANJIDIC2's French
 * meanings for the same kanji. Pure — pinned by tests on hand-verified
 * examples from the real data (tests/kanjidb.test.mjs).
 */
export function meaningFrCheckFor(bookletMeaningFr, dictMeaningsFr) {
  const a = frTokens(bookletMeaningFr)
  const b = new Set()
  for (const s of dictMeaningsFr || []) for (const t of frTokens(s)) b.add(t)
  if (a.size === 0 || b.size === 0) return null
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const coeff = inter / Math.min(a.size, b.size)
  return coeff >= 0.5 ? 'agrees' : 'differs'
}

// ------------------------------------------------------------------ main
function main() {
  const curriculum = JSON.parse(fs.readFileSync(path.join(FRENCH_DIR, 'curriculum-index.json'), 'utf8'))
  const bookletEntries = JSON.parse(fs.readFileSync(path.join(FRENCH_DIR, 'entries-L19-L25.json'), 'utf8'))
  const bookletByChar = new Map(bookletEntries.map((e) => [e.char, e]))

  const indexRows = JSON.parse(fs.readFileSync(path.join(DB_DIR, 'index.json'), 'utf8'))
  const indexChars = new Set(indexRows.map((r) => r[0]))

  // KANJIDIC2 French meanings, from the generated meta shards.
  const metaFr = new Map()
  for (const f of fs.readdirSync(path.join(DB_DIR, 'meta')).filter((f) => f.endsWith('.json'))) {
    const shard = JSON.parse(fs.readFileSync(path.join(DB_DIR, 'meta', f), 'utf8'))
    for (const [ch, meta] of Object.entries(shard)) metaFr.set(ch, meta.meaningsFr || [])
  }

  const entries = {}
  const counts = {
    kanji: 0,
    withThemes: 0,
    withLesson: 0,
    withRadicalNameFr: 0,
    checkAgrees: 0,
    checkDiffers: 0,
    checkNull: 0,
    notInKanjidbIndex: 0,
  }
  for (const [ch, row] of Object.entries(curriculum.index || {})) {
    const booklet = bookletByChar.get(ch) || null
    const themes = Array.isArray(row.themes) ? row.themes : []
    const lesson = Array.isArray(row.lessons) && row.lessons.length ? row.lessons[0] : null
    const radicalNameFr = booklet?.radical?.nameFr ? booklet.radical.nameFr : null
    const radicalChar = booklet?.radical?.char ? booklet.radical.char : null
    const check = booklet ? meaningFrCheckFor(booklet.meaningFr, metaFr.get(ch)) : null
    entries[ch] = { themes, lesson, radicalChar, radicalNameFr, meaningFrCheck: check }
    counts.kanji++
    if (themes.length) counts.withThemes++
    if (lesson != null) counts.withLesson++
    if (radicalNameFr) counts.withRadicalNameFr++
    if (check === 'agrees') counts.checkAgrees++
    else if (check === 'differs') counts.checkDiffers++
    else counts.checkNull++
    if (!indexChars.has(ch)) counts.notInKanjidbIndex++
  }

  const out = {
    manifest: {
      sources: {
        curriculum: 'Licence japonais curriculum extraction (INALCO booklets L19–L25 + semester theme lists S5/S6) — personal reference layer, ~/workspace/jpn2easy/french-curriculum/',
        kanjidb: 'KanjiDB v2 (KANJIDIC2 via scripts/build-kanjidb.mjs) — French meanings cross-checked, never overwritten',
      },
      rights: 'INALCO booklet text is used ONLY as a cross-check signal and as short factual tags (theme names, radical French names). No booklet compounds, examples, or gloss lines are copied into this file.',
      checkRule: 'meaningFrCheck: content-token sets (lowercase, accents stripped, French stopwords + single letters dropped) of the booklet gloss vs KANJIDIC2 meaningsFr; agrees when |A∩B| / min(|A|,|B|) ≥ 0.5, differs below that, null when either side has no French text. A QA signal, not a correctness verdict — synonyms in different words score differs.',
      counts,
    },
    entries,
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(out))
  console.log(`french.json: ${counts.kanji} kanji · themes ${counts.withThemes} · lessons ${counts.withLesson} · radicalNameFr ${counts.withRadicalNameFr} · check agrees ${counts.checkAgrees} / differs ${counts.checkDiffers} / null ${counts.checkNull} · not in kanjidb index: ${counts.notInKanjidbIndex}`)
  console.log(`wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} kB)`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
