import { useTheme } from '../theme/ThemeProvider'
import { segWrapStyle, viewBtnStyle } from '../theme/chrome'
import type { ViewName } from '../types/task'

export interface ViewOption {
  key: ViewName
  label: string
}

export function ViewSwitcher({
  views,
  view,
  onChange,
  compact = false,
}: {
  views: ViewOption[]
  view: ViewName
  onChange: (v: ViewName) => void
  /** Tighter buttons, for the phone toolbar's row, which also carries the logo and two icons. */
  compact?: boolean
}) {
  const { theme, conf } = useTheme()
  return (
    <div style={segWrapStyle(theme)}>
      {views.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => onChange(v.key)}
          style={{
            ...viewBtnStyle(theme, conf, view === v.key),
            ...(compact && { padding: '6px', fontSize: '12px' }),
          }}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}
