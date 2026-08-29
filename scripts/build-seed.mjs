import { kanjiLessons, grammarLessons, vocabLessons, passages, ankiCards, questions } from '../src/data.js'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const esc = (s) => (s ?? '').toString().replaceAll("'", "''")

const rows = []

kanjiLessons.forEach((k) => {
  rows.push({
    source: `kanji:${k.char}`,
    content: [
      `Kanji: ${k.char}`,
      `Meaning: ${k.meaning}${k.meaningFr ? ` / ${k.meaningFr}` : ''}`,
      `On: ${k.on}, Kun: ${k.kun}`,
      `Word: ${k.word}`,
      `Story: ${k.story}`,
      `Example: ${k.example}`,
    ].join('\n'),
    metadata: { emoji: k.emoji, radicals: k.radicals, type: 'kanji' },
  })
})

grammarLessons.forEach((g) => {
  rows.push({
    source: `grammar:${g.pattern}`,
    content: [
      `Pattern: ${g.pattern}`,
      `Form: ${g.form}`,
      `Meaning: ${g.meaning}${g.meaningFr ? ` / ${g.meaningFr}` : ''}`,
      `Nuance: ${g.nuance}`,
      `Scene: ${g.scene}`,
      `Example: ${g.example}`,
    ].join('\n'),
    metadata: { image: g.image, type: 'grammar' },
  })
})

vocabLessons.forEach((v) => {
  rows.push({
    source: `vocab:${v.word}`,
    content: [
      `Word: ${v.word} (${v.reading})`,
      `Meaning: ${v.meaning}${v.meaningFr ? ` / ${v.meaningFr}` : ''}`,
      `Collocation: ${v.collocation}`,
      `Story: ${v.story}`,
      `Example: ${v.example}`,
    ].join('\n'),
    metadata: { image: v.image, type: 'vocab' },
  })
})

passages.forEach((p) => {
  rows.push({
    source: `passage:${p.title}`,
    content: [
      `Title: ${p.title}`,
      `Level: ${p.level}, Time: ${p.time} min`,
      `Text: ${p.text}`,
      `Glossary: ${p.glossary.map((g) => `${g.word} (${g.reading}) — ${g.meaning}`).join('; ')}`,
      `Questions: ${p.questions.map((q, i) => `${i + 1}. ${q.prompt} Correct: ${q.options.find((o) => o.correct)?.label}`).join('; ')}`,
    ].join('\n'),
    metadata: { level: p.level, time: p.time, type: 'passage' },
  })
})

ankiCards.forEach((c) => {
  rows.push({
    source: `anki:${c.front}`,
    content: `Front: ${c.front}\nBack: ${c.back}\nTag: ${c.tag}`,
    metadata: { image: c.image, type: 'anki' },
  })
})

questions.forEach((q) => {
  rows.push({
    source: `drill:${q.id}`,
    content: [
      `Type: ${q.type}, Format: ${q.format}`,
      `Prompt: ${q.prompt}`,
      `Target: ${q.target || 'none'}`,
      `Options: ${q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.label}`).join(', ')}`,
      `Correct: ${String.fromCharCode(65 + q.options.findIndex((o) => o.correct))}`,
      `Explanation: ${q.explanation}`,
      `Hint: ${q.hint}`,
    ].join('\n'),
    metadata: { type: 'drill' },
  })
})

const sql = [
  'delete from public.n2_chunks;',
  ...rows.map(
    (r) =>
      `insert into public.n2_chunks (content, source, metadata) values ('${esc(r.content)}', '${esc(r.source)}', '${esc(JSON.stringify(r.metadata))}'::jsonb);`
  ),
].join('\n')

writeFileSync(join(__dirname, '..', 'supabase', 'seed.sql'), sql + '\n')
console.log(`Wrote ${rows.length} chunks to supabase/seed.sql`)
