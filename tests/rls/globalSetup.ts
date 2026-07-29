import { execFileSync } from 'node:child_process'

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
    // package.json. shell: true so this works on Windows, where `npx` is `npx.cmd`.
    raw = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })
  } catch {
    throw new Error(
      'RLS tests need a local Supabase stack, and none is running.\n' +
        'Start one with:  npm run test:rls:up\n' +
        'Stop it later with:  npm run test:rls:down',
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
