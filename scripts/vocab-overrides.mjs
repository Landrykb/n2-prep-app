// Corrections for a handful of upstream OpenJLPT vocab entries whose glosses
// are mistranslated or list a minor/rare sense first, which is misleading in
// an app that shows only the first line. Keyed by `word`, then by the exact
// `reading` string from the source JSON (empty string if the source has no
// reading for that entry). See scripts/build-anki.mjs.
export const MEANING_OVERRIDES = {
  // Upstream lists "(1) to drive" as the first sense of 潜る, which is a
  // mistranslation — 潜る never means "to drive". もぐる and くぐる are
  // distinct readings with related but different primary senses.
  '潜る': {
    'もぐる': 'to dive, to go under (water), to submerge; to hide underground, to go into hiding',
    'くぐる': 'to pass under, to go through (a gate, low doorway, etc.); to duck under, to squeeze through; to evade, to slip through (a checkpoint, the law)',
  },
  // Upstream puts "also" first, which reads as the primary meaning. やはり/
  // やっぱり's core sense is "as expected / after all / still"; "also" (as in
  // "too") is a minor tertiary sense, so it's moved to the end.
  'やはり': {
    '': 'as I thought, after all, still, in spite of, absolutely, of course, (also: too)',
  },
  'やっぱり': {
    '': 'as I thought, after all, still, in spite of, absolutely, of course, (also: too)',
  },
  'やはり/やっぱり': {
    '': 'as I thought, after all, absolutely, (also: too)',
  },
  '矢っ張り': {
    'やっぱり': 'as I thought, after all, still, in spite of, absolutely, (also: too)',
  },
}
