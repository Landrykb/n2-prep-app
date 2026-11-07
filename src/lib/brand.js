// BRAND CONFIG — the single source of truth for the product's name,
// tagline, and the mascot fleet roster (Doc 13 — Mascot Fleet & Character
// System). A future rename is a ONE-FILE change: edit `brand.name` (and
// `brand.tagline`) here and every surface that reads from this module
// follows. (The product was renamed from JPN2easy to Yonde on 2026-11-05;
// this file is where the rename landed first.)
//
// Fleet colours and props are Doc 13 §1, verbatim. Names are working
// names (Doc 13 marks them an open decision for Landry) — they live here
// so renaming a mascot is also a one-file change.

export const brand = {
  name: 'Yonde',
  tagline: 'Summon your Japanese',
  differentiator: 'It learns how you learn',
  // Support address used by the legal pages and the feedback mailto
  // fallback. support@yonde.app does NOT exist yet (no domain/MX set
  // up — Landry, 2026-11-07), so the fallback points at his working
  // Gmail for now; switch back when yonde.app mail is real (Doc 15 §6).
  supportEmail: 'bleepxbuilds@gmail.com',
  callRitual: { name: 'Yobidashi', jp: '呼び出し', moment: 'Yobidashi no Jikan', momentJp: '呼び出しの時間' },
  // The family's outline colour (Doc 13 §4): deep plum, near-black.
  outline: '#2A1A33',
  fleet: [
    {
      id: 'koe', name: 'Koe', kanji: '声', role: 'The Sensei', roleKey: 'fleet.koe.role',
      job: 'Calls you and talks with you', jobKey: 'fleet.koe.job',
      color: '#FF6B57', // warm coral red
      prop: 'A small retro phone receiver worn like a headset',
      voice: 'Warm, unhurried, quietly expectant. Never scolds a missed call.',
    },
    {
      id: 'nao', name: 'Nao', kanji: '直', role: 'The Fixer', roleKey: 'fleet.nao.role',
      job: 'Finds the one fix that matters', jobKey: 'fleet.nao.job',
      color: '#58B368', // leaf green
      prop: 'A soft, rounded red pencil — a friendly correction pencil, never sharp',
      voice: 'Precise and gentle. “One thing:” — then the fix, then done.',
    },
    {
      id: 'saki', name: 'Saki', kanji: '先', role: 'The Planner', roleKey: 'fleet.saki.role',
      job: 'Prepares tomorrow for you', jobKey: 'fleet.saki.job',
      color: '#4FA8E0', // sky blue
      prop: 'A little paper calendar with tomorrow’s page lifting',
      voice: 'Calm and concrete: what, how long, why this. No planning jargon.',
    },
    {
      id: 'tsuku', name: 'Tsuku', kanji: '作', role: 'The Maker', roleKey: 'fleet.tsuku.role',
      job: 'Builds your new practice material', jobKey: 'fleet.tsuku.job',
      color: '#E5B83B', // mustard yellow
      prop: 'A wooden mallet resting, and a maker’s apron',
      voice: 'Cheerful and crafty. Shows you the finished thing, doesn’t lecture.',
    },
    {
      id: 'hori', name: 'Hori', kanji: '掘', role: 'The Miner', roleKey: 'fleet.hori.role',
      job: 'Digs your documents for gold', jobKey: 'fleet.hori.job',
      color: '#E07B39', // earthy orange
      prop: 'A round magnifying glass, held up like a monocle',
      voice: 'Curious and delighted by finds: “Look what I found in your letter —”',
    },
    {
      id: 'michi', name: 'Michi', kanji: '道', role: 'The Coach', roleKey: 'fleet.michi.role',
      job: 'Walks the road with you; writes your weekly letter', jobKey: 'fleet.michi.job',
      color: '#71368A', // deep plum — the family anchor colour
      prop: 'A small walking flag, carried low or planted at milestones',
      voice: 'Steady and honest. Reports the week truthfully, rescue attached.',
    },
  ],
}

export const mascotById = (id) => brand.fleet.find((m) => m.id === id) || brand.fleet[0]
