import { createContext, useContext } from 'react'
import type { UseBoardDirectory } from './useBoardDirectory'

/**
 * Separate from the provider component for the same reason `labelDirectoryContext.ts` is: keeping
 * the context in a hook-only module leaves `BoardDirectoryProvider.tsx` exporting components alone
 * (`react-refresh/only-export-components`), and lets a test supply a directory by rendering the
 * real provider rather than by mocking the module that defines it.
 */
export const BoardDirectoryContext = createContext<UseBoardDirectory | null>(null)

/**
 * The Board Directory if one is mounted, or `null`.
 *
 * For chrome that is genuinely optional rather than broken without it — the Board switcher renders
 * nothing outside a provider, exactly as `TaskCard` is decorative without `BoardActionContext`.
 * Prefer `useBoardDirectoryContext` anywhere the Board list is actually required; throwing is the
 * better failure for a component that cannot do its job without one.
 *
 * It lives here rather than beside that hook so an optional consumer need not import the provider
 * module at all: several page tests mock that module wholesale, and every export a component reaches
 * for through it is another hole such a mock can silently develop.
 */
export function useOptionalBoardDirectory(): UseBoardDirectory | null {
  return useContext(BoardDirectoryContext)
}
