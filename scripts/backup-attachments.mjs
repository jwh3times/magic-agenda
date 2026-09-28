#!/usr/bin/env node
// Copy every object in the attachments bucket into the nightly backup bundle (#411).
//
// **Why now.** #401 put the bucket's configuration and policies in the bundle (`storage.sql`) and
// deferred the bytes. The deferral named its own revisit triggers, and "Boards become shareable
// (#279)" was met: losing your own files is a personal problem, losing files someone else uploaded
// to your Board is not. Option 2 of #411 -- sync the bucket into the nightly bundle -- was chosen
// over separate object storage while the bucket is small.
//
// **What it writes**, under the output directory, which the workflow tars and GPG-encrypts before
// anything leaves the runner:
//
//   objects/<storage_path>   the bytes, at the path `task_attachments.storage_path` generates,
//                            so a restore puts each file exactly where its row expects it
//   manifest.json            path, size, MIME type, and SHA-256 per object, plus totals --
//                            what `restore-attachments.mjs` checks every file against
//
// **Checked here, not just downloaded.** Each download must match the size the object's own
// metadata records; a short read fails the run rather than recording a truncated file as backed
// up. `task_attachments` rows whose object is missing are counted and reported as a warning, not a
// failure: an upload reservation in flight at dump time is legitimate (the row is reserved first,
// then the bytes land), and a missing object is a production fact to surface, not a backup defect.
//
// **Log hygiene.** This job's log is public. It prints counts and byte totals only -- never a
// path, since paths are Board and Task ids -- and the service key it derives is masked.

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const ATTACHMENTS_BUCKET = 'attachments'

/** Half the free tier's 1 GB. Past it, #411's option 3 (separate object storage) is the plan. */
export const SIZE_WARNING_BYTES = 500 * 1024 * 1024

export const OBJECTS_QUERY = `
select name,
       (metadata->>'size')::bigint as size,
       metadata->>'mimetype' as mime_type
  from storage.objects
 where bucket_id = '${ATTACHMENTS_BUCKET}'
 order by name
`

export const ROWS_QUERY = `
select storage_path from public.task_attachments order by storage_path
`

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/**
 * `<board_id>/<task_id>/<attachment_id>`, the only shape the upload command writes. Enforced
 * because the name becomes a file path on the runner and, on restore, an object path: anything
 * else -- `..`, a leading slash, a stray segment -- is refused rather than written somewhere.
 */
export const STORAGE_PATH = new RegExp(`^${UUID}/${UUID}/${UUID}$`)

/**
 * Pick a server-side key from the Management API's `api-keys` response. A new-style `secret` key
 * first -- Supabase is retiring the legacy JWT keys -- and the legacy `service_role` key only when
 * the project has no secret key yet. Never the anon or publishable key.
 */
export function selectServiceKey(keys) {
  if (!Array.isArray(keys)) throw new Error('Unexpected api-keys response shape.')
  const secret = keys.find((k) => k.type === 'secret' && k.api_key)
  if (secret) return { key: secret.api_key, legacy: false }
  const legacy = keys.find((k) => k.name === 'service_role' && k.api_key)
  if (legacy) return { key: legacy.api_key, legacy: true }
  throw new Error('No service_role or secret API key is available for this project.')
}

/** Headers for the Storage API. New-style secret keys are not JWTs and go in `apikey` only. */
export function storageHeaders({ key, legacy }) {
  return legacy ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key }
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * Download every object and write the bundle directory. Pure apart from the injected `download`
 * and the filesystem, so it is tested with a fake download and a temporary directory.
 */
export async function backupAttachments({
  objects,
  rows,
  download,
  outDir,
  concurrency = 4,
  attempts = 3,
}) {
  for (const [index, object] of objects.entries()) {
    if (!STORAGE_PATH.test(object.name)) {
      throw new Error(`Object ${index + 1} has a name outside the attachments path shape.`)
    }
    if (!Number.isSafeInteger(Number(object.size)) || Number(object.size) < 0) {
      throw new Error(`Object ${index + 1} has no usable size in its metadata.`)
    }
  }

  const entries = new Array(objects.length)
  let next = 0
  async function worker() {
    while (next < objects.length) {
      const index = next++
      const object = objects[index]
      const expected = Number(object.size)
      let bytes
      let lastError
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          bytes = await download(object.name)
          if (bytes.byteLength !== expected) {
            throw new Error(`read ${bytes.byteLength} of ${expected} bytes`)
          }
          break
        } catch (error) {
          bytes = undefined
          lastError = error
        }
      }
      if (!bytes) {
        // The index, not the path: this runs in a job whose log is public.
        throw new Error(
          `Object ${index + 1} of ${objects.length} failed after ${attempts} attempts: ${lastError?.message ?? lastError}`,
        )
      }
      const file = join(outDir, 'objects', ...object.name.split('/'))
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, bytes)
      entries[index] = {
        path: object.name,
        size: expected,
        mime_type: object.mime_type ?? null,
        sha256: sha256(bytes),
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, objects.length) }, worker))

  const present = new Set(objects.map((o) => o.name))
  const rowsWithoutObject = rows.filter((r) => !present.has(r.storage_path)).length
  const totalBytes = entries.reduce((sum, e) => sum + e.size, 0)
  const manifest = {
    format: 1,
    bucket: ATTACHMENTS_BUCKET,
    object_count: entries.length,
    total_bytes: totalBytes,
    objects: entries,
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { objectCount: entries.length, totalBytes, rowsWithoutObject, rowCount: rows.length }
}

function requireEnv() {
  const { SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID } = process.env
  if (!SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_ID) {
    throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_ID are required.')
  }
  return { token: SUPABASE_ACCESS_TOKEN, ref: SUPABASE_PROJECT_ID }
}

async function management(path, init = {}) {
  const { token, ref } = requireEnv()
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  // Never echo the body: it sits beside production credentials, and this log is public.
  if (!response.ok) throw new Error(`Management API ${path} failed with ${response.status}`)
  return response.json()
}

async function query(sql) {
  const rows = await management('/database/query', {
    method: 'POST',
    body: JSON.stringify({ query: sql, read_only: true }),
  })
  if (!Array.isArray(rows)) throw new Error('Unexpected Management API response shape.')
  return rows
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = process.argv[2]
  if (!outDir) throw new Error('usage: backup-attachments.mjs <output-dir>')
  const { ref } = requireEnv()

  const serviceKey = selectServiceKey(await management('/api-keys?reveal=true'))
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${serviceKey.key}`)
  const headers = storageHeaders(serviceKey)

  const [objects, rows] = await Promise.all([query(OBJECTS_QUERY), query(ROWS_QUERY)])
  const result = await backupAttachments({
    objects,
    rows,
    outDir,
    async download(path) {
      const response = await fetch(
        `https://${ref}.supabase.co/storage/v1/object/${ATTACHMENTS_BUCKET}/${path}`,
        { headers },
      )
      if (!response.ok) throw new Error(`download failed with ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
  })

  console.log(
    `Captured ${result.objectCount} attachment objects (${result.totalBytes} bytes) for ${result.rowCount} task_attachments rows.`,
  )
  if (result.rowsWithoutObject > 0) {
    console.log(
      `::warning::${result.rowsWithoutObject} task_attachments rows have no object in the bucket -- those files cannot be restored from any backup.`,
    )
  }
  if (result.totalBytes > SIZE_WARNING_BYTES) {
    console.log(
      `::warning::The attachments bucket holds ${result.totalBytes} bytes, past the ${SIZE_WARNING_BYTES}-byte tripwire. Plan #411's option 3 (separate object storage).`,
    )
  }
}
