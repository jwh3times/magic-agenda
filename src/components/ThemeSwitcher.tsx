import { useTheme } from '../theme/ThemeProvider'
import { segWrapStyle, themeBtnStyle, swatchStyle } from '../theme/chrome'
import type { ThemeName } from '../types/task'

const THEMES: { key: ThemeName; label: string; sw: string }[] = [
  { key: 'cork', label: 'Cork', sw: '#caa46b' },
  { key: 'brutal', label: 'Neon', sw: '#FF4D2E' },
  { key: 'glass', label: 'Aurora', sw: '#7c5cff' },
]

export function ThemeSwitcher() {
  const { theme, setTheme, conf } = useTheme()
  return (
    <div style={segWrapStyle(theme)}>
      {THEMES.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => setTheme(t.key)}
          style={themeBtnStyle(theme, conf, theme === t.key)}
        >
          <span style={swatchStyle(t.sw)} />
          {t.label}
        </button>
      ))}
    </div>
  )
}
