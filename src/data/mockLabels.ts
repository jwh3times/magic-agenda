import { fakeLabelDirectory } from '../labels/fakeLabelDirectory'
import type { UseLabels } from '../labels/useLabels'
import type { Label } from '../types/label'

/** Decorative/demo Label vocabulary used only by the landing preview and hermetic Board tests. */
export const MOCK_LABELS: Label[] = [
  { id: 'demo-work', boardId: 'demo-board', name: 'Work', dotColor: '#2563eb', position: 0 },
  {
    id: 'demo-personal',
    boardId: 'demo-board',
    name: 'Personal',
    dotColor: '#db2777',
    position: 1,
  },
  {
    id: 'demo-errands',
    boardId: 'demo-board',
    name: 'Errands',
    dotColor: '#d97706',
    position: 2,
  },
  { id: 'demo-ideas', boardId: 'demo-board', name: 'Ideas', dotColor: '#7c3aed', position: 3 },
  {
    id: 'demo-health',
    boardId: 'demo-board',
    name: 'Health',
    dotColor: '#059669',
    position: 4,
  },
]

/**
 * Built from the typed fake rather than hand-rolled, so an addition to `UseLabels` cannot leave a
 * partial object here — which is exactly what happened when the management writes landed.
 */
export const MOCK_LABEL_DIRECTORY: UseLabels = fakeLabelDirectory({ labels: MOCK_LABELS })
