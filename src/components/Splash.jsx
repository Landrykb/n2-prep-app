import { useEffect, useRef, useState } from 'react'
import { brand } from '../lib/brand.js'

// Boot splash (issue #16). Plays once on cold start over whatever
// boot path the app takes (boot skeleton, sign-in gate, shell):
// the Koe app icon settles in, one flat coral summon ring pulses
// out from it — Koe's call, the Yobidashi idea — then the
// wordmark and tagline fade in and the whole thing fades away.
// It manages its own lifecycle, never blocks the app loading
// underneath it, a tap skips it, and it always unmounts itself.
// Reduced motion: no ring, no rise — a still mark, gone sooner.
export default function Splash() {
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)
  const timers = useRef([])

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const hold = reduced ? 500 : 1250
    timers.current = [
      setTimeout(() => setLeaving(true), hold),
      setTimeout(() => setGone(true), hold + 400),
    ]
    return () => timers.current.forEach(clearTimeout)
  }, [])

  if (gone) return null

  const skip = () => {
    timers.current.forEach(clearTimeout)
    setLeaving(true)
    timers.current = [setTimeout(() => setGone(true), 380)]
  }

  return (
    <div
      role="status"
      aria-label={brand.name}
      onClick={skip}
      className={`fixed inset-0 z-[100] bg-bun-900 flex flex-col items-center justify-center transition-opacity duration-300 ${leaving ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <div className="relative">
        <img src="/icon-512.png" alt="" className="splash-mark h-24 w-24 rounded-[26px]" />
        <div aria-hidden="true" className="splash-ring absolute inset-0 rounded-[26px] border-2 border-[#FF6B57]" />
      </div>
      <p className="splash-word mt-5 text-[28px] leading-none font-bold tracking-tight text-slate-100">{brand.name}</p>
      <p className="splash-tag mt-2 text-sm text-slate-400">{brand.tagline}</p>
    </div>
  )
}
