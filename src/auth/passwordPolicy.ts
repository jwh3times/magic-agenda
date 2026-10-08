/**
 * Client mirror of the Supabase password policy.
 *
 * `supabase/config.toml`'s `[auth]` tree is the real control — this only makes the signup and
 * reset forms fail fast instead of round-tripping to GoTrue. It lived in two files until the auth
 * seam landed (`Login`'s `SIGNUP_MIN_PASSWORD` and `ResetPassword`'s `MIN_PASSWORD`, the second
 * carrying a comment that it was a copy of the first), which meant the number and the sentence
 * could drift from each other and from `config.toml` independently.
 *
 * Applied on **signup and reset only**. Sign-in must keep accepting a legacy password shorter
 * than the current minimum, or raising the policy would lock existing users out.
 */
export const MIN_PASSWORD = 10

export const PASSWORD_RULE =
  'At least 10 characters, including upper- and lower-case letters, a number, and a symbol.'

/**
 * A password nobody will ever type, for the sign-up request.
 *
 * Sign-up no longer asks for a password: the database discards whatever was stored when the
 * address is first confirmed (`20261008160000`), because a password submitted before the address
 * was proven cannot be trusted to be its owner's. The auth server still requires one in the
 * request, so this fills the field with 32 random bytes plus one character of each class the
 * policy demands. It is never shown, stored, or used to sign in.
 */
export function throwawayPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${random}aA1!`
}
