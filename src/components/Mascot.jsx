import { useState } from 'react'
import { mascotById, brand } from '../lib/brand.js'
import { useLanguage } from '../hooks/useLanguage.js'

// MASCOT — the fleet's faces. Real character art (Doc 13, Landry-approved
// 2026-11-05) lives in public/fleet/<id>.png — cut out, transparent.
// If an image ever fails to load, the CSS disc (flat colour + kanji) is
// the fallback, so a mascot is never a broken-image box.
//
// Motion (Doc 13 §4 — alive, not static): every mascot breathes on its
// OWN rhythm (RHYTHM below), so a row of them never bobs in sync like a
// chorus line. At display sizes >= 48 a soft ground shadow breathes in
// counterphase (shrinks as the body rises) so the character feels
// planted, not floating. motion="bounce" is Koe on the ringing screen;
// motion="hop" is the two-hop celebration, used at proof moments only;
// mood="resting" sways slowly and softens — the bad-week expression.
// There are no angry or disappointed variants — they do not exist in
// this product, by rule. Reduced-motion users get stillness via CSS.
const RHYTHM = { koe: 3.1, nao: 3.7, saki: 4.1, tsuku: 3.4, hori: 3.9, michi: 4.4 }

export default function Mascot({ agent, size = 40, mood = 'happy', showName = true, label, motion = 'idle' }) {
  const { t } = useLanguage()
  const m = mascotById(agent)
  const roleText = m.roleKey ? t(m.roleKey) : m.role
  const resting = mood === 'resting'
  const [imgOk, setImgOk] = useState(true)
  const motionClass = motion === 'none' ? '' : motion === 'bounce' ? 'mascot-bounce' : motion === 'hop' ? 'mascot-hop' : resting ? 'mascot-sway' : 'mascot-bob'
  const rhythm = RHYTHM[m.id] || 3.4
  const showShadow = imgOk && size >= 48 && (motion === 'idle' || motion === 'bounce')
  return (
    <span className="inline-flex items-center gap-2 shrink-0" role="img" aria-label={label || `${m.name}, ${roleText}`}>
      {imgOk ? (
        <span aria-hidden="true" className="relative inline-flex flex-col items-center select-none" style={{ width: Math.round(size * 1.12) }}>
          <img
            src={`/fleet/${m.id}.png`}
            alt=""
            draggable="false"
            onError={() => setImgOk(false)}
            className={motionClass}
            style={{
              width: Math.round(size * 1.12),
              height: Math.round(size * 1.12),
              objectFit: 'contain',
              opacity: resting ? 0.8 : 1,
              animationDuration: motionClass === 'mascot-bob' ? `${rhythm}s` : undefined,
            }}
          />
          {showShadow && (
            <span
              className="mascot-shadow block rounded-[50%] bg-black/50"
              style={{
                width: Math.round(size * 0.72),
                height: Math.max(4, Math.round(size * 0.1)),
                marginTop: -Math.round(size * 0.06),
                animationDuration: motionClass === 'mascot-bob' ? `${rhythm}s` : undefined,
              }}
            />
          )}
        </span>
      ) : (
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
      )}
      {showName && (
        <span className="leading-tight">
          <span className="block text-sm font-bold text-white">{m.name}</span>
          <span className="block text-[11px] text-slate-400">{roleText}</span>
        </span>
      )}
    </span>
  )
}
