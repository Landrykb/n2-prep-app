// Mock exam generator — builds a JLPT N2-shaped paper entirely from the
// app's authoritative data (vocabLessons, commonWords, grammarLessons,
// questions, passages, n2Listening). Nothing here invents Japanese text:
// every prompt, option, and explanation is lifted from real study content.
//
// Generation is deterministic for a given seed (mulberry32 via shuffle.js) so
// a refreshed page can rebuild the identical paper.

import { grammarLessons, vocabLessons, passages, questions, commonWords } from '../data.js'
import { n2Listening } from '../data/n2Listening.js'
import { seededRandom, shuffleWithSeed } from './shuffle.js'

const KANJI_RE = /[㐀-䶿一-龿]/
const hasKanji = (w) => KANJI_RE.test(w)

export const TYPE_LABEL = {
  'kanji-reading': '漢字読み',
  'orthography': '表記',
  'vocab-meaning': '文脈規定・言い換え',
  'grammar-form': '文法形式',
  'sentence-structure': '文の組み立て',
  'reading': '読解',
  'listening': '聴解',
}

// Which scaled section each question type feeds into.
const TYPE_SECTION = {
  'reading': 'reading',
  'listening': 'listening',
}
export const typeSection = (type) => TYPE_SECTION[type] || 'lk'

// Words usable as kanji-reading / orthography / vocab-meaning items.
const WORDS = [
  ...vocabLessons.map((v) => ({ word: v.word, reading: v.reading, meaning: v.meaning, example: v.example || '' })),
  ...commonWords.map((w) => ({ word: w.word, reading: w.reading, meaning: w.meaning, example: '' })),
].filter((w) => w.word && w.reading && w.meaning && hasKanji(w.word))

const uniqueWords = (() => {
  const seen = new Set()
  return WORDS.filter((w) => !seen.has(w.word) && seen.add(w.word))
})()

// Grammar lessons whose example literally contains the cleaned pattern, so the
// blanked-out sentence is guaranteed to be a real usage.
const cleanPattern = (pattern) =>
  pattern.replace(/^〜/, '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim()

const GRAMMAR_BLANKS = grammarLessons
  .map((g) => ({ lesson: g, cleaned: cleanPattern(g.pattern) }))
  .filter(({ lesson, cleaned }) => cleaned.length >= 2 && lesson.example && lesson.example.includes(cleaned))

const MEANING_DRILLS = questions.filter((q) => q.type === 'Vocabulary' && q.format === 'meaning')
const STRUCTURE_DRILLS = questions.filter((q) => q.type === 'Grammar' && q.format === 'structure')

/** Pick `n` distractor values from a pool, unique and not equal to `correct`. */
function distractors(pool, correct, n, rand, key = (x) => x) {
  const out = []
  const used = new Set([correct])
  const shuffled = [...pool].sort(() => rand() - 0.5)
  for (const item of shuffled) {
    const label = key(item)
    if (!label || used.has(label)) continue
    used.add(label)
    out.push(item)
    if (out.length === n) break
  }
  return out
}

function makeOptions(correctLabel, wrongLabels, seed) {
  const opts = [{ label: correctLabel, correct: true }, ...wrongLabels.map((l) => ({ label: l, correct: false }))]
  return shuffleWithSeed(opts, seed)
}

const PLANS = {
  quick: { timeA: 25, timeB: 10, kanji: 5, orthography: 4, vocabMeaning: 6, grammarForm: 8, structure: 4, passages: 2, listening: 2 },
  full: { timeA: 105, timeB: 50, kanji: 10, orthography: 8, vocabMeaning: 12, grammarForm: 16, structure: Infinity, passages: Infinity, listening: Infinity },
}

export const MOCK_LENGTHS = {
  quick: { label: 'Quick mock', desc: 'Short paper — one sit-down practice run', timeA: 25, timeB: 10 },
  full: { label: 'Full mock', desc: 'Real N2 timing and every bank item', timeA: 105, timeB: 50 },
}

export function buildMockExam(length = 'quick', seed = Date.now() % 2147483647) {
  const plan = PLANS[length] || PLANS.quick
  const rand = seededRandom(seed)
  let qid = 0
  const id = () => `q${seed.toString(36)}-${qid++}`

  // --- 問題1 漢字読み: kanji word → correct reading -----------------------
  const kanjiPool = shuffleWithSeed(uniqueWords.filter((w) => w.reading.length >= 2), seed + 1)
  const kanjiQs = kanjiPool.slice(0, plan.kanji).map((w, i) => {
    const near = uniqueWords.filter((x) => x.word !== w.word && Math.abs(x.reading.length - w.reading.length) <= 2)
    const ds = distractors(near, w.reading, 3, rand, (x) => x.reading)
    if (ds.length < 3) {
      const picked = new Set(ds.map((x) => x.reading))
      ds.push(...distractors(uniqueWords.filter((x) => x.word !== w.word && !picked.has(x.reading)), w.reading, 3 - ds.length, rand, (x) => x.reading))
    }
    return {
      id: id(), type: 'kanji-reading', group: '問題1 漢字読み',
      prompt: w.example || `次の言葉の読み方：「${w.word}」`,
      target: w.word,
      options: makeOptions(w.reading, ds.map((x) => x.reading), seed + 100 + i),
      explanation: `${w.word} は「${w.reading}」と読みます。意味: ${w.meaning}`,
    }
  })

  // --- 問題2 表記: reading → correct kanji spelling ------------------------
  const orthoPool = shuffleWithSeed(uniqueWords.filter((w) => !kanjiQs.some((q) => q.target === w.word)), seed + 2)
  const orthoQs = orthoPool.slice(0, plan.orthography).map((w, i) => {
    const near = uniqueWords.filter((x) => x.word !== w.word && Math.abs(x.word.length - w.word.length) <= 1)
    const ds = distractors(near, w.word, 3, rand, (x) => x.word)
    if (ds.length < 3) {
      const picked = new Set(ds.map((x) => x.word))
      ds.push(...distractors(uniqueWords.filter((x) => x.word !== w.word && !picked.has(x.word)), w.word, 3 - ds.length, rand, (x) => x.word))
    }
    return {
      id: id(), type: 'orthography', group: '問題2 表記',
      prompt: `「${w.reading}」(${w.meaning}) — 漢字での表記として最もよいものを選びなさい。`,
      target: w.word,
      options: makeOptions(w.word, ds.map((x) => x.word), seed + 200 + i),
      explanation: `「${w.reading}」は「${w.word}」と書きます。意味: ${w.meaning}`,
    }
  })

  // --- 問題3 文脈規定・言い換え: word → meaning -----------------------------
  const generatedMeaning = shuffleWithSeed(
    uniqueWords.filter((w) => !kanjiQs.some((q) => q.target === w.word) && !orthoQs.some((q) => q.target === w.word)),
    seed + 3,
  ).map((w, i) => {
    const ds = distractors(uniqueWords, w.meaning, 3, rand, (x) => x.meaning)
    return {
      id: id(), type: 'vocab-meaning', group: '問題3 文脈規定・言い換え',
      prompt: w.example ? `${w.example}` : `「${w.word}」の意味として最もよいものを選びなさい。`,
      target: w.word,
      options: makeOptions(w.meaning, ds.map((x) => x.meaning), seed + 300 + i),
      explanation: `${w.word}（${w.reading}）= ${w.meaning}`,
    }
  })
  const drillMeaning = MEANING_DRILLS.map((q) => ({
    id: id(), type: 'vocab-meaning', group: '問題3 文脈規定・言い換え',
    prompt: q.prompt, target: q.target, options: q.options, explanation: q.explanation,
  }))
  const meaningQs = shuffleWithSeed([...generatedMeaning, ...drillMeaning], seed + 4).slice(0, plan.vocabMeaning)

  // --- 問題4 文法形式の判断: blanked example → correct pattern -------------
  const grammarQs = shuffleWithSeed(GRAMMAR_BLANKS, seed + 5).slice(0, plan.grammarForm).map(({ lesson, cleaned }, i) => {
    const ds = distractors(grammarLessons, lesson.pattern, 3, rand, (x) => x.pattern)
    return {
      id: id(), type: 'grammar-form', group: '問題4 文法形式の判断',
      prompt: lesson.example.replace(cleaned, '＿＿＿'),
      target: lesson.pattern,
      options: makeOptions(lesson.pattern, ds.map((x) => x.pattern), seed + 400 + i),
      explanation: `${lesson.pattern} = ${lesson.meaning}`,
    }
  })

  // --- 問題5 文の組み立て ----------------------------------------------------
  const structureQs = shuffleWithSeed(STRUCTURE_DRILLS, seed + 6).slice(0, plan.structure).map((q) => ({
    id: id(), type: 'sentence-structure', group: '問題5 文の組み立て',
    prompt: q.prompt, target: q.target, options: q.options, explanation: q.explanation,
  }))

  // --- 問題6 読解: passages --------------------------------------------------
  const readingGroups = shuffleWithSeed(passages, seed + 7).slice(0, plan.passages).map((p) => ({
    name: '問題6 読解',
    intro: '次の文章を読んで、後の問いに対する答えとして最もよいものを選びなさい。',
    passage: { title: p.title, text: p.text, glossary: p.glossary },
    questions: p.questions.map((q) => ({
      id: id(), type: 'reading', group: '問題6 読解',
      prompt: q.prompt, options: q.options, explanation: q.explanation,
    })),
  }))

  // --- 聴解 ------------------------------------------------------------------
  const listeningGroups = shuffleWithSeed(n2Listening, seed + 8).slice(0, plan.listening).map((l) => ({
    name: '問題1 聴解',
    intro: '音声を聞いて、質問と選択肢から最もよい答えを選びなさい。',
    listening: { title: l.title, script: l.script },
    questions: l.questions.map((q) => ({
      id: id(), type: 'listening', group: '問題1 聴解',
      prompt: q.prompt, options: q.options, explanation: q.explanation,
    })),
  }))

  return {
    length,
    seed,
    sections: [
      {
        id: 'A',
        name: '言語知識（文字・語彙・文法）・読解',
        timeMin: plan.timeA,
        groups: [
          { name: '問題1 漢字読み', intro: '＿＿＿の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。', questions: kanjiQs },
          { name: '問題2 表記', intro: '＿＿＿の言葉を漢字で書くとき、最もよいものを選びなさい。', questions: orthoQs },
          { name: '問題3 文脈規定・言い換え', intro: '＿＿＿に入れるのに最もよいものを、1・2・3・4から一つ選びなさい。', questions: meaningQs },
          { name: '問題4 文法形式の判断', intro: '＿＿＿に入れるのに最もよいものを、1・2・3・4から一つ選びなさい。', questions: grammarQs },
          { name: '問題5 文の組み立て', intro: '＿＿＿に入れるのに最もよいものを、1・2・3・4から一つ選びなさい。', questions: structureQs },
          ...readingGroups,
        ].filter((g) => g.questions.length > 0),
      },
      {
        id: 'B',
        name: '聴解',
        timeMin: plan.timeB,
        groups: listeningGroups,
      },
    ],
  }
}

/** Flatten a section's groups into a single ordered question list. */
export function flattenSection(section) {
  return section.groups.flatMap((g) => g.questions.map((q) => ({ ...q, _group: g })))
}

/** Score an attempt: per-type tallies and the three scaled section scores. */
export function scoreExam(exam, answers) {
  const byType = {}
  const tally = (q) => {
    const label = TYPE_LABEL[q.type] || q.type
    byType[label] = byType[label] || { correct: 0, total: 0 }
    byType[label].total += 1
    const sel = answers[q.id]
    const ok = sel !== undefined && q.options[sel]?.correct
    if (ok) byType[label].correct += 1
    return ok
  }

  let lkC = 0, lkT = 0, rdC = 0, rdT = 0, lsC = 0, lsT = 0
  const wrong = []
  for (const section of exam.sections) {
    for (const group of section.groups) {
      for (const q of group.questions) {
        const ok = tally(q)
        const bucket = typeSection(q.type)
        if (bucket === 'lk') { lkT++; if (ok) lkC++ }
        else if (bucket === 'reading') { rdT++; if (ok) rdC++ }
        else { lsT++; if (ok) lsC++ }
        if (!ok) wrong.push({ question: q, group, selected: answers[q.id] })
      }
    }
  }

  const scaled = {
    lk: lkT ? Math.round((lkC / lkT) * 60) : 0,
    reading: rdT ? Math.round((rdC / rdT) * 60) : 0,
    listening: lsT ? Math.round((lsC / lsT) * 60) : 0,
  }
  scaled.total = scaled.lk + scaled.reading + scaled.listening
  const passed = scaled.total >= 90 && scaled.lk >= 19 && scaled.reading >= 19 && scaled.listening >= 19

  return { scaled, passed, byType, wrong }
}
