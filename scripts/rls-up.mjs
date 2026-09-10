import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/**
 * Start the local Supabase stack for `npm run test:rls`, with the same dummy secrets CI uses.
 *
 * This script exists for one reason: `supabase/config.toml` enables SMTP against
 * `smtp.resend.com` through `env(RESEND_API_KEY)`, so a local GoTrue started by a shell that
 * holds the real key can send real email from a test stack. A maintainer running under `op run`
 * with the production-operations template — the documented way to hold production credentials —
 * had exactly that shell. The RLS suite itself creates users with `email_confirm: true` and sends
 * nothing, but a manual signup against the local UI would have.
 *
 * `GOOGLE_OAUTH_CLIENT_SECRET` rides along for the same reason it does in CI. The rest are cheap
 * insurance: this command actually starts storage rather than only parsing `config.toml`.
 */
export const DUMMY_ENV = Object.freeze({
  RESEND_API_KEY: 'dummy-not-a-real-key',
  GOOGLE_OAUTH_CLIENT_SECRET: 'dummy-not-a-real-secret',
  OPENAI_API_KEY: 'dummy-not-a-real-key',
  S3_HOST: 'dummy.local',
  S3_REGION: 'local',
  S3_ACCESS_KEY: 'dummy-access-key',
  S3_SECRET_KEY: 'dummy-secret-key',
})

/** Excluded services, kept identical to CI so a local stack is the same stack. */
export const EXCLUDED_SERVICES = 'studio,edge-runtime,logflare,vector,imgproxy'

/**
 * The dummies go **over** the ambient environment, not under it.
 *
 * `{ ...DUMMY_ENV, ...env }` would read as a sensible default and would defeat the entire point:
 * a shell that already exports the real `RESEND_API_KEY` is precisely the case this guards, so
 * the real value has to lose.
 */
export function stackEnv(env) {
  return { ...env, ...DUMMY_ENV }
}

/**
 * `npx`, for the reason CI spells out: it prefers the exact-pinned local `supabase` devDependency,
 * whereas a PATH binary would float.
 *
 * One command string through a shell rather than an argv array, and both halves of that are
 * forced. On Windows `npx` is `npx.cmd`, which Node has refused to spawn without a shell since
 * the 20.x CVE-2024-27980 mitigation (`EINVAL`); and passing an argv array *with* a shell is
 * DEP0190, because the arguments are concatenated rather than escaped. A constant string is
 * neither. Keep it constant -- nothing here may ever interpolate a value from outside this file.
 */
const COMMAND = `npx supabase start -x ${EXCLUDED_SERVICES}`

function main() {
  const child = spawn(COMMAND, {
    stdio: 'inherit',
    shell: true,
    env: stackEnv(process.env),
  })
  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 1))
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
