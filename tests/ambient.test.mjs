// Heard Words matcher tests (run: node tests/ambient.test.mjs)
// Pins for Doc 22: the ambient matcher returns ONLY dictionary
// counts — the privacy contract is a property of the code, and the
// adversarial fixture below is its proof: a meeting transcript full
// of names, companies and figures must yield nothing but dictionary
// words, because there is no field that could hold anything else.
//
// The dictionary under test is the production one: the bot's
// curated glossaries PLUS the wide wordbook (public/data/
// wordbook.json — every written form of every full-JMdict entry,
// mapped to its headword). The names dictionary (JMnedict) is
// deliberately not a source, and the fixtures pin that.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'

const ambient = await import('../supabase/functions/reader-bot/ambient.ts')
const { matchHeardWords, summariseHeard, buildHeardDict, heardReading, EXPRESSIONS, HEARD_FLOOR } = ambient

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const wbDir = new URL('../public/data/wordbook/', import.meta.url)
const wbManifest = JSON.parse(readFileSync(new URL('manifest.json', wbDir), 'utf8'))
const wordbook = { heads: [], readings: [], forms: {} }
for (const name of wbManifest.shards) {
  const shard = JSON.parse(readFileSync(new URL(name, wbDir), 'utf8'))
  wordbook.heads.push(...shard.heads)
  wordbook.readings.push(...shard.readings)
  Object.assign(wordbook.forms, shard.forms)
}
const t0 = Date.now()
const dict = buildHeardDict(wordbook)
console.log(`  (wide dictionary built: ${dict.surfaces.size} surfaces in ${Date.now() - t0}ms)`)
const narrowDict = buildHeardDict()

check('wide dictionary is real: business words in, names out', () => {
  assert.ok(dict.surfaces.size > 400_000, 'the wide wordbook should carry 400k+ surfaces')
  for (const w of ['見積', '会議室', '会議', '書類', '確認', '連絡', '資料', '提出']) {
    assert.ok(dict.surfaces.has(w), `${w} should be matchable`)
  }
  for (const w of ['田中', '山田', '鈴木', '佐藤']) {
    assert.ok(!dict.surfaces.has(w), `${w} is a name — it must NOT be in the dictionary`)
  }
})

check('the widening lands: words outside the curated glossaries now match', () => {
  // 納期 was the first real-world miss: absent from the deck, the
  // glossaries AND JMdict's common subset — present in full JMdict.
  for (const w of ['納期', '検収', '稟議', '見積書']) {
    assert.ok(dict.items.has(w), `${w} should be a countable item now`)
    assert.ok(!narrowDict.items.has(w), `${w} pins the widening: the curated-only fallback must NOT have it`)
  }
  const { counts } = matchHeardWords('納期を確認しました。検収と稟議も済ませました。', dict)
  assert.equal(counts.get('納期')?.count, 1)
  assert.equal(counts.get('検収')?.count, 1)
  assert.equal(counts.get('稟議')?.count, 1)
})

check('a word heard in kana counts under its kanji headword, with a reading', () => {
  const { counts } = matchHeardWords('のうきが遅れています。のうきの連絡は明日します。', dict)
  assert.equal(counts.get('納期')?.count, 2, 'のうき hearings land on 納期')
  assert.equal(heardReading(dict, '納期'), 'のうき')
  assert.equal(heardReading(dict, '会議'), 'かいぎ')
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
  const text = '田中部長は山田商事との会議で、第三四半期の売上高が前年比120パーセントの4億3000万円に達したと報告し、来月から極秘プロジェクト「ZX」が始まると発表した。鈴木さんの内線番号は4832番です。'
  const { counts } = matchHeardWords(text, dict)
  for (const item of counts.keys()) {
    assert.ok(dict.items.has(item) || EXPRESSIONS.some((e) => e.surface === item),
      `stored item ${item} must be a dictionary entry or a curated expression`)
    assert.ok(!/^[0-9a-zA-Z]+$/.test(item), `stored item ${item} must be a dictionary word, never a bare figure or code from the room (an entry like 第3四半期 carries its own numeral — it is the same word for everyone)`)
  }
  for (const banned of ['田中', '山田', '鈴木']) {
    assert.ok(!counts.has(banned), `${banned} must not appear in the counts`)
  }
  assert.ok(!counts.has('120'), 'a bare figure from the room must never become an item (JMdict carries numeric entries — the generator and the matcher both refuse pure digit/letter strings)')
  assert.ok(counts.has('パーセント'), 'the word around the figure still counts')
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

check('seeding targets: words only, unknown only, most-heard first, capped', () => {
  const { selectHeardTargets } = ambient
  const rows = [
    { item: '納期', kind: 'word', count: 5 },
    { item: '会議', kind: 'word', count: 9 },
    { item: '検収', kind: 'word', count: 3 },
    { item: 'ご査収ください', kind: 'expr', count: 7 },
    { item: '資料', kind: 'word', count: 3 },
  ]
  const known = new Set(['会議'])
  assert.deepEqual(selectHeardTargets(rows, known), ['納期', '検収', '資料'],
    'known word and expression excluded; count desc, item asc on ties')
  assert.deepEqual(selectHeardTargets(rows, known, 2), ['納期', '検収'], 'cap honoured')
  assert.deepEqual(selectHeardTargets([], known), [], 'no rows, no targets')
  assert.deepEqual(selectHeardTargets(rows, new Set(['納期', '会議', '検収', '資料'])), [], 'all known, no targets')
})

console.log(`ambient: ${passed} checks passed`)
