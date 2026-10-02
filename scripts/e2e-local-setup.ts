import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Client as PgClient } from 'pg'

export const LOCAL_E2E_EMAIL = 'e2e@magicagenda.test'
export const LOCAL_E2E_PASSWORD = 'E2e!Local-Only2026'
/** A second confirmed account, invited to the first account's Board by the invitation spec (#437). */
export const LOCAL_E2E_INVITEE_EMAIL = 'e2e-invitee@magicagenda.test'
export const LOCAL_E2E_INVITEE_PASSWORD = 'E2e!Invitee-Only2026'
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'

interface LocalStack {
  apiUrl: string
  dbUrl: string
  anonKey: string
  serviceRoleKey: string
}

/** Parse only the local values E2E needs; none of them are production credentials. */
export function parseLocalStack(raw: string): LocalStack {
  const status = JSON.parse(raw) as Record<string, unknown>
  const required = {
    apiUrl: status.API_URL,
    dbUrl: status.DB_URL,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
  }

  for (const [name, value] of Object.entries(required)) {
    if (typeof value !== 'string' || !value) {
      throw new Error(`Supabase status did not report a usable ${name}.`)
    }
  }

  return required as LocalStack
}

export function localE2EEnvironment(stack: LocalStack): Record<string, string> {
  return {
    VITE_SUPABASE_URL: stack.apiUrl,
    VITE_SUPABASE_ANON_KEY: stack.anonKey,
    VITE_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
    E2E_BASE_URL: 'http://127.0.0.1:4173',
    E2E_SUPABASE_URL: stack.apiUrl,
    E2E_SUPABASE_ANON_KEY: stack.anonKey,
    E2E_TEST_EMAIL: LOCAL_E2E_EMAIL,
    E2E_TEST_PASSWORD: LOCAL_E2E_PASSWORD,
    E2E_INVITEE_EMAIL: LOCAL_E2E_INVITEE_EMAIL,
    E2E_INVITEE_PASSWORD: LOCAL_E2E_INVITEE_PASSWORD,
  }
}

function appendEnvironment(path: string, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value.includes('\n') || value.includes('\r')) {
      throw new Error(`${name} cannot be written to GITHUB_ENV because it contains a newline.`)
    }
    appendFileSync(path, `${name}=${value}\n`, 'utf8')
  }
}

async function provisionUsers(stack: LocalStack): Promise<void> {
  const admin = createClient(stack.apiUrl, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: listed, error: listError } = await admin.auth.admin.listUsers()
  if (listError) throw new Error(`Could not inspect local E2E users: ${listError.message}`)

  // The invitee first: after a local run it may still be a member of the main account's Board, and
  // account deletion refuses to strand a sole Owner's co-members, so the owner could not be replaced.
  for (const [email, password] of [
    [LOCAL_E2E_INVITEE_EMAIL, LOCAL_E2E_INVITEE_PASSWORD],
    [LOCAL_E2E_EMAIL, LOCAL_E2E_PASSWORD],
  ] as const) {
    const existing = listed.users.find((user) => user.email === email)
    if (existing) {
      const { error } = await admin.auth.admin.deleteUser(existing.id)
      if (error) throw new Error(`Could not replace the local E2E user ${email}: ${error.message}`)
    }

    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw new Error(`Could not create the local E2E user ${email}: ${error.message}`)
  }
}

/**
 * Turns `board-sharing` on, as production has had it since 2026-09-29 (#494).
 *
 * Without it the E2E account sees the app as it was before sharing launched: no Members panel, no
 * member fetch on the board, so the a11y scans and visual canaries check a configuration nobody
 * runs. Same statement as the runbook's stage 2 (`docs/runbooks/roles-and-feature-flags.md`), made
 * idempotent because the setup can rerun against a restored stack.
 *
 * Direct SQL as the local superuser, not the Data API: `feature_flags` grants nothing to
 * `service_role`, and a write through `authenticated` needs an admin. Making the E2E account an
 * admin instead would also show it sharing (`useBoardSharing()` admits admins without the flag),
 * but it would see what an administrator sees — the Admin link in Settings included — rather than
 * what every other Account does.
 */
const ENABLE_BOARD_SHARING_SQL = `insert into public.feature_flags (key, enabled, description)
values ('board-sharing', true, 'Shared Boards: invitations, members, and Assignees')
on conflict (key) do update set enabled = true`

async function enableBoardSharing(stack: LocalStack): Promise<void> {
  const pg = new PgClient({ connectionString: stack.dbUrl })
  await pg.connect()
  try {
    await pg.query(ENABLE_BOARD_SHARING_SQL)
  } finally {
    await pg.end()
  }
}

export async function setupLocalE2E(): Promise<void> {
  const githubEnv = process.env.GITHUB_ENV
  if (!githubEnv) throw new Error('GITHUB_ENV is required; this setup script is CI-only.')

  const raw = execSync('npx supabase status -o json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stack = parseLocalStack(raw)
  await provisionUsers(stack)
  await enableBoardSharing(stack)
  appendEnvironment(githubEnv, localE2EEnvironment(stack))
  console.log(
    'Prepared an isolated local E2E account, enabled board-sharing, and wrote the browser environment.',
  )
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await setupLocalE2E()
}
