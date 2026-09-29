import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ThemeName } from '../types/task'
import { themeConf, type ThemeConf } from './themeConf'

interface ThemeContextValue {
  theme: ThemeName
  setTheme: (t: ThemeName) => void
  conf: ThemeConf
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({
  children,
  initial = 'cork',
  onThemeChange,
}: {
  children: ReactNode
  initial?: ThemeName
  /** Fired whenever the theme changes — used to persist the preference. */
  onThemeChange?: (theme: ThemeName) => void
}) {
  const [theme, setThemeState] = useState<ThemeName>(initial)

  // Re-sync when the persisted theme changes elsewhere (another device via realtime).
  // Local changes are unaffected: they flow through setTheme and land back here as
  // the same value, which React bails out on.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect, react/no-deriving-state-in-effects
    setThemeState(initial)
  }, [initial])

  const setTheme = useCallback(
    (t: ThemeName) => {
      setThemeState(t)
      onThemeChange?.(t)
    },
    [onThemeChange],
  )

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, conf: themeConf(theme) }),
    [theme, setTheme],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

const FALLBACK = { theme: 'cork' as ThemeName, conf: themeConf('cork') }

/**
 * The current theme for a leaf control (#464), or cork outside a provider. `useTheme` throws there
 * on purpose, since a page that forgot its provider should fail loudly. A button is not a page,
 * though: it renders inside dozens of section-level unit tests that mount one section on its own,
 * and making each of them mount a provider only to style a button would test nothing more.
 */
// oxlint-disable-next-line react/only-export-components
export function useThemeOrDefault(): { theme: ThemeName; conf: ThemeConf } {
  return useContext(ThemeContext) ?? FALLBACK
}
