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
