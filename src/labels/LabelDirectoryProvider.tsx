import { useContext, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useBoardSession } from '../board/BoardDirectoryProvider'
import { readLastUserId } from '../lib/lastUser'
import type { Label } from '../types/label'
import { useLabels, type UseLabels } from './useLabels'
import { LabelDirectoryContext } from './labelDirectoryContext'

/** Owns the selected Board's Label vocabulary for the whole signed-in session. */
export function LabelDirectoryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { board } = useBoardSession()
  const value = useLabels(user?.id ?? readLastUserId(), board?.id ?? '', Boolean(user))
  return <LabelDirectoryContext.Provider value={value}>{children}</LabelDirectoryContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export function useLabelDirectoryContext(): UseLabels {
  const context = useContext(LabelDirectoryContext)
  if (!context) {
    throw new Error('useLabelDirectoryContext must be used within <LabelDirectoryProvider>')
  }
  return context
}

// oxlint-disable-next-line react/only-export-components
export function useLabel(labelId: string | null): Label | null {
  const { labels } = useLabelDirectoryContext()
  return labels.find((label) => label.id === labelId) ?? null
}
