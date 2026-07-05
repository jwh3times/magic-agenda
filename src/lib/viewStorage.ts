import type { ViewName } from '../types/task'

// Per-tab memory of the board's current view (sessionStorage: survives a refresh,
// resets on a new tab). Distinct from user_settings.default_view, which is the
// synced landing preference changed only in Settings.
const KEY = 'ma-board-view'

const isViewName = (v: string): v is ViewName =>
  v === 'calendar' || v === 'week' || v === 'agenda' || v === 'kanban'

export function readBoardView(): ViewName | null {
  try {
    const v = sessionStorage.getItem(KEY)
    return v && isViewName(v) ? v : null
  } catch {
    return null
  }
}

export function writeBoardView(view: ViewName): void {
  try {
    sessionStorage.setItem(KEY, view)
  } catch {
    // Storage unavailable (privacy mode) — remembering the view is best-effort.
  }
}

export function clearBoardView(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
