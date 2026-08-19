import { capabilitiesFor } from './role'
import type { BoardSession } from './BoardDirectoryProvider'
import type { BoardSummary } from './selection'
import type { UseBoardDirectory } from './useBoardDirectory'

/**
 * In-memory Board Directory for tests that exercise a caller rather than the Supabase hook.
 *
 * Same reason `fakeUseTasks` and `fakeAuthGateway` exist: a hand-built `vi.mock` factory is shaped
 * like whichever members the test-under-edit happened to call, which is untyped and drifts —
 * `Login.test.tsx` once stubbed 3 of the auth context's 6 members while its siblings stubbed 6, and
 * nothing caught it. Returning a complete `UseBoardDirectory` means a new member cannot leave a
 * partial object behind.
 *
 * Carries no vitest import and nothing in the app imports it, so it never reaches the bundle.
 */
export function fakeBoardSummary(over: Partial<BoardSummary> = {}): BoardSummary {
  return {
    id: 'b1',
    name: 'My Board',
    role: 'owner',
    defaultView: 'calendar',
    membershipId: 'm1',
    ...over,
  }
}

/**
 * The selected Board and its capabilities, for tests that mock the provider module.
 *
 * Derives `can` from the role rather than letting callers pass booleans, so a test cannot
 * accidentally assert against a capability set the real role mapping would never produce.
 */
export function fakeBoardSession(board: BoardSummary | null = fakeBoardSummary()): BoardSession {
  return { board, can: capabilitiesFor(board?.role) }
}

export function fakeBoardDirectory(overrides: Partial<UseBoardDirectory> = {}): UseBoardDirectory {
  const boards = overrides.boards ?? [fakeBoardSummary()]
  return {
    boards,
    selectedBoardId: boards[0]?.id ?? null,
    selectBoard: () => {},
    loading: false,
    error: null,
    offline: false,
    reload: async () => {},
    setDefaultView: async () => {},
    createBoard: () => Promise.resolve(null),
    deleteBoard: () => Promise.resolve(null),
    renameBoard: () => Promise.resolve(null),
    ...overrides,
  }
}
