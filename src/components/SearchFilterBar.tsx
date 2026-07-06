import type { CSSProperties } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { useIsMobile } from '../lib/useMediaQuery'
import { CAT, STATUS } from '../theme/constants'
import { EMPTY_FILTER, isFilterActive, type FilterQuery } from '../data/filters'
import type { Category, Status } from '../types/task'

export interface SearchFilterBarProps {
  query: FilterQuery
  onChange: (q: FilterQuery) => void
}

export function SearchFilterBar({ query, onChange }: SearchFilterBarProps) {
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const dark = theme === 'glass'
  const fg = dark ? '#eaf0ff' : '#241c12'
  const bg = dark ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.78)'
  const border = dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.16)'
  const control: CSSProperties = {
    padding: '8px 11px',
    borderRadius: 8,
    border: `1px solid ${border}`,
    background: bg,
    color: fg,
    fontFamily: conf.ui,
    fontSize: isMobile ? 16 : 13, // <16px makes iOS Safari zoom in on focus
    colorScheme: dark ? 'dark' : 'light',
  }
  const active = isFilterActive(query)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 8 : 10,
        padding: isMobile ? '10px 10px 0' : '10px 22px 0',
        flexWrap: 'wrap',
        position: 'relative',
        zIndex: 1,
      }}
    >
      <input
        value={query.text}
        onChange={(e) => onChange({ ...query, text: e.target.value })}
        placeholder="Search tasks…"
        style={{ ...control, flex: '1 1 220px', minWidth: 160 }}
      />
      <select
        value={query.category}
        onChange={(e) => onChange({ ...query, category: e.target.value as Category | 'all' })}
        style={{ ...control, ...(isMobile && { flex: '1 1 40%', minWidth: 0 }) }}
      >
        <option value="all">All categories</option>
        {(Object.keys(CAT) as Category[]).map((k) => (
          <option key={k} value={k}>
            {CAT[k].label}
          </option>
        ))}
      </select>
      <select
        value={query.status}
        onChange={(e) => onChange({ ...query, status: e.target.value as Status | 'all' })}
        style={{ ...control, ...(isMobile && { flex: '1 1 40%', minWidth: 0 }) }}
      >
        <option value="all">All statuses</option>
        {STATUS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={query.pinned ? 'Show all tasks' : 'Show pinned only'}
        onClick={() => onChange({ ...query, pinned: !query.pinned })}
        style={{
          ...control,
          cursor: 'pointer',
          fontWeight: 700,
          ...(query.pinned ? { color: conf.accent, borderColor: conf.accent } : {}),
        }}
      >
        📌 Pinned
      </button>
      {active && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTER)}
          style={{
            ...control,
            cursor: 'pointer',
            fontWeight: 700,
            color: conf.accent,
            borderColor: conf.accent,
          }}
        >
          Clear
        </button>
      )}
    </div>
  )
}
