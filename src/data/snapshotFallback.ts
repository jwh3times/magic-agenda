/** Why a live read fell back to a local snapshot. */
export type SnapshotFallbackReason = 'network' | 'auth' | 'request-error'

/**
 * Classify the final Supabase/PostgREST response without depending on vendor message prose.
 * postgrest-js resolves transport failures with status 0; HTTP failures keep their real status.
 */
export function snapshotFallbackReason(status: number): SnapshotFallbackReason {
  if (status === 0) return 'network'
  if (status === 401 || status === 403) return 'auth'
  return 'request-error'
}

/** Pick the most actionable reason when several Board reads fell back independently. */
export function dominantSnapshotFallbackReason(
  reasons: readonly (SnapshotFallbackReason | null)[],
): SnapshotFallbackReason | null {
  if (reasons.includes('auth')) return 'auth'
  if (reasons.includes('request-error')) return 'request-error'
  if (reasons.includes('network')) return 'network'
  return null
}
