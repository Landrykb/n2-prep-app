// Language system tests (run: TZ=UTC npm run test:i18n)
// Doc 20: the catalogs translate CHROME only, coverage is complete
// (exact key parity across en/fr/ja — a missing key FAILS here, the
// t() English fallback is a safety net, never a coverage strategy),
// and the language choice is a learner-state slice like any other:
// { lang, at }, collected, applied, and merged by newest `at`.

import assert from 'node:assert'

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const i18n = await import('../src/lib/i18n.js')
const { CATALOGS, LANGUAGES, t } = i18n

console.log('i18n — catalog parity (coverage is enforced, not hoped for):')
{
  const langs = Object.keys(CATALOGS).sort()
  check('catalogs exist for exactly en, fr, ja', () => {
    assert.deepEqual(langs, ['en', 'fr', 'ja'])
  })

  const keySets = Object.fromEntries(langs.map((l) => [l, new Set(Object.keys(CATALOGS[l]))]))
  check('every catalog has the exact same key set', () => {
    for (const l of langs) {
      for (const other of langs) {
        const missing = [...keySets[other]].filter((k) => !keySets[l].has(k))
        const extra = [...keySets[l]].filter((k) => !keySets[other].has(k))
        assert.deepEqual({ lang: l, missing, extra }, { lang: l, missing: [], extra: [] })
      }
    }
  })

  check('every key is a non-empty string in all three languages', () => {
    for (const l of langs) {
      for (const [k, v] of Object.entries(CATALOGS[l])) {
        assert.equal(typeof v, 'string', `${l}:${k} is not a string`)
        assert.ok(v.trim().length > 0, `${l}:${k} is empty`)
      }
    }
  })

  check('the catalog is substantial (the wired surfaces are covered)', () => {
    assert.ok(keySets.en.size >= 150, `only ${keySets.en.size} keys — surfaces are missing`)
  })

  check('LANGUAGES lists en/fr/ja with their own names', () => {
    assert.deepEqual(LANGUAGES.map((l) => l.id), ['en', 'fr', 'ja'])
    assert.deepEqual(LANGUAGES.map((l) => l.label), ['English', 'Français', '日本語'])
  })
}

console.log('i18n — t() behaviour:')
{
  check('t() reads the requested language', () => {
    assert.equal(t('fr', 'settings.language'), 'Langue')
    assert.equal(t('ja', 'settings.language'), '言語')
    assert.equal(t('en', 'settings.language'), 'Language')
  })

  check('t() interpolates {name} vars', () => {
    const key = Object.keys(CATALOGS.en).find((k) => CATALOGS.en[k].includes('{'))
    assert.ok(key, 'expected at least one interpolated string in the catalog')
    const out = t('en', key, { [CATALOGS.en[key].match(/\{(\w+)\}/)[1]]: 'ZZZ' })
    assert.ok(out.includes('ZZZ'), `interpolation failed for ${key}: ${out}`)
    assert.ok(!out.includes('undefined'))
  })

  check('t() falls back to English for an unknown language, to the key for an unknown key', () => {
    assert.equal(t('de', 'settings.language'), 'Language')
    assert.equal(t('fr', 'no.such.key'), 'no.such.key')
  })

  check('no catalog string leaks a raw placeholder pattern of another shape', () => {
    for (const l of Object.keys(CATALOGS)) {
      for (const [k, v] of Object.entries(CATALOGS[l])) {
        assert.ok(!/%[sd]|\$\{/.test(v), `${l}:${k} has a foreign placeholder: ${v}`)
      }
    }
  })
}

console.log('i18n — the language slice (collect / apply / merge):')
{
  const store = new Map()
  const prev = globalThis.localStorage
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  try {
    const ls = await import('../src/lib/learnerState.js')
    const { mergeLearnerState } = await import('../src/lib/stateMerge.js')

    check('default: no stored choice → no slice, UI language is en', () => {
      assert.equal(ls.loadLanguage(), null)
      assert.equal(ls.collectLearnerState().language, null)
    })

    check('saveLanguage validates and stamps { lang, at }', () => {
      const rec = ls.saveLanguage('fr')
      assert.equal(rec.lang, 'fr')
      assert.ok(Number.isFinite(Date.parse(rec.at)))
      assert.deepEqual(ls.loadLanguage(), rec)
      assert.equal(ls.saveLanguage('de')?.lang, 'fr') // invalid id refused, prior choice kept
    })

    check('the slice round-trips through collect → apply', () => {
      const doc = ls.collectLearnerState()
      assert.equal(doc.language.lang, 'fr')
      store.clear()
      assert.equal(ls.loadLanguage(), null)
      ls.applyLearnerState(doc)
      assert.deepEqual(ls.loadLanguage(), doc.language)
    })

    check('merge picks the later `at`, whole document, either direction', () => {
      const older = { lang: 'fr', at: '2026-11-07T00:00:00.000Z' }
      const newer = { lang: 'ja', at: '2026-11-07T01:00:00.000Z' }
      assert.deepEqual(mergeLearnerState({ language: older }, { language: newer }).language, newer)
      assert.deepEqual(mergeLearnerState({ language: newer }, { language: older }).language, newer)
      assert.deepEqual(mergeLearnerState({ language: older }, {}).language, older)
      assert.deepEqual(mergeLearnerState({}, { language: newer }).language, newer)
      assert.equal(mergeLearnerState({}, {}).language, null)
    })
  } finally {
    if (prev === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prev
  }
}

console.log(`\ni18n: ${passed} checks passed`)
