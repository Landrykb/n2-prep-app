// Heard Words — the client-side matcher (Doc 22, automatic mode).
//
// A deliberate mirror of the bot's matcher (reader-bot/ambient.ts):
// same normalisation, same expressions, same dictionary order,
// same longest-match walk, same defences. The two implementations
// must stay in step — a word the app counts is a word the bot
// would count. One difference of SOURCING only: the bot's curated
// glossaries (deck gloss + JMdict compounds) are bot-side data;
// here the app's own deck stands in for them, ahead of the same
// wide wordbook both sides fetch from /data/wordbook/.
//
// Privacy is structural, exactly as on the bot: matching runs
// locally over a recognised segment, the segment is dropped by
// the caller the moment this returns, and all that ever leaves
// the device is (item, kind) counts through bump_heard_words.

export const HEARD_FLOOR = 2

/** Business expressions, matched as units BEFORE word tokenization — mirror of EXPRESSIONS in reader-bot/ambient.ts (surfaces only; the register notes live bot-side). */
export const EXPRESSIONS = [
  'お世話になっております',
  'よろしくお願いいたします',
  '申し訳ございません',
  'お手数をおかけしますが',
  'ご査収ください',
  'ご確認ください',
  'ご連絡いたします',
  'ご検討ください',
  '恐れ入りますが',
  '承知いたしました',
  'かしこまりました',
  'お待たせしました',
  'お疲れ様です',
  '失礼いたします',
  '取り急ぎ',
  'ご認識のとおり',
]

const HAN = /\p{Script=Han}/u

/** Mirror of normalizeSpeechText (reader-bot/score.ts): NFKC fold, then every space, punctuation mark and symbol removed. */
export function normalizeSpeechText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/**
 * Build the match dictionary. Sources, first-wins (bot order):
 *   1. the app's deck (headword counts as itself, deck reading);
 *   2. the wide wordbook — headwords count as themselves, every
 *      other written form counts under its headword
 *      (のうき → 納期）.
 * Buckets are grouped by first character, then by length.
 */
export function buildHeardDict({ deckEntries = [], wordbook = null } = {}) {
  const itemOf = new Map()
  const readingsOf = new Map()
  const add = (surface, item) => {
    const s = normalizeSpeechText(surface)
    if (!s || itemOf.has(s)) return
    if (/^[0-9a-zA-Z]+$/.test(s)) return
    const it = normalizeSpeechText(item) || s
    if (/^[0-9a-zA-Z]+$/.test(it)) return
    itemOf.set(s, it)
  }
  for (const e of deckEntries) {
    if (!e?.word) continue
    add(e.word, e.word)
    const item = normalizeSpeechText(e.word)
    const reading = e.reading ? normalizeSpeechText(e.reading) : ''
    if (item && reading && reading !== item && !readingsOf.has(item)) readingsOf.set(item, reading)
  }
  const heads = Array.isArray(wordbook?.heads) ? wordbook.heads : []
  const wbReadings = Array.isArray(wordbook?.readings) ? wordbook.readings : []
  const wbForms = wordbook?.forms && typeof wordbook.forms === 'object' ? wordbook.forms : {}
  for (let i = 0; i < heads.length; i++) {
    add(heads[i], heads[i])
    const item = normalizeSpeechText(heads[i])
    const reading = wbReadings[i] ? normalizeSpeechText(wbReadings[i]) : ''
    if (item && reading && reading !== item && !readingsOf.has(item)) readingsOf.set(item, reading)
  }
  for (const [surface, idx] of Object.entries(wbForms)) {
    const head = heads[Number(idx)]
    if (head) add(surface, head)
  }
  // Deck readings win over the wordbook's for the same item.
  for (const e of deckEntries) {
    if (!e?.word || !e?.reading) continue
    const item = normalizeSpeechText(e.word)
    const reading = normalizeSpeechText(e.reading)
    if (item && reading && reading !== item) readingsOf.set(item, reading)
  }

  const byFirst = new Map()
  let maxLen = 0
  for (const s of itemOf.keys()) {
    const chars = [...s]
    if (!chars.length) continue
    if (chars.length > maxLen) maxLen = chars.length
    let byLen = byFirst.get(chars[0])
    if (!byLen) { byLen = new Map(); byFirst.set(chars[0], byLen) }
    let set = byLen.get(chars.length)
    if (!set) { set = new Set(); byLen.set(chars.length, set) }
    set.add(s)
  }
  return { byFirst, itemOf, readingsOf, maxLen }
}

let dictPromise = null

/**
 * The production dictionary: deck (already an app download) +
 * the wide wordbook from /data/wordbook/, fetched shard by shard
 * and merged. Cached for the page's life; a failed wordbook
 * fetch narrows recognition to the deck — it never breaks the
 * session (the bot's degradation rule, mirrored).
 * fetchImpl is injectable for tests.
 */
export function loadHeardDict({ fetchImpl = fetch, deckEntries = [] } = {}) {
  if (dictPromise) return dictPromise
  dictPromise = (async () => {
    let wordbook = null
    try {
      const manifestRes = await fetchImpl('/data/wordbook/manifest.json')
      const manifest = manifestRes.ok ? await manifestRes.json() : null
      const shardNames = Array.isArray(manifest?.shards) ? manifest.shards : []
      if (shardNames.length > 0) {
        // Shards fetch in PARALLEL and merge in manifest order —
        // a first load must never be the reason a press feels
        // dead (the bot's sequential fetch is its own choice;
        // the merge result is identical).
        const shards = await Promise.all(shardNames.map(async (name) => {
          const res = await fetchImpl(`/data/wordbook/${name}`)
          if (!res.ok) return null
          const shard = await res.json()
          return Array.isArray(shard?.heads) ? shard : null
        }))
        if (shards.every((s) => s)) {
          const merged = { heads: [], readings: [], forms: {} }
          for (const shard of shards) {
            merged.heads.push(...shard.heads)
            merged.readings.push(...(shard.readings ?? []))
            Object.assign(merged.forms, shard.forms ?? {})
          }
          if (merged.heads.length > 0) wordbook = merged
        }
      }
    } catch { wordbook = null }
    return buildHeardDict({ deckEntries, wordbook })
  })()
  return dictPromise
}

/** An item's reading for display (word（reading）), or null when none is known. */
export function heardReading(dict, item) {
  return dict?.readingsOf?.get(normalizeSpeechText(item)) ?? null
}

/**
 * Match a transcript segment against the dictionary — a port of
 * the bot's matchHeardWords. Returns a Map keyed by dictionary
 * item with { count, kind: 'word' | 'expr' }. Expressions are
 * consumed first and masked, so their inner words are not
 * double-counted; one-character entries match only for kanji.
 */
export function matchHeardWords(text, dict) {
  const stream = [...normalizeSpeechText(text ?? '')]
  const counts = new Map()
  const bump = (item, kind) => {
    const cur = counts.get(item)
    if (cur) cur.count += 1
    else counts.set(item, { count: 1, kind })
  }

  const exprs = EXPRESSIONS
    .map((surface) => ({ surface, norm: normalizeSpeechText(surface) }))
    .filter((e) => e.norm)
    .sort((a, b) => [...b.norm].length - [...a.norm].length)
  for (const e of exprs) {
    const needle = [...e.norm]
    for (let i = 0; i + needle.length <= stream.length; i++) {
      let hit = true
      for (let j = 0; j < needle.length; j++) {
        if (stream[i + j] !== needle[j]) { hit = false; break }
      }
      if (hit) {
        bump(e.surface, 'expr')
        for (let j = 0; j < needle.length; j++) stream[i + j] = '\u0000'
        i += needle.length - 1
      }
    }
  }

  for (let i = 0; i < stream.length; i++) {
    const ch = stream[i]
    if (ch === '\u0000') continue
    const byLen = dict.byFirst.get(ch)
    if (!byLen) continue
    let consumed = 0
    const maxTry = Math.min(dict.maxLen, stream.length - i)
    for (let len = maxTry; len >= 1; len--) {
      if (len === 1 && !HAN.test(ch)) break
      const set = byLen.get(len)
      if (!set) continue
      const cand = stream.slice(i, i + len).join('')
      if (set.has(cand)) {
        consumed = len
        bump(dict.itemOf.get(cand) ?? cand, 'word')
        break
      }
    }
    if (consumed > 0) i += consumed - 1
  }

  return counts
}
