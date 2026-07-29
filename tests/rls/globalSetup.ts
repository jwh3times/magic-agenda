import { execSync } from 'node:child_process'

/**
 * Reads the running local stack's URLs and keys once, before any test file.
 *
 * These values are generated per machine by `supabase start`, so they cannot be committed.
 * Failing here with an actionable message is much kinder than every test failing on a refused
 * connection.
 */
export default function setup(): void {
  let raw: string
  try {
    // `npx supabase` resolves the exact-pinned devDependency, not a registry `latest` -- see
    // package.json. execSync rather than execFileSync with an args array: it always runs through
    // a shell, which is what makes `npx` work on Windows where it is really `npx.cmd`, and
    // execFileSync given BOTH an args array and shell:true is deprecated (DEP0190) and prints a
    // warning on every single run. The command is a fixed literal -- nothing is interpolated into
    // it, so there is no injection surface.
    raw = execSync('npx supabase status -o json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    // Bind the cause. "No stack running" is only one of the ways this can fail; a wrong CLI
    // version, a spawn failure, or a non-JSON stderr blob all land here too, and reporting those
    // as "none is running" sends a developer to `test:rls:up`, which fixes none of them.
    throw new Error(
      'RLS tests need a local Supabase stack, and `npx supabase status` failed.\n' +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}\n` +
        'If no stack is running, start one with:  npm run test:rls:up\n' +
        'Stop it later with:  npm run test:rls:down',
      { cause: err },
    )
  }

  const status = JSON.parse(raw) as Record<string, string>
  const required = ['API_URL', 'DB_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY'] as const
  for (const key of required) {
    if (!status[key]) {
      throw new Error(
        `\`supabase status -o json\` did not report ${key}. ` +
          'Key names have changed across CLI majors -- check the `supabase` version pinned in package.json.',
      )
    }
  }

  process.env.SUPABASE_API_URL = status.API_URL
  process.env.SUPABASE_DB_URL = status.DB_URL
  process.env.SUPABASE_ANON_KEY = status.ANON_KEY
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
}
