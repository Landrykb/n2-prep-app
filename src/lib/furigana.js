// Shared helpers for the app-wide furigana toggle.
//
// segmentFurigana() greedily matches the longest dictionary word starting at
// each position, so multi-kanji compounds (and words with okurigana, e.g.
// 食べる) get a single, correct reading instead of one per character.

/** Katakana -> hiragana, so on-yomi readings render as furigana normally would. */
export function toHiragana(str) {
  return str.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

/**
 * Dictionary reading fields are mostly clean kana, but a few (single kanji
 * merged from on/kun lesson data) look like "ろく · の(ばす), の(べる)" or
 * "イチ・イツ". Take the first reading only and drop okurigana markers.
 */
export function cleanReading(raw) {
  if (!raw) return ''
  const first = raw.split(/[·・,、]/)[0].trim()
  if (!first) return ''
  const stripped = first.split(/[(.]/)[0].trim()
  return toHiragana(stripped)
}

/** Build a first-character index so segmentation doesn't scan the whole dictionary per position. */
export function buildFuriganaIndex(dict) {
  const map = new Map()
  for (const entry of dict.byLength) {
    if (!entry.word || !entry.reading) continue
    const c = entry.word[0]
    if (!map.has(c)) map.set(c, [])
    map.get(c).push(entry)
  }
  return map
}

/**
 * Split `text` into { type: 'w', text, reading } for recognised dictionary
 * words and { type: 'c', text } for everything else (punctuation, kana,
 * unrecognised kanji), preserving order and full coverage of the input.
 */
export function segmentFurigana(text, index) {
  const parts = []
  let rest = text
  while (rest.length > 0) {
    const candidates = index.get(rest[0])
    let match = null
    if (candidates) {
      for (const candidate of candidates) {
        if (rest.startsWith(candidate.word)) {
          match = candidate
          break
        }
      }
    }
    if (match) {
      parts.push({ type: 'w', text: match.word, reading: cleanReading(match.reading) })
      rest = rest.slice(match.word.length)
    } else {
      parts.push({ type: 'c', text: rest[0] })
      rest = rest.slice(1)
    }
  }
  return parts
}
