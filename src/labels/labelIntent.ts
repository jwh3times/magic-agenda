import type { Label } from '../types/label'

/**
 * Every decision behind Owner Label management, with no Supabase and no React.
 *
 * The split follows `series.ts` / `editIntent.ts`: this module decides *whether a change is
 * allowed and what the vocabulary becomes*, while `useLabels` only applies state and sends
 * writes. The reason it earns a module is that the same three questions — is this name usable,
 * what does this reorder renumber, and what did the database just refuse — were otherwise going
 * to be answered inline in a component, in slightly different ways per call site.
 */

/** Mirrors the `labels_name_trimmed` check constraint. */
export const NAME_MAX_LENGTH = 80

/** Mirrors the `labels_dot_color_hex` check constraint. */
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/

/**
 * Why a Label write cannot proceed. This is an app-owned union, not a vendor error: the same
 * reason has to be producible twice — once by the optimistic client check below, and once by
 * translating whatever PostgREST returns — so the UI has exactly one vocabulary to render.
 *
 * `unknown` keeps the vendor's own text on purpose, the same bargain `AuthFailureReason` makes:
 * an unmapped code degrades to the server's wording rather than to silence.
 */
export type LabelProblem =
  | { reason: 'empty' }
  | { reason: 'too-long'; max: number }
  | { reason: 'duplicate-name'; existing: string }
  | { reason: 'bad-color' }
  | { reason: 'not-allowed' }
  | { reason: 'unknown'; message: string }

/** The database stores the name trimmed; `labels_name_trimmed` rejects anything else. */
export function normalizeName(raw: string): string {
  return raw.trim()
}

/**
 * Case-insensitive identity within a Board, matching the `labels_board_name_ci_uniq` index.
 *
 * This is an *early explanation*, never the authority. Postgres `lower()` is collation-dependent
 * and JavaScript `toLowerCase()` is not, so the two can disagree on non-ASCII scripts — which is
 * exactly why `labelProblemFromError` can still produce `duplicate-name` after this returns null.
 */
export function checkName(
  raw: string,
  labels: readonly Label[],
  selfId: string | null = null,
): LabelProblem | null {
  const name = normalizeName(raw)
  if (name.length === 0) return { reason: 'empty' }
  if (name.length > NAME_MAX_LENGTH) return { reason: 'too-long', max: NAME_MAX_LENGTH }

  const clash = labels.find((l) => l.id !== selfId && l.name.toLowerCase() === name.toLowerCase())
  return clash ? { reason: 'duplicate-name', existing: clash.name } : null
}

export function checkColor(raw: string): LabelProblem | null {
  return HEX_COLOR.test(raw) ? null : { reason: 'bad-color' }
}

/** Appends after the current vocabulary. Positions stay dense, so this is the length. */
export function nextPosition(labels: readonly Label[]): number {
  return labels.length
}

/**
 * The vocabulary after moving one Label by `delta` places, renumbered densely from 0.
 *
 * Returns `null` for a move that changes nothing — off either end, or an id that is not here.
 * A null result means "do not write", which is what keeps the arrow buttons at the ends inert
 * rather than issuing an empty upsert.
 */
export function moveLabel(labels: readonly Label[], id: string, delta: number): Label[] | null {
  const ordered = [...labels].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  const from = ordered.findIndex((l) => l.id === id)
  if (from === -1) return null

  const to = from + delta
  if (to < 0 || to >= ordered.length || delta === 0) return null

  const [moved] = ordered.splice(from, 1)
  ordered.splice(to, 0, moved)
  return ordered.map((label, index) => ({ ...label, position: index }))
}

/**
 * Only the rows whose position actually moved.
 *
 * Same reasoning as `persistReorder` upserting only the touched lanes: renumbering densely is the
 * simplest correct model, but writing all N rows for a one-place swap makes an Owner's reorder
 * cost proportional to vocabulary size for no benefit.
 */
export function changedPositions(before: readonly Label[], after: readonly Label[]): Label[] {
  const previous = new Map(before.map((l) => [l.id, l.position]))
  return after.filter((l) => previous.get(l.id) !== l.position)
}

/** True when deleting this Label would leave the Board with no vocabulary at all. */
export function isLastLabel(labels: readonly Label[], id: string): boolean {
  return labels.length === 1 && labels[0]?.id === id
}

interface PostgrestLikeError {
  code?: string | null
  message?: string | null
}

/**
 * Translate a PostgREST/Postgres failure into the same union the client check produces.
 *
 * Keyed on SQLSTATE and constraint *names*, never on message prose — message text is reworded
 * across releases, while `labels_board_name_ci_uniq` is ours and changes only when we change it.
 */
export function labelProblemFromError(error: PostgrestLikeError | null | undefined): LabelProblem {
  const code = error?.code ?? ''
  const message = error?.message ?? ''

  if (code === '23505') {
    return message.includes('labels_board_name_ci_uniq')
      ? { reason: 'duplicate-name', existing: '' }
      : { reason: 'unknown', message }
  }
  if (code === '23514') {
    if (message.includes('labels_dot_color_hex')) return { reason: 'bad-color' }
    if (message.includes('labels_name_trimmed')) return { reason: 'empty' }
    return { reason: 'unknown', message }
  }
  // 42501 is a column/table grant refusal; 42883 and PGRST-prefixed codes arrive when RLS leaves
  // the caller with no visible row to update. All three mean the same thing to an Owner-only UI.
  if (code === '42501' || code.startsWith('PGRST')) return { reason: 'not-allowed' }

  return { reason: 'unknown', message: message || 'Could not save the label.' }
}

/** One sentence per reason, so every surface explains a refusal the same way. */
export function explainProblem(problem: LabelProblem): string {
  switch (problem.reason) {
    case 'empty':
      return 'Enter a label name.'
    case 'too-long':
      return `Label names are at most ${problem.max} characters.`
    case 'duplicate-name':
      return problem.existing
        ? `“${problem.existing}” already uses that name.`
        : 'Another label already uses that name.'
    case 'bad-color':
      return 'Pick a colour for the label.'
    case 'not-allowed':
      return 'Only the board owner can change labels.'
    case 'unknown':
      return problem.message
  }
}
