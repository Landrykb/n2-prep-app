// Sources & licences — every dataset and service the app ships
// (docs/18, docs/19). Each entry is grounded in a build manifest or
// in code: names, licences and links below match what the generators
// recorded, not what would be nice to claim. Anything that could not
// be grounded in a manifest or in code is left out.
//
// Entry shape: { name, usedFor, licence, url, credit? }
//   credit — a verbatim attribution line a licence requires, when one
//            exists (Kanjium). Rendered word for word.

export const SOURCES = [
  {
    name: 'KANJIDIC2',
    usedFor: 'Kanji readings, meanings (English and French), stroke counts, frequency ranks, school grades, radical numbers and dictionary references for all 13,108 kanji in the database.',
    licence: 'CC BY-SA 3.0 — EDRDG (Electronic Dictionary Research and Development Group)',
    url: 'http://www.edrdg.org/wiki/index.php/KANJIDIC_Project',
  },
  {
    name: 'KanjiVG',
    usedFor: 'Stroke-order paths, the nested component trees behind the Kanji Lens assembly, radical and phonetic marks, attested sound families, and the variant glyph forms.',
    licence: 'CC BY-SA 3.0 — KanjiVG, created by Ulrich Apel',
    url: 'https://kanjivg.tagaini.net',
  },
  {
    name: 'JMdict',
    usedFor: 'The common-words dictionary: 22,650 entries behind Words With This Kanji, word search, the queue-word picker, and the headwords the example sentences link to. Ships via jmdict-simplified.',
    licence: 'CC BY-SA 4.0 — EDRDG',
    url: 'http://www.edrdg.org/edrdg/licence.html',
  },
  {
    name: 'Kanjium',
    usedFor: 'Pitch accent patterns shown as the raised number next to a word\u2019s reading. Words without a Kanjium line show no number — the pattern is never guessed.',
    licence: 'CC BY-SA 4.0',
    url: 'https://github.com/mifunetoshiro/kanjium',
    credit: 'The pitch accent notation, verb particle data, phonetics, homonyms and other additions or modifications to EDICT, KANJIDIC or KRADFILE were provided by Uros O. through his free database.',
  },
  {
    name: 'Tatoeba / Tanaka Corpus',
    usedFor: 'Example sentences for dictionary words, attached through the EDRDG dictionary-linked examples file: each sentence names the headwords it illustrates, so a word\u2019s sentences really contain that word.',
    licence: 'CC BY 2.0 FR (some sentences CC0)',
    url: 'https://tatoeba.org',
  },
  {
    name: 'OpenJLPT',
    usedFor: 'Example vocabulary in the level kanji lists, and the deck levels the Reader bank fits passages against.',
    licence: 'CC BY-SA 4.0',
    url: 'https://github.com/evanclan/OpenJLPT',
  },
  {
    name: 'Licence Curriculum Lists',
    usedFor: 'Theme tags, lesson numbers and the radical\u2019s French name for 814 kanji, plus a cross-check signal comparing French meanings. Tags and cross-checks only — no booklet text ships in the app.',
    licence: 'Personal reference material (INALCO Licence de japonais course lists) — not redistributed',
    url: null,
  },
  {
    name: 'Microsoft Edge Read Aloud',
    usedFor: 'The free voice route: the Yobidashi call voice and the Reader voice notes (the Nanami voice), synthesised through the project\u2019s Voice Worker.',
    licence: 'Online service — voices stream from Microsoft\u2019s read-aloud endpoint; no dataset ships in the app',
    url: null,
  },
  {
    name: 'Groq Whisper',
    usedFor: 'Speech-to-text for Reader voice notes (whisper-large-v3-turbo): your reading is transcribed, scored against the passage on the spot, and the transcript is never stored.',
    licence: 'Online service API',
    url: 'https://api.groq.com',
  },
]
