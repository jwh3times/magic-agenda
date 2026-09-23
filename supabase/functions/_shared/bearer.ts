/**
 * Constant-time check of a cron job's bearer secret, shared by the functions `pg_cron` invokes
 * (`send-reminders`, `materialize-series`).
 *
 * Both sides are hashed first, so the comparison always runs over two 32-byte digests: its timing
 * reveals neither the secret's length nor how many leading bytes matched. An empty expected secret
 * never matches, so a function deployed before its secret is set refuses everything rather than
 * accepting an empty bearer.
 */
export async function sameSecret(
  actual: string,
  expected: string,
): Promise<boolean> {
  if (!expected) return false;
  const encode = (value: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [left, right] = await Promise.all([encode(actual), encode(expected)]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

/** The token from an `Authorization: Bearer …` header, or an empty string. */
export function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}
