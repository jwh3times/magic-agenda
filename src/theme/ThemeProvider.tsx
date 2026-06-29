import {
  createContext,
  useCallback,
  useContext,
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

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
