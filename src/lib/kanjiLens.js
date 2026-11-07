// Kanji Lens — pure helpers over KanjiDB v2 data (see docs/18).
//
// The Lens is evidence-ruled: components are shown with the job the data
// actually supports (dictionary radical, sound component, plain part),
// sound families are a probabilistic cue and are labelled as such, and
// nothing here scores handwriting. These helpers stay pure — inputs in,
// data out — so tests can pin them against the real generated database.

/** All stroke indices in a node's subtree (own direct strokes + descendants). */
export function subtreeIndices(node) {
  if (!node) return []
  const out = [...(node.strokes || [])]
  for (const child of node.children || []) out.push(...subtreeIndices(child))
  return out.sort((a, b) => a - b)
}

/**
 * Role of one tree node, from data alone:
 *   'radical' — KanjiVG flags it as the dictionary radical;
 *   'sound'   — it is the kanji's derived sound component (meta.soundComponent)
 *               or KanjiVG marks it with a phonetic hint (node.ph);
 *   'part'    — a plain structural part; no function is claimed for it.
 */
export function roleOf(node, meta = null) {
  if (!node) return 'part'
  if (node.radical) return 'radical'
  if (node.ph) return 'sound'
  if (meta?.soundComponent && node.element === meta.soundComponent) return 'sound'
  return 'part'
}

/**
 * Flatten a KanjiVG tree (expanded shape from kanjiDb.expandTree) into an
 * ordered list: document order, each node carrying its depth, its resolved
 * role, and the full stroke-index set of its subtree.
 */
export function flattenComponents(tree, meta = null) {
  if (!tree) return []
  const out = []
  const walk = (node, depth) => {
    out.push({
      element: node.element ?? null,
      radical: node.radical ?? null,
      position: node.position ?? null,
      phon: node.phon ?? null,
      depth,
      role: roleOf(node, meta),
      strokes: subtreeIndices(node),
    })
    for (const child of node.children || []) walk(child, depth + 1)
  }
  walk(tree, 0)
  return out
}

const POSITION_WORDS = {
  left: 'on the left',
  right: 'on the right',
  top: 'on top',
  bottom: 'at the bottom',
  middle: 'in the middle',
  center: 'in the centre',
  centre: 'in the centre',
  enclose: 'wrapped around',
  enclosure: 'wrapped around',
}
/** KanjiVG position value in plain words ('' when unknown/absent). */
export function positionWords(position) {
  if (!position) return ''
  return POSITION_WORDS[position] || position
}

/**
 * The caption naming a component and its job, built ONLY from data:
 *   radical → "言 — the radical: meaning side (speech)" (meaning = the
 *             component's own first KANJIDIC2 meaning, when it is a kanji)
 *   sound   → "吾 — sound side: gives ゴ" (the shared on-reading, when known)
 *   part    → "五 — five · on the top of 吾" style: element, its own meaning
 *             when sourced, and its position in plain words.
 * info = { meaning, soundOn } for the component itself; both optional.
 */
export function captionFor(node, info = {}) {
  if (!node?.element) return ''
  const el = node.element
  if (node.role === 'radical') {
    return info.meaning ? `${el} — the radical: meaning side (${info.meaning})` : `${el} — the radical`
  }
  if (node.role === 'sound') {
    return info.soundOn ? `${el} — sound side: gives ${info.soundOn}` : `${el} — sound side`
  }
  const bits = [el]
  if (info.meaning) bits.push(info.meaning)
  const pos = positionWords(node.position)
  return pos ? `${bits.join(' — ')} · ${pos}` : bits.join(' — ')
}

/**
 * Anchor point for a stroke number: the first moveto of a KanjiVG path.
 * Returns { x, y } in the 0–109 viewBox, or null for unparseable input.
 */
export function strokeAnchor(d) {
  if (typeof d !== 'string') return null
  const m = d.match(/[Mm]\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const x = Number(m[1])
  const y = Number(m[2])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

const KANJI_CHAR = /[㐀-鿿豈-﫿]/
/** How many kanji characters a written form contains. */
export function kanjiCountOf(form) {
  let n = 0
  for (const ch of String(form || '')) if (KANJI_CHAR.test(ch)) n++
  return n
}

/**
 * The word the Lens acts on for a kanji (queue adds + encounters):
 * the FIRST 2-kanji compound among the kanji's JMdict common words
 * (wordsDb.wordsForKanji order) whose written form contains the
 * char — a true compound teaches the kanji in company, which is
 * how it will actually be met in text. Falls back to the first
 * entry, preferring a written form that contains the char. Returns
 * { entry, front } or null when the dictionary has no word for the
 * kanji at all — the caller must then disable the action honestly,
 * never invent a word.
 */
export function pickQueueWord(char, entries) {
  if (!char || !Array.isArray(entries) || entries.length === 0) return null
  for (const entry of entries) {
    const form = (entry?.kanji || []).find((f) => f.includes(char) && kanjiCountOf(f) === 2)
    if (form) return { entry, front: form }
  }
  const first = entries[0]
  if (!first) return null
  const front = (first.kanji || []).find((f) => f.includes(char)) || first.kanji?.[0] || first.kana || ''
  return front ? { entry: first, front } : null
}

/**
 * Is this front already in the one queue — under ANY source? The
 * queue dedupes adds by (source, front) id, so a word mined from
 * the Reader and later offered by the Lens would otherwise land
 * twice under two ids. Front presence is the honest check for the
 * "Already In Your Queue" state.
 */
export function queueHasFront(queueItems, front) {
  if (!front) return false
  return (queueItems || []).some((i) => i?.front === front)
}

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : [])
const onListOf = (entry) => {
  const raw = asList(entry?.on).join('・')
  return raw ? raw.split(/[・\s]+/).filter(Boolean) : []
}

/**
 * Family data for one kanji. Pure: all database access arrives via `data`:
 *   data.components : the components.json map — element -> [charsString, primaryOn]
 *   data.metaOf     : (char) -> { on, freq, jlpt, level } | null  (index or meta shape)
 *   data.radicalMembers : chars sharing the kanji's radical number (any order)
 *   data.attested   : optional — the shipped attested family for the sound
 *                     component ({ component, reading, members,
 *                     alsoComputed } from kanjiDb families.json). When it
 *                     matches the sound component, the sound row is built
 *                     from it: attested members first, alsoComputed after.
 *
 * Returns:
 *   soundComponent : the component carrying the sound, or null
 *   soundOn        : the shared on-reading it carries, or ''
 *   sound          : [{ char, on, matches }] — kanji built on the sound
 *                    component (the kanji itself excluded), capped; `matches`
 *                    is true when the member's own on-readings include the
 *                    shared reading — the cue is probabilistic, so both
 *                    kinds are returned and the caller must show the split.
 *                    With data.attested, entries also carry `attested`
 *                    (true = confirmed by two sources, false = computed).
 *   attested       : boolean — the sound row came from an attested family
 *   parts          : { element: { chars, count, on } } per top-level component
 *   radical        : [chars] sharing the radical, capped, frequent first
 */
export function familyFor(char, meta = null, tree = null, data = {}, cap = 12) {
  const components = data.components || {}
  const metaOf = typeof data.metaOf === 'function' ? data.metaOf : () => null

  const rank = (a, b) => {
    const ma = metaOf(a)
    const mb = metaOf(b)
    const fa = ma?.freq ?? null
    const fb = mb?.freq ?? null
    if (fa != null && fb == null) return -1
    if (fa == null && fb != null) return 1
    if (fa != null && fb != null && fa !== fb) return fa - fb
    const la = ma?.jlpt != null || ma?.level ? 0 : 1
    const lb = mb?.jlpt != null || mb?.level ? 0 : 1
    if (la !== lb) return la - lb
    return String(a).localeCompare(String(b))
  }

  // Sound family: meta's derived signal first, else a phonetic-marked node.
  let soundComponent = meta?.soundComponent || null
  if (!soundComponent && tree) {
    const flat = flattenComponents(tree, meta)
    soundComponent = flat.find((n) => n.depth > 0 && n.phon)?.element || null
  }
  let sound = []
  let soundOn = ''
  let attested = false
  if (soundComponent) {
    const entry = components[soundComponent]
    const members = entry ? [...entry[0]] : []
    soundOn = entry?.[1] || ''
    if (!soundOn) {
      // Fall back to the reading this kanji shares with its component.
      const compOns = onListOf(metaOf(soundComponent))
      soundOn = onListOf(meta).find((r) => compOns.includes(r)) || compOns[0] || ''
    }
    const fam = data.attested && data.attested.component === soundComponent ? data.attested : null
    if (fam) {
      // Attested family (docs/18): members confirmed by two sources
      // lead; alsoComputed members follow with attested: false so the
      // caller can dim them. The reading is the family's own.
      attested = true
      if (fam.reading) soundOn = fam.reading
      const toRow = (c, isAttested) => {
        const ons = onListOf(metaOf(c))
        return { char: c, on: ons[0] || '', matches: soundOn ? ons.includes(soundOn) : false, attested: isAttested }
      }
      const attestedRows = (fam.members || []).filter((c) => c !== char).map((c) => toRow(c, true)).sort((a, b) => rank(a.char, b.char))
      const listed = new Set(attestedRows.map((r) => r.char))
      const computedRows = (fam.alsoComputed || [])
        .filter((c) => c !== char && !listed.has(c))
        .map((c) => toRow(c, false))
        .sort((a, b) => rank(a.char, b.char))
      sound = [...attestedRows, ...computedRows].slice(0, cap)
    } else {
      sound = members
        .filter((c) => c !== char)
        .map((c) => {
          const ons = onListOf(metaOf(c))
          return { char: c, on: ons[0] || '', matches: soundOn ? ons.includes(soundOn) : false }
        })
        .sort((a, b) => Number(b.matches) - Number(a.matches) || rank(a.char, b.char))
        .slice(0, cap)
    }
  }

  // One row per top-level component: what else is built from it.
  const parts = {}
  if (tree) {
    for (const child of tree.children || []) {
      const el = child.element
      if (!el || parts[el]) continue
      const entry = components[el]
      const members = entry ? [...entry[0]] : []
      parts[el] = {
        chars: members.filter((c) => c !== char).sort(rank).slice(0, cap),
        count: members.length,
        on: entry?.[1] || '',
      }
    }
  }

  const radical = [...(data.radicalMembers || [])]
    .filter((c) => c !== char)
    .sort(rank)
    .slice(0, cap)

  return { soundComponent, soundOn, sound, attested, parts, radical }
}
