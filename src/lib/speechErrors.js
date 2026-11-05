// Plain-language copy for speech-recognition failures (P1-1 fix).
//
// The recognition API reports WHY it failed in `event.error`, and each
// cause needs a different response: a blocked microphone needs recovery
// steps, silence needs encouragement, a missing mic needs the typing
// door. Before this helper every surface collapsed all of them into
// "stop listening, say nothing" — a Speak button that silently did
// nothing, forever, for anyone who had once tapped Block.
//
// 'aborted' returns null on purpose: that is the user (or the app)
// stopping recognition deliberately, and silence is correct there.

export function micErrorCopy(kind) {
  switch (kind) {
    case 'not-allowed':
    case 'service-not-allowed':
      return {
        title: 'The microphone is blocked',
        body: 'Your browser is not letting Yonde use the microphone. To allow it: open the site settings from the icon beside the address bar, set Microphone to Allow, then tap Speak again. Until then, typing your answer works exactly the same — nothing is lost.',
      }
    case 'audio-capture':
      return {
        title: 'No microphone found',
        body: 'This device does not seem to have a working microphone right now. Typing your answer works exactly the same — nothing is lost.',
      }
    case 'no-speech':
      return {
        title: 'I didn\'t catch that',
        body: 'No speech came through. Try once more, a little closer to the microphone or somewhere quieter — or type your answer instead.',
      }
    case 'network':
      return {
        title: 'Speech recognition needs a connection',
        body: 'Your browser turns speech into text with an online service, and it could not be reached. Typing your answer works exactly the same.',
      }
    case 'aborted':
      return null
    default:
      return {
        title: 'Listening stopped',
        body: 'Something interrupted the microphone. Tap Speak to try again, or type your answer — typing counts the same.',
      }
  }
}
