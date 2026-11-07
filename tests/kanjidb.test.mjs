// KanjiDB v2 tests (run: TZ=UTC npm run test:kanjidb)
// Pins the generated database under public/data/kanjidb/ (built by
// scripts/build-kanjidb.mjs from KANJIDIC2 + KanjiVG) and the pure helpers
// of src/lib/kanjiDb.js. Data files are read from disk, never via fetch.
//
// Count note: node_modules/kanji/dist/data/kanjidic/ holds 13,109 entries,
// one of which is _notice.txt — so the KANJIDIC2 JSON files, and therefore
// the index, number 13,108.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DB = path.join(root, 'public/data/kanjidb')
const DIC = path.join(root, 'node_modules/kanji/dist/data/kanjidic')
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

const db = await import('../src/lib/kanjiDb.js')

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`) }

const indexRaw = readJson(path.join(DB, 'index.json'))
const index = indexRaw.map(db.expandIndexRow)
const manifest = readJson(path.join(DB, 'manifest.json'))

check('index holds one row per KANJIDIC2 JSON file (13,108)', () => {
  const dicJsonCount = fs.readdirSync(DIC).filter((f) => f.endsWith('.json')).length
  assert.equal(dicJsonCount, 13108)
  assert.equal(indexRaw.length, dicJsonCount)
  assert.equal(manifest.counts.kanjidicKanji, dicJsonCount)
})

check('meta shards together hold every kanji in the index', () => {
  let total = 0
  for (const f of fs.readdirSync(path.join(DB, 'meta'))) {
    total += Object.keys(readJson(path.join(DB, 'meta', f))).length
  }
  assert.equal(total, indexRaw.length)
})

check('loader shard maths points at real files', () => {
  const astral = index.find((r) => r.char.codePointAt(0) > 0x1f000).char
  for (const ch of ['語', '一', '龠', astral]) {
    const metaRel = db.metaShardPath(ch).replace('/data/kanjidb/', '')
    assert.ok(fs.existsSync(path.join(DB, metaRel)), metaRel)
  }
  for (const ch of ['語', '一', '龠']) {
    const strokesRel = db.strokesShardPath(ch).replace('/data/kanjidb/', '')
    assert.ok(fs.existsSync(path.join(DB, strokesRel)), strokesRel)
  }
})

function strokesEntryFor(ch) {
  const shard = readJson(path.join(DB, db.strokesShardPath(ch).replace('/data/kanjidb/', '')))
  return shard[ch] || null
}
function metaFor(ch) {
  const shard = readJson(path.join(DB, db.metaShardPath(ch).replace('/data/kanjidb/', '')))
  return shard[ch] || null
}

check('語 has exactly 14 stroke paths and KANJIDIC2 agrees', () => {
  const entry = strokesEntryFor('語')
  assert.ok(entry)
  assert.equal(entry.paths.length, 14)
  assert.equal(metaFor('語').strokes, 14)
})

check('語 tree: 言 carries the radical flag and nests 口; 吾 nests 五 and 口', () => {
  const { tree } = db.expandStrokesEntry(strokesEntryFor('語'))
  assert.equal(tree.element, '語')
  const gon = tree.children.find((c) => c.element === '言')
  assert.ok(gon)
  assert.ok(gon.radical, '言 must carry a KanjiVG radical flag')
  assert.ok(gon.children.some((c) => c.element === '口'))
  const go = tree.children.find((c) => c.element === '吾')
  assert.ok(go)
  assert.deepEqual(go.children.map((c) => c.element), ['五', '口'])
  // Every stroke belongs to exactly one subtree leaf path: 14 unique indices.
  const all = db.subtreeStrokeIndices(tree)
  assert.equal(all.length, 14)
  assert.equal(new Set(all).size, 14)
})

check('meta for 語 carries sourced readings, meanings and refs', () => {
  const meta = metaFor('語')
  assert.ok(meta.on.includes('ゴ'))
  assert.ok(meta.kun.some((k) => k.startsWith('かた')))
  assert.ok(meta.meanings.includes('language'))
  assert.ok(meta.meaningsFr.includes('langage'))
  assert.equal(meta.radical, 149)
  assert.equal(meta.refs.heisig, '347')
  assert.equal(meta.level, 'N5') // old JLPT 4 -> the app's N5 list
})

check('components index: 言 is contained in 語 and 誠, with its on-reading', () => {
  const components = readJson(path.join(DB, 'components.json'))
  const [chars, on] = components['言']
  assert.ok(chars.includes('語'))
  assert.ok(chars.includes('誠'))
  assert.equal(on, 'ゲン')
  // Integrity: every kanji referenced exists in the index.
  const indexChars = new Set(index.map((r) => r.char))
  for (const [list] of Object.values(components)) {
    for (const ch of [...list]) assert.ok(indexChars.has(ch), ch)
  }
})

check('a kanji KanjiVG does not cover returns an honest null', () => {
  // 丂 is in KANJIDIC2 but has no KanjiVG entry in the current release:
  // the shard simply has no key for it, and the loader maps that to null.
  assert.ok(index.some((r) => r.char === '丂'))
  assert.equal(strokesEntryFor('丂'), null)
  assert.equal(db.expandStrokesEntry(null), null)
  assert.equal(manifest.counts.kanjidicKanji - manifest.counts.kanjivgCovered, 6691)
})

check('search: character, kana, romaji and meaning all find 語', () => {
  assert.equal(db.searchIndex(index, '語')[0].char, '語')
  assert.ok(db.searchIndex(index, 'ゴ').some((r) => r.char === '語'))
  assert.ok(db.searchIndex(index, 'かた').some((r) => r.char === '語'))
  assert.ok(db.searchIndex(index, 'go').some((r) => r.char === '語'))
  // Meaning search sees the index's compact first-meaning field ('word').
  assert.ok(db.searchIndex(index, 'word', 500).some((r) => r.char === '語'))
  assert.equal(db.kanaToRomaji('ゴ'), 'go')
  assert.equal(db.kanaToRomaji('カタル'), 'kataru')
})

check('radicals: 214 entries, all with a character, provenance kept', () => {
  const radicals = readJson(path.join(DB, 'radicals.json'))
  assert.equal(radicals.length, 214)
  assert.ok(radicals.every((r) => r.char && r.charSource))
  const r149 = radicals.find((r) => r.n === 149)
  assert.equal(r149.char, '言')
  const r1 = radicals.find((r) => r.n === 1)
  assert.equal(r1.char, '一')
  assert.equal(r1.nameEn, 'one')
  assert.equal(manifest.validation.goTreeOk, true)
  assert.equal(manifest.validation.componentsIntegrity, true)
})

check('intersectComponents: 日 + 月 finds 明； empty or unknown parts give []', () => {
  const components = readJson(path.join(DB, 'components.json'))
  const both = db.intersectComponents(['日', '月'], components)
  assert.ok(both.includes('明'), '明 must be built from both 日 and 月')
  assert.ok(both.every((c) => components['日'][0].includes(c) && components['月'][0].includes(c)))
  const gon = db.intersectComponents(['言'], components)
  assert.ok(gon.includes('語'))
  assert.deepEqual(db.intersectComponents([], components), [])
  assert.deepEqual(db.intersectComponents(['龘龘'], components), [])
  assert.deepEqual(db.intersectComponents(['日', '龘龘'], components), [])
})

console.log('french layer — curriculum merge (build-french-merge.mjs, docs/18):')
{
  const french = readJson(path.join(DB, 'french.json'))
  const { meaningFrCheckFor, frTokens } = await import('../scripts/build-french-merge.mjs')
  const FR_DIR = path.join(root, '..', '..', 'jpn2easy', 'french-curriculum')
  const booklet = readJson(path.join(FR_DIR, 'entries-L19-L25.json'))
  const bookletByChar = new Map(booklet.map((e) => [e.char, e]))
  const metaFor = (ch) => {
    const shard = readJson(path.join(DB, db.metaShardPath(ch).replace('/data/kanjidb/', '')))
    return shard[ch] || null
  }

  check('french.json: every kanji exists in the index; only tag/check fields ship', () => {
    const chars = new Set(index.map((r) => r.char))
    const entries = french.entries
    assert.equal(Object.keys(entries).length, 814)
    assert.equal(french.manifest.counts.kanji, 814)
    assert.equal(french.manifest.counts.notInKanjidbIndex, 0)
    for (const [ch, row] of Object.entries(entries)) {
      assert.ok(chars.has(ch), `${ch} missing from the kanjidb index`)
      // Rights rule, structurally: tags + check signal only — no
      // booklet compounds, examples, or gloss lines may ship.
      assert.deepEqual(Object.keys(row).sort(), ['lesson', 'meaningFrCheck', 'radicalChar', 'radicalNameFr', 'themes'])
    }
    const recount = { withThemes: 0, withLesson: 0, withRadicalNameFr: 0, checkAgrees: 0, checkDiffers: 0, checkNull: 0 }
    for (const row of Object.values(entries)) {
      if (row.themes.length) recount.withThemes++
      if (row.lesson != null) recount.withLesson++
      if (row.radicalNameFr) recount.withRadicalNameFr++
      if (row.meaningFrCheck === 'agrees') recount.checkAgrees++
      else if (row.meaningFrCheck === 'differs') recount.checkDiffers++
      else recount.checkNull++
    }
    assert.deepEqual(
      Object.fromEntries(Object.keys(recount).map((k) => [k, french.manifest.counts[k]])),
      recount,
    )
  })

  check('french.json: theme tags reference the real S5/S6 lists', () => {
    const valid = new Set()
    for (const list of ['S5', 'S6']) {
      const src = readJson(path.join(FR_DIR, `themes-${list}.json`))
      for (const t of src.themes) {
        for (const k of t.kanji) valid.add(`${list}|${t.theme}|${k.char}|${k.n}`)
      }
    }
    let tagged = 0
    for (const [ch, row] of Object.entries(french.entries)) {
      for (const t of row.themes) {
        assert.ok(valid.has(`${t.list}|${t.theme}|${ch}|${t.n}`), `${ch} theme ${t.theme} (${t.list} #${t.n}) not in the source list`)
        tagged++
      }
    }
    assert.ok(tagged > 0)
  })

  check('meaningFrCheckFor: hand-verified examples from the real data', () => {
    // Verified by eye against the booklet extraction + KANJIDIC2 FR:
    // 回 booklet « tourner, tour » — the dictionary FR list contains
    // both words → full overlap → agrees.
    assert.equal(meaningFrCheckFor(bookletByChar.get('回').meaningFr, metaFor('回').meaningsFr), 'agrees')
    // 勝 booklet « triompher, vaincre, supérieur, excellent » vs
    // dictionary « victoire, gagner, l'emporter, surpasser » — same
    // meaning, zero shared content tokens → differs. This is the
    // rule working as documented: a QA signal, not a verdict.
    assert.equal(meaningFrCheckFor(bookletByChar.get('勝').meaningFr, metaFor('勝').meaningsFr), 'differs')
    // 皮 booklet « peau, ce qui couvre la surface, superficiel » vs
    // dictionary « peau, cuir, fourrure, … » — only « peau » shared,
    // coefficient 0.25 < 0.5 → differs.
    assert.equal(meaningFrCheckFor(bookletByChar.get('皮').meaningFr, metaFor('皮').meaningsFr), 'differs')
    // The stored layer agrees with the rule on the same kanji.
    assert.equal(french.entries['回'].meaningFrCheck, 'agrees')
    assert.equal(french.entries['勝'].meaningFrCheck, 'differs')
    assert.equal(french.entries['皮'].meaningFrCheck, 'differs')
    // No French text on a side → no signal.
    assert.equal(meaningFrCheckFor('', ['peau']), null)
    assert.equal(meaningFrCheckFor('peau', []), null)
    assert.equal(meaningFrCheckFor(null, null), null)
    assert.deepEqual([...frTokens('L’emporter, c’est gagner!')].sort(), ['emporter', 'gagner'])
  })
}

console.log('attested sound families (build-families.mjs, docs/18):')
{
  const familiesDoc = readJson(path.join(DB, 'families.json'))
  const strokesOf = (ch) => {
    const shard = readJson(path.join(DB, db.strokesShardPath(ch).replace('/data/kanjidb/', '')))
    return shard[ch] || null
  }
  const metaOf = (ch) => {
    const shard = readJson(path.join(DB, db.metaShardPath(ch).replace('/data/kanjidb/', '')))
    return shard[ch] || null
  }

  check('families.json: manifest counts agree with the shipped families', () => {
    const counts = familiesDoc.manifest.counts
    assert.equal(familiesDoc.families.length, counts.attestedFamilies)
    assert.ok(familiesDoc.families.length <= 200)
    assert.equal(familiesDoc.families.reduce((s, f) => s + f.members.length, 0), counts.attestedMemberships)
    assert.equal(familiesDoc.families.reduce((s, f) => s + f.alsoComputed.length, 0), counts.computedOnlyMemberships)
    assert.equal(counts.derivedSoundComponentKanji, manifest.counts.soundComponentDerived)
    assert.equal(familiesDoc.manifest.validation.derivedTotalMatchesKanjidbManifest, true)
    assert.ok(familiesDoc.families.every((f) => f.members.length >= 3))
  })

  check('families: every attested member is confirmed by BOTH sources in the real data', () => {
    const componentsData = readJson(path.join(DB, 'components.json'))
    for (const fam of familiesDoc.families) {
      assert.equal(componentsData[fam.component][1], fam.reading)
      for (const ch of fam.members) {
        const m = metaOf(ch)
        assert.equal(m.soundComponent, fam.component, `${ch}: derived rule must name the component`)
        assert.ok(m.on.includes(fam.reading), `${ch}: reading must be among its on-readings`)
        const entry = strokesOf(ch)
        assert.ok((entry?.tree?.c || []).some((n) => n.e === fam.component && n.ph), `${ch}: KanjiVG must mark the component group phonetic`)
      }
      for (const ch of fam.alsoComputed) {
        const m = metaOf(ch)
        assert.equal(m.soundComponent, fam.component, `${ch}: alsoComputed still needs the derived rule`)
        const entry = strokesOf(ch)
        assert.ok(!(entry?.tree?.c || []).some((n) => n.e === fam.component && n.ph), `${ch}: alsoComputed must NOT carry the phonetic mark`)
      }
    }
  })

  check('青/セイ family: the six common kanji are attested; 靖 is computed only', () => {
    const fam = familiesDoc.families.find((f) => f.component === '青')
    assert.ok(fam, 'the 青 family must ship')
    assert.equal(fam.reading, 'セイ')
    for (const ch of ['情', '請', '清', '精', '静', '晴']) assert.ok(fam.members.includes(ch), `${ch} must be attested`)
    assert.ok(fam.alsoComputed.includes('靖'))
    assert.ok(!fam.members.includes('靖'))
  })
}

console.log('KanjiVG variant forms (build-variants.mjs, docs/18):')
{
  const variantsDoc = readJson(path.join(DB, 'variants.json'))
  const strokesOf = (ch) => {
    const shard = readJson(path.join(DB, db.strokesShardPath(ch).replace('/data/kanjidb/', '')))
    return shard[ch] || null
  }
  const { variantNote } = await import('../scripts/build-variants.mjs')

  check('variants.json: investigation + counts agree; payload under budget', () => {
    const inv = variantsDoc.manifest.investigation
    assert.equal(inv.mainFormFiles, 6703)
    assert.equal(inv.variantFiles, 4959)
    assert.equal(inv.variantBaseKanji, 4076)
    assert.equal(inv.variantBaseKanjiInOurStrokes, 4076)
    const entries = Object.entries(variantsDoc.variants)
    assert.equal(entries.length, variantsDoc.manifest.counts.kanjiWithVariantsShipped)
    assert.equal(entries.reduce((s, [, l]) => s + l.length, 0), variantsDoc.manifest.counts.variantsShipped)
    assert.ok(variantsDoc.manifest.counts.payloadBytes <= variantsDoc.manifest.counts.budgetBytes)
    for (const [ch, list] of entries) {
      assert.ok(strokesOf(ch), `${ch}: variants ship only for kanji with standard strokes`)
      for (const v of list) assert.ok(v.paths.length > 0, `${ch}/${v.variant}: no paths`)
    }
  })

  check('直 ships its Kaisho form; 語 has no variants; standard paths unaffected', () => {
    const choku = variantsDoc.variants['直']
    assert.ok(choku?.some((v) => v.variant === 'Kaisho' && v.paths.length === 8), '直-Kaisho with 8 paths')
    assert.ok(choku.find((v) => v.variant === 'Kaisho').note.includes('Kaisho'))
    assert.equal(variantsDoc.variants['語'], undefined)
    assert.equal(strokesOf('直').paths.length, 8)
    assert.equal(strokesOf('語').paths.length, 14)
  })

  check('variant notes come only from the documented suffix vocabulary', () => {
    assert.equal(variantNote('Kaisho'), 'Kaisho (regular script) form')
    assert.equal(variantNote('Insatsu'), 'printed form')
    assert.ok(variantNote('KaishoVtLst').includes('vertical last'))
    assert.equal(variantNote('KaishoLe'), null)
    assert.equal(variantNote('NoDot'), null)
    for (const list of Object.values(variantsDoc.variants)) {
      for (const v of list) {
        if (v.note != null) assert.equal(v.note, variantNote(v.variant), `${v.variant}: note must equal the composed gloss`)
      }
    }
  })
}

console.log(`\nkanjidb: ${passed} checks passed`)
