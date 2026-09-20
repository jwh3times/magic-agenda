// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
  BUCKET_QUERY,
  POLICY_QUERY,
  renderStorageMetadata,
} from './dump-storage-metadata.mjs'

/**
 * The renderer for the attachments storage backup (#401), tested without a database.
 *
 * What matters here is that the emitted SQL restores the **boundary**, not merely that it is
 * syntactically plausible. A backup of this kind fails in one direction that is genuinely
 * dangerous — restoring a bucket without its policies, or with `public = true` — and in that state
 * nothing errors, so only an assertion catches it.
 */

const bucket = (over = {}) => ({
  id: 'attachments',
  name: 'attachments',
  public: false,
  file_size_limit: 10485760,
  allowed_mime_types: ['image/png', 'image/jpeg', 'application/pdf'],
  ...over,
})

const policy = (over = {}) => ({
  policyname: 'attachments_select_member',
  permissive: 'PERMISSIVE',
  roles: ['authenticated'],
  cmd: 'SELECT',
  qual: "bucket_id = 'attachments'",
  with_check: null,
  ...over,
})

describe('renderStorageMetadata', () => {
  test('restores the bucket as private, with its limits', () => {
    const sql = renderStorageMetadata([bucket()], [policy()])
    expect(sql).toContain('insert into storage.buckets')
    expect(sql).toContain("values ('attachments', 'attachments', false, 10485760,")
    expect(sql).toContain("array['image/png', 'image/jpeg', 'application/pdf']::text[]")
    // `do update`, not `do nothing`: a pre-existing dashboard-created bucket must be converged, or
    // the policies below are applied to a bucket whose own config contradicts them.
    expect(sql).toContain('on conflict (id) do update set')
  })

  test('reconstructs a policy with its role, command, and predicate', () => {
    const sql = renderStorageMetadata([bucket()], [policy()])
    expect(sql).toContain('create policy "attachments_select_member" on storage.objects')
    expect(sql).toContain('  as permissive')
    expect(sql).toContain('  for select')
    expect(sql).toContain('  to "authenticated"')
    expect(sql).toContain('  using (bucket_id = \'attachments\')')
    // A SELECT policy has no WITH CHECK; emitting an empty one would be a syntax error.
    expect(sql).not.toContain('with check')
  })

  test('emits both clauses for an UPDATE policy', () => {
    // `using` decides which objects may be targeted, `with check` what they may become. Dropping
    // the second on restore would let a file be renamed into another Board's prefix — the exact
    // thing attachments_update_editor exists to stop.
    const sql = renderStorageMetadata(
      [bucket()],
      [policy({ policyname: 'attachments_update_editor', cmd: 'UPDATE', with_check: 'true' })],
    )
    expect(sql).toContain('  using (')
    expect(sql).toContain('  with check (true)')
  })

  test('drops before creating, so a restore onto a live bucket is idempotent', () => {
    const sql = renderStorageMetadata([bucket()], [policy()])
    expect(sql).toContain('drop policy if exists "attachments_select_member" on storage.objects;')
    expect(sql.indexOf('drop policy')).toBeLessThan(sql.indexOf('create policy'))
  })

  test('omits the role clause when a policy targets PUBLIC, rather than inventing one', () => {
    // `to` with an empty list is a syntax error, and guessing a role would silently change the
    // boundary. A PUBLIC policy is a finding for #397 to report; a backup records what is there.
    const sql = renderStorageMetadata([bucket()], [policy({ roles: [] })])
    expect(sql).not.toContain('  to ')
    expect(sql).toContain('  for select')
  })

  test('escapes quotes in a policy name and a predicate', () => {
    const sql = renderStorageMetadata(
      [bucket({ name: "it's" })],
      [policy({ policyname: 'we"ird' })],
    )
    expect(sql).toContain("'it''s'")
    expect(sql).toContain('"we""ird"')
  })

  test('refuses to write a backup with no bucket row', () => {
    // Succeeding here would record "attachments are backed up" for a bundle that restores nothing.
    expect(() => renderStorageMetadata([], [policy()])).toThrow(/no 'attachments' row/)
  })

  test('refuses to write a backup with no policies', () => {
    // The dangerous direction: a bucket with no policy restores an unprotected object store.
    expect(() => renderStorageMetadata([bucket()], [])).toThrow(/no policies/)
  })

  test('says plainly that the bytes are not here', () => {
    // The header is what someone reads during an outage, when they are deciding whether the files
    // are coming back. Leaving it implicit is how a restore surprises someone.
    const sql = renderStorageMetadata([bucket()], [policy()])
    expect(sql).toContain('NOT the object bytes')
  })
})

test('the queries read only, and only the attachments bucket and storage.objects policies', () => {
  for (const query of [BUCKET_QUERY, POLICY_QUERY]) {
    expect(query.trim().toLowerCase().startsWith('select')).toBe(true)
    expect(query).not.toMatch(/\b(insert|update|delete|drop|alter|create|grant|revoke)\b/i)
  }
  // Never `select * from storage.objects`: those rows describe files whose bytes are in no backup,
  // so restoring them would rebuild rows pointing at objects that do not exist.
  expect(POLICY_QUERY).toContain('pg_policies')
  expect(POLICY_QUERY).not.toMatch(/from\s+storage\.objects/i)
})
