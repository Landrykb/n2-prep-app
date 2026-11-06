// Yonde Reader fitting tests (run: TZ=UTC npm run test:reader)
// Pins for Doc 16 §5: the known-word ratio gate is CODE, and the client
// module (src/lib/readerFit.js) and the server port
// (supabase/functions/reader-bot/fit.ts) are twins that must agree —
// the same discipline phase2.test.mjs applies to calls.js / slot.ts.
// The 2026-11-06 calibration (headword matching + below-band deck
// credit + grammar-token rule) is pinned by the second half below.

import assert from 'node:assert'

const fit = await import('../src/lib/readerFit.js')
const port = await import('../supabase/functions/reader-bot/fit.ts')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

// '猫' is the known kanji token (placed in the known set); '龍' is a
// kanji token nobody knows; kana/punctuation tokens carry no kanji.
const tokensOf = (known, unknown, kana = 0) => [
  ...Array(known).fill('猫'),
  ...Array(unknown).fill('龍'),
  ...Array(kana).fill('は'),
]
const passage = (id, band, tokens) => ({ id, band, tokens })
const knownNeko = fit.buildKnownSet([{ front: '猫' }])

check('buildKnownSet: fronts trimmed, empties dropped, personal vocab merged', () => {
  const s = fit.buildKnownSet(
    [{ front: ' 猫 ' }, { front: '' }, { front: '  ' }, { front: 42 }, {}, null],
    [' 犬 ', '', '鳥'],
  )
  assert.deepEqual([...s].sort(), ['犬', '猫', '鳥'])
})

check('passageRatio: every token known scores 1', () => {
  assert.equal(fit.passageRatio(['猫', 'は', '猫', '。'], knownNeko), 1)
})

check('passageRatio: kana and punctuation count known with an empty set; unknown kanji do not', () => {
  assert.equal(fit.passageRatio(['猫', 'は', '犬', '。'], new Set()), 0.5)
})

check('passageRatio: empty or non-array tokens score 0 (can never pass the gate)', () => {
  assert.equal(fit.passageRatio([], knownNeko), 0)
  assert.equal(fit.passageRatio(null, knownNeko), 0)
  assert.equal(fit.passageRatio(undefined, knownNeko), 0)
})

check('passageRatio: exact fraction (19/20 = 0.95)', () => {
  assert.equal(fit.passageRatio(tokensOf(19, 1), knownNeko), 0.95)
})

check('pickPassage: the 0.93–0.97 gate rejects 0.92 and 0.98', () => {
  const below = passage('below', 'N3', tokensOf(92, 8))
  const above = passage('above', 'N3', tokensOf(98, 2))
  assert.equal(fit.pickPassage([below], knownNeko, 'N3'), null)
  assert.equal(fit.pickPassage([above], knownNeko, 'N3'), null)
})

check('pickPassage: gate boundaries 0.93 and 0.97 are admitted', () => {
  const lo = fit.pickPassage([passage('lo', 'N3', tokensOf(93, 7))], knownNeko, 'N3')
  const hi = fit.pickPassage([passage('hi', 'N3', tokensOf(97, 3))], knownNeko, 'N3')
  assert.equal(lo.ratio, 0.93)
  assert.equal(hi.ratio, 0.97)
})

check('pickPassage: closest to 0.95 wins (0.945 beats 0.96)', () => {
  const near = passage('near', 'N3', tokensOf(189, 11)) // 0.945, dist 0.005
  const far = passage('far', 'N3', tokensOf(96, 4)) // 0.96, dist 0.01
  const picked = fit.pickPassage([far, near], knownNeko, 'N3')
  assert.equal(picked.passage.id, 'near')
  assert.ok(Math.abs(picked.ratio - 0.945) < 1e-9)
})

check('pickPassage: band window is ±1 level (N3 learner: N2 and N4 yes, N1 and N5 no)', () => {
  const mk = (id, band) => passage(id, band, tokensOf(95, 5))
  assert.equal(fit.pickPassage([mk('n1', 'N1')], knownNeko, 'N3'), null)
  assert.equal(fit.pickPassage([mk('n5', 'N5')], knownNeko, 'N3'), null)
  assert.equal(fit.pickPassage([mk('n2', 'N2')], knownNeko, 'N3').passage.id, 'n2')
  assert.equal(fit.pickPassage([mk('n4', 'N4')], knownNeko, 'N3').passage.id, 'n4')
})

check('pickPassage: recent passages are excluded; excluding all leaves null', () => {
  const best = passage('best', 'N3', tokensOf(95, 5))
  const next = passage('next', 'N3', tokensOf(94, 6))
  assert.equal(fit.pickPassage([best, next], knownNeko, 'N3', ['best']).passage.id, 'next')
  assert.equal(fit.pickPassage([best, next], knownNeko, 'N3', ['best', 'next']), null)
})

check('pickPassage: empty known set cannot fit a kanji-heavy passage', () => {
  const heavy = passage('heavy', 'N4', tokensOf(0, 10, 10)) // kana only → ratio 0.5
  assert.equal(fit.pickPassage([heavy], new Set(), 'N4'), null)
  assert.equal(fit.pickPassage([heavy], fit.buildKnownSet([]), 'N4'), null)
})

check('pickPassage: an unknown learner band yields null, never a guess', () => {
  assert.equal(fit.pickPassage([passage('x', 'N3', tokensOf(95, 5))], knownNeko, 'N9'), null)
  assert.equal(fit.pickPassage([passage('x', 'N3', tokensOf(95, 5))], knownNeko, ''), null)
})

check('headword matching: an inflected token is known via its dictionary form', () => {
  const toks = [
    { s: '引っ越し', h: '引っ越す', l: 'N4' },
    { s: 'ました', h: 'ました', l: null },
    { s: '。', h: '。', l: null },
  ]
  const known = fit.buildKnownSet([{ front: '引っ越す' }])
  assert.equal(fit.tokenIsKnown(toks[0], known), true)
  assert.equal(fit.passageRatio(toks, known), 1)
  // Matching is by headword ONLY: knowing the surface proves nothing.
  const surfaceOnly = fit.buildKnownSet([{ front: '引っ越し' }])
  assert.equal(fit.tokenIsKnown(toks[0], surfaceOnly), false)
})

check('deckCreditSet: strictly below the band, from Map and object alike', () => {
  const deck = new Map([['猫', 'N5'], ['犬', 'N4'], ['鳥', 'N3'], ['亀', 'N2'], ['龍', 'N1']])
  assert.deepEqual([...fit.deckCreditSet(deck, 'N3')].sort(), ['犬', '猫'])
  assert.deepEqual([...fit.deckCreditSet(deck, 'N1')].sort(), ['亀', '犬', '猫', '鳥']) // N1 learner is credited N2 words
  assert.deepEqual([...fit.deckCreditSet({ 猫: 'N5', 犬: 'N4' }, 'N4')], ['猫'])
})

check('deckCreditSet: N5 earns nothing (nothing is below N5); no band earns nothing', () => {
  const deck = new Map([['猫', 'N5'], ['犬', 'N4']])
  assert.equal(fit.deckCreditSet(deck, 'N5').size, 0)
  assert.equal(fit.deckCreditSet(deck, undefined).size, 0)
  assert.equal(fit.deckCreditSet(deck, '').size, 0)
  assert.equal(fit.deckCreditSet(deck, 'N9').size, 0)
  assert.equal(fit.deckCreditSet(null, 'N3').size, 0)
})

check('buildKnownSet: queue + personal vocab + credit merge as headwords', () => {
  const s = fit.buildKnownSet([{ front: '猫' }], ['鳥'], new Set(['犬']))
  assert.deepEqual([...s].sort(), ['犬', '猫', '鳥'])
})

check('grammar rule: short kana non-deck tokens are free; deck words and kanji must earn it', () => {
  const empty = new Set()
  assert.equal(fit.tokenIsKnown({ s: 'は', h: 'は', l: null }, empty), true) // particle fragment
  assert.equal(fit.tokenIsKnown({ s: 'ました', h: 'ました', l: null }, empty), true) // 3 chars
  assert.equal(fit.tokenIsKnown({ s: 'なかった', h: 'なかった', l: null }, empty), false) // 4 chars — past the cap
  assert.equal(fit.tokenIsKnown({ s: 'これ', h: 'これ', l: 'N5' }, empty), false) // a deck word is never free
  assert.equal(fit.tokenIsKnown({ s: 'これ', h: 'これ', l: 'N5' }, fit.buildKnownSet([], [], new Set(['これ']))), true)
  assert.equal(fit.tokenIsKnown({ s: '転入届', h: '転入届', l: null }, empty), false) // kanji content, deck or not
  assert.equal(fit.tokenIsKnown({ s: '。', h: '。', l: null }, empty), true)
})

check('pickPassage: credit fits an inflected passage for a diagnosed learner; no diagnosis, no fit', () => {
  // 20 tokens: 19 surfaces are inflections/fragments of below-band or
  // grammar material for an N3 learner, 1 is a genuinely new N3 word.
  const toks = [
    ...Array(9).fill({ s: '食べ', h: '食べる', l: 'N5' }),
    ...Array(5).fill({ s: '引っ越し', h: '引っ越す', l: 'N4' }),
    ...Array(5).fill({ s: 'は', h: 'は', l: null }),
    { s: '指摘', h: '指摘', l: 'N1' },
  ]
  const deck = new Map([['食べる', 'N5'], ['引っ越す', 'N4'], ['指摘', 'N1']])
  const diagnosed = fit.buildKnownSet([], [], fit.deckCreditSet(deck, 'N3'))
  const picked = fit.pickPassage([passage('fit', 'N3', toks)], diagnosed, 'N3')
  assert.equal(picked.ratio, 0.95)
  const undiagnosed = fit.buildKnownSet([], []) // no credit without a diagnosis
  assert.equal(fit.pickPassage([passage('fit', 'N3', toks)], undiagnosed, 'N3'), null)
})

check('twin parity: fit.ts agrees with readerFit.js on sets, ratios and picks', () => {
  const items = [{ front: '猫' }, { front: '鳥' }]
  const a = [...fit.buildKnownSet(items, ['犬'])].sort()
  const b = [...port.buildKnownSet(items, ['犬'])].sort()
  assert.deepEqual(a, b)
  const fixtures = [tokensOf(19, 1), tokensOf(0, 10, 10), ['猫', 'は', '犬', '。'], []]
  for (const t of fixtures) {
    assert.equal(port.passageRatio(t, knownNeko), fit.passageRatio(t, knownNeko))
  }
  const bank = [
    passage('near', 'N3', tokensOf(189, 11)),
    passage('far', 'N2', tokensOf(96, 4)),
    passage('old', 'N3', tokensOf(95, 5)),
  ]
  const pa = fit.pickPassage(bank, knownNeko, 'N3', ['old'])
  const pb = port.pickPassage(bank, knownNeko, 'N3', ['old'])
  assert.equal(pb.passage.id, pa.passage.id)
  assert.equal(pb.ratio, pa.ratio)
  assert.equal(port.RATIO_MIN, fit.RATIO_MIN)
  assert.equal(port.RATIO_MAX, fit.RATIO_MAX)
  assert.equal(port.RATIO_TARGET, fit.RATIO_TARGET)
})

check('twin parity: calibration APIs agree too (credit, headwords, grammar rule)', () => {
  const deckMap = new Map([['猫', 'N5'], ['引っ越す', 'N4'], ['鳥', 'N3'], ['龍', 'N1']])
  const deckObj = Object.fromEntries(deckMap)
  for (const band of ['N5', 'N4', 'N3', 'N2', 'N1', undefined, 'N9']) {
    assert.deepEqual([...port.deckCreditSet(deckObj, band)].sort(), [...fit.deckCreditSet(deckMap, band)].sort())
  }
  const knownA = fit.buildKnownSet([{ front: '猫' }], [], fit.deckCreditSet(deckMap, 'N3'))
  const knownB = port.buildKnownSet([{ front: '猫' }], [], port.deckCreditSet(deckObj, 'N3'))
  assert.deepEqual([...knownB].sort(), [...knownA].sort())
  const fixtures = [
    { s: '引っ越し', h: '引っ越す', l: 'N4' },
    { s: 'は', h: 'は', l: null },
    { s: 'なかった', h: 'なかった', l: null },
    { s: '転入届', h: '転入届', l: null },
  ]
  for (const t of fixtures) assert.equal(port.tokenIsKnown(t, knownB), fit.tokenIsKnown(t, knownA))
  assert.equal(port.tokenIsKnown(fixtures[0], knownB), true) // 引っ越す arrives via credit
})

// ---------- R0.5: draft validation + retry logic (Doc 16 §7) ----------

check('evaluateDraft: inside the gate with few unknowns accepts (0.95, 1 unknown)', () => {
  const v = fit.evaluateDraft(tokensOf(19, 1), knownNeko)
  assert.equal(v.ratio, 0.95)
  assert.deepEqual(v.unknowns, ['龍'])
  assert.equal(v.accept, true)
})

check('evaluateDraft: below the gate rejects; above the gate rejects too', () => {
  assert.equal(fit.evaluateDraft(tokensOf(90, 10), knownNeko).accept, false) // 0.90 — a slog
  assert.equal(fit.evaluateDraft(tokensOf(99, 1), fit.buildKnownSet([{ front: '猫' }, { front: '龍' }], [], new Set(['猫'])) ).ratio, 1)
  const above = fit.evaluateDraft([...Array(99).fill('猫'), '龍'], knownNeko) // 0.99 — nothing to learn
  assert.equal(above.ratio, 0.99)
  assert.equal(above.accept, false)
})

check('evaluateDraft: the unknown cap rejects a word-stuffed draft inside the ratio gate', () => {
  const distinct = ['龍', '麟', '鳳', '鶴', '亀', '蝶', '蜂', '蛙', '鯨', '鷹', '狼', '熊', '虎']
  const stuffed = [...Array(182).fill('猫'), ...distinct, ...Array(5).fill('は')] // 200 tokens, ratio 0.935
  const v = fit.evaluateDraft(stuffed, knownNeko)
  assert.ok(v.ratio >= fit.RATIO_MIN && v.ratio <= fit.RATIO_MAX)
  assert.equal(v.unknowns.length, 13)
  assert.equal(v.accept, false)
  const lean = [...Array(183).fill('猫'), ...distinct.slice(0, 12), ...Array(5).fill('は')] // ratio 0.94, 12 unknowns
  assert.equal(fit.evaluateDraft(lean, knownNeko).accept, true)
})

check('evaluateDraft: unknowns are headwords, deduped, in text order; punctuation is not vocabulary', () => {
  const toks = [
    { s: '走っ', h: '走る', l: 'N4' },
    { s: '。', h: '。', l: null },
    { s: '龍', h: '龍', l: 'N1' },
    { s: '走り', h: '走る', l: 'N4' },
    { s: '、', h: '、', l: null },
  ]
  const v = fit.evaluateDraft(toks, new Set())
  assert.deepEqual(v.unknowns, ['走る', '龍'])
})

check('nextForbiddenList: unions across retries, dedupes, preserves first-seen order, caps', () => {
  assert.deepEqual(fit.nextForbiddenList(['龍'], ['鳳', '龍', '鶴']), ['龍', '鳳', '鶴'])
  assert.deepEqual(fit.nextForbiddenList([], []), [])
  const many = Array.from({ length: 50 }, (_, i) => `語${i}`)
  assert.equal(fit.nextForbiddenList([], many).length, 40)
  assert.deepEqual(fit.nextForbiddenList(null, ['猫']), ['猫'])
})

check('shouldGenerate: generation is fallback-only and cooldown-gated', () => {
  assert.equal(fit.shouldGenerate(null, true), true)
  assert.equal(fit.shouldGenerate({ passage: {}, ratio: 0.95 }, true), false) // bank hit — never generate
  assert.equal(fit.shouldGenerate(null, false), false) // cooldown — stay honest and quiet
  assert.equal(fit.shouldGenerate(undefined, 1), true)
})

check('twin parity: R0.5 draft logic agrees (evaluateDraft, forbidden list, decision, cap)', () => {
  const fixtures = [tokensOf(19, 1), tokensOf(90, 10), [...Array(183).fill('猫'), '龍', '鳳', ...Array(5).fill('は')]]
  for (const t of fixtures) {
    const a = fit.evaluateDraft(t, knownNeko)
    const b = port.evaluateDraft(t, knownNeko)
    assert.deepEqual(b, a)
  }
  assert.deepEqual(port.nextForbiddenList(['龍'], ['鳳', '龍']), fit.nextForbiddenList(['龍'], ['鳳', '龍']))
  assert.equal(port.shouldGenerate(null, true), fit.shouldGenerate(null, true))
  assert.equal(port.UNKNOWN_CAP, fit.UNKNOWN_CAP)
})

// ---------- R0.5: the segmenter (src/lib/readerSegment.js + segment.ts) ----------

const seg = await import('../src/lib/readerSegment.js')
const segPort = await import('../supabase/functions/reader-bot/segment.ts')

const fixtureDeck = new Map([
  ['猫', 'N5'], ['犬', 'N5'], ['食べる', 'N5'], ['ご飯', 'N5'], ['今日', 'N5'],
  ['天気', 'N5'], ['引っ越す', 'N4'], ['高い', 'N5'],
])
const fixtureSeg = seg.createSegmenter({ deckLevels: fixtureDeck })

check('segmenter: deck words match whole, surfaces join back to the text', () => {
  const text = '猫はご飯を食べる。'
  const toks = fixtureSeg.segment(text)
  assert.equal(toks.map((t) => t.s).join(''), text)
  assert.deepEqual(toks.find((t) => t.s === '食べる'), { s: '食べる', h: '食べる', l: 'N5' })
  assert.deepEqual(toks.find((t) => t.s === '。'), { s: '。', h: '。', l: null })
})

check('segmenter: an inflected surface resolves to its dictionary headword', () => {
  const toks = fixtureSeg.segment('引っ越しました')
  assert.deepEqual(toks[0], { s: '引っ越し', h: '引っ越す', l: 'N4' })
  assert.equal(toks.map((t) => t.s).join(''), '引っ越しました')
})

check('segmenter: grammar forms are function tokens chunked to ≤3 chars', () => {
  const toks = fixtureSeg.segment('ありがとうございます')
  assert.equal(toks.map((t) => t.s).join(''), 'ありがとうございます')
  assert.deepEqual(toks.slice(-2), [
    { s: 'ござい', h: 'ござい', l: null },
    { s: 'ます', h: 'ます', l: null },
  ])
  // …and the fitting grammar rule frees each chunk on its own.
  assert.equal(fit.tokenIsKnown(toks[toks.length - 1], new Set()), true)
  assert.equal(fit.tokenIsKnown(toks[toks.length - 2], new Set()), true)
})

check('segmenter: a single kana is a fragment, never a content word', () => {
  const withKana = seg.createSegmenter({ deckLevels: new Map([['力', 'N5']]), extraWords: ['は'] })
  const toks = withKana.segment('は')
  assert.deepEqual(toks, [{ s: 'は', h: 'は', l: null }])
})

check('segmenter parity: segment.ts (deck-only) agrees with the JS core on shared data', () => {
  const text = '猫はご飯を食べる。今日は高い寿司を食べました。引っ越しました。'
  assert.equal(segPort.segmentText(text).map((t) => t.s).join(''), text) // port joins back
  // On a sentence built only from words the fixture deck and the
  // real deck share, the port (full deck) and the fixture core must
  // produce the same content tokens. (ご飯 is NOT one of them: the
  // bank builder matches it via the local dictionary, the deck-only
  // port cannot — the documented conservative difference.)
  const shared = '猫は食べる。犬は食べる。'
  const content = (toks) => toks.filter((t) => t.l !== null)
  assert.deepEqual(segPort.segmentText(shared).filter((t) => t.l !== null), content(fixtureSeg.segment(shared)))
  // And on fixture data overall: the port's stem resolution matches.
  assert.deepEqual(
    segPort.segmentText('引っ越しました')[0],
    fixtureSeg.segment('引っ越しました')[0],
  )
})

// Parity against the BANK BUILDER's own output: the seeded rows in
// supabase/seed/reading_passages.sql are the fixture. The JS core is
// injected with the builder's exact data (deck + merged dictionary +
// overrides); its segmentation of a seeded text must reproduce the
// seeded tokens token-for-token, or the three matcher siblings have
// drifted apart.
const bank = await import('../scripts/build-reader-bank.mjs')
const { readFileSync } = await import('node:fs')

function parseSeedRows(path) {
  const sql = readFileSync(path, 'utf8')
  const rows = new Map()
  const marker = 'VALUES ('
  let at = 0
  const literal = (i) => {
    // sql[i] === "'"; '' is an escaped quote.
    let out = ''
    i++
    while (i < sql.length) {
      if (sql[i] === "'") {
        if (sql[i + 1] === "'") { out += "'"; i += 2; continue }
        return [out, i + 1]
      }
      out += sql[i]
      i++
    }
    throw new Error('unterminated literal')
  }
  while (true) {
    const start = sql.indexOf(marker, at)
    if (start === -1) break
    let i = start + marker.length
    const fields = []
    for (let f = 0; f < 7; f++) {
      while (sql[i] === ' ' || sql[i] === '\n') i++
      const [value, next] = literal(i)
      fields.push(value)
      i = next
      if (sql.startsWith('::jsonb', i)) i += '::jsonb'.length
      while (sql[i] === ' ' || sql[i] === '\n') i++
      if (sql[i] === ',') i++
    }
    const [id, band, topic, text, tokens, candidates, source] = fields
    rows.set(id, { id, band, topic, text, tokens: JSON.parse(tokens), candidates: JSON.parse(candidates), source })
    at = i
  }
  return rows
}

check('segmenter parity: JS core reproduces the seeded bank tokens (3 rows)', () => {
  const rows = parseSeedRows(new URL('../supabase/seed/reading_passages.sql', import.meta.url))
  assert.ok(rows.size >= 20, `seed should carry the bank, got ${rows.size}`)
  const dict = bank.buildDictionary()
  const extraWords = dict.entries
    .filter((e) => e.word && e.type !== 'Grammar' && !/[～~]/.test(e.word))
    .map((e) => e.word)
  const core = seg.createSegmenter({
    deckLevels: bank.buildDeckLevels(),
    extraWords,
    headwords: [...dict.byWord.keys(), ...Object.keys(bank.OVERRIDES)],
    overrides: Object.keys(bank.OVERRIDES),
  })
  const ids = ['scene-city-address', 'scene-hospital-symptom', 'bank-reading-1']
  for (const id of ids) {
    const row = rows.get(id)
    assert.ok(row, `seeded row ${id} exists`)
    assert.equal(row.tokens.map((t) => t.s).join(''), row.text)
    assert.deepEqual(core.segment(row.text), row.tokens)
  }
})

// The R0.5 loop, end to end on offline fixtures: a word-stuffed first
// draft is rejected with its unknowns; the retry — written against
// the forbidden list — is evaluated again and accepted. (No model is
// called in tests; the drafts are fixtures, the logic is the loop's.)
check('generation loop trace: stuffed draft rejected → forbidden list grows → fitted retry accepted', () => {
  // The learner knows every fixture-deck word except 天気.
  const known = fit.buildKnownSet([...fixtureDeck.keys()].filter((w) => w !== '天気').map((front) => ({ front })))
  const segCore = seg.createSegmenter({ deckLevels: fixtureDeck })
  const stuffed = '龍。麟。鳳。猫はご飯を食べる。'
  const v1 = fit.evaluateDraft(segCore.segment(stuffed), known)
  assert.equal(v1.accept, false)
  assert.deepEqual(v1.unknowns, ['龍', '麟', '鳳'])
  const forbidden = fit.nextForbiddenList([], v1.unknowns)
  assert.deepEqual(forbidden, ['龍', '麟', '鳳'])
  const retry = '猫はご飯を食べる。犬もご飯を食べる。今日は天気です。猫は高いご飯を食べる。犬も高いご飯を食べる。'
  const v2 = fit.evaluateDraft(segCore.segment(retry), known)
  assert.deepEqual(v2.unknowns, ['天気'])
  assert.equal(v2.accept, true) // 30/31 known — inside the gate, one word to learn
  // The trace itself: print the verdicts so a human can see the loop.
  console.log(`    trace: draft1 ratio=${v1.ratio.toFixed(2)} unknowns=[${v1.unknowns.join(',')}] accept=${v1.accept}`)
  console.log(`    trace: retry  ratio=${v2.ratio.toFixed(2)} unknowns=[${v2.unknowns.join(',')}] accept=${v2.accept}`)
})

console.log(`reader: ${passed} checks passed`)
