import type { CSSProperties, Ref } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { useIsMobile } from '../lib/useMediaQuery'
import { STATUS } from '../theme/constants'
import { EMPTY_FILTER, isFilterActive, type FilterQuery } from '../data/filters'
import type { WorkflowStatus } from '../types/task'
import { useLabelDirectoryContext } from '../labels/LabelDirectoryProvider'

export interface SearchFilterBarProps {
  query: FilterQuery
  onChange: (q: FilterQuery) => void
  /** Lets the board focus the search field from the `/` keyboard shortcut (#269). */
  searchInputRef?: Ref<HTMLInputElement>
  /** Selection mode (#270). The toggle is omitted when no handler is given (a read-only board). */
  selecting?: boolean
  onToggleSelect?: () => void
}

export function SearchFilterBar({
  query,
  onChange,
  searchInputRef,
  selecting = false,
  onToggleSelect,
}: SearchFilterBarProps) {
  const { theme, conf } = useTheme()
  const { labels } = useLabelDirectoryContext()
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
    <search
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
        ref={searchInputRef}
        aria-label="Search tasks"
        value={query.text}
        onChange={(e) => onChange({ ...query, text: e.target.value })}
        placeholder="Search tasks…"
        style={{ ...control, flex: '1 1 220px', minWidth: 160 }}
      />
      <select
        aria-label="Filter by label"
        value={query.labelId}
        onChange={(e) => onChange({ ...query, labelId: e.target.value })}
        style={{ ...control, ...(isMobile && { flex: '1 1 40%', minWidth: 0 }) }}
      >
        <option value="all">All labels</option>
        <option value="unlabeled">Unlabeled</option>
        {labels.map((label) => (
          <option key={label.id} value={label.id}>
            {label.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter by status"
        value={query.status}
        onChange={(e) => onChange({ ...query, status: e.target.value as WorkflowStatus | 'all' })}
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
      {onToggleSelect && (
        <button
          type="button"
          aria-pressed={selecting}
          onClick={onToggleSelect}
          style={{
            ...control,
            cursor: 'pointer',
            fontWeight: 700,
            ...(selecting ? { color: conf.accent, borderColor: conf.accent } : {}),
          }}
        >
          ☑ Select
        </button>
      )}
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
    </search>
  )
}
