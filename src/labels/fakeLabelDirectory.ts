import type { Label } from '../types/label'
import type { UseLabels } from './useLabels'

export function fakeLabel(overrides: Partial<Label> = {}): Label {
  return {
    id: 'l1',
    boardId: 'b1',
    name: 'Work',
    dotColor: '#2563eb',
    position: 0,
    ...overrides,
  }
}

/** Complete in-memory Label Directory for tests of consumers rather than the Supabase adapter. */
export function fakeLabelDirectory(overrides: Partial<UseLabels> = {}): UseLabels {
  return {
    labels: [fakeLabel()],
    loading: false,
    error: null,
    offline: false,
    fallbackReason: null,
    savedAt: null,
    reload: () => Promise.resolve(),
    createLabel: () => Promise.resolve(null),
    renameLabel: () => Promise.resolve(null),
    recolorLabel: () => Promise.resolve(null),
    reorderLabel: () => Promise.resolve(null),
    deleteLabel: () => Promise.resolve(null),
    ...overrides,
  }
}
