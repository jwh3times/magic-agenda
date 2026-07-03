import { useCallback, useSyncExternalStore } from 'react'

// The theming layer is inline style objects, so responsive layout can't use CSS media
// queries — components branch on this hook instead (same pattern as the theme branching).

function canMatch(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

/** Reactive `window.matchMedia`. Returns false where matchMedia is unavailable (jsdom). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!canMatch()) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => canMatch() && window.matchMedia(query).matches)
}

/** Phone-width breakpoint shared by every responsive component. */
export const MOBILE_QUERY = '(max-width: 760px)'

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}
