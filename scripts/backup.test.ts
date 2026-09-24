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

/**
 * A healthy `storage.sql` (#401): the bucket restored as private, plus the two object policies.
 * Built here rather than imported from the generator on purpose. These tests are about what the
 * workflow REFUSES, and a fixture that tracked the generator would keep passing even if the
 * generator started emitting something useless.
 */
const healthyStorage = [
  'insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)',
  "values ('attachments', 'attachments', false, 10485760, array['image/png']::text[])",
  'on conflict (id) do update set public = excluded.public;',
  ...['select_member', 'delete_editor'].map(
    (name) => `create policy "attachments_${name}" on storage.objects to "authenticated";`,
  ),
].join('\n')

function check(
  tables: string[],
  syntax: 'COPY' | 'INSERT INTO' = 'INSERT INTO',
  storage: string = healthyStorage,
) {
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
        ...[
          'handle_new_user',
          'handle_account_deletion',
          'create_board',
          'enforce_task_completion_lifecycle',
          'stamp_task_attribution',
        ].map((name) => `CREATE OR REPLACE FUNCTION "public"."${name}"() RETURNS void;`),
        ...Array.from({ length: 12 }, (_, i) => `CREATE POLICY p${i} ON public.tasks;`),
      ].join('\n'),
    )
    writeFileSync(join(dir, 'backup', 'storage.sql'), storage)
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

// ——— attachments storage metadata (#401) ———
// The object side of the authorization boundary is in no other file: `schema.sql` covers `public`
// only. Each case below restores something that fails SILENTLY rather than loudly, which is why the
// workflow asserts it rather than trusting the generator.

const withoutLines = (predicate: (line: string) => boolean) =>
  healthyStorage
    .split('\n')
    .filter((line) => !predicate(line))
    .join('\n')

test('refuses a backup whose storage.sql is missing or empty', () => {
  const result = check(required, 'INSERT INTO', '')
  expect(result.status).not.toBe(0)
  expect(result.stdout).toContain('backup/storage.sql is empty or missing')
})

test('refuses a backup that restores no attachments bucket', () => {
  // Policies applied to a bucket that does not exist restore no boundary at all.
  const result = check(
    required,
    'INSERT INTO',
    withoutLines((line) => line.includes('storage.buckets')),
  )
  expect(result.status).not.toBe(0)
  expect(result.stdout).toContain('does not configure the attachments bucket')
})

test('refuses a backup without a required object policy', () => {
  const result = check(
    required,
    'INSERT INTO',
    withoutLines((line) => line.startsWith('create policy "attachments_delete_editor"')),
  )
  expect(result.status).not.toBe(0)
  expect(result.stdout).toContain('attachments_delete_editor')
})

test('refuses a backup that restores a direct attachment write policy', () => {
  const result = check(
    required,
    'INSERT INTO',
    `${healthyStorage}\ncreate policy "attachments_insert_editor" on storage.objects to "authenticated";`,
  )
  expect(result.status).not.toBe(0)
  expect(result.stdout).toContain('uploads must cross the quota command')
})

test('refuses a backup that would restore the bucket as public', () => {
  // The worst outcome available here: a public bucket makes every object policy decorative, because
  // the object URL alone serves the file. It restores cleanly and nothing errors.
  const result = check(required, 'INSERT INTO', healthyStorage.replace(', false,', ', true,'))
  expect(result.status).not.toBe(0)
  expect(result.stdout).toContain('does not restore the attachments bucket as private')
})
