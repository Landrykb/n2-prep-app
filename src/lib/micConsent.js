// Microphone pre-prompt state (Doc 15 §1: Apple 2.5.14 explicit consent +
// Google Play Prominent Disclosure — the explanation must appear inside the
// flow, BEFORE the browser/OS permission prompt, and consent must be an
// affirmative tap; dismissing is never consent). Once a user has seen and
// accepted the explanation on this device, we don't nag them again — the
// flag is itself data, so it lives under the jpn: namespace and is wiped by
// account deletion like everything else.

export const MIC_EXPLAINED_KEY = 'jpn:mic-explained:v1'

export const micExplained = () => {
  try { return localStorage.getItem(MIC_EXPLAINED_KEY) === '1' } catch { return false }
}

export const markMicExplained = () => {
  try { localStorage.setItem(MIC_EXPLAINED_KEY, '1') } catch { /* ignore */ }
}

// The exact words the user sees before any microphone prompt (shared by
// VoiceLoop and SenseiCall so the promise is identical everywhere).
export const MIC_EXPLANATION =
  'Koe needs your microphone so you can answer out loud. Your voice is turned into text on the spot, and that text is what gets corrected — Yonde does not keep recordings of your voice. Typing your answer instead always works just as well.'
