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
const checkAsync = async (name, fn) => { await fn(); passed++; console.log(`  ok ${name}`) }

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

// ---------- adaptive fit: the step state (Doc 16 §5 amendment #4) ----------
// Landry's design: the fit adapts itself. Push Me steps up for fun;
// Too Hard steps back to the PREVIOUS KNOWN level (last_good_step),
// never a crash below it; three comfortable reads ratchet the known
// level and trial a stretch — progression hardens from time to time,
// earned by comfort. All spine logic; the gate is untouched.

check('serveBandFor: shifts the basis by the step and clamps at both ends of the ladder', () => {
  assert.equal(fit.serveBandFor('N3', 0), 'N3')
  assert.equal(fit.serveBandFor('N3', 1), 'N2') // a stretch aims one band up
  assert.equal(fit.serveBandFor('N3', -1), 'N4') // a gentler notch aims one down
  assert.equal(fit.serveBandFor('N5', 1), 'N4')
  assert.equal(fit.serveBandFor('N1', 1), 'N1') // clamped at the top
  assert.equal(fit.serveBandFor('N5', -1), 'N5') // clamped at the bottom
  assert.equal(fit.serveBandFor('N3', 5), 'N2') // an out-of-range step clamps to ±1 first
  assert.equal(fit.serveBandFor('N3', -5), 'N4')
})

check('serveBandFor: no basis, no serve band — a step never invents a level', () => {
  assert.equal(fit.serveBandFor(null, 1), null)
  assert.equal(fit.serveBandFor(undefined, -1), null)
  assert.equal(fit.serveBandFor('', 0), null)
  assert.equal(fit.serveBandFor('N9', 1), null)
})

check('applyFeedback: comfortable reads log — and the third ratchets last_good and trials up', () => {
  const s0 = { fit_step: 0, last_good_step: 0, comfy_streak: 0 }
  const r1 = fit.applyFeedback(s0, 'read')
  assert.deepEqual(r1, { fit_step: 0, last_good_step: 0, comfy_streak: 1, effect: 'logged' })
  const r2 = fit.applyFeedback(r1, 'read')
  assert.deepEqual(r2, { fit_step: 0, last_good_step: 0, comfy_streak: 2, effect: 'logged' })
  const r3 = fit.applyFeedback(r2, 'read')
  // Third in a row: step 0 is PROVEN (last_good ratchets to it), the
  // fit trials one step up, and the streak resets.
  assert.deepEqual(r3, { fit_step: 1, last_good_step: 0, comfy_streak: 0, effect: 'trial_up' })
})

check('applyFeedback: at full stretch, the third read proves the stretch instead of overshooting', () => {
  let s = { fit_step: 1, last_good_step: 0, comfy_streak: 0 }
  s = fit.applyFeedback(s, 'read')
  s = fit.applyFeedback(s, 'read')
  const r = fit.applyFeedback(s, 'read')
  // No +2 exists: the ratchet moves last_good UP to the proven
  // stretch, the step stays, the effect says proven, not trial_up.
  assert.deepEqual(r, { fit_step: 1, last_good_step: 1, comfy_streak: 0, effect: 'proven' })
})

check('applyFeedback: Push Me steps up once, clamps at max, and clears the streak', () => {
  const pushed = fit.applyFeedback({ fit_step: 0, last_good_step: 0, comfy_streak: 2 }, 'up')
  assert.deepEqual(pushed, { fit_step: 1, last_good_step: 0, comfy_streak: 0, effect: 'pushed' })
  const maxed = fit.applyFeedback({ fit_step: 1, last_good_step: 0, comfy_streak: 0 }, 'up')
  assert.deepEqual(maxed, { fit_step: 1, last_good_step: 0, comfy_streak: 0, effect: 'max' })
})

check('applyFeedback: Too Hard returns to the previous known level — never a crash below it', () => {
  // Stretched by Push Me, unproven: back to the known level 0.
  const back = fit.applyFeedback({ fit_step: 1, last_good_step: 0, comfy_streak: 1 }, 'hard')
  assert.deepEqual(back, { fit_step: 0, last_good_step: 0, comfy_streak: 0, effect: 'step_back' })
  // The stretch was PROVEN (last_good ratcheted to 1): Too Hard
  // stays at the proven level — proven ground is not lost.
  const stays = fit.applyFeedback({ fit_step: 1, last_good_step: 1, comfy_streak: 0 }, 'hard')
  assert.deepEqual(stays, { fit_step: 1, last_good_step: 1, comfy_streak: 0, effect: 'step_back' })
  // At the floor already: nothing moves (the explanation still
  // sends — that is the handler's half of the protocol).
  const floor = fit.applyFeedback({ fit_step: 0, last_good_step: 0, comfy_streak: 0 }, 'hard')
  assert.deepEqual(floor, { fit_step: 0, last_good_step: 0, comfy_streak: 0, effect: 'step_back' })
  // An unknown kind never moves the state.
  const untouched = fit.applyFeedback({ fit_step: 1, last_good_step: 0, comfy_streak: 2 }, 'meh')
  assert.deepEqual(untouched, { fit_step: 1, last_good_step: 0, comfy_streak: 2, effect: 'ignored' })
})

check('fit callbacks: payloads round-trip and stay ≤64 bytes even with a uuid passage id', () => {
  const uuid = '123e4567-e89b-12d3-a456-426614174000' // 36 chars — the longest id shape
  assert.equal(fit.fitCallback('read', 'scene-city-address'), 'fit:read:scene-city-address')
  for (const kind of fit.FEEDBACK_KINDS) {
    const data = fit.fitCallback(kind, uuid)
    assert.ok(Buffer.byteLength(data, 'utf8') <= 64, `${data} is ${Buffer.byteLength(data, 'utf8')} bytes`)
    assert.deepEqual(fit.parseFitCallback(data), { kind, passageId: uuid })
  }
  assert.equal(Buffer.byteLength(fit.fitCallback('hard', uuid), 'utf8'), 45)
  // Malformed payloads parse to null, never to a guess.
  assert.equal(fit.parseFitCallback('mine:abc'), null)
  assert.equal(fit.parseFitCallback('fit:meh:abc'), null)
  assert.equal(fit.parseFitCallback('fit:read:'), null)
  assert.equal(fit.parseFitCallback('fit:read'), null)
  assert.equal(fit.parseFitCallback(null), null)
  assert.deepEqual(fit.parseFitCallback('fit:up:foundry-abc-def'), { kind: 'up', passageId: 'foundry-abc-def' })
})

check('hasFeedbackFor: the first tap for a passage counts; later taps dedupe', () => {
  const rows = [
    { kind: 'read', passageId: 'p-1', fitStepAfter: 0 },
    { kind: 'up', passageId: 'p-2', fitStepAfter: 1 },
    null,
    {},
  ]
  assert.equal(fit.hasFeedbackFor(rows, 'p-1'), true)
  assert.equal(fit.hasFeedbackFor(rows, 'p-2'), true) // any kind — one tap per passage, total
  assert.equal(fit.hasFeedbackFor(rows, 'p-3'), false)
  assert.equal(fit.hasFeedbackFor([], 'p-1'), false)
  assert.equal(fit.hasFeedbackFor(null, 'p-1'), false)
})

check('twin parity: adaptive-fit APIs agree (serve band, transitions, callbacks, dedupe, constants)', () => {
  assert.equal(port.FIT_STEP_MIN, fit.FIT_STEP_MIN)
  assert.equal(port.FIT_STEP_MAX, fit.FIT_STEP_MAX)
  assert.equal(port.COMFY_STREAK_TARGET, fit.COMFY_STREAK_TARGET)
  assert.deepEqual(port.FEEDBACK_KINDS, fit.FEEDBACK_KINDS)
  for (const band of ['N5', 'N4', 'N3', 'N2', 'N1', null, 'N9']) {
    for (const step of [-5, -1, 0, 1, 5]) {
      assert.equal(port.serveBandFor(band, step), fit.serveBandFor(band, step))
    }
  }
  const states = [
    { fit_step: 0, last_good_step: 0, comfy_streak: 0 },
    { fit_step: 0, last_good_step: 0, comfy_streak: 2 },
    { fit_step: 1, last_good_step: 0, comfy_streak: 2 },
    { fit_step: 1, last_good_step: 1, comfy_streak: 1 },
  ]
  for (const s of states) {
    for (const kind of ['read', 'up', 'hard', 'meh']) {
      assert.deepEqual(port.applyFeedback(s, kind), fit.applyFeedback(s, kind))
    }
  }
  assert.equal(port.fitCallback('up', 'p-9'), fit.fitCallback('up', 'p-9'))
  assert.deepEqual(port.parseFitCallback('fit:hard:p-9'), fit.parseFitCallback('fit:hard:p-9'))
  const rows = [{ kind: 'read', passageId: 'p-9', fitStepAfter: 0 }]
  assert.equal(port.hasFeedbackFor(rows, 'p-9'), fit.hasFeedbackFor(rows, 'p-9'))
  assert.equal(port.hasFeedbackFor(rows, 'p-x'), fit.hasFeedbackFor(rows, 'p-x'))
})

// ---------- voice proof + morning dispatch (Doc 16, 2026-11-06 late) ----------
// R1/R2 pulled forward on Landry's "build everything": the voice-
// note read-aloud is the performed proof of a read (duration only —
// no transcription in v1), and the morning dispatch is the bot's
// one sanctioned proactive send. Both decisions are pure spine
// logic in the twins; the wire code (Edge TTS, Telegram, pg_cron)
// stays untested by design, exactly like generation's model call.

check('voiceReadWindow: expected seconds are chars / 6.5, window 0.35×–2.75×', () => {
  const w = fit.voiceReadWindow(650, 100)
  assert.equal(w.expectedSec, 100)
  assert.equal(w.minSec, 35)
  assert.equal(w.maxSec, 275)
  assert.equal(w.plausible, true) // exactly at the expected pace
  assert.equal(fit.VOICE_READ_CHARS_PER_SEC, 6.5)
})

check('voiceReadWindow: the window edges are inclusive; just outside is not a read', () => {
  assert.equal(fit.voiceReadWindow(650, 35).plausible, true) // fast but complete
  assert.equal(fit.voiceReadWindow(650, 275).plausible, true) // slow, careful, twice-through
  assert.equal(fit.voiceReadWindow(650, 34.9).plausible, false) // a skim, not a read
  assert.equal(fit.voiceReadWindow(650, 275.1).plausible, false) // ran long — not one read
  assert.equal(fit.voiceReadWindow(65, 4).plausible, true) // a short passage, read fast (min 3.5s)
})

check('voiceReadWindow: no numbers, no proof — degenerate inputs are never plausible', () => {
  assert.equal(fit.voiceReadWindow(0, 30).plausible, false) // no passage
  assert.equal(fit.voiceReadWindow(0, 30).expectedSec, 0)
  assert.equal(fit.voiceReadWindow(-5, 30).plausible, false)
  assert.equal(fit.voiceReadWindow(650, 0).plausible, false) // a zero-length note
  assert.equal(fit.voiceReadWindow(650, -10).plausible, false)
  assert.equal(fit.voiceReadWindow(650, NaN).plausible, false)
  assert.equal(fit.voiceReadWindow(650, undefined).plausible, false)
  assert.equal(fit.voiceReadWindow('650', '100').plausible, true) // payload-shaped strings coerce
})

check('voice proof trace: a plausible voice read counts ONCE, through the tap machinery', () => {
  // The handler's composition, on fixtures: two Read It taps are on
  // file (streak 2); a plausible voice read of a third passage runs
  // the window check, then applyFeedback('read') — the same
  // transition as a tap — and the logged payload dedupes any later
  // tap or second voice note for that passage.
  let s = { fit_step: 0, last_good_step: 0, comfy_streak: 2 }
  const win = fit.voiceReadWindow(390, 58) // expected 60s — a real read-aloud
  assert.equal(win.plausible, true)
  s = fit.applyFeedback(s, 'read')
  assert.deepEqual(s, { fit_step: 1, last_good_step: 0, comfy_streak: 0, effect: 'trial_up' })
  const logged = [{ kind: 'read', passageId: 'p-voice', fitStepAfter: 1, via: 'voice' }]
  assert.equal(fit.hasFeedbackFor(logged, 'p-voice'), true) // a tap after the voice read cannot double-count
  // And an implausible note changes nothing: no transition is run.
  assert.equal(fit.voiceReadWindow(390, 10).plausible, false)
})

check('isDispatchDue: inside [morning, morning+90min) is due; the edges behave', () => {
  const base = { morningMinutes: 450, sentMorningToday: false } // 07:30
  assert.equal(fit.isDispatchDue({ ...base, nowMinutes: 450 }), true) // the minute itself
  assert.equal(fit.isDispatchDue({ ...base, nowMinutes: 465.5 }), true) // mid-window, fractional
  assert.equal(fit.isDispatchDue({ ...base, nowMinutes: 480 }), true) // the 08:00 tick retries
  assert.equal(fit.isDispatchDue({ ...base, nowMinutes: 539.99 }), true)
  assert.equal(fit.isDispatchDue({ ...base, nowMinutes: 540 }), false) // window end is exclusive
  assert.equal(fit.isDispatchDue({ ...base, nowMinutes: 449.99 }), false) // not yet
  assert.equal(fit.isDispatchDue({ ...base, nowMinutes: 600 }), false) // long past
  assert.equal(fit.DISPATCH_WINDOW_MIN, 90)
})

check('isDispatchDue: an already-sent morning blocks the day; junk inputs never dispatch', () => {
  assert.equal(fit.isDispatchDue({ morningMinutes: 450, nowMinutes: 455, sentMorningToday: true }), false)
  assert.equal(fit.isDispatchDue({ morningMinutes: 450, nowMinutes: 455, sentMorningToday: 1 }), false) // truthy blocks
  assert.equal(fit.isDispatchDue({ morningMinutes: NaN, nowMinutes: 455, sentMorningToday: false }), false)
  assert.equal(fit.isDispatchDue({ morningMinutes: 450, nowMinutes: undefined, sentMorningToday: false }), false)
  assert.equal(fit.isDispatchDue({}), false)
  assert.equal(fit.isDispatchDue(), false)
  // A midnight morning_time is a real (if unusual) setting, not junk.
  assert.equal(fit.isDispatchDue({ morningMinutes: 0, nowMinutes: 0, sentMorningToday: false }), true)
})

check('twin parity: voice + dispatch APIs agree (window, due, constants)', () => {
  assert.equal(port.VOICE_READ_CHARS_PER_SEC, fit.VOICE_READ_CHARS_PER_SEC)
  assert.equal(port.VOICE_READ_MIN_FACTOR, fit.VOICE_READ_MIN_FACTOR)
  assert.equal(port.VOICE_READ_MAX_FACTOR, fit.VOICE_READ_MAX_FACTOR)
  assert.equal(port.DISPATCH_WINDOW_MIN, fit.DISPATCH_WINDOW_MIN)
  for (const [chars, dur] of [[650, 100], [650, 35], [650, 276], [0, 10], [120, 3], [120, 40]]) {
    assert.deepEqual(port.voiceReadWindow(chars, dur), fit.voiceReadWindow(chars, dur))
  }
  const dues = [
    { morningMinutes: 450, nowMinutes: 450, sentMorningToday: false },
    { morningMinutes: 450, nowMinutes: 480, sentMorningToday: false },
    { morningMinutes: 450, nowMinutes: 455, sentMorningToday: true },
    { morningMinutes: 0, nowMinutes: 29, sentMorningToday: false },
    { morningMinutes: NaN, nowMinutes: 10, sentMorningToday: false },
  ]
  for (const d of dues) assert.equal(port.isDispatchDue(d), fit.isDispatchDue(d))
})

// ---------- web read-aloud scoring (Doc 16 §5 amendment #5) ----------
// The free Web Speech route: the browser transcribes on-device, and
// src/lib/readAloud.js scores the transcript against the passage in
// code. The score is a TEXT MATCH (coverage, in order) — never a
// pronunciation grade — and the one-fix rule is Hick's Law: exactly
// one card, the first missed new word, nothing else competes.

const aloud = await import('../src/lib/readAloud.js')

check('normalizeSpeechText: punctuation and spacing vanish; NFKC folds width variants', () => {
  assert.equal(aloud.normalizeSpeechText('猫は、ご飯を 食べる。'), '猫はご飯を食べる')
  assert.equal(aloud.normalizeSpeechText('「明日」は ９時！'), '明日は9時')
  assert.equal(aloud.normalizeSpeechText('ｶﾀｶﾅ'), 'カタカナ') // half-width kana fold to full
  assert.equal(aloud.normalizeSpeechText(''), '')
  assert.equal(aloud.normalizeSpeechText(null), '')
  assert.equal(aloud.normalizeSpeechText('、。！？'), '') // punctuation alone is not speech
})

check('scoreReadAloud: a verbatim read scores 1; insertions cost nothing', () => {
  const text = '猫はご飯を食べる。'
  assert.deepEqual(aloud.scoreReadAloud(text, '猫はご飯を食べる'), { score: 1, matchedChars: 8, targetChars: 8 })
  // A restart / self-correction in the transcript leaves coverage whole.
  assert.equal(aloud.scoreReadAloud(text, '猫は、えーと、猫はご飯を食べる').score, 1)
})

check('scoreReadAloud: coverage is the fraction voiced, in order', () => {
  const text = '猫はご飯を食べる' // 8 chars
  assert.equal(aloud.scoreReadAloud(text, '猫はご飯').score, 0.5) // half read, half scored
  assert.equal(aloud.scoreReadAloud(text, '食べる').score, 0.375) // only the tail (3 of 8), in order
  assert.equal(aloud.scoreReadAloud(text, '犬は水を飲む').score, 0.25) // only the particles は・を coincide
})

check('scoreReadAloud: no text, no proof — empty inputs score 0', () => {
  assert.equal(aloud.scoreReadAloud('猫はご飯を食べる', '').score, 0)
  assert.equal(aloud.scoreReadAloud('猫はご飯を食べる', '。。。').score, 0) // punctuation is not a read
  assert.equal(aloud.scoreReadAloud('', '猫').score, 0)
  assert.equal(aloud.scoreReadAloud(null, null).score, 0)
})

check('scoreReadAloud: ASR noise dents an honest read but stays above the pass line', () => {
  // Homophone swap （飯→はん sound kept, kanji wrong) + a dropped
  // particle: 2 of 20 normalised chars lost — an honest full read.
  const text = '今日は天気がいいので、駅まで歩いて行きます。'
  const heard = '今日天気いいので駅まで歩いて行きます'
  const { score } = aloud.scoreReadAloud(text, heard)
  assert.ok(score >= aloud.READ_ALOUD_PASS_SCORE, `honest read ${score} must pass`)
  assert.ok(score < 1)
  assert.equal(aloud.READ_ALOUD_PASS_SCORE, 0.7) // pinned: below honest noise, above any partial read
})

check('firstMissedCandidate: the first unvoiced new word, in passage order', () => {
  const cands = [
    { word: 'ご飯', h: 'ご飯', reading: 'ごはん', meaning: 'cooked rice; a meal' },
    { word: '散歩', h: '散歩', reading: 'さんぽ', meaning: 'a walk' },
    { word: '天気', h: '天気', reading: 'てんき', meaning: 'weather' },
  ]
  assert.equal(aloud.firstMissedCandidate(cands, '猫はご飯を食べる'), cands[1]) // 散歩 is the first miss
  assert.equal(aloud.firstMissedCandidate(cands, 'ご飯と散歩と天気'), null) // all voiced — no fix
})

check('firstMissedCandidate: the headword counts — voicing the dictionary form is voicing the word', () => {
  const cands = [{ word: '引っ越し', h: '引っ越す', reading: 'ひっこし', meaning: 'moving house' }]
  assert.equal(aloud.firstMissedCandidate(cands, '来月引っ越す予定です'), null)
  assert.equal(aloud.firstMissedCandidate(cands, '来月引っ越しました'), null) // surface form
  assert.equal(aloud.firstMissedCandidate(cands, '来月旅行します'), cands[0])
  assert.equal(aloud.firstMissedCandidate(cands, ''), null) // no transcript — no fix claimed
  assert.equal(aloud.firstMissedCandidate([], '猫'), null)
  assert.equal(aloud.firstMissedCandidate(null, '猫'), null)
})

// ---------- server scoring twin (Doc 16 §5 amendment #6) ----------
// The Telegram surface scores too, now: the voice note is
// transcribed by Groq's Whisper and judged by score.ts, the server
// port of readAloud.js. One ruler for the proof-of-reading on both
// surfaces — the twins must agree on every fixture, exactly like
// the fit.ts / readerFit.js parity above.

const scorePort = await import('../supabase/functions/reader-bot/score.ts')

check('score twin: the pass line is the same 0.7 on both surfaces', () => {
  assert.equal(scorePort.READ_ALOUD_PASS_SCORE, aloud.READ_ALOUD_PASS_SCORE)
  assert.equal(scorePort.READ_ALOUD_PASS_SCORE, 0.7)
})

check('score twin: normalisation agrees with the web module', () => {
  const samples = ['猫は、ご飯を 食べる。', '「明日」は ９時！', 'ｶﾀｶﾅ', '', null, undefined, '、。！？', '３つの駅']
  for (const s of samples) {
    assert.equal(scorePort.normalizeSpeechText(s), aloud.normalizeSpeechText(s))
  }
})

check('score twin: coverage scores agree across shared fixtures', () => {
  const fixtures = [
    ['猫はご飯を食べる。', '猫はご飯を食べる'],
    ['猫はご飯を食べる。', '猫は、えーと、猫はご飯を食べる'],
    ['猫はご飯を食べる', '猫はご飯'],
    ['猫はご飯を食べる', '食べる'],
    ['猫はご飯を食べる', '犬は水を飲む'],
    ['今日は天気がいいので、駅まで歩いて行きます。', '今日天気いいので駅まで歩いて行きます'],
    ['猫はご飯を食べる', ''],
    ['', '猫'],
    [null, null],
  ]
  for (const [text, heard] of fixtures) {
    assert.deepEqual(scorePort.scoreReadAloud(text, heard), aloud.scoreReadAloud(text, heard))
  }
})

check('score twin: an honest Telegram read passes; a partial one does not', () => {
  const text = '今日は天気がいいので、駅まで歩いて行きます。'
  const honest = scorePort.scoreReadAloud(text, '今日天気いいので駅まで歩いて行きます').score
  assert.ok(honest >= scorePort.READ_ALOUD_PASS_SCORE, `honest read ${honest} must pass`)
  const partial = scorePort.scoreReadAloud(text, '今日は天気がいい').score
  assert.ok(partial < scorePort.READ_ALOUD_PASS_SCORE, `partial read ${partial} must not pass`)
})

check('score twin: firstMissedCandidate agrees — same fix, same order', () => {
  const cands = [
    { word: 'ご飯', h: 'ご飯', reading: 'ごはん', meaning: 'cooked rice; a meal' },
    { word: '散歩', h: '散歩', reading: 'さんぽ', meaning: 'a walk' },
    { word: '天気', h: '天気', reading: 'てんき', meaning: 'weather' },
  ]
  const heard = ['猫はご飯を食べる', 'ご飯と散歩と天気', '', '天気と散歩とご飯']
  for (const h of heard) {
    assert.deepEqual(scorePort.firstMissedCandidate(cands, h), aloud.firstMissedCandidate(cands, h))
  }
  const move = [{ word: '引っ越し', h: '引っ越す', reading: 'ひっこし', meaning: 'moving house' }]
  assert.equal(scorePort.firstMissedCandidate(move, '来月引っ越す予定です'), null) // headword voiced
  assert.equal(scorePort.firstMissedCandidate(move, '来月旅行します'), move[0])
  assert.equal(scorePort.firstMissedCandidate(null, '猫'), null)
  assert.equal(scorePort.firstMissedCandidate(cands, ''), null)
})

// ---------- amendment #7: N7+, foundations pace, doors (2026-11-07) ----------

check('resolveBand: raw N7 resolves to N5 with the joke remembered — and only there', () => {
  assert.deepEqual(fit.resolveBand({ declaredBand: 'N7' }), { band: 'N5', source: 'declared', joke: true })
  assert.deepEqual(port.resolveBand({ declaredBand: 'N7' }), { band: 'N5', source: 'declared', joke: true })
  // A diagnosis overrides band AND joke: no joke key survives.
  assert.deepEqual(fit.resolveBand({ diagnosisBand: 'N3', declaredBand: 'N7' }), { band: 'N3', source: 'diagnosis' })
  // Downstream only ever sees a real band: the step ladder works.
  const resolved = fit.resolveBand({ declaredBand: 'N7' })
  assert.equal(fit.serveBandFor(resolved.band, 0), 'N5')
  assert.equal(fit.serveBandFor(resolved.band, 1), 'N4')
})

check('resolveBand: the latest declaration wins across the two stores; the Telegram row is the incumbent', () => {
  const older = '2026-11-01T00:00:00.000Z'
  const newer = '2026-11-05T00:00:00.000Z'
  // App-side declaration strictly fresher → it takes over.
  assert.deepEqual(
    fit.resolveBand({ declaredBand: 'N4', declaredAt: older, stateDeclaredBand: 'N2', stateDeclaredAt: newer }),
    { band: 'N2', source: 'declared' },
  )
  // Telegram declaration fresher → it stands.
  assert.deepEqual(
    fit.resolveBand({ declaredBand: 'N4', declaredAt: newer, stateDeclaredBand: 'N2', stateDeclaredAt: older }),
    { band: 'N4', source: 'declared' },
  )
  // A tie keeps the incumbent (the Telegram row).
  assert.deepEqual(
    fit.resolveBand({ declaredBand: 'N4', declaredAt: newer, stateDeclaredBand: 'N2', stateDeclaredAt: newer }),
    { band: 'N4', source: 'declared' },
  )
  // A fresher app-side N7 carries the joke with it.
  assert.deepEqual(
    fit.resolveBand({ declaredBand: 'N3', declaredAt: older, stateDeclaredBand: 'N7', stateDeclaredAt: newer }),
    { band: 'N5', source: 'declared', joke: true },
  )
  // Junk in the fresher store is ignored, never guessed at.
  assert.deepEqual(
    fit.resolveBand({ declaredBand: 'N3', declaredAt: older, stateDeclaredBand: 'beginner', stateDeclaredAt: newer }),
    { band: 'N3', source: 'declared' },
  )
  // A state-only declaration still speaks.
  assert.deepEqual(
    fit.resolveBand({ stateDeclaredBand: 'N2', stateDeclaredAt: newer }),
    { band: 'N2', source: 'declared' },
  )
  // The port resolves identically.
  assert.deepEqual(
    port.resolveBand({ declaredBand: 'N4', declaredAt: older, stateDeclaredBand: 'N2', stateDeclaredAt: newer }),
    fit.resolveBand({ declaredBand: 'N4', declaredAt: older, stateDeclaredBand: 'N2', stateDeclaredAt: newer }),
  )
})

check('applyFeedback: foundations pace needs SIX comfortable reads before the ratchet dares', () => {
  assert.equal(fit.COMFY_STREAK_TARGET, 3)
  assert.equal(fit.FOUNDATIONS_COMFY_TARGET, 6)
  assert.equal(port.FOUNDATIONS_COMFY_TARGET, 6)
  let s = { fit_step: 0, last_good_step: 0, comfy_streak: 0 }
  for (let i = 0; i < 5; i++) {
    s = fit.applyFeedback(s, 'read', fit.FOUNDATIONS_COMFY_TARGET)
    assert.equal(s.effect, 'logged')
    assert.equal(s.fit_step, 0)
  }
  assert.equal(s.comfy_streak, 5)
  s = fit.applyFeedback(s, 'read', fit.FOUNDATIONS_COMFY_TARGET)
  assert.equal(s.effect, 'trial_up')
  assert.deepEqual(
    { fit_step: s.fit_step, last_good_step: s.last_good_step, comfy_streak: s.comfy_streak },
    { fit_step: 1, last_good_step: 0, comfy_streak: 0 },
  )
  // At full stretch the sixth read proves instead of overshooting.
  const proven = fit.applyFeedback(
    { fit_step: 1, last_good_step: 1, comfy_streak: 5 },
    'read',
    fit.FOUNDATIONS_COMFY_TARGET,
  )
  assert.equal(proven.effect, 'proven')
  // Push Me and Too Hard never wait for the target, at any pace.
  assert.equal(fit.applyFeedback({ fit_step: 0, last_good_step: 0, comfy_streak: 0 }, 'up', 6).effect, 'pushed')
  assert.equal(fit.applyFeedback({ fit_step: 1, last_good_step: 0, comfy_streak: 4 }, 'hard', 6).effect, 'step_back')
  // The port walks the same six steps.
  let p = { fit_step: 0, last_good_step: 0, comfy_streak: 0 }
  for (let i = 0; i < 6; i++) p = port.applyFeedback(p, 'read', port.FOUNDATIONS_COMFY_TARGET)
  assert.equal(p.effect, 'trial_up')
})

check('pickGentle: same gate, starter order — easiest band, then fewest new words', () => {
  const toks = (knownCount, ...unknownWords) => [...Array(knownCount).fill('猫'), ...unknownWords]
  const onTarget = passage('a-target', 'N4', toks(95, '龍', '鳥', '犬', '馬', '魚')) // ratio .95
  const gentler = passage('b-gentle', 'N5', toks(47, '龍', '鳥', '犬')) // ratio .94, lower band
  const bank = [onTarget, gentler]
  // pickPassage takes the closest-to-target; pickGentle takes the kindest.
  assert.equal(fit.pickPassage(bank, knownNeko, 'N4').passage.id, 'a-target')
  assert.equal(fit.pickGentle(bank, knownNeko, 'N4').passage.id, 'b-gentle')
  // Within one band, fewest distinct new words wins over ratio closeness.
  const fewerNew = passage('c-fewer', 'N5', toks(47, '龍', '鳥', '犬')) // .94, 3 new
  const closerMore = passage('d-closer', 'N5', toks(95, '龍', '鳥', '犬', '馬', '魚')) // .95, 5 new
  assert.equal(fit.pickGentle([closerMore, fewerNew], knownNeko, 'N4').passage.id, 'c-fewer')
  // The gate never moves for gentle picks: below it, above it, and
  // outside the ±1 window all return null — exactly like pickPassage.
  assert.equal(fit.pickGentle([passage('e-low', 'N5', toks(92, '龍', '鳥', '犬', '馬', '魚', '牛', '羊', '豚'))], knownNeko, 'N4'), null)
  assert.equal(fit.pickGentle([passage('f-easy', 'N5', toks(99, '龍'))], knownNeko, 'N4'), null)
  assert.equal(fit.pickGentle([passage('g-far', 'N2', toks(95, '龍', '鳥', '犬', '馬', '魚'))], knownNeko, 'N4'), null)
  // The 14-day exclusion binds gentle picks too.
  assert.equal(fit.pickGentle([gentler], knownNeko, 'N4', ['b-gentle']), null)
  // The port picks identically.
  assert.equal(port.pickGentle(bank, knownNeko, 'N4').passage.id, 'b-gentle')
  assert.equal(port.pickGentle([closerMore, fewerNew], knownNeko, 'N4').passage.id, 'c-fewer')
})

check('levelKeyboard: bands, the N7+ joke, Not sure — identical in both twins, callbacks tiny', () => {
  const kb = fit.levelKeyboard()
  assert.deepEqual(port.levelKeyboard(), kb)
  const rows = kb.inline_keyboard
  assert.deepEqual(rows[0].map((b) => b.callback_data), fit.BANDS.map((b) => `level:${b}`))
  const joke = rows.flat().find((b) => b.callback_data === 'level:N7')
  assert.equal(joke.text, 'N7+ 😂')
  assert.ok(rows.flat().some((b) => b.callback_data === 'level:none'))
  for (const btn of rows.flat()) {
    assert.ok(Buffer.byteLength(btn.callback_data, 'utf8') <= 64, btn.callback_data)
  }
})

// ---------- kanji readings breakdown (Doc 16 §5 amendment #9) ----------
//
// The block inside the passage message: EVERY kanji-bearing word,
// not just the new-word candidates — kanjiReadings takes no known
// set at all, so a word credited as "known" still earns its
// reading. The gloss book here is a fixture; the seeded-bank check
// at the end runs the production DECK_GLOSS over a real row.

const glossOf = (book) => (h) => book[h]

check('kanjiReadings: first-appearance order; lookup by headword, display by surface', () => {
  const toks = [
    { s: '猫', h: '猫', l: 'N5' },
    { s: 'は', h: 'は', l: null },
    { s: '学校', h: '学校', l: 'N4' },
    { s: 'へ', h: 'へ', l: null },
    { s: '行き', h: '行く', l: 'N5' },
    { s: 'ます', h: 'ます', l: null },
  ]
  const book = { '猫': 'ねこ', '学校': 'がっこう', '行く': 'いく' }
  assert.deepEqual(fit.kanjiReadings(toks, glossOf(book)), [
    { word: '猫', reading: 'ねこ' },
    { word: '学校', reading: 'がっこう' },
    { word: '行き', reading: 'いく' },
  ])
})

check('kanjiReadings: a repeated word collapses to its first appearance', () => {
  const toks = [
    { s: '犬', h: '犬', l: 'N5' },
    { s: 'と', h: 'と', l: null },
    { s: '猫', h: '猫', l: 'N5' },
    { s: '犬', h: '犬', l: 'N5' },
    { s: '猫', h: '猫', l: 'N5' },
  ]
  assert.deepEqual(fit.kanjiReadings(toks, glossOf({ '犬': 'いぬ', '猫': 'ねこ' })), [
    { word: '犬', reading: 'いぬ' },
    { word: '猫', reading: 'ねこ' },
  ])
})

check('kanjiReadings: kana-only words never qualify — kanji is the whole point', () => {
  const toks = [
    { s: 'カタカナ', h: 'カタカナ', l: null },
    { s: 'ひらがな', h: 'ひらがな', l: null },
    { s: '鳥', h: '鳥', l: 'N5' },
  ]
  // Even a differing "reading" cannot save a kanji-less surface.
  const book = { 'カタカナ': 'かたかな', 'ひらがな': 'ヒラガナ', '鳥': 'とり' }
  assert.deepEqual(fit.kanjiReadings(toks, glossOf(book)), [
    { word: '鳥', reading: 'とり' },
  ])
})

check('kanjiReadings: no gloss, an empty reading, or reading == surface — no entry', () => {
  const toks = [
    { s: '龍', h: '龍', l: 'N1' },
    { s: '心', h: '心', l: 'N3' },
    { s: '空', h: '空', l: 'N4' },
  ]
  const book = { '心': '心', '空': '' }
  assert.deepEqual(fit.kanjiReadings(toks, glossOf(book)), [])
})

check('kanjiReadings: the cap keeps the first 40 by appearance', () => {
  const toks = Array.from({ length: 45 }, (_, i) => ({ s: `漢${i}`, h: `漢${i}`, l: 'N1' }))
  const out = fit.kanjiReadings(toks, (h) => `よみ${h.slice(1)}`)
  assert.equal(fit.KANJI_READINGS_CAP, 40)
  assert.equal(out.length, 40)
  assert.deepEqual(out[0], { word: '漢0', reading: 'よみ0' })
  assert.deepEqual(out[39], { word: '漢39', reading: 'よみ39' })
})

check('kanjiReadings: legacy string tokens work; junk yields nothing, never a crash', () => {
  const book = { '猫': 'ねこ' }
  assert.deepEqual(fit.kanjiReadings(['猫', 'は', '猫'], glossOf(book)), [
    { word: '猫', reading: 'ねこ' },
  ])
  assert.deepEqual(fit.kanjiReadings(null, glossOf(book)), [])
  assert.deepEqual(fit.kanjiReadings(undefined, glossOf(book)), [])
  assert.deepEqual(fit.kanjiReadings([{ s: '猫', h: '猫', l: 'N5' }], null), [])
  assert.deepEqual(fit.kanjiReadings([{ s: '猫', h: '猫', l: 'N5' }], () => { throw new Error('boom') }), [])
  assert.deepEqual(fit.kanjiReadings([null, 42, {}, { s: 7 }, { s: '', h: '猫' }], glossOf(book)), [])
})

check('twin parity: kanjiReadings agrees across the twins (fixtures, cap, constant)', () => {
  const book = { '猫': 'ねこ', '学校': 'がっこう', '行く': 'いく', '鳥': 'とり', '心': '心' }
  const toks = [
    { s: '猫', h: '猫', l: 'N5' },
    { s: 'は', h: 'は', l: null },
    { s: '学校', h: '学校', l: 'N4' },
    { s: '行き', h: '行く', l: 'N5' },
    { s: '心', h: '心', l: 'N3' },
    { s: '鳥', h: '鳥', l: 'N5' },
    { s: '学校', h: '学校', l: 'N4' },
  ]
  assert.deepEqual(port.kanjiReadings(toks, glossOf(book)), fit.kanjiReadings(toks, glossOf(book)))
  const many = Array.from({ length: 45 }, (_, i) => ({ s: `漢${i}`, h: `漢${i}`, l: 'N1' }))
  const byIndex = (h) => `よみ${h.slice(1)}`
  assert.deepEqual(port.kanjiReadings(many, byIndex), fit.kanjiReadings(many, byIndex))
  assert.equal(port.KANJI_READINGS_CAP, fit.KANJI_READINGS_CAP)
})

const deckGloss = (await import('../supabase/functions/reader-bot/gloss.ts')).DECK_GLOSS

check('kanjiReadings (seeded bank): the school-teacher letter carries its full breakdown', () => {
  const rows = parseSeedRows(new URL('../supabase/seed/reading_passages.sql', import.meta.url))
  const row = rows.get('scene-school-teacher')
  assert.ok(row, 'seeded row scene-school-teacher exists')
  const readingOf = (h) => deckGloss[h]?.reading
  const out = fit.kanjiReadings(row.tokens, readingOf)
  // The exact breakdown of the passage Landry actually received —
  // including words far below candidacy (本, 日): the block serves
  // the staring-at-a-kanji moment, not the new-word list.
  assert.deepEqual(out, [
    { word: '面', reading: 'めん' },
    { word: '時間', reading: 'じかん' },
    { word: '本', reading: 'ほん' },
    { word: '日', reading: 'ひ' },
    { word: '国語', reading: 'こくご' },
    { word: '授業', reading: 'じゅぎょう' },
    { word: '友達', reading: 'ともだち' },
    { word: '心配', reading: 'しんぱいする' },
  ])
  // Every entry is a word of the text, in reading order.
  let last = -1
  for (const e of out) {
    const at = row.text.indexOf(e.word)
    assert.ok(at > last, `${e.word} appears in order`)
    last = at
  }
  assert.deepEqual(port.kanjiReadings(row.tokens, readingOf), out)
})

const jmdictCompounds = (await import('../supabase/functions/reader-bot/jmdict-gloss.ts')).JMDICT_COMPOUNDS

check('kanjiReadings (seeded bank, production wiring): compounds resolve whole, with meanings (amendments #13/#14)', () => {
  const rows = parseSeedRows(new URL('../supabase/seed/reading_passages.sql', import.meta.url))
  const row = rows.get('scene-school-teacher')
  // Wired exactly as reader-bot/index.ts wires it: deck first,
  // then the JMdict compound supplement. The segmenter chopped
  // 面談 into 面 + 談のお… — the block must still show the word
  // the passage actually says, whole (Landry's catch).
  const compoundOf = (w) => {
    const d = deckGloss[w]
    if (d) return d
    const s = jmdictCompounds[w]
    return s ? { reading: s[0], meaning: s[1] } : null
  }
  const out = fit.kanjiReadings(
    row.tokens,
    (h) => deckGloss[h]?.reading,
    (h) => deckGloss[h]?.meaning,
    compoundOf,
  )
  assert.deepEqual(out, [
    { word: '面談', reading: 'めんだん', meaning: 'interview' },
    { word: '時間', reading: 'じかん', meaning: 'time' },
    { word: '本日', reading: 'ほんじつ', meaning: 'today' },
    { word: '国語', reading: 'こくご', meaning: 'national language' },
    { word: '授業', reading: 'じゅぎょう', meaning: 'lesson' },
    { word: '友達', reading: 'ともだち', meaning: 'friend' },
    { word: '心配', reading: 'しんぱいする', meaning: 'to worry' },
  ])
  assert.deepEqual(
    port.kanjiReadings(row.tokens, (h) => deckGloss[h]?.reading, (h) => deckGloss[h]?.meaning, compoundOf),
    out,
  )
})

// ---------------------------------------------------------------
// Telegram Mini App identity validation: the suite imports the
// PRODUCTION module used by supabase/functions/telegram-auth —
// validate.ts, WebCrypto only — rather than reimplementing the
// HMAC here. The signed strings below are fixed known vectors for
// a test-only token; changing any signed byte must break them.
const telegramValidate = await import('../supabase/functions/telegram-auth/validate.ts')
const TELEGRAM_TEST_TOKEN = 'test-only-bot-token'
const TELEGRAM_NOW = 1_700_000_060
const TELEGRAM_INIT_DATA =
  'auth_date=1700000000&query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Test%22%2C%22username%22%3A%22tester%22%7D&hash=b6b89131485477a9da50cc85fdbd8fef3dee4961b2b9336a5caeab9dfa65cc25'

await checkAsync('telegram initData: the production validator accepts the known vector', async () => {
  const result = await telegramValidate.validateTelegramInitData(
    TELEGRAM_INIT_DATA,
    TELEGRAM_TEST_TOKEN,
    TELEGRAM_NOW,
  )
  assert.equal(result.ok, true)
  assert.equal(result.telegramUserId, 123456789)
  assert.equal(result.authDate, 1700000000)
})

await checkAsync('telegram initData: altered signed content fails the HMAC', async () => {
  const altered = TELEGRAM_INIT_DATA.replace('%22Test%22', '%22Best%22')
  const result = await telegramValidate.validateTelegramInitData(
    altered,
    TELEGRAM_TEST_TOKEN,
    TELEGRAM_NOW,
  )
  assert.deepEqual(result, { ok: false, reason: 'bad_signature' })
})

await checkAsync('telegram initData: a tampered hash fails closed', async () => {
  const tampered = TELEGRAM_INIT_DATA.replace(/5$/, '4')
  const result = await telegramValidate.validateTelegramInitData(
    tampered,
    TELEGRAM_TEST_TOKEN,
    TELEGRAM_NOW,
  )
  assert.deepEqual(result, { ok: false, reason: 'bad_signature' })
})

await checkAsync('telegram initData: auth_date older than 24h is stale', async () => {
  const result = await telegramValidate.validateTelegramInitData(
    TELEGRAM_INIT_DATA,
    TELEGRAM_TEST_TOKEN,
    TELEGRAM_NOW + telegramValidate.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
  )
  assert.deepEqual(result, { ok: false, reason: 'stale' })
})

await checkAsync('telegram initData: a signed but malformed user payload is rejected', async () => {
  const malformedUser =
    'auth_date=1700000000&query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=not-json&hash=c539abbdfee23acf1364077e40aff4a4c6fc778808b726bab472e3fcba0f81cf'
  const result = await telegramValidate.validateTelegramInitData(
    malformedUser,
    TELEGRAM_TEST_TOKEN,
    TELEGRAM_NOW,
  )
  assert.deepEqual(result, { ok: false, reason: 'bad_user' })
})

console.log('fit v2 — encounters, seen kanji, dose band, batch recycle (amendment #10):')
{
  // Proven words: 21 single-kanji words the learner demonstrably met.
  const proven = ['猫', '犬', '鳥', '魚', '馬', '牛', '羊', '豚', '兎', '熊', '鹿', '象', '蝶', '蜂', '蟻', '蟹', '鮫', '鶴', '亀', '舌', '山']
  const seen = fit.seenKanjiSet(proven)
  const knownSet = fit.buildKnownSet([], proven, null)
  const toks = (unknown) => [
    ...proven.slice(0, 19).map((w) => ({ s: w, h: w })),
    { s: unknown, h: unknown },
  ]
  const passage = (id, unknown) => ({ id, band: 'N3', tokens: toks(unknown) })
  // Each candidate: 19/20 known = 0.95, squarely in the gate.
  const dosed = passage('dosed', '温泉') // 温+泉 unseen → 2 new kanji
  const zeroNew = passage('zero', '猫舌') // both kanji seen; the WORD is new
  const overDosed = passage('over', '龍鳳麒麟鷲鷺鴨鴛鴦') // 9 distinct new kanji
  const coldish = passage('batchy', '氷河') // 氷+河 unseen → also dosed

  check('seenKanjiSet derives kanji from proven words only', () => {
    assert.equal(seen.has('猫'), true)
    assert.equal(seen.has('舌'), true)
    assert.equal(seen.has('温'), false)
    assert.equal(fit.seenKanjiSet([]).size, 0)
    assert.equal(fit.seenKanjiSet(['あい', '']).size, 0)
  })

  check('passageNewKanji: distinct unseen kanji, first-appearance order', () => {
    assert.deepEqual(fit.passageNewKanji(dosed.tokens, seen), ['温', '泉'])
    assert.deepEqual(fit.passageNewKanji(zeroNew.tokens, seen), [])
    assert.equal(fit.passageNewKanji(overDosed.tokens, seen).length, 9)
    assert.deepEqual(fit.passageNewKanji(['猫', '温泉'], seen), ['温', '泉'])
  })

  check('doseRankOf: dosed (1..8) < zero-new < over-dosed (>8)', () => {
    assert.equal(fit.doseRankOf(1), 0)
    assert.equal(fit.doseRankOf(8), 0)
    assert.equal(fit.doseRankOf(0), 1)
    assert.equal(fit.doseRankOf(9), 2)
    assert.equal(fit.NEW_KANJI_DOSE_MAX, 8)
  })

  check('dose ordering: dosed beats zero-new beats over-dosed', () => {
    const opts = { seenKanji: seen, batchWords: [] }
    assert.equal(fit.pickPassage([zeroNew, overDosed, dosed], knownSet, 'N3', [], opts).passage.id, 'dosed')
    assert.equal(fit.pickPassage([overDosed, zeroNew], knownSet, 'N3', [], opts).passage.id, 'zero')
  })

  check('over-dosed still serves when it alone passes the gate', () => {
    const opts = { seenKanji: seen, batchWords: [] }
    const pick = fit.pickPassage([overDosed], knownSet, 'N3', [], opts)
    assert.equal(pick.passage.id, 'over')
    assert.ok(pick.ratio >= 0.93 && pick.ratio <= 0.97)
  })

  check('no fitOpts → pre-v2 order unchanged (dose-blind)', () => {
    // Identical ratio/size: the id tie-break decides, as before v2.
    assert.equal(fit.pickPassage([zeroNew, dosed], knownSet, 'N3', []).passage.id, 'dosed')
    assert.equal(fit.pickPassage([dosed, zeroNew], knownSet, 'N3', []).passage.id, 'dosed')
  })

  check('currentBatchWords: ungraduated Reader queue words only', () => {
    const queue = [
      { front: '温泉', source: 'reader', fsrs: { reps: 0 } },
      { front: '猫舌', source: 'reader', fsrs: { reps: 3 } }, // graduated
      { front: '氷河', source: 'reader' }, // no fsrs yet → in batch
      { front: '単語', source: 'lesson', fsrs: { reps: 0 } }, // not Reader
      { front: '温泉', source: 'reader', fsrs: { reps: 1 } }, // dupe
    ]
    assert.deepEqual(fit.currentBatchWords(queue), ['温泉', '氷河'])
    assert.equal(fit.GRADUATED_REPS, 3)
  })

  check('passageRecyclesBatch matches by headword', () => {
    assert.equal(fit.passageRecyclesBatch(zeroNew.tokens, ['猫舌']), true)
    assert.equal(fit.passageRecyclesBatch([{ s: '猫舌だ', h: '猫舌' }], ['猫舌']), true)
    assert.equal(fit.passageRecyclesBatch(dosed.tokens, ['猫舌']), false)
    assert.equal(fit.passageRecyclesBatch(dosed.tokens, []), false)
  })

  check('batch recycle outranks dose', () => {
    // zeroNew recycles the batch word 猫舌 (dose rank 1); coldish is
    // purely dosed (rank 0, no batch word). Recycle wins.
    const opts = { seenKanji: seen, batchWords: ['猫舌'] }
    assert.equal(fit.pickPassage([coldish, zeroNew], knownSet, 'N3', [], opts).passage.id, 'zero')
    // With an empty batch the dose preference leads again.
    assert.equal(fit.pickPassage([coldish, zeroNew], knownSet, 'N3', [], { seenKanji: seen, batchWords: [] }).passage.id, 'batchy')
  })

  check('pickGentle honours the same Fit v2 keys', () => {
    const opts = { seenKanji: seen, batchWords: [] }
    assert.equal(fit.pickGentle([zeroNew, dosed], knownSet, 'N3', [], opts).passage.id, 'dosed')
  })

  check('fit v2 twin parity: every new helper agrees', () => {
    const queue = [
      { front: '温泉', source: 'reader', fsrs: { reps: 0 } },
      { front: '猫舌', source: 'reader', fsrs: { reps: 5 } },
    ]
    for (const [name, args] of [
      ['kanjiCharsOf', ['温泉の猫']],
      ['doseRankOf', [0]],
      ['doseRankOf', [4]],
      ['doseRankOf', [12]],
      ['currentBatchWords', [queue]],
      ['passageRecyclesBatch', [dosed.tokens, ['温泉']]],
      ['fitRankKeys', [dosed.tokens, { seenKanji: seen, batchWords: ['温泉'] }]],
      ['fitRankKeys', [zeroNew.tokens, { seenKanji: seen, batchWords: [] }]],
    ]) {
      assert.deepEqual(port[name](...args), fit[name](...args), name)
    }
    assert.deepEqual([...port.seenKanjiSet(proven)].sort(), [...fit.seenKanjiSet(proven)].sort())
    assert.deepEqual(port.passageNewKanji(overDosed.tokens, seen), fit.passageNewKanji(overDosed.tokens, seen))
    assert.equal(port.NEW_KANJI_DOSE_MAX, fit.NEW_KANJI_DOSE_MAX)
    assert.equal(port.GRADUATED_REPS, fit.GRADUATED_REPS)
    const opts = { seenKanji: seen, batchWords: ['猫舌'] }
    assert.equal(
      port.pickPassage([coldish, zeroNew], knownSet, 'N3', [], opts).passage.id,
      fit.pickPassage([coldish, zeroNew], knownSet, 'N3', [], opts).passage.id,
    )
  })

  check('the passage message teaches the voice gesture (amendment #10)', () => {
    // Amendment #11 moved the copy into i18n.ts: the EN catalog
    // carries the gesture lines byte-identically, and index.ts
    // composes them through the catalog keys.
    const cat = readFileSync(new URL('../supabase/functions/reader-bot/i18n.ts', import.meta.url), 'utf8')
    const src = readFileSync(new URL('../supabase/functions/reader-bot/index.ts', import.meta.url), 'utf8')
    assert.ok(cat.includes('hold the microphone button below, read the whole passage'), 'passage instruction line')
    assert.ok(src.includes("bt(lang, 'voice.instruction')"), 'instruction is composed into the passage send')
    assert.ok(cat.includes('🎙 Voice read: after a passage, hold the microphone button'), 'HELP explains the voice read')
    assert.ok(cat.includes('hold the microphone and send another voice note'), 'score replies name the gesture')
  })
}


// ---------- bot i18n (Doc 16 §5 amendment #11) ----------
// The bot speaks the linked user's app language. The catalogs
// live in the function's own i18n.ts (Deno module world — the web
// catalogs are deliberately NOT reused); language resolution
// reads the synced learner-state document's language slice and
// nothing else.
const botI18n = await import('../supabase/functions/reader-bot/i18n.ts')
{
  const { BOT_CATALOGS, bt, botFittedFooter, botLevelIntro, botTrialUpCopy, languageFromState, languageFromStateRow } = botI18n

  check('bot i18n: catalog parity — same key set, non-empty, in all three languages', () => {
    const enKeys = Object.keys(BOT_CATALOGS.en).sort()
    assert.ok(enKeys.length > 0)
    for (const lang of ['fr', 'ja']) {
      assert.deepEqual(Object.keys(BOT_CATALOGS[lang]).sort(), enKeys, lang)
    }
    for (const [lang, catalog] of Object.entries(BOT_CATALOGS)) {
      for (const [key, value] of Object.entries(catalog)) {
        assert.equal(typeof value, 'string', `${lang}:${key}`)
        assert.ok(value.length > 0, `${lang}:${key} is empty`)
      }
    }
  })

  check('bot i18n: resolution reads the language slice — fr/ja resolve, missing or bad falls back to en', () => {
    assert.equal(languageFromStateRow({ state: { language: { lang: 'fr', at: '2026-11-07T00:00:00Z' } } }), 'fr')
    assert.equal(languageFromStateRow({ state: { language: { lang: 'ja', at: '2026-11-07T00:00:00Z' } } }), 'ja')
    assert.equal(languageFromStateRow({ state: { language: { lang: 'en', at: '2026-11-07T00:00:00Z' } } }), 'en')
    assert.equal(languageFromStateRow({ state: {} }), 'en', 'no slice')
    assert.equal(languageFromStateRow({ state: { language: { lang: 'xx', at: 'x' } } }), 'en', 'bad value')
    assert.equal(languageFromStateRow({ state: { language: 'fr' } }), 'en', 'malformed slice')
    assert.equal(languageFromStateRow(null), 'en', 'no row')
    assert.equal(languageFromStateRow(undefined), 'en')
    assert.equal(languageFromState(null), 'en')
    assert.equal(languageFromState({ language: { lang: 'fr' } }), 'fr')
  })

  check('voice result keyboard (amendment #15): Next / Again / Push Me, routed to vnext, again:, vpush:', () => {
    const { voiceResultKeyboard } = botI18n
    const kb = voiceResultKeyboard('en', 'scene-school-teacher')
    assert.deepEqual(kb, {
      inline_keyboard: [
        [
          { text: 'Next Passage 📖', callback_data: 'vnext' },
          { text: 'Read It Again', callback_data: 'again:scene-school-teacher' },
        ],
        [{ text: 'Push Me 🔥', callback_data: 'vpush:scene-school-teacher' }],
      ],
    })
    const fr = voiceResultKeyboard('fr', 'x1')
    assert.equal(fr.inline_keyboard[0][0].text, 'Passage Suivant 📖')
    assert.equal(fr.inline_keyboard[1][0].callback_data, 'vpush:x1')
    const ja = voiceResultKeyboard('ja', 'x1')
    assert.equal(ja.inline_keyboard[0][1].callback_data, 'again:x1')
  })

  check('integration audit: link path names My Twin (never the retired Fleet), in all three languages', () => {
    for (const lang of ['en', 'fr', 'ja']) {
      assert.ok(!bt(lang, 'link.explainer').includes('Fleet'), `${lang} explainer`)
      assert.ok(!bt(lang, 'link.expired').includes('Fleet'), `${lang} expired`)
    }
    assert.ok(bt('en', 'link.explainer').includes('My Twin'))
    assert.ok(bt('fr', 'link.explainer').includes('Mon jumeau'))
    assert.ok(bt('ja', 'link.explainer').includes('わたしのツイン'))
    // The new guided-flow keys exist and are non-empty everywhere
    // (catalog parity above already proves the key SETS match).
    for (const key of ['app.openSession', 'passage.howTo', 'chat.contextReply']) {
      for (const lang of ['en', 'fr', 'ja']) assert.ok(bt(lang, key).length > 0, `${lang}:${key}`)
    }
  })

  check('integration audit: bot source carries the continuation, exact doors and dispatch outcome', () => {
    const src = readFileSync(new URL('../supabase/functions/reader-bot/index.ts', import.meta.url), 'utf8')
    assert.ok(src.includes('continuationKeyboard'), 'one shared continuation builder')
    assert.ok(src.includes("callback_data: 'door:read'"), 'continuation primary is the door serve')
    assert.ok(src.includes('MINI_APP_SESSION_URL'), 'a session door exists')
    assert.ok(src.includes("'session'"), 'no-fit doors land on the session')
    assert.ok(src.includes('dispatch_outcome'), 'dispatch logs its outcome per due learner')
    assert.ok(src.includes("return 'sent'"), 'handleRead reports the sent outcome')
    assert.ok(src.includes('telegramLang()'), 'pre-link replies resolve Telegram language')
    assert.ok(src.includes("bt(lang, 'passage.howTo')"), 'the passage message carries its numbered steps')
    const admin = readFileSync(new URL('../supabase/functions/reader-admin/index.ts', import.meta.url), 'utf8')
    assert.ok(admin.includes('/reader?tg=4'), 'the chat menu button opens the Reader surface')
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    assert.ok(app.includes("path === '/session'"), 'the client routes the literal /session path')
  })

  check('bot i18n: bt interpolates, falls back to EN, then to the key', () => {
    assert.equal(bt('fr', 'level.bandToast', { band: 'N3' }), 'N3 — compris.')
    assert.equal(bt('xx', 'level.notSure'), 'Not sure', 'unknown lang falls back to EN')
    assert.equal(bt('fr', 'no.such.key'), 'no.such.key', 'unknown key surfaces itself')
  })

  check('bot i18n: EN snapshots — the pinned strings are byte-identical to the pre-i18n bot', () => {
    assert.equal(
      bt('en', 'welcome'),
      '🔍 Linked — Hori here, your Miner in Yonde.\n' +
        'Send /read any time and I will dig up a short passage fitted to the words you actually know. ' +
        'New words come <b>bold</b>, and one tap mines them into your review queue.\n' +
        'No streaks, no nagging — reading when you feel like it is the whole design.',
    )
    assert.equal(
      bt('en', 'voice.instruction'),
      '🎙 <b>Read it out loud:</b> hold the microphone button below, read the whole passage, and let go to send — I listen and answer with your reading match.',
    )
    assert.equal(botLevelIntro('en', 'none', null), bt('en', 'level.ask'))
    assert.equal(
      botTrialUpCopy('en'),
      '🔍 Three comfortable reads in a row — that level is properly yours now. ' +
        'The next passage stretches a little past it; that is the fit hardening, one notch at a time. ' +
        'If it overshoots, Too Hard brings us straight back.',
    )
    assert.equal(
      botFittedFooter('en', { bandSource: 'diagnosis', band: 'N2', pct: 95, newWordCount: 3 }),
      'Fitted to your N2 level and your queue: about 95% of its words should already be familiar (an estimate) · 3 new words',
    )
    assert.equal(
      botFittedFooter('en', { bandSource: 'declared', band: 'N3', pct: 94, newWordCount: 1, fitStep: 1, basisBand: 'N3', newKanjiCount: 1, recycledBatch: true }),
      'Fitted to the N3 you told me and your queue: about 94% of its words should already be familiar (an estimate) · 1 new word' +
        '\nYour checkup in Yonde sharpens this whenever you want it.' +
        '\nStretching you a little past N3 today — Push Me works both ways: Too Hard brings us back.' +
        '\n1 kanji here is new to you — it is in the readings block, and it will keep coming back until it is yours.' +
        '\nThis one practises the batch you are learning now — the same words again, in new sentences, until they are yours.',
    )
  })

  check('bot i18n: FR render — translated furniture, the passage text itself untouched', () => {
    const passageText = '今日は学校へ行きます。友達と国語の授業を受けます。'
    const footer = botFittedFooter('fr', {
      bandSource: 'diagnosis', band: 'N2', pct: 95, newWordCount: 3, newKanjiCount: 2,
    })
    const composed = `${passageText}\n\n${footer}\n\n${bt('fr', 'voice.instruction')}`
    assert.ok(footer.startsWith('Ajusté à ton niveau N2'), 'FR footer names the basis')
    assert.ok(footer.includes('3 nouveaux mots'), 'FR footer counts the new words')
    assert.ok(footer.includes('2 kanji ici sont nouveaux pour toi'), 'FR footer carries the dose line')
    assert.ok(bt('fr', 'voice.instruction').includes('maintiens le bouton microphone'), 'FR instruction teaches the gesture')
    assert.ok(composed.includes(passageText), 'the Japanese passage text is byte-identical inside the FR message')
    assert.equal(bt('ja', 'voice.instruction').includes('マイクボタン'), true, 'JA instruction teaches the gesture')
  })

  check('bot i18n: the level keyboard localises ONLY the Not sure label — callback data is byte-identical', () => {
    const frKb = port.levelKeyboard('Je ne sais pas')
    assert.deepEqual(fit.levelKeyboard('Je ne sais pas'), frKb, 'twins agree on the localised keyboard')
    const flat = (kb) => kb.inline_keyboard.flat()
    assert.deepEqual(
      flat(frKb).map((b) => b.callback_data),
      flat(port.levelKeyboard()).map((b) => b.callback_data),
      'callback payloads unchanged by localisation',
    )
    assert.equal(flat(frKb).at(-1).text, 'Je ne sais pas')
    assert.equal(flat(port.levelKeyboard()).at(-1).text, 'Not sure', 'default stays English')
  })
}

check('kanjiReadings: an injected meaning source adds the gloss; without one the entries are unchanged (amendment #13)', () => {
  const toks = [
    { s: '時間', h: '時間', l: 'N3' },
    { s: 'は', h: 'は', l: null },
    { s: '国語', h: '国語', l: 'N3' },
  ]
  const readings = { '時間': 'じかん', '国語': 'こくご' }
  const meanings = { '時間': 'time' } // 国語 deliberately unglossed in the fixture
  assert.deepEqual(fit.kanjiReadings(toks, glossOf(readings), glossOf(meanings)), [
    { word: '時間', reading: 'じかん', meaning: 'time' },
    { word: '国語', reading: 'こくご' },
  ])
  assert.deepEqual(fit.kanjiReadings(toks, glossOf(readings)), [
    { word: '時間', reading: 'じかん' },
    { word: '国語', reading: 'こくご' },
  ])
})

// ---------- reader-serve: the web pipeline twin (amendment #16) ----------
// The web /reader page's bank-only pick dead-ended learners the
// bot would have fitted by generation. reader-serve runs the
// same pipeline behind a user JWT. Its fit.ts / segment.ts must
// stay byte-identical to the bot's — a drift would move the gate
// on one surface only.
{
  const { readFileSync } = await import('node:fs')
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  check('reader-serve fit/segment twins are byte-identical to the bot', () => {
    assert.equal(read('../supabase/functions/reader-serve/fit.ts'), read('../supabase/functions/reader-bot/fit.ts'))
    assert.equal(read('../supabase/functions/reader-serve/segment.ts'), read('../supabase/functions/reader-bot/segment.ts'))
    assert.equal(read('../supabase/functions/reader-serve/deck.ts'), read('../supabase/functions/reader-bot/deck.ts'))
  })
  check('reader-serve contract: JWT-named caller, picked/nofit out', () => {
    const fn = read('../supabase/functions/reader-serve/index.ts')
    assert.ok(fn.includes('auth.getUser()'), 'caller named from the JWT')
    assert.ok(fn.includes("status: 'picked'"), 'picked shape')
    assert.ok(fn.includes("status: 'nofit'"), 'nofit is data, not an error')
    assert.ok(fn.includes('tryGenerate') || fn.includes('generateDraft'), 'generation fallback present')
    assert.ok(fn.includes('GEN_COOLDOWN_MS'), 'the generation cooldown rides along')
    assert.ok(!fn.includes('TELEGRAM') && !fn.includes('sendMessage'), 'no Telegram surface in the web pipeline')
  })
  check('the web page asks the server before declaring nothing fits', () => {
    const page = read('../src/components/Reader.jsx')
    assert.ok(page.includes("functions.invoke('reader-serve'"), 'page invokes the serve function')
    assert.ok(page.includes("phase === 'digging'"), 'a digging state covers the wait')
    assert.ok(page.includes('hori-search'), 'the wait shows Hori sweeping the shelf with his magnifying glass, not just the words')
    assert.ok(page.includes('tryServe(ctx, excluded)') || page.includes('await tryServe(ctx, excluded)'), 'another-passage uses it too')
  })
}

console.log(`reader: ${passed} checks passed`)
