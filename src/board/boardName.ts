/**
 * What a Board may be called, decided in one place.
 *
 * These mirror the database exactly: `boards_name_trimmed` and the column's original
 * `char_length(name) between 1 and 120`. The client check is an early explanation; the constraint
 * is the authority.
 *
 * Used by rename and by the UI that edits a name. **Creation deliberately does not use it**:
 * `create_board` substitutes `'My Board'` for a blank name rather than refusing one, so the empty
 * case means different things on the two paths — a new Board gets a default, while clearing an
 * existing Board's name is a mistake to explain. Two rules that only look like one.
 */

export const BOARD_NAME_MAX_LENGTH = 120

/** The database stores names trimmed; `boards_name_trimmed` rejects anything else. */
export function normalizeBoardName(raw: string): string {
  return raw.trim()
}

/** An explanation of why this name is unusable, or null. */
export function checkBoardName(raw: string): string | null {
  const name = normalizeBoardName(raw)
  if (name.length === 0) return 'Enter a board name.'
  if (name.length > BOARD_NAME_MAX_LENGTH) {
    return `Board names are at most ${BOARD_NAME_MAX_LENGTH} characters.`
  }
  return null
}
