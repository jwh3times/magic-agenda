/** Stable client-side id (used for optimistic task/checklist ids; survives the DB round-trip). */
export function newId(): string {
  return globalThis.crypto.randomUUID()
}
