// Data integrity checks for the study content.
// Run with: npm run validate
//
// Catches the classes of bug that are easy to introduce by hand-editing the
// data files: quizzes with zero/multiple correct answers, duplicate answer
// options, readings that contain kanji, unknown level tags, and broken links
// between vocabulary levels and quiz levels.

import { readFileSync } from 'node:fs'
import { kanjiLessons, grammarLessons, vocabLessons, passages, questions, commonWords } from '../src/data.js'
import { bjtVocab, bjtLevels, bjtKeigo, bjtPassages, bjtListening, bjtDailyQuestions, bjtStrategy, bjtScoreMapping } from '../src/data/bjt.js'
import { n2Listening } from '../src/data/n2Listening.js'
import { parseDeckEntry } from '../src/lib/dictionary.js'

const problems = []
const fail = (where, msg) => problems.push(`${where}: ${msg}`)

const KANA = /^[\u3040-\u309f\u30a0-\u30ff・\s（）()、.,\-ー]*$/
const HAS_KANJI = /[\u4e00-\u9faf]/

/** Every multiple-choice group must have exactly one correct, unique options. */
function checkChoices(label, list) {
  list.forEach((q, i) => {
    const at = `${label}[${i}]`
    if (!Array.isArray(q.options)) return fail(at, 'missing options array')
    const correct = q.options.filter((o) => o.correct)
    if (correct.length !== 1) fail(at, `has ${correct.length} correct options (expected 1) — "${q.prompt}"`)
    const labels = q.options.map((o) => o.label)
    const dupes = labels.filter((l, j) => labels.indexOf(l) !== j)
    if (dupes.length) fail(at, `duplicate options ${JSON.stringify([...new Set(dupes)])} — "${q.prompt}"`)
    if (!q.prompt) fail(at, 'missing prompt')
  })
}

checkChoices('bjtDailyQuestions', bjtDailyQuestions)
bjtPassages.forEach((p, i) => checkChoices(`bjtPassages[${i}].questions`, p.questions))
bjtListening.forEach((l, i) => checkChoices(`bjtListening[${i}].questions`, l.questions))
n2Listening.forEach((l, i) => checkChoices(`n2Listening[${i}].questions`, l.questions))

// data.js drill questions use a different shape (options + answer index/value).
questions.forEach((q, i) => {
  if (!q.options?.length) fail(`questions[${i}]`, 'missing options')
  const correct = q.options.filter((o) => o.correct)
  if (correct.length !== 1) fail(`questions[${i}]`, `has ${correct.length} correct options — "${q.prompt}"`)
})

// Readings should be kana only (a kanji in the reading field is always a bug).
const checkReadings = (label, list, wordKey = 'word', readingKey = 'reading') => {
  list.forEach((e, i) => {
    const r = e[readingKey]
    if (!r) return
    if (HAS_KANJI.test(r)) fail(`${label}[${i}]`, `reading "${r}" for ${e[wordKey]} contains kanji`)
    else if (!KANA.test(r)) fail(`${label}[${i}]`, `reading "${r}" for ${e[wordKey]} is not kana`)
  })
}
checkReadings('bjtVocab', bjtVocab)
checkReadings('vocabLessons', vocabLessons)
checkReadings('commonWords', commonWords)
passages.forEach((p, i) => checkReadings(`passages[${i}].glossary`, p.glossary))

// Level tags must be known values.
const validBjt = new Set(bjtLevels)
bjtVocab.forEach((v, i) => { if (!validBjt.has(v.level)) fail(`bjtVocab[${i}]`, `unknown level "${v.level}" for ${v.word}`) })
bjtDailyQuestions.forEach((q, i) => { if (!validBjt.has(q.level)) fail(`bjtDailyQuestions[${i}]`, `unknown level "${q.level}"`) })
bjtPassages.forEach((p, i) => { if (!validBjt.has(p.level)) fail(`bjtPassages[${i}]`, `unknown level "${p.level}"`) })
bjtListening.forEach((l, i) => { if (!validBjt.has(l.level)) fail(`bjtListening[${i}]`, `unknown level "${l.level}"`) })

// Every level needs study guidance, otherwise the BJT strategy panel is blank.
bjtLevels.forEach((lv) => { if (!bjtStrategy[lv]) fail('bjtStrategy', `missing strategy for level ${lv}`) })
bjtScoreMapping.forEach((m, i) => { if (!m.bjt || !m.score) fail(`bjtScoreMapping[${i}]`, 'missing bjt/score') })

// The same word should not be tagged with conflicting BJT levels.
const vocabLevel = new Map()
bjtVocab.forEach((v) => {
  if (vocabLevel.has(v.word) && vocabLevel.get(v.word) !== v.level) {
    fail('bjtVocab', `"${v.word}" tagged as both ${vocabLevel.get(v.word)} and ${v.level}`)
  }
  vocabLevel.set(v.word, v.level)
})

// Keigo table must be fully populated.
bjtKeigo.forEach((k, i) => {
  ;['plain', 'sonkei', 'kenjou', 'scene'].forEach((f) => { if (!k[f]) fail(`bjtKeigo[${i}]`, `missing ${f}`) })
  if (k.sonkei === k.kenjou) fail(`bjtKeigo[${i}]`, `sonkeigo and kenjougo identical ("${k.sonkei}") for ${k.plain}`)
})

// Replacement characters / traditional-Chinese forms that slipped into content.
const RAW_FILES = ['src/data.js', 'src/data/bjt.js', 'src/data/n2Listening.js']
for (const f of RAW_FILES) {
  const text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
  if (text.includes('\uFFFD')) fail(f, 'contains U+FFFD replacement character')
  for (const bad of ['點', '數', '稰', '會', '學']) {
    if (text.includes(bad)) fail(f, `contains non-Japanese character "${bad}"`)
  }
}

// Kanji lessons: char must be a single kanji, radicals must be present.
kanjiLessons.forEach((k, i) => {
  if ([...k.char].length !== 1) fail(`kanjiLessons[${i}]`, `char "${k.char}" is not a single character`)
  if (!k.radicals?.length) fail(`kanjiLessons[${i}]`, `${k.char} has no radicals`)
})
grammarLessons.forEach((g, i) => { if (!g.pattern || !g.meaning) fail(`grammarLessons[${i}]`, 'missing pattern/meaning') })

// The bundled deck must parse cleanly into word/reading/meaning.
try {
  const deck = JSON.parse(readFileSync(new URL('../public/data/ankiVocab.json', import.meta.url), 'utf8'))
  const parsed = deck.map(parseDeckEntry)
  const badReading = parsed.filter((e) => /[()（）—]/.test(e.reading))
  if (badReading.length) fail('ankiVocab', `${badReading.length} entries have malformed readings`)
  const noMeaning = parsed.filter((e) => !e.meaning)
  if (noMeaning.length) fail('ankiVocab', `${noMeaning.length} entries have no meaning`)
  const noWord = parsed.filter((e) => !e.word)
  if (noWord.length) fail('ankiVocab', `${noWord.length} entries have no word`)
  console.log(`deck: ${deck.length} rows parsed, ${parsed.filter((e) => e.reading).length} with readings`)
} catch (err) {
  fail('ankiVocab', `could not read/parse deck (${err.message})`)
}

console.log(
  `content: ${kanjiLessons.length} kanji, ${grammarLessons.length} grammar, ${vocabLessons.length} vocab, ` +
  `${commonWords.length} common, ${questions.length} drills, ${bjtVocab.length} BJT vocab, ${bjtDailyQuestions.length} BJT drills`
)

if (problems.length) {
  console.error(`\n✗ ${problems.length} data problem(s):`)
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('\n✓ all data checks passed')
