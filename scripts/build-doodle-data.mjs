import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const emojiData = JSON.parse(await fs.readFile('/tmp/emoji-en-US.json', 'utf8'))
const meaningEmoji = {}

for (const [emoji, keywords] of Object.entries(emojiData)) {
  for (const kw of keywords) {
    const words = String(kw).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    for (const w of words) {
      if (!meaningEmoji[w]) meaningEmoji[w] = emoji
    }
  }
}

const manual = {
  difficult: '⛰️', hard: '⛰️', tough: '⛰️', easy: '🍃', simple: '🍃', complicated: '🧩', complex: '🧬',
  year: '📅', years: '📅', age: '👴', month: '🌑', week: '📆', day: '🌞', hour: '🕐', minute: '⏱️', second: '⏱️', moment: '⏳',
  important: '⭐', necessary: '⭕', possible: '✅', impossible: '🚫', busy: '🏃', free: '🕊️', interesting: '👀', beautiful: '💐', ugly: '🤢',
  safe: '🛡️', dangerous: '⚠️', rich: '💎', poor: '🪙', expensive: '💸', cheap: '🏷️', comfortable: '🛋️', quiet: '🤫', loud: '📢',
  kind: '❤️', rude: '🙅', friendly: '🤝', polite: '🙇', popular: '🌟', famous: '🏆', lucky: '🍀', unlucky: '🌧️', honest: '🤝', dishonest: '🐍',
  healthy: '💚', sick: '🤒', strong: '💪', weak: '🦴', full: '📛', empty: '🕳️', enough: '✅', special: '💎', normal: '🔹',
  high: '🏔️', low: '🕳️', long: '📏', short: '🤏', near: '📍', far: '🛣️', early: '🐦', late: '🕰️', warm: '☕', cool: '🍃',
  dry: '🏜️', wet: '💧', clean: '🧼', dirty: '🐷', clear: '🪟', cloudy: '☁️', bright: '💡', dark: '🌑', soft: '🧸', smooth: '🧊', rough: '🌵',
  sweet: '🍯', bitter: '🍋', salty: '🧂', sour: '🍋', spicy: '🌶️', delicious: '😋', tasty: '😋',
  happy: '😊', sad: '😢', angry: '😠', love: '❤️', hate: '💔', like: '👍', dislike: '👎', enjoy: '🎉', fun: '🎉', funny: '😂',
  bored: '😴', tired: '😴', sleepy: '😪', nervous: '😰', calm: '🧘', worried: '😟', afraid: '😱', scared: '😱', brave: '🦁',
  surprised: '😲', excited: '🤩', relaxed: '😌', lonely: '🧍', shy: '🙈', proud: '🦚', embarrassed: '😳',
  go: '🚶', come: '➡️', leave: '🚪', arrive: '📍', travel: '✈️', run: '🏃', walk: '🚶', drive: '🚗', fly: '✈️', ride: '🚲',
  study: '📚', learn: '🧠', teach: '🧑‍🏫', school: '🏫', student: '👩‍🎓', teacher: '👨‍🏫',
  eat: '🍽️', drink: '🥤', food: '🍱', meal: '🍽️', hungry: '😋', thirsty: '🥛', cook: '👨‍🍳', restaurant: '🍽️',
  morning: '🌅', afternoon: '🌞', evening: '🌇', night: '🌃', midnight: '🕛', noon: '🕛', dawn: '🌅', dusk: '🌆',
  now: '⏰', then: '⏳', soon: '⏩', later: '⏳', before: '⏮️', after: '⏭️', during: '⏳', while: '⏳', until: '⏳', since: '⏳', ago: '⏪',
  here: '📍', there: '👉', everywhere: '🌐', somewhere: '❓', nowhere: '🚫', up: '⬆️', down: '⬇️', left: '⬅️', right: '➡️',
  front: '🔜', back: '🔙', between: '↔️', among: '👥', through: '➡️', across: '↔️', along: '➡️', around: '🔄', over: '⬆️', under: '⬇️',
  behind: '🔙', beyond: '➡️', close: '📍', away: '➡️', together: '👥', apart: '↔️',
  always: '♾️', never: '🚫', often: '🔁', sometimes: '🎲', usually: '📅', rarely: '🪙', again: '🔁', once: '1️⃣', twice: '2️⃣',
  if: '❓', because: '💡', so: '➡️', although: '🤷', though: '🤷', unless: '🚫', whether: '❓', either: '↔️', neither: '🚫', both: '👥',
  each: '1️⃣', another: '➕', other: '↔️', such: '👇', same: '👯', similar: '≈', unlike: '👎', about: '💬', against: '🥊',
  except: '➖', including: '➕', plus: '➕', minus: '➖', times: '✖️', divided: '➗', equal: '🟰'
}

for (const [w, e] of Object.entries(manual)) {
  meaningEmoji[w] = e
}

const kanjiData = JSON.parse(await fs.readFile('/tmp/kanji.json', 'utf8'))
const kanjiEmoji = {}

for (const [kanji, info] of Object.entries(kanjiData)) {
  const emojis = []
  const wk = (info.wk_meanings || []).filter(Boolean)
  const mns = (info.meanings || []).filter(Boolean)
  const allMeanings = [...wk, ...mns]
  for (const m of allMeanings) {
    const words = String(m)
      .toLowerCase()
      .replace(/^[!^]+/, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
    for (const w of words) {
      const e = meaningEmoji[w]
      if (e && !emojis.includes(e)) {
        emojis.push(e)
      }
      if (emojis.length >= 3) break
    }
    if (emojis.length >= 3) break
  }
  if (emojis.length > 0) {
    kanjiEmoji[kanji] = emojis.length === 1 ? emojis[0] + '✨' : emojis.slice(0, 3).join('')
  }
}

const outDir = path.join(__dirname, '..', 'public', 'data')
await fs.mkdir(outDir, { recursive: true })
await fs.writeFile(
  path.join(outDir, 'doodleData.json'),
  JSON.stringify({ meaningEmoji, kanjiEmoji })
)

console.log(`Wrote ${Object.keys(kanjiEmoji).length} kanji emojis and ${Object.keys(meaningEmoji).length} meaning emojis.`)
