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
 * empty `userId` so they cost no query and no subscription. `SettingsProvider.test.tsx` pins that.
 *
 * `useTasks` is deliberately NOT hoisted alongside it: `BoardPage` is lazy-loaded to keep dnd-kit
 * and the board data layer out of the entry chunk, and lifting `useTasks` up here would pull them
 * back in. Returning to the board still shows its own loading state, which is the intended trade.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const value = useSettings(user?.id ?? readLastUserId())
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

/** The session's shared settings. Throws outside `<SettingsProvider>` rather than returning null. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSettingsContext(): UseSettings {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettingsContext must be used within <SettingsProvider>')
  return ctx
}
