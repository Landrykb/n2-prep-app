// One-shot channel for "Ask AI to explain" buttons outside the tutor tab:
// the caller stores a message, switches to the `ai` tab, and the freshly
// mounted AiTutor consumes and sends it.
let pending = null

export function setAiPrefill(message) {
  pending = message
}

export function consumeAiPrefill() {
  const msg = pending
  pending = null
  return msg
}
