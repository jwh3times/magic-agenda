import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const LOCAL_E2E_EMAIL = 'e2e@magicagenda.test'
export const LOCAL_E2E_PASSWORD = 'E2e!Local-Only2026'
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'

interface LocalStack {
  apiUrl: string
  anonKey: string
  serviceRoleKey: string
}

/** Parse only the local values E2E needs; none of them are production credentials. */
export function parseLocalStack(raw: string): LocalStack {
  const status = JSON.parse(raw) as Record<string, unknown>
  const required = {
    apiUrl: status.API_URL,
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

async function provisionUser(stack: LocalStack): Promise<void> {
  const admin = createClient(stack.apiUrl, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: listed, error: listError } = await admin.auth.admin.listUsers()
  if (listError) throw new Error(`Could not inspect local E2E users: ${listError.message}`)

  const existing = listed.users.find((user) => user.email === LOCAL_E2E_EMAIL)
  if (existing) {
    const { error } = await admin.auth.admin.deleteUser(existing.id)
    if (error) throw new Error(`Could not replace the local E2E user: ${error.message}`)
  }

  const { error } = await admin.auth.admin.createUser({
    email: LOCAL_E2E_EMAIL,
    password: LOCAL_E2E_PASSWORD,
    email_confirm: true,
  })
  if (error) throw new Error(`Could not create the local E2E user: ${error.message}`)
}

export async function setupLocalE2E(): Promise<void> {
  const githubEnv = process.env.GITHUB_ENV
  if (!githubEnv) throw new Error('GITHUB_ENV is required; this setup script is CI-only.')

  const raw = execSync('npx supabase status -o json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stack = parseLocalStack(raw)
  await provisionUser(stack)
  appendEnvironment(githubEnv, localE2EEnvironment(stack))
  console.log('Prepared an isolated local E2E account and browser environment.')
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await setupLocalE2E()
}
