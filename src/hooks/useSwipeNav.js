import { useEffect, useRef } from 'react'

const H_THRESHOLD = 60 // px of horizontal travel required to trigger
const V_TOLERANCE = 0.8 // horizontal travel must dominate vertical by this ratio
const EDGE_IGNORE = 20 // ignore gestures starting at the very edge (OS back gesture)
const MAX_DURATION = 700 // ms — slower drags are treated as scrolling, not swiping

/** True if the gesture started inside something that scrolls horizontally itself. */
function startedInScroller(target) {
  let node = target
  while (node && node !== document.body) {
    if (node.nodeType === 1) {
      const style = window.getComputedStyle(node)
      const overflowX = style.overflowX
      if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 4) return true
      // Never swipe away from an input the user is editing, or a slider.
      const tag = node.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    }
    node = node.parentNode
  }
  return false
}

/**
 * Horizontal swipe navigation for touch devices.
 *
 * Swiping left goes to the next section, swiping right to the previous one,
 * which gives the PWA a way to move between pages without relying on the
 * browser chrome that standalone mode hides.
 */
export function useSwipeNav({ onNext, onPrev, enabled = true }) {
  const start = useRef(null)
  // Keep the latest callbacks without re-binding the listeners on every render.
  const handlers = useRef({ onNext, onPrev })
  handlers.current = { onNext, onPrev }

  useEffect(() => {
    if (!enabled) return

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) { start.current = null; return }
      const t = e.touches[0]
      if (t.clientX < EDGE_IGNORE || t.clientX > window.innerWidth - EDGE_IGNORE) { start.current = null; return }
      if (startedInScroller(e.target)) { start.current = null; return }
      start.current = { x: t.clientX, y: t.clientY, at: Date.now() }
    }

    const onTouchEnd = (e) => {
      const s = start.current
      start.current = null
      if (!s) return
      // A live text selection means the user was selecting, not navigating.
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return

      const t = e.changedTouches?.[0]
      if (!t) return
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (Date.now() - s.at > MAX_DURATION) return
      if (Math.abs(dx) < H_THRESHOLD) return
      if (Math.abs(dy) > Math.abs(dx) * V_TOLERANCE) return

      if (dx < 0) handlers.current.onNext?.()
      else handlers.current.onPrev?.()
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', () => { start.current = null }, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [enabled])
}
