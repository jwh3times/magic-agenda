import { createContext, useContext, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useSettings, type UseSettings } from './useSettings'
import { readLastUserId } from '../lib/lastUser'

const SettingsContext = createContext<UseSettings | null>(null)

/**
 * Owns the user's settings for the whole signed-in session.
 *
 * Mounted **above `<Routes>`** on purpose. `BoardPage` (`/`) and `SettingsPage` (`/settings`) are
 * mutually exclusive routes, so when each called `useSettings` itself, navigating between them
 * unmounted the hook: settings were refetched, the realtime channel was torn down and recreated,
 * and both pages gate on `loading` with a full-page spinner — so every trip to settings and back
 * flashed one. Hoisting it here means one fetch and one channel per session.
 *
 * It therefore also mounts for signed-out visitors on the landing page; `useSettings` no-ops on an
 * empty `userId`. That is NOT the same as "every signed-out visitor" — it is empty only for one who
 * never signed in on this device (no stored `ma-last-user`), so a first-time visitor still costs no
 * query and no subscription (`SettingsProvider.test.tsx` pins that). A visitor whose session vanished
 * WITHOUT a `SIGNED_OUT` event — the offline-drop case the board/settings offline fallback exists
 * for — keeps a non-empty `readLastUserId()`, so returning online while still signed out DOES fire a
 * `user_settings` query and open a realtime channel from this landing page. Not a leak: RLS scopes
 * both to rows the caller owns, and an unauthenticated request returns nothing. `SettingsProvider.test.tsx`
 * pins that widened case too, so it can't silently regress into an actual empty-string guard.
 *
 * `useTasks` is deliberately NOT hoisted alongside it: `BoardPage` is lazy-loaded to keep dnd-kit
 * and the board data layer out of the entry chunk, and lifting `useTasks` up here would pull them
 * back in. Returning to the board still shows its own loading state, which is the intended trade.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  // `userId` is fine to resolve from the stale `ma-last-user` for a lookup; `hasSession` is the
  // separate, stricter signal useSettings needs before it may persist anything (see its docstring).
  const value = useSettings(user?.id ?? readLastUserId(), Boolean(user))
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

/** The session's shared settings. Throws outside `<SettingsProvider>` rather than returning null. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSettingsContext(): UseSettings {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettingsContext must be used within <SettingsProvider>')
  return ctx
}
