// Build the synthesis manifest for the pre-rendered listening
// audio (Doc 17 addendum 2 follow-up, 2026-11-07).
//
// The listening scripts are FIXED content, but their speaker
// buttons synthesised live — and the live chain can fall back to
// the device robot voice when the webview's Edge connection
// stalls (Landry, Listening page: spinner, then robot). Fixed
// content gets fixed audio: this manifest is rendered ONCE on
// the Voice Worker VM (an egress Edge answers), one file per
// script, turns cast exactly as the live player casts them
// (voiceCast.js is the single source of the cast rules), and the
// files ship in public/audio/listening/ — playback is then a
// local file: instant, neural, offline-proof.
//
// Usage: node scripts/build-listening-audio-manifest.mjs > listening-audio-manifest.json
// The renderer (VM side) consumes [{ slug, turns: [{ voice, pitch, text }] }].
import { n2Listening } from '../src/data/n2Listening.js'
import { listeningPlus } from '../src/data/listeningPlus.js'
import { parseScriptTurns, resolveCast } from '../src/lib/voiceCast.js'

export const LISTENING_AUDIO_SLUGS = {
  '会社での打ち合わせ': 'kaisha-uchiawase',
  '不動産屋で': 'fudosan-ya',
  'レストランの予約': 'restaurant-yoyaku',
  'コンビニで': 'konbini',
  '友達との約束': 'tomodachi-yakusoku',
  '道を聞く': 'michi-kiku',
  'アルバイトの電話': 'arubaito-denwa',
  '旅行の計画': 'ryoko-keikaku',
  '健康診断の結果': 'kenko-shindan',
  '引っ越しの相談': 'hikkoshi-sodan',
  '会議の日程変更': 'kaigi-nittei',
  '環境問題のニュース': 'kankyo-news',
  '新しい制度の説明': 'seido-setsumei',
}

const items = [...listeningPlus, ...n2Listening]
const manifest = items.map((item) => {
  const slug = LISTENING_AUDIO_SLUGS[item.title]
  if (!slug) throw new Error(`no audio slug for listening item: ${item.title}`)
  const turns = parseScriptTurns(item.script)
  const cast = turns ?? [{ cast: 'female', text: String(item.script || '').replace(/\n/g, ' ') }]
  return {
    slug,
    title: item.title,
    turns: cast.map((tn) => {
      const c = resolveCast(tn.cast)
      return { voice: c.edge, pitch: c.pitch, text: tn.text }
    }),
  }
})

// Print only when run as the generator; importers (the test
// suite) take LISTENING_AUDIO_SLUGS silently.
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(manifest, null, 1))
}
