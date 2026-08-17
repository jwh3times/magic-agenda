import { createContext } from 'react'
import type { UseLabels } from './useLabels'

export const LabelDirectoryContext = createContext<UseLabels | null>(null)
