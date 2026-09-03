import { useCallback, useEffect, useRef, useState } from 'react'

const read = (fallback, valid) => {
  const id = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  if (!id) return fallback
  return !valid || valid.includes(id) ? id : fallback
}

/**
 * Keeps the active section in the URL hash so refresh, the browser back/forward
 * buttons, and shared links all land on the right tab.
 *
 * Also exposes an explicit `back()`. In an installed PWA there is no browser
 * chrome, and pressing the system back button on the first screen closes the
 * app, so the UI needs its own way to retreat. `depth` tracks how many in-app
 * navigations we have pushed, so `back()` only calls `history.back()` when that
 * will actually stay inside the app.
 */
export function useHashRoute(fallback, valid) {
  const [route, setRoute] = useState(() => read(fallback, valid))
  const depth = useRef(0)
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    const onChange = () => {
      setRoute(read(fallback, valid))
      // A hashchange we did not initiate (back/forward) reduces our depth.
      depth.current = Math.max(0, depth.current - 1)
      setCanGoBack(depth.current > 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [fallback, valid])

  // Make sure the URL reflects the initial section without adding a history entry.
  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, '', `#/${route}`)
  }, [route])

  const navigate = useCallback((id) => {
    if (window.location.hash.replace(/^#\/?/, '') === id) return
    depth.current += 2 // +2 because the hashchange handler will subtract one
    setCanGoBack(true)
    window.location.hash = `#/${id}`
  }, [])

  const back = useCallback(() => {
    if (depth.current > 0) {
      window.history.back()
      return
    }
    // No in-app history (e.g. deep-linked straight into a section): fall back
    // to the home section instead of letting the PWA close.
    if (read(fallback, valid) !== fallback) {
      window.history.replaceState(null, '', `#/${fallback}`)
      setRoute(fallback)
    }
    setCanGoBack(false)
  }, [fallback, valid])

  return [route, navigate, { back, canGoBack: canGoBack || route !== fallback }]
}
