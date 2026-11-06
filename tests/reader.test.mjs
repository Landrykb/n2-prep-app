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

// ---------- cold start: the starter track (Doc 16 §5 amendment #2) ----------
// Landry's live test: linked, empty queue, no diagnosis → the "no
// synced words" dead end. These checks pin the on-ramp: the
// predicate, the starter pick, and the candidate cap. The gate
// itself is untouched (all gate checks above still stand).

// Object-token fixture builder: content tokens by headword.
const ctoks = (heads) => heads.map((h) => ({ s: h, h, l: 'N5' }))

check('isColdStart: a diagnosis is never cold; without one, 39 is cold and 40 is not', () => {
  assert.equal(fit.COLD_START_KNOWN_LIMIT, 40)
  assert.equal(fit.isColdStart(true, 0), false) // diagnosis = a fitting basis at any census
  assert.equal(fit.isColdStart(true, 39), false)
  assert.equal(fit.isColdStart(false, 0), true) // Landry's live-test state
  assert.equal(fit.isColdStart(false, 39), true)
  assert.equal(fit.isColdStart(false, 40), false)
  assert.equal(fit.isColdStart(false, 400), false)
})

check('countKnownContent: kanji and long words count; short kana fragments do not', () => {
  // 'は' is a grammar fragment; 'これ' (2 kana chars) undercounts by
  // design — the conservative direction documented in readerFit.js.
  const known = new Set(['猫', '食べる', 'は', 'これ', 'ありがとう', ''])
  assert.equal(fit.countKnownContent(known), 3)
  assert.equal(fit.countKnownContent(new Set()), 0)
  assert.equal(fit.countKnownContent(null), 0)
})

check('pickStarter: band order beats unknown count (easiest shelf first)', () => {
  const n5 = passage('n5-hard', 'N5', ctoks(['龍', '麟', '鳳', '鶴', '亀', '。'])) // 5 unknowns
  const n4 = passage('n4-easy', 'N4', ctoks(['龍', '。'])) // 1 unknown
  const picked = fit.pickStarter([n4, n5], new Set())
  assert.equal(picked.passage.id, 'n5-hard')
  assert.deepEqual(picked.unknowns, ['龍', '麟', '鳳', '鶴', '亀'])
})

check('pickStarter: within a band, fewest unknowns wins; ties break on fewer tokens', () => {
  const known = fit.buildKnownSet([{ front: '猫' }])
  const two = passage('two', 'N4', ctoks(['猫', '龍', '鳳', '。'])) // 2 unknowns
  const one = passage('one', 'N4', ctoks(['猫', '龍', '。'])) // 1 unknown
  assert.equal(fit.pickStarter([two, one], known).passage.id, 'one')
  const short = passage('short', 'N4', ctoks(['猫', '龍'])) // 1 unknown, 2 tokens
  const long = passage('long', 'N4', ctoks(['猫', '猫', '龍', '。'])) // 1 unknown, 4 tokens
  assert.equal(fit.pickStarter([long, short], known).passage.id, 'short')
})

check('pickStarter: the 14-day exclusion applies — and an emptied pool falls back to it', () => {
  const s1 = passage('s1', 'N5', ctoks(['龍']))
  const s2 = passage('s2', 'N4', ctoks(['龍']))
  const hard = passage('hard', 'N2', ctoks(['龍']))
  assert.equal(fit.pickStarter([s1, s2, hard], new Set(), ['s1']).passage.id, 's2')
  // Every starter excluded: a repeated starter beats a dead end —
  // and the fallback still never reaches above the starter bands.
  assert.equal(fit.pickStarter([s1, s2, hard], new Set(), ['s1', 's2']).passage.id, 's1')
})

check('pickStarter: a bank with nothing in the starter bands yields null', () => {
  assert.equal(fit.pickStarter([passage('x', 'N2', ctoks(['龍'])), passage('y', 'N1', ctoks(['龍']))], new Set()), null)
  assert.equal(fit.pickStarter([], new Set()), null)
  assert.equal(fit.pickStarter(null, new Set()), null)
})

check('capCandidates: deck level ascending, null/absent/invalid last, text order stable, cap trims', () => {
  const cands = [
    { word: 'w-n2', level: 'N2' },
    { word: 'w-n5a', level: 'N5' },
    { word: 'w-null', level: null },
    { word: 'w-n5b', level: 'N5' },
    { word: 'w-n1', level: 'N1' },
    { word: 'w-none' },
    { word: 'w-bad', level: 'N9' },
  ]
  assert.deepEqual(
    fit.capCandidates(cands).map((c) => c.word),
    ['w-n5a', 'w-n5b', 'w-n2', 'w-n1', 'w-null', 'w-none', 'w-bad'],
  )
  assert.deepEqual(fit.capCandidates(cands, 3).map((c) => c.word), ['w-n5a', 'w-n5b', 'w-n2'])
  const many = Array.from({ length: 15 }, (_, i) => ({ word: `m${i}`, level: 'N3' }))
  assert.equal(fit.capCandidates(many).length, 12) // default max
  assert.deepEqual(fit.capCandidates(null), [])
})

check('twin parity: cold-start APIs agree (predicate, census, starter pick, cap, constants)', () => {
  assert.equal(port.COLD_START_KNOWN_LIMIT, fit.COLD_START_KNOWN_LIMIT)
  assert.deepEqual(port.STARTER_BANDS, fit.STARTER_BANDS)
  for (const [diag, n] of [[true, 0], [false, 0], [false, 39], [false, 40]]) {
    assert.equal(port.isColdStart(diag, n), fit.isColdStart(diag, n))
  }
  const known = new Set(['猫', '食べる', 'は', 'ありがとう'])
  assert.equal(port.countKnownContent(known), fit.countKnownContent(known))
  const bankFx = [
    passage('n4-easy', 'N4', ctoks(['龍', '。'])),
    passage('n5-hard', 'N5', ctoks(['龍', '麟', '鳳', '。'])),
    passage('n2', 'N2', ctoks(['龍'])),
  ]
  const pa = fit.pickStarter(bankFx, new Set(), [])
  const pb = port.pickStarter(bankFx, new Set(), [])
  assert.equal(pb.passage.id, pa.passage.id)
  assert.deepEqual(pb.unknowns, pa.unknowns)
  const cands = [{ word: 'a', level: 'N1' }, { word: 'b', level: null }, { word: 'c', level: 'N5' }]
  assert.deepEqual(port.capCandidates(cands).map((c) => c.word), fit.capCandidates(cands).map((c) => c.word))
  assert.deepEqual(port.unknownContentHeadwords(ctoks(['龍', '。', '鳳']), new Set()), fit.unknownContentHeadwords(ctoks(['龍', '。', '鳳']), new Set()))
})

check('cold start end-to-end (seeded bank shape): an empty known set yields a capped N5 starter', () => {
  const rows = parseSeedRows(new URL('../supabase/seed/reading_passages.sql', import.meta.url))
  const bankRows = [rows.get('scene-smalltalk-weekend'), rows.get('scene-city-address'), rows.get('bank-reading-1')]
  assert.ok(bankRows.every(Boolean))
  const empty = new Set()
  // Landry's live-test state, exactly: no diagnosis, no known words.
  assert.equal(fit.isColdStart(false, fit.countKnownContent(empty)), true)
  // …and the gate really is a dead end here — the starter's own
  // ratio sits far below it; that gap is why the track exists.
  const starter = fit.pickStarter(bankRows, empty, [])
  assert.equal(starter.passage.id, 'scene-smalltalk-weekend') // the bank's only N5
  assert.ok(fit.passageRatio(starter.passage.tokens, empty) < fit.RATIO_MIN)
  assert.ok(starter.unknowns.length > 0)
  // The send caps the starter's candidates (levels resolved from
  // the passage's own tokens, as index.ts does): ≤12, ordered.
  const lvl = new Map(starter.passage.tokens.map((t) => [t.h, t.l]))
  const enriched = starter.passage.candidates.map((c) => ({ ...c, level: lvl.get(c.h) ?? null }))
  const capped = fit.capCandidates(enriched)
  assert.ok(capped.length <= 12)
  assert.equal(capped.length, Math.min(12, enriched.length))
  const ranks = capped.map((c) => (c.level ? fit.BANDS.indexOf(c.level) : 99))
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))
})

// ---------- declared level: the one-tap starting belief (Doc 16 §5 amendment #3) ----------
// Landry's objection: he never entered a level anywhere, so /read
// must not gate fitting on the checkup. The tap is a starting
// belief; a real diagnosis overrides it whenever one exists; every
// footer labels which basis was used.

check('resolveBand: a diagnosis overrides a declared band, always', () => {
  assert.deepEqual(fit.resolveBand({ diagnosisBand: 'N2', declaredBand: 'N4' }), { band: 'N2', source: 'diagnosis' })
  assert.deepEqual(fit.resolveBand({ diagnosisBand: 'N5', declaredBand: 'N1' }), { band: 'N5', source: 'diagnosis' })
})

check('resolveBand: declared speaks when no diagnosis; none when neither; junk is ignored', () => {
  assert.deepEqual(fit.resolveBand({ diagnosisBand: null, declaredBand: 'N3' }), { band: 'N3', source: 'declared' })
  assert.deepEqual(fit.resolveBand({ declaredBand: 'N4' }), { band: 'N4', source: 'declared' })
  assert.deepEqual(fit.resolveBand({ diagnosisBand: null, declaredBand: null }), { band: null, source: 'none' })
  assert.deepEqual(fit.resolveBand({}), { band: null, source: 'none' })
  assert.deepEqual(fit.resolveBand(), { band: null, source: 'none' })
  // Not-a-band values never become a basis — no guessing at levels.
  assert.deepEqual(fit.resolveBand({ diagnosisBand: 'N9', declaredBand: 'N3' }), { band: 'N3', source: 'declared' })
  assert.deepEqual(fit.resolveBand({ diagnosisBand: 'N9', declaredBand: 'beginner' }), { band: null, source: 'none' })
})

check('declared credit: a declared band fits passages like a diagnosed one (gate unchanged)', () => {
  // The same passage shape as the diagnosed-credit check above.
  const toks = [
    ...Array(9).fill({ s: '食べ', h: '食べる', l: 'N5' }),
    ...Array(5).fill({ s: '引っ越し', h: '引っ越す', l: 'N4' }),
    ...Array(5).fill({ s: 'は', h: 'は', l: null }),
    { s: '指摘', h: '指摘', l: 'N1' },
  ]
  const deck = new Map([['食べる', 'N5'], ['引っ越す', 'N4'], ['指摘', 'N1']])
  const resolved = fit.resolveBand({ diagnosisBand: null, declaredBand: 'N3' })
  assert.equal(resolved.source, 'declared')
  const declared = fit.buildKnownSet([], [], fit.deckCreditSet(deck, resolved.band))
  const picked = fit.pickPassage([passage('fit', 'N3', toks)], declared, resolved.band)
  assert.equal(picked.ratio, 0.95) // credit on for declared — the same gate, the same fit
  // And with no basis at all there is still no credit and no fit.
  const none = fit.resolveBand({ diagnosisBand: null, declaredBand: null })
  assert.equal(none.band, null)
  assert.equal(fit.pickPassage([passage('fit', 'N3', toks)], fit.buildKnownSet([], []), 'N3'), null)
})

check('level callbacks: every level callback_data fits in 12 bytes', () => {
  // Telegram rejects oversized button payloads silently — the whole
  // level surface (five bands + Not sure) must stay tiny.
  for (const b of fit.BANDS) {
    assert.ok(Buffer.byteLength(`level:${b}`, 'utf8') <= 12, `level:${b}`)
  }
  assert.equal(Buffer.byteLength('level:N5', 'utf8'), 8)
  assert.equal(Buffer.byteLength('level:none', 'utf8'), 10)
})

check('shouldAskLevel: asks only a linked, basis-less, undeclared learner', () => {
  const linked = { user_id: 'u1', chat_id: 42, declared_band: null }
  assert.equal(fit.shouldAskLevel(linked, 'none'), true) // the one case that asks
  assert.equal(fit.shouldAskLevel({ ...linked, declared_band: 'N3' }, 'none'), false) // declared set
  assert.equal(fit.shouldAskLevel(linked, 'diagnosis'), false) // diagnosis in charge
  assert.equal(fit.shouldAskLevel(linked, 'declared'), false) // declared in charge
  assert.equal(fit.shouldAskLevel(null, 'none'), false) // no link at all
  assert.equal(fit.shouldAskLevel({ user_id: 'u1', chat_id: null, declared_band: null }, 'none'), false) // unlinked row
  assert.equal(fit.shouldAskLevel({ user_id: 'u1', declared_band: null }, 'none'), false) // no chat bound
})

check('twin parity: band resolution and the ask agree (resolveBand, shouldAskLevel)', () => {
  const inputs = [
    { diagnosisBand: 'N2', declaredBand: 'N4' },
    { diagnosisBand: null, declaredBand: 'N3' },
    { diagnosisBand: 'N9', declaredBand: 'beginner' },
    { diagnosisBand: null, declaredBand: null },
    {},
  ]
  for (const input of inputs) assert.deepEqual(port.resolveBand(input), fit.resolveBand(input))
  const links = [
    { user_id: 'u1', chat_id: 42, declared_band: null },
    { user_id: 'u1', chat_id: 42, declared_band: 'N3' },
    { user_id: 'u1', chat_id: null, declared_band: null },
    null,
  ]
  for (const link of links) {
    for (const source of ['diagnosis', 'declared', 'none']) {
      assert.equal(port.shouldAskLevel(link, source), fit.shouldAskLevel(link, source))
    }
  }
})

console.log(`reader: ${passed} checks passed`)
