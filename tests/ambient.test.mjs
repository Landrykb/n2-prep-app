// Heard Words matcher tests (run: node tests/ambient.test.mjs)
// Pins for Doc 22: the ambient matcher returns ONLY dictionary
// counts — the privacy contract is a property of the code, and the
// adversarial fixture below is its proof: a meeting transcript full
// of names, companies and figures must yield nothing but dictionary
// words, because there is no field that could hold anything else.

import assert from 'node:assert'

const ambient = await import('../supabase/functions/reader-bot/ambient.ts')
const { matchHeardWords, summariseHeard, buildHeardDict, EXPRESSIONS, HEARD_FLOOR } = ambient

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const dict = buildHeardDict()
const surfaces = new Set()
for (const list of dict.byFirst.values()) for (const s of list) surfaces.add(s)

check('dictionary is real: business words in, names and codenames out', () => {
  for (const w of ['見積', '会議室', '会議', '書類', '確認', '連絡', '資料', '提出']) {
    assert.ok(surfaces.has(w), `${w} should be matchable`)
  }
  for (const w of ['田中', '山田', '鳳凰']) {
    assert.ok(!surfaces.has(w), `${w} must NOT be in the dictionary`)
  }
})

check('counts repeated dictionary words in a work stretch', () => {
  const text = '見積の確認をお願いします。見積は明日までに提出してください。会議室で資料を確認します。'
  const { counts } = matchHeardWords(text, dict)
  assert.equal(counts.get('見積')?.count, 2)
  assert.equal(counts.get('確認')?.count, 2)
  assert.equal(counts.get('提出')?.count, 1)
  assert.equal(counts.get('会議室')?.count, 1)
})

check('longest match wins: 会議室 is not split into 会議', () => {
  const { counts } = matchHeardWords('会議室を予約しました。', dict)
  assert.equal(counts.get('会議室')?.count, 1)
  assert.ok(!counts.has('会議'))
})

check('expressions match as units and mask their inner words', () => {
  const text = 'お世話になっております。資料をご査収ください。ご査収くださいと先方にも伝えました。'
  const { counts } = matchHeardWords(text, dict)
  assert.equal(counts.get('お世話になっております')?.kind, 'expr')
  assert.equal(counts.get('ご査収ください')?.count, 2)
  assert.equal(counts.get('ご査収ください')?.kind, 'expr')
})

check('single kana never counts; a single kanji word can', () => {
  const { counts } = matchHeardWords('あ、あの、猫がいます。あ、猫です。', dict)
  assert.ok(!counts.has('あ'), 'single kana あ must be noise, never vocabulary')
  assert.equal(counts.get('猫')?.count, 2)
})

check('ADVERSARIAL: names, companies, figures and codenames cannot persist', () => {
  const text = '田中部長は山田商事との会議で、第三四半期の売上高が前年比120パーセントの4億3000万円に達したと報告し、来月から極秘プロジェクト「鳳凰」が始まると発表した。鈴木さんの内線番号は4832番です。'
  const { counts } = matchHeardWords(text, dict)
  for (const item of counts.keys()) {
    assert.ok(surfaces.has(item) || EXPRESSIONS.some((e) => e.surface === item),
      `stored item ${item} must be a dictionary entry or a curated expression`)
  }
  for (const banned of ['田中', '山田', '鳳凰', '鈴木']) {
    assert.ok(!counts.has(banned), `${banned} must not appear in the counts`)
  }
  // …and the matcher still did its job on the same text: the
  // ordinary business words inside it are exactly what survives.
  assert.ok(counts.has('会議'), 'the dictionary word inside the sentence still counts')
})

check('empty and non-Japanese input yield empty counts', () => {
  assert.equal(matchHeardWords('', dict).counts.size, 0)
  assert.equal(matchHeardWords('The quick brown fox jumps over the lazy dog.', dict).counts.size, 0)
})

check('summary: the floor separates sticking words from heard-once words', () => {
  const rows = [
    { item: '見積', kind: 'word', count: 3 },
    { item: '確認', kind: 'word', count: 1 },
    { item: 'ご査収ください', kind: 'expr', count: 2 },
    { item: '資料', kind: 'word', count: 1 },
  ]
  const s = summariseHeard(rows)
  assert.equal(HEARD_FLOOR, 2)
  assert.deepEqual(s.sticking.map((r) => r.item), ['見積', 'ご査収ください'], 'count desc, expressions first on ties')
  assert.equal(s.onceWords, 2, 'below-floor words contribute only their number, never their identity')
  assert.equal(s.totalHearings, 7)
  assert.equal(s.distinct, 4)
})

console.log(`ambient: ${passed} checks passed`)
