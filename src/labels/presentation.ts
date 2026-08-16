import type { Label } from '../types/label'

export const UNLABELED_NAME = 'Unlabeled'
export const UNLABELED_DOT_COLOR = '#8b8378'

export function labelPresentation(label: Label | null): { name: string; dotColor: string } {
  return label
    ? { name: label.name, dotColor: label.dotColor }
    : { name: UNLABELED_NAME, dotColor: UNLABELED_DOT_COLOR }
}
