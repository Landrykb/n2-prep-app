// Voice casts (Landry, 2026-11-07): "the speech has male and
// female — the speech should use appropriate voices. Make
// Female, Girl, Boy etc."
//
// One cast table drives every spoken surface. The free Edge
// route has exactly two Japanese neural voices (Nanami,
// female; Keita, male), so the younger casts are the same
// voices with a pitch lift in the SSML prosody — an honest
// approximation, labelled as such here, never a claim of a
// dedicated child voice (none exists on the free route).
//
// Who speaks with which cast:
// - Scene partner lines: the scene's own `partnerVoice` tag.
// - Listening scripts: the script's speaker labels （女・男・
//   店長…), mapped by castForSpeaker below.
// - Model lines (the sentence the learner imitates): the
//   learner's own chosen cast (settings, voicePreference.js).
// - Koe in the call: always 'female' — Sensei's persona
//   voice, not the learner's model voice.

export const VOICE_CASTS = {
  female: { edge: 'ja-JP-NanamiNeural', pitch: '+0Hz' },
  male: { edge: 'ja-JP-KeitaNeural', pitch: '+0Hz' },
  girl: { edge: 'ja-JP-NanamiNeural', pitch: '+35Hz' },
  boy: { edge: 'ja-JP-KeitaNeural', pitch: '+25Hz' },
}

export const CAST_IDS = Object.keys(VOICE_CASTS)
export const DEFAULT_CAST = 'female'

/** The Edge voice + prosody for a cast id; unknown ids fall back to the default cast. */
export function resolveCast(cast) {
  return VOICE_CASTS[cast] || VOICE_CASTS[DEFAULT_CAST]
}

// Speaker-label → cast for the listening scripts' dialogue
// labels. First matching rule wins; unmatched labels (and
// narration) take the default cast. Role defaults are a
// documented choice, not a fact about the speaker: service
// and authority roles in the shipped scripts （店長・先生・
// 医者・駅員） read male, reception/office roles female —
// an item that needs otherwise can say so in its data later.
const SPEAKER_RULES = [
  [/女の子|少女/, 'girl'],
  [/男の子|少年/, 'boy'],
  [/女|母|彼女|妻|姉|妹|おばあ/, 'female'],
  [/男|父|彼氏|夫|兄|弟|おじい/, 'male'],
  [/店長|社長|上司|医者|先生|駅員|警官|運転手|店員/, 'male'],
  [/受付|看護|秘書|案内/, 'female'],
]

export function castForSpeaker(label) {
  const name = String(label || '')
  for (const [pattern, cast] of SPEAKER_RULES) {
    if (pattern.test(name)) return cast
  }
  return DEFAULT_CAST
}

const TURN_RE = /^([^：:\n]{1,10})[：:]\s*(.*)$/

/**
 * Split a listening script into spoken turns:
 * [{ speaker, cast, text }]. A line with a `label：` prefix
 * starts a new turn; a line without one continues the
 * previous speaker (or the narrator when first). Labels are
 * never spoken. Returns null when the text is not a labelled
 * dialogue (fewer than two labelled lines) — callers then
 * treat it as one plain line.
 */
export function parseScriptTurns(script) {
  const lines = String(script || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const turns = []
  let labelled = 0
  for (const line of lines) {
    const m = line.match(TURN_RE)
    if (m && m[2]) {
      labelled++
      turns.push({ speaker: m[1].trim(), cast: castForSpeaker(m[1]), text: m[2].trim() })
    } else if (turns.length) {
      const last = turns[turns.length - 1]
      last.text = `${last.text} ${line}`.trim()
    } else {
      turns.push({ speaker: '', cast: DEFAULT_CAST, text: line })
    }
  }
  if (labelled < 2) return null
  return turns.filter((t) => t.text)
}
