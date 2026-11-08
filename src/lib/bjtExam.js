// BJT Full Exam engine — the real BJT paper, rebuilt in-app.
//
// Structure/bands are the official facts (kanken.or.jp BJT): 80 questions,
// Part 1 聴解 25 (~45 min), Part 2 聴読解 25 (~30 min), Part 3 読解 30 (30 min),
// score 0–800, bands J5 0–199 · J4 200–319 · J3 320–419 · J2 420–529 ·
// J1 530–599 · J1+ 600–800. The real score is IRT-equated; ours is a
// documented mock equating (score = round(800 × accuracy)) and is always
// labelled "est." — the proof claim rests on the paper being SEALED and
// full-length, not on the equating.
//
// POOLS (Landry, 2026-11-08): bank groups are 'sealed' or 'practice'.
// Sealed questions never appear in practice and never feed the variant
// generators. Passing a sealed paper is the strong evidence; passing
// practised questions is not. Legacy BJT content (bjt.js) maps to the
// practice pool. Form practice (variants of the exam's forms, synced to
// what the learner studies) lives at the bottom of this file.

import { bjtAllGroups, BJT_FORMS, BJT_PARTS } from '../data/bjtBank.js'
import { bjtPassages, bjtListening, bjtDailyQuestions, bjtKeigo, bjtVocab } from '../data/bjt.js'
import { shuffleWithSeed, seededRandom } from './shuffle.js'

export { BJT_FORMS, BJT_PARTS }

export const BJT_BANDS = [
  { band: 'J1+', min: 600 }, { band: 'J1', min: 530 }, { band: 'J2', min: 420 },
  { band: 'J3', min: 320 }, { band: 'J4', min: 200 }, { band: 'J5', min: 0 },
]

export function bandForScore(score) {
  for (const b of BJT_BANDS) if (score >= b.min) return b.band
  return 'J5'
}

/** Section rank 1–7 from accuracy — documented mock mapping (the real
 *  ranks are IRT percentiles against past examinees). */
export function rankForAccuracy(acc) {
  if (acc >= 0.93) return 7
  if (acc >= 0.82) return 6
  if (acc >= 0.70) return 5
  if (acc >= 0.57) return 4
  if (acc >= 0.43) return 3
  if (acc >= 0.28) return 2
  return 1
}

const toItems = (questions) => (questions || []).map((q) => ({
  prompt: q.prompt,
  options: (q.options || []).map((o) => (typeof o === 'string' ? o : o.label)),
  answer: Math.max(0, (q.options || []).findIndex((o) => typeof o !== 'string' && o.correct)),
  vocab: [],
}))

const parseScript = (script) => (script || '')
  .split('\n')
  .map((line) => {
    const m = line.match(/^([AB])：(.*)$/)
    return m ? { who: m[1], text: m[2] } : null
  })
  .filter(Boolean)

/** Legacy BJT content as practice-pool groups (never sealed, by rule). */
export function practiceGroups() {
  const groups = []
  bjtListening.forEach((entry, i) => groups.push({
    id: `pb-listen-${i}`, form: 'sougouL', pool: 'practice', level: entry.level,
    domain: 'listening', script: parseScript(entry.script), items: toItems(entry.questions),
  }))
  bjtPassages.forEach((entry, i) => groups.push({
    id: `pb-pass-${i}`, form: 'sougouR', pool: 'practice', level: entry.level,
    domain: 'reading', doc: entry.text, items: toItems(entry.questions),
  }))
  bjtDailyQuestions.forEach((q) => groups.push({
    id: `pb-daily-${q.id}`, form: 'goi', pool: 'practice', level: q.level,
    domain: 'vocab', items: toItems([q]),
  }))
  return groups
}

export function allGroups() {
  return [...bjtAllGroups, ...practiceGroups()]
}

const itemKey = (group, idx) => `${group.id}#${idx}`

/**
 * Assemble a paper. sealedOnly=true draws exclusively from the sealed pool
 * (the proof paper). Groups are preferred when their vocabulary overlaps
 * what the learner already knows (synced with their study — the exam meets
 * their words), with the seeded shuffle breaking ties so papers vary.
 */
export function assemblePaper({ sealedOnly = true, seed = 1, knownWords = null } = {}) {
  const pool = allGroups().filter((g) => (sealedOnly ? g.pool === 'sealed' : true))
  const known = knownWords instanceof Set ? knownWords : null
  const knownShare = (g) => {
    if (!known) return 0
    const words = g.items.flatMap((it) => it.vocab || [])
    if (!words.length) return 0
    return words.filter((w) => known.has(w)).length / words.length
  }
  const groups = []
  const thin = []
  const byForm = {}
  for (const [form, spec] of Object.entries(BJT_FORMS)) {
    const candidates = shuffleWithSeed(pool.filter((g) => g.form === form), seed)
      .sort((a, b) => knownShare(b) - knownShare(a))
    let count = 0
    for (const g of candidates) {
      if (count >= spec.count) break
      groups.push(g)
      count += g.items.length
    }
    byForm[form] = Math.min(count, spec.count)
    if (count < spec.count) thin.push(form)
  }
  const totalQuestions = groups.reduce((n, g) => n + g.items.length, 0)
  const sealedQuestions = groups.filter((g) => g.pool === 'sealed')
    .reduce((n, g) => n + g.items.length, 0)
  const sealed = totalQuestions > 0 && sealedQuestions === totalQuestions && thin.length === 0
  return { groups, byForm, thin, totalQuestions, sealedQuestions, sealed, seed }
}

/** Score a finished paper. answers: { [itemKey]: chosenIndex }. */
export function scorePaper(paper, answers = {}) {
  const perForm = {}
  const misses = []
  let correct = 0
  let total = 0
  for (const g of paper.groups) {
    const spec = BJT_FORMS[g.form]
    if (!perForm[g.form]) perForm[g.form] = { name: spec?.name || g.form, correct: 0, total: 0 }
    g.items.forEach((item, i) => {
      const key = itemKey(g, i)
      const chosen = answers[key]
      total += 1
      perForm[g.form].total += 1
      if (chosen === item.answer) {
        correct += 1
        perForm[g.form].correct += 1
      } else {
        misses.push({ key, groupId: g.id, form: g.form, item, chosen: typeof chosen === 'number' ? chosen : null })
      }
    })
  }
  for (const f of Object.values(perForm)) {
    f.acc = f.total ? f.correct / f.total : 0
    f.rank = rankForAccuracy(f.acc)
  }
  const acc = total ? correct / total : 0
  const score = Math.round(800 * acc)
  return {
    perForm, misses, correct, total, acc, score,
    band: bandForScore(score),
    sealed: paper.sealed === true,
    thin: paper.thin || [],
  }
}

export { itemKey }

// ─── Form practice: variants of the exam's forms, for daily exposure ────
// Practice draws ONLY from the practice pool and the generators below.
// Sealed items are never practised and never templated — that separation
// is what makes a sealed pass strong evidence.

/** Practice items for one form: bank practice groups first, then
 *  generated variants for the forms that have a generator. */
export function practiceItemsForForm(form, { seed = 1, count = 5 } = {}) {
  const fromBank = []
  for (const g of shuffleWithSeed(practiceGroups().filter((g) => g.form === form), seed)) {
    for (const item of g.items) fromBank.push({ ...item, groupId: g.id, doc: g.doc, script: g.script, scene: g.scene })
    if (fromBank.length >= count) break
  }
  if (fromBank.length >= count) return fromBank.slice(0, count)
  const gen = FORM_GENERATORS[form]
  if (gen) {
    const variants = gen(count - fromBank.length, seed + 7)
    return [...fromBank, ...variants].slice(0, count)
  }
  return fromBank
}

const KEIGO_GEN_VERBS = ['見る', '言う', '行く', '来る', 'する', '聞く', '会う', '読む', '食べる']
const SONKEI_MASU = {
  'ご覧になる': 'ご覧になります', 'おっしゃる': 'おっしゃいます', 'いらっしゃる': 'いらっしゃいます',
  'お越しになる': 'お越しになります', 'なさる': 'なさいます', 'お聞きになる': 'お聞きになります',
  'お会いになる': 'お会いになります', 'お読みになる': 'お読みになります', '召し上がる': '召し上がります',
}
const KENJOU_MASU = {
  '拝見する': '拝見いたします', '申す': '申し上げます', '参る': '参ります', 'いたす': 'いたします',
  '伺う': '伺います', 'お目にかかる': 'お目にかかります', '拝読する': '拝読いたします', 'いただく': 'いただきます',
}
const PLAIN_MASU = {
  '見る': '見ます', '言う': '言います', '行く': '行きます', '来る': '来ます', 'する': 'します',
  '聞く': '聞きます', '会う': '会います', '読む': '読みます', '食べる': '食べます',
}
const firstForm = (s) => (s || '').split('/')[0].split('・')[0].trim()

/** 発言聴解 generator: the register discrimination, in sentence frames.
 *  Correctness is mechanical (the keigo table), so variants are safe. */
export function genKeigoPractice(count = 5, seed = 1) {
  const rand = seededRandom(seed)
  const entries = bjtKeigo.filter((k) => KEIGO_GEN_VERBS.includes(k.plain))
  const picks = shuffleWithSeed(entries, seed)
  const out = []
  for (let i = 0; i < picks.length && out.length < count; i++) {
    const k = picks[i]
    const sonkei = SONKEI_MASU[firstForm(k.sonkei)]
    const kenjou = KENJOU_MASU[firstForm(k.kenjou)]
    if (!sonkei || !kenjou) continue
    const other = picks[(i + 3) % picks.length]
    const otherSonkei = SONKEI_MASU[firstForm(other.sonkei)]
    if (!otherSonkei) continue
    const respect = rand() > 0.5
    const correct = respect ? sonkei : kenjou
    const wrongs = respect ? [kenjou, otherSonkei] : [sonkei, otherSonkei]
    const options = shuffleWithSeed([correct, ...wrongs, PLAIN_MASU[k.plain]], seed + i)
    out.push({
      prompt: respect
        ? `場面：${k.scene}。部長の動作を目上の人に報告する文として、正しいものはどれですか。`
        : `場面：${k.scene}。自分の動作を目上の人に言う文として、正しいものはどれですか。`,
      options: options.map((verb) => (respect ? `部長は${verb}。` : `私は${verb}。`)),
      answer: options.indexOf(correct),
      vocab: [],
      generated: true,
    })
  }
  return out
}

/** 語彙 generator from the business vocabulary table. */
export function genVocabPractice(count = 5, seed = 1) {
  const rand = seededRandom(seed)
  const picks = shuffleWithSeed(bjtVocab, seed)
  const out = []
  for (let i = 0; i < picks.length && out.length < count; i++) {
    const v = picks[i]
    const distractors = shuffleWithSeed(bjtVocab.filter((x) => x.word !== v.word), seed + i * 3).slice(0, 3)
    if (rand() > 0.5) {
      const options = shuffleWithSeed([v.meaning, ...distractors.map((d) => d.meaning)], seed + i)
      out.push({ prompt: `「${v.word}」の意味はどれですか。`, options, answer: options.indexOf(v.meaning), vocab: [v.word], generated: true })
    } else {
      const options = shuffleWithSeed([v.word, ...distractors.map((d) => d.word)], seed + i)
      out.push({ prompt: `「${v.meaning}」を表す言葉はどれですか。`, options, answer: options.indexOf(v.word), vocab: [v.word], generated: true })
    }
  }
  return out
}

const BAMEN_PRACTICE_SCENES = [
  {
    scene: '駅前のビルの前で、スーツの男性二人が頭を下げ合って、小さな紙を交換しています。',
    options: ['二人は名刺を交換しています。', '二人は契約書にサインしています。', '二人は商品を販売しています。', '二人は会議をしています。'],
    answer: 0, vocab: ['名刺'],
  },
  {
    scene: '社員食堂で、社員たちが昼食を取りながら談笑しています。',
    options: ['社員たちがレストランでパーティーを開いています。', '社員たちが社員食堂で食事をしています。', '社員たちが会議室で会議をしています。', '社員たちが料理を作っています。'],
    answer: 1, vocab: ['社員'],
  },
  {
    scene: '電話のそばで、女性社員が別の部署へ電話をつないでいます。',
    options: ['女の人が電話をかけています。', '女の人が電話を取り次いでいます。', '女の人が電話を切っています。', '女の人が電話で苦情を言っています。'],
    answer: 1, vocab: ['電話'],
  },
  {
    scene: '大きな会議室で、大勢の聴衆の前で男性が演台に立って話しています。',
    options: ['男の人が面接をしています。', '男の人が会議をしています。', '男の人が講演をしています。', '男の人が電話で話しています。'],
    answer: 2, vocab: ['会議室'],
  },
]

/** 場面把握 generator: authored scene templates (practice pool only). */
export function genBamenPractice(count = 5, seed = 1) {
  return shuffleWithSeed(BAMEN_PRACTICE_SCENES, seed).slice(0, count).map((s) => ({
    prompt: '場面の説明として正しいものはどれですか。',
    scene: s.scene, options: s.options, answer: s.answer, vocab: s.vocab, generated: true,
  }))
}

export const FORM_GENERATORS = {
  hatsugen: genKeigoPractice,
  goi: genVocabPractice,
  bamen: genBamenPractice,
}

/** The learner's weakest exam forms, from their own record — form
 *  practice opens here, so practice is synced with what they need. */
export function weakestForms(metrics = []) {
  const exams = (metrics || []).filter((e) => e?.type === 'bjt_exam_completed' && e.sections)
  if (exams.length) {
    const latest = exams[exams.length - 1]
    return Object.entries(latest.sections)
      .map(([form, s]) => ({ form, acc: typeof s?.acc === 'number' ? s.acc : 1 }))
      .sort((a, b) => a.acc - b.acc)
      .map((x) => x.form)
  }
  const kindToForm = { daily: 'goi', reading: 'sougouR', listening: 'sougouL' }
  const byKind = {}
  for (const e of metrics || []) {
    if (e?.type !== 'bjt_completed' || !kindToForm[e.kind]) continue
    const f = kindToForm[e.kind]
    byKind[f] = byKind[f] || { c: 0, t: 0 }
    byKind[f].c += e.correct || 0
    byKind[f].t += e.total || 0
  }
  return Object.entries(byKind)
    .map(([form, v]) => ({ form, acc: v.t ? v.c / v.t : 1 }))
    .sort((a, b) => a.acc - b.acc)
    .map((x) => x.form)
}
