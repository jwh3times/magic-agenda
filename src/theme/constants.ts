import type { Category, Color, Status, ThemeName } from '../types/task'

// All values ported verbatim from design/Task Board.dc.html (CAT / COLORS / STATUS / PAPER).

export interface CatDef {
  label: string
  dot: string
}

export const CAT: Record<Category, CatDef> = {
  work: { label: 'Work', dot: '#2563eb' },
  personal: { label: 'Personal', dot: '#db2777' },
  errands: { label: 'Errands', dot: '#d97706' },
  ideas: { label: 'Ideas', dot: '#7c3aed' },
  health: { label: 'Health', dot: '#059669' },
}

export const COLORS: Color[] = ['yellow', 'pink', 'blue', 'mint', 'lilac', 'orange']

export interface StatusDef {
  key: Status
  label: string
  accent: string
}

export const STATUS: StatusDef[] = [
  { key: 'todo', label: 'To Do', accent: '#94a3b8' },
  { key: 'doing', label: 'In Progress', accent: '#3b82f6' },
  { key: 'done', label: 'Completed', accent: '#22c55e' },
]

export interface PaperDef {
  bg: string
  /** Border colour — present on cork & glass, absent on brutal. */
  edge?: string
  ink: string
}

export const PAPER: Record<ThemeName, Record<Color, PaperDef>> = {
  cork: {
    yellow: { bg: '#FCE98B', edge: '#E9D055', ink: '#5a521e' },
    pink: { bg: '#F8B6C8', edge: '#EE9BB2', ink: '#6e2740' },
    blue: { bg: '#AAD4F2', edge: '#86BEE8', ink: '#1d3f5b' },
    mint: { bg: '#B4E3BE', edge: '#92D4A0', ink: '#1f5733' },
    lilac: { bg: '#CFC0EC', edge: '#B6A2E1', ink: '#402f6b' },
    orange: { bg: '#FBC78A', edge: '#F2B062', ink: '#6b3e1a' },
  },
  brutal: {
    yellow: { bg: '#FFE600', ink: '#111' },
    pink: { bg: '#FF5DA8', ink: '#111' },
    blue: { bg: '#4D7CFF', ink: '#fff' },
    mint: { bg: '#00E0A4', ink: '#08231b' },
    lilac: { bg: '#B388FF', ink: '#160a2e' },
    orange: { bg: '#FF7A2F', ink: '#1a0c02' },
  },
  glass: {
    yellow: { bg: 'rgba(250,210,80,.14)', edge: 'rgba(250,210,80,.42)', ink: '#FBEFC4' },
    pink: { bg: 'rgba(244,114,182,.15)', edge: 'rgba(244,114,182,.45)', ink: '#FAD3E6' },
    blue: { bg: 'rgba(96,165,250,.15)', edge: 'rgba(96,165,250,.45)', ink: '#CFE3FF' },
    mint: { bg: 'rgba(52,211,153,.15)', edge: 'rgba(52,211,153,.45)', ink: '#C5F3E1' },
    lilac: { bg: 'rgba(167,139,250,.16)', edge: 'rgba(167,139,250,.46)', ink: '#E2D7FF' },
    orange: { bg: 'rgba(251,146,60,.15)', edge: 'rgba(251,146,60,.45)', ink: '#FBDFC0' },
  },
}
