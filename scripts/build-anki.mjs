import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const levels = ['n5', 'n4', 'n3', 'n2', 'n1']
const levelEmoji = { N5: '🔵', N4: '🟢', N3: '🟡', N2: '🟠', N1: '🔴' }

const cards = []
for (const level of levels) {
  const res = await fetch(`https://raw.githubusercontent.com/evanclan/OpenJLPT/main/data/json/vocab/${level}.json`)
  if (!res.ok) throw new Error(`Failed to fetch ${level}: ${res.status}`)
  const data = await res.json()
  for (const item of data) {
    const meaning = (item.meanings || []).join(', ')
    const reading = item.reading || ''
    const back = reading ? `${item.word} (${reading}) — ${meaning}` : `${item.word} — ${meaning}`
    cards.push({
      id: cards.length + 1,
      front: item.word,
      back,
      tag: 'Vocab',
      level: item.level,
      image: levelEmoji[item.level] || '📝',
    })
  }
}

writeFileSync(join(__dirname, '..', 'public', 'data', 'ankiVocab.json'), JSON.stringify(cards) + '\n')
console.log(`Wrote ${cards.length} Anki cards to public/data/ankiVocab.json`)
