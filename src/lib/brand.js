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
  // fallback. TO CONFIRM before public launch (Doc 15 §6 checklist).
  supportEmail: 'support@yonde.app',
  callRitual: { name: 'Yobidashi', jp: '呼び出し', moment: 'Yobidashi no Jikan', momentJp: '呼び出しの時間' },
  // The family's outline colour (Doc 13 §4): deep plum, near-black.
  outline: '#2A1A33',
  fleet: [
    {
      id: 'koe', name: 'Koe', kanji: '声', role: 'The Sensei',
      job: 'Calls you and talks with you',
      color: '#FF6B57', // warm coral red
      prop: 'A small retro phone receiver worn like a headset',
      voice: 'Warm, unhurried, quietly expectant. Never scolds a missed call.',
    },
    {
      id: 'nao', name: 'Nao', kanji: '直', role: 'The Fixer',
      job: 'Finds the one fix that matters',
      color: '#58B368', // leaf green
      prop: 'A soft, rounded red pencil — a friendly correction pencil, never sharp',
      voice: 'Precise and gentle. “One thing:” — then the fix, then done.',
    },
    {
      id: 'saki', name: 'Saki', kanji: '先', role: 'The Planner',
      job: 'Prepares tomorrow for you',
      color: '#4FA8E0', // sky blue
      prop: 'A little paper calendar with tomorrow’s page lifting',
      voice: 'Calm and concrete: what, how long, why this. No planning jargon.',
    },
    {
      id: 'tsuku', name: 'Tsuku', kanji: '作', role: 'The Maker',
      job: 'Builds your new practice material',
      color: '#E5B83B', // mustard yellow
      prop: 'A wooden mallet resting, and a maker’s apron',
      voice: 'Cheerful and crafty. Shows you the finished thing, doesn’t lecture.',
    },
    {
      id: 'hori', name: 'Hori', kanji: '掘', role: 'The Miner',
      job: 'Digs your documents for gold',
      color: '#E07B39', // earthy orange
      prop: 'A round magnifying glass, held up like a monocle',
      voice: 'Curious and delighted by finds: “Look what I found in your letter —”',
    },
    {
      id: 'michi', name: 'Michi', kanji: '道', role: 'The Coach',
      job: 'Walks the road with you; writes your weekly letter',
      color: '#71368A', // deep plum — the family anchor colour
      prop: 'A small walking flag, carried low or planted at milestones',
      voice: 'Steady and honest. Reports the week truthfully, rescue attached.',
    },
  ],
}

export const mascotById = (id) => brand.fleet.find((m) => m.id === id) || brand.fleet[0]
