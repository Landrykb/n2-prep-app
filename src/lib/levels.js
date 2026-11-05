// Level definitions for JLPT (N5 → N1, plus an N1+ "beyond the exam" band)
// and BJT (J5 → J1+).
//
// Exam facts (official): JLPT is scored /180 with an overall pass mark AND a
// sectional minimum of 19/60 in every section — one weak section fails the
// whole exam. The Japan Foundation publishes NO official vocab/kanji lists,
// so those counts are community estimates (labelled as such in the UI copy
// that uses them). BJT is scored 0–800 with no pass/fail, in six bands;
// immigration reference points: BJT ≥400 ≈ N2 category, ≥480 ≈ N1 category.

export const JLPT_LEVELS = [
  {
    id: 'N5', order: 0, passMark: 80, sectionMin: 19, sections: ['Language Knowledge + Reading /120', 'Listening /60'],
    vocabEstimate: '~800', kanjiEstimate: '~100',
    canDo: 'Basic Japanese: kana and simple kanji sentences, short slow everyday conversation.',
    color: 'rose',
  },
  {
    id: 'N4', order: 1, passMark: 90, sectionMin: 19, sections: ['Language Knowledge + Reading /120', 'Listening /60'],
    vocabEstimate: '~1,500', kanjiEstimate: '~300',
    canDo: 'Everyday Japanese in familiar daily-life situations.',
    color: 'amber',
  },
  {
    id: 'N3', order: 2, passMark: 95, sectionMin: 19, sections: ['Language Knowledge /60', 'Reading /60', 'Listening /60'],
    vocabEstimate: '~3,000–3,750', kanjiEstimate: '~650',
    canDo: 'Bridge level: everyday Japanese to a certain degree, near-natural-speed daily conversation.',
    color: 'plum',
  },
  {
    id: 'N2', order: 3, passMark: 90, sectionMin: 19, sections: ['Language Knowledge /60', 'Reading /60', 'Listening /60'],
    vocabEstimate: '~6,000', kanjiEstimate: '~1,000',
    canDo: 'Japanese in a range of circumstances beyond daily life; newspapers, normal-speed conversation. The de-facto hiring filter in Japan.',
    color: 'cyan',
  },
  {
    id: 'N1', order: 4, passMark: 100, sectionMin: 19, sections: ['Language Knowledge /60', 'Reading /60', 'Listening /60'],
    vocabEstimate: '~10,000+', kanjiEstimate: '~2,000',
    canDo: 'Japanese in a variety of circumstances: complex and abstract texts, detailed coherent listening.',
    color: 'emerald',
  },
  {
    id: 'N1+', order: 5, passMark: null, sectionMin: null, sections: ['Beyond the exam: native media, specialist domains, register control'],
    vocabEstimate: '10,000++', kanjiEstimate: '2,000+',
    canDo: 'Beyond N1: fluent professional Japanese — nuance, register, specialist vocabulary in your own field.',
    color: 'coral',
  },
]

export const JLPT_IDS = JLPT_LEVELS.map((l) => l.id)
export const jlptLevel = (id) => JLPT_LEVELS.find((l) => l.id === id) || null

/** The level above `id` (for "train above your target with input" guidance). */
export function levelAbove(id) {
  const l = jlptLevel(id)
  if (!l) return null
  return JLPT_LEVELS[l.order + 1] || null
}

export function levelBelow(id) {
  const l = jlptLevel(id)
  if (!l) return null
  return JLPT_LEVELS[l.order - 1] || null
}

export const BJT_BANDS = [
  { id: 'J5', min: 0, max: 199, jlptApprox: 'Below N5', descriptor: 'Virtually no business communication ability.', hsp: null, color: 'slate' },
  { id: 'J4', min: 200, max: 319, jlptApprox: '≈ N5–N4', descriptor: 'Minimal communication in a limited range of business situations.', hsp: null, color: 'rose' },
  { id: 'J3', min: 320, max: 419, jlptApprox: '≈ N4–N3', descriptor: 'A limited degree of communication in a limited range of situations.', hsp: 'BJT ≥400 counts as the N2 category for Highly Skilled Professional points (10 pts).', color: 'amber' },
  { id: 'J2', min: 420, max: 529, jlptApprox: '≈ N3–N2', descriptor: 'Appropriate communication in a limited range of business situations.', hsp: 'BJT ≥480 counts as the N1 category for Highly Skilled Professional points (15 pts).', color: 'plum' },
  { id: 'J1', min: 530, max: 599, jlptApprox: '≈ N2–N1', descriptor: 'Appropriate communication in a wide range of business situations.', hsp: null, color: 'cyan' },
  { id: 'J1+', min: 600, max: 800, jlptApprox: '≈ N1+', descriptor: 'Sufficient communication in any business situation.', hsp: null, color: 'emerald' },
]

export const BJT_IDS = BJT_BANDS.map((b) => b.id)

export function bjtBandForScore(score) {
  const s = Math.max(0, Math.min(800, Math.round(score) || 0))
  return BJT_BANDS.find((b) => s >= b.min && s <= b.max) || BJT_BANDS[0]
}

/** Map a JLPT level estimate onto a rough BJT band, for cross-exam guidance. */
export function bjtBandForJlpt(jlptId) {
  const map = { N5: 'J4', N4: 'J3', N3: 'J2', N2: 'J1', N1: 'J1', 'N1+': 'J1+' }
  return BJT_BANDS.find((b) => b.id === map[jlptId]) || BJT_BANDS[0]
}

/** Rough BJT score estimate (0–800) from a 0–1 business-Japanese accuracy. */
export function estimateBjtScore(accuracy01) {
  const a = Math.max(0, Math.min(1, accuracy01 || 0))
  // Anchored so ~50% ≈ J3 threshold area and ~85%+ reaches J1.
  return Math.round(800 * Math.pow(a, 1.35))
}

export const SECTION_KEYS = [
  { id: 'language', label: 'Language Knowledge (vocab / grammar)', jlpt: '言語知識' },
  { id: 'reading', label: 'Reading', jlpt: '読解' },
  { id: 'listening', label: 'Listening', jlpt: '聴解' },
]
