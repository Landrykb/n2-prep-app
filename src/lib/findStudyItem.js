import { kanjiLessons, vocabLessons, grammarLessons, passages, commonWords } from '../data.js'

export const studyItems = [
  ...kanjiLessons.map((k) => ({ ...k, _key: k.char, _type: 'Kanji' })),
  ...vocabLessons.map((v) => ({ ...v, _key: v.word, _type: 'Vocab' })),
  ...grammarLessons.map((g) => ({ ...g, _key: g.pattern, _type: 'Grammar' })),
  ...passages.flatMap((p) => p.glossary.map((g) => ({ ...g, _key: g.word, _type: 'Glossary', _passage: p.title }))),
  ...commonWords.map((c) => ({ ...c, _key: c.word, _type: 'Common' })),
].sort((a, b) => b._key.length - a._key.length)

export const studyItemByKey = new Map(studyItems.map((i) => [i._key, i]))

export function findStudyItem(word) {
  if (!word) return null
  const clean = word.trim()
  return studyItemByKey.get(clean) || studyItems.find((i) => clean.startsWith(i._key)) || null
}
