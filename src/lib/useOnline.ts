import { useCallback, useSyncExternalStore } from 'react'

// Same shape as useMediaQuery: an external store React can subscribe to, so components
// branch on connectivity in JSX rather than through an effect + state pair.

function canDetect(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
}

/**
 * Reactive connectivity. Returns **true** where `navigator.onLine` is unavailable, so an
 * environment that cannot report it behaves exactly as the app does today.
 *
 * `navigator.onLine` is a hint, not a guarantee — a captive portal reports "online". That is
 * acceptable here: it drives read-only mode and a banner, and a failed request re-enters the
 * offline path anyway.
 */
export function useOnline(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener('online', onChange)
    window.addEventListener('offline', onChange)
    return () => {
      window.removeEventListener('online', onChange)
      window.removeEventListener('offline', onChange)
    }
  }, [])
  return useSyncExternalStore(subscribe, () => (canDetect() ? navigator.onLine : true))
}
