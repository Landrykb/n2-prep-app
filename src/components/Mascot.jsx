import { mascotById, brand } from '../lib/brand.js'

// MASCOT — the fleet's faces, drawn with pure CSS (Doc 13 §4 house style,
// no generated art yet): a flat solid circle in the agent's signature
// colour, a bold dark-plum outline, the agent's kanji glyph, and a name
// label. One mascot per surface, placed at moments of emotion only
// (Doc 06 §3) — never on a primary action button.
//
// `mood="resting"` is the bad-week expression (Doc 13 §3.4): the circle
// sits lower, colours soften, and a small "resting" marker replaces the
// glyph's liveliness. There are no angry or disappointed variants —
// they do not exist in this product, by rule.
export default function Mascot({ agent, size = 40, mood = 'happy', showName = true, label, motion = 'idle' }) {
  const m = mascotById(agent)
  const resting = mood === 'resting'
  // Motion (Doc 13 §4): idle breathing bob by default, a happy bounce when
  // ringing (motion="bounce"), a slow sway when resting. Reduced-motion
  // users get stillness via the CSS media query.
  const motionClass = motion === 'none' ? '' : motion === 'bounce' ? 'mascot-bounce' : resting ? 'mascot-sway' : 'mascot-bob'
  return (
    <span className="inline-flex items-center gap-2 shrink-0" role="img" aria-label={label || `${m.name}, ${m.role}`}>
      <span
        aria-hidden="true"
        className={`relative rounded-full flex items-center justify-center font-bold select-none ${motionClass}`}
        style={{
          width: size,
          height: size,
          backgroundColor: m.color,
          border: `${Math.max(2, Math.round(size / 12))}px solid ${brand.outline}`,
          color: '#FFF9F0',
          fontSize: Math.round(size * 0.44),
          lineHeight: 1,
          opacity: resting ? 0.75 : 1,
          textShadow: '0 1px 0 rgba(42,26,51,0.35)',
        }}
      >
        {resting ? '〜' : m.kanji}
      </span>
      {showName && (
        <span className="leading-tight">
          <span className="block text-sm font-bold text-white">{m.name}</span>
          <span className="block text-[11px] text-slate-400">{m.role}</span>
        </span>
      )}
    </span>
  )
}
