import { useAuth } from '../auth/AuthProvider'
import { Board } from '../components/Board'

/**
 * The signed-in board. Phase 8 will load tasks/settings here and pass them to Board;
 * for now Board still holds its own mock state.
 */
export function BoardPage() {
  const { signOut } = useAuth()
  return <Board onSignOut={signOut} />
}
