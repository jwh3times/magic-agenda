/** Normalizes a caught value (an `Error`, or anything else a throw/rejection can carry) into a message. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong'
}
