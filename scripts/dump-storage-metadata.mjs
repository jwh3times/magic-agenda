#!/usr/bin/env node
// Capture the attachments bucket's configuration and the `storage.objects` policies (#401),
// which no dump in this repository contained.
//
// **Why a third file rather than a wider `db dump`.** The nightly dump takes DDL for `public` and
// data for `public` plus durable `auth` rows. Widening it to `storage` would be wrong twice: the
// schema half would capture platform-managed tables a Supabase project provisions itself, and the
// data half would capture every `storage.objects` row — metadata for files whose BYTES are in no
// backup, so a restore would rebuild rows pointing at objects that do not exist. That is the
// silent-breakage shape this issue is about, not a fix for it.
//
// **What a restore gets from this.** The bucket exists with `public = false`, its size limit, and
// its MIME allow-list; and the four object policies are back. So the authorization boundary is
// rebuilt correctly even though the files are gone — which is the difference between "attachments
// are missing" and "the bucket is world-readable, or exists with no policy at all".
//
// **Read from production rather than trusted from the migration.** `20260918210000_task_
// attachments_foundation.sql` creates all of this, and on a rebuilt project migrations replay, so
// in practice it would come back anyway. That is an assumption, and #384 is what this repository
// learned about assuming production matches its migrations. This records what production actually
// has.
//
// **Bytes are deliberately NOT here.** Backing up object bytes is a different commitment — it is
// unbounded, it costs egress on the free tier, and every artifact this repository uploads must be
// treated as public. Deferred, and recorded as deferred on #401.
//
// Read-only: two SELECTs. Writes one file and prints counts only — never the SQL, because this
// runs in a job whose log is public.

import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ATTACHMENTS_BUCKET = 'attachments'

export const BUCKET_QUERY = `
select id,
       name,
       public,
       file_size_limit,
       to_jsonb(allowed_mime_types) as allowed_mime_types
  from storage.buckets
 where id = '${ATTACHMENTS_BUCKET}'
`

// `pg_policies` renders `qual` and `with_check` already expanded, which is what makes this
// reconstructable at all. Roles come back as a `name[]`; cast so the shape does not depend on how
// the transport decodes a Postgres array.
export const POLICY_QUERY = `
select policyname,
       permissive,
       to_jsonb(roles) as roles,
       cmd,
       qual,
       with_check
  from pg_policies
 where schemaname = 'storage'
   and tablename = 'objects'
 order by policyname
`

/** A SQL string literal. Doubling the quote is the whole escape rule for a standard-conforming string. */
const literal = (value) => `'${String(value).replace(/'/g, "''")}'`

/** An identifier. Always quoted: a policy name is free text and may contain anything. */
const ident = (value) => `"${String(value).replace(/"/g, '""')}"`

function renderBucket(row) {
  const mimeTypes = row.allowed_mime_types
  const mimeLiteral =
    mimeTypes === null || mimeTypes === undefined
      ? 'null'
      : `array[${mimeTypes.map(literal).join(', ')}]::text[]`
  // `on conflict do update`, exactly as the migration does and for the same reason: a bucket that
  // already exists — dashboard-created, possibly public, possibly unrestricted — must be converged
  // rather than kept, or the policies below are applied to a bucket whose own config contradicts
  // them.
  return [
    `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)`,
    `values (${literal(row.id)}, ${literal(row.name)}, ${row.public}, ${row.file_size_limit ?? 'null'}, ${mimeLiteral})`,
    `on conflict (id) do update set`,
    `  public = excluded.public,`,
    `  file_size_limit = excluded.file_size_limit,`,
    `  allowed_mime_types = excluded.allowed_mime_types;`,
  ].join('\n')
}

function renderPolicy(row) {
  const parts = [
    `create policy ${ident(row.policyname)} on storage.objects`,
    `  as ${row.permissive === 'RESTRICTIVE' ? 'restrictive' : 'permissive'}`,
    `  for ${String(row.cmd).toLowerCase()}`,
  ]
  const roles = row.roles ?? []
  // No roles at all would mean PUBLIC. Emitting `to` with an empty list is a syntax error, so the
  // clause is omitted — which reproduces PUBLIC, faithfully. A policy like that is a finding
  // (#397 fails on it), and a backup's job is to record what is there, not to quietly improve it.
  if (roles.length > 0) parts.push(`  to ${roles.map(ident).join(', ')}`)
  if (row.qual) parts.push(`  using (${row.qual})`)
  if (row.with_check) parts.push(`  with check (${row.with_check})`)
  return `drop policy if exists ${ident(row.policyname)} on storage.objects;\n${parts.join('\n')};`
}

/**
 * Render the whole file. Pure, so it is unit-tested without a database or a network.
 *
 * Throws rather than writing a file that would restore a broken boundary. A backup step that
 * succeeds while capturing nothing is the failure this workflow's own comments keep warning about:
 * it stays green for months and is discovered during an outage.
 */
export function renderStorageMetadata(buckets, policies) {
  if (buckets.length === 0) {
    throw new Error(`storage.buckets has no '${ATTACHMENTS_BUCKET}' row — nothing to back up.`)
  }
  if (policies.length === 0) {
    throw new Error('storage.objects has no policies — refusing to record an open bucket as backed up.')
  }
  return [
    '-- Attachments storage metadata (#401). Generated by scripts/dump-storage-metadata.mjs.',
    '-- The bucket configuration and the storage.objects policies, read from production.',
    '-- NOT the object bytes: those are in no backup, and a restore loses every attached file.',
    '-- Apply AFTER schema.sql and data.sql; storage.buckets and storage.objects are provisioned',
    '-- by the Supabase platform, so these statements assume those tables already exist.',
    '',
    ...buckets.map(renderBucket),
    '',
    ...policies.map(renderPolicy),
    '',
  ].join('\n')
}

async function queryProduction(query) {
  const { SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID } = process.env
  if (!SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_ID) {
    throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_ID are required.')
  }
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, read_only: true }),
    },
  )
  if (!response.ok) {
    // Never echo the body: it is an API error, but this runs beside production credentials.
    throw new Error(`Management API query failed with ${response.status}`)
  }
  const rows = await response.json()
  if (!Array.isArray(rows)) throw new Error('Unexpected Management API response shape.')
  return rows
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2]
  if (!out) throw new Error('usage: dump-storage-metadata.mjs <output-path>')
  const [buckets, policies] = await Promise.all([
    queryProduction(BUCKET_QUERY),
    queryProduction(POLICY_QUERY),
  ])
  writeFileSync(out, renderStorageMetadata(buckets, policies), 'utf8')
  // Counts only. The SQL itself is never printed: this job's log is public.
  console.log(`Captured ${buckets.length} bucket and ${policies.length} storage.objects policies.`)
}
