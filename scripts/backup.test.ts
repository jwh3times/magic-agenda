// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'

const workflow = readFileSync(new URL('../.github/workflows/backup.yml', import.meta.url), 'utf8')
const step = workflow.split('      - name: Verify the dumps contain what a restore needs\n')[1]
const verify = step
  .split('        run: |\n')[1]
  .split('\n      - ')[0]
  .split('\n')
  .map((line) => line.replace(/^ {10}/, ''))
  .join('\n')
const required = [
  'public.tasks',
  'auth.users',
  'auth.identities',
  'public.boards',
  'public.board_memberships',
  'public.account_profiles',
  'auth.mfa_factors',
]
const excluded = [
  'auth.sessions',
  'auth.refresh_tokens',
  'auth.mfa_amr_claims',
  'auth.mfa_challenges',
  'auth.one_time_tokens',
  'auth.flow_state',
]

function check(tables: string[], syntax: 'COPY' | 'INSERT INTO' = 'INSERT INTO') {
  const dir = mkdtempSync(join(tmpdir(), 'backup-verification-'))
  try {
    mkdirSync(join(dir, 'backup'))
    writeFileSync(
      join(dir, 'backup', 'data.sql'),
      tables
        .map(
          (table) =>
            `${syntax} "${table.replace('.', '"."')}" (id) ${syntax === 'COPY' ? 'FROM stdin;' : 'VALUES (1);'}`,
        )
        .join('\n'),
    )
    writeFileSync(
      join(dir, 'backup', 'schema.sql'),
      [
        'CREATE TABLE "public"."tasks" (id integer);',
        ...['handle_new_user', 'handle_account_deletion', 'create_board'].map(
          (name) => `CREATE OR REPLACE FUNCTION "public"."${name}"() RETURNS void;`,
        ),
        ...Array.from({ length: 12 }, (_, i) => `CREATE POLICY p${i} ON public.tasks;`),
      ].join('\n'),
    )
    return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', verify], { cwd: dir, encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test.each(['COPY', 'INSERT INTO'] as const)(
  'accepts accounts, OAuth links, and enrolled MFA factors (%s)',
  (syntax) => {
    expect(check(required, syntax).status).toBe(0)
  },
)

test.each(
  excluded.flatMap((table) =>
    (['COPY', 'INSERT INTO'] as const).map((syntax) => ({ table, syntax })),
  ),
)('refuses $table in $syntax form before encryption/upload', ({ table, syntax }) => {
  const result = check([...required, table], syntax)
  expect(result.status).not.toBe(0)
  expect(result.stdout).toContain(`data.sql contains excluded table ${table}`)
})

test.each(['auth.users', 'auth.identities'])('refuses a backup without %s', (table) => {
  expect(check(required.filter((name) => name !== table)).status).not.toBe(0)
})
