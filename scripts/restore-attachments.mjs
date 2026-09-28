#!/usr/bin/env node
// Put a backup bundle's attachment files back into a rebuilt project (#411), or verify that a
// bundle carries what that would need.
//
//   node scripts/restore-attachments.mjs --verify-only <bundle>/attachments
//   RESTORE_SUPABASE_URL=https://<ref>.supabase.co RESTORE_SERVICE_KEY=<key> \
//     node scripts/restore-attachments.mjs <bundle>/attachments
//
// **Verify** re-hashes every file against `manifest.json` and refuses a bundle with a missing,
// short, altered, or unlisted file. The nightly job runs it on the decrypted round trip, so an
// uploaded bundle is known to hold every object it claims, byte for byte.
//
// **Restore** verifies first, then uploads each object to the `attachments` bucket at its original
// path -- `task_attachments.storage_path` is generated from ids, so `data.sql`'s rows already
// expect exactly these paths -- and then downloads each one back and compares its hash. A restore
// that only reports "uploaded" is the exists-but-unverified shape the backup job keeps warning
// about. Uploads use the service key and bypass the quota command deliberately: these bytes
// were already admitted once, and the rows that count against quota come back with `data.sql`.
//
// Run it AFTER `storage.sql`: the bucket must exist, private, before anything is written into it.
// Idempotent: uploads upsert, so a rerun after a partial failure converges.
//
// Prints counts only, never paths, matching the backup job's log rule.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ATTACHMENTS_BUCKET, STORAGE_PATH, sha256 } from './backup-attachments.mjs'

function listFiles(root) {
  if (!existsSync(root)) return []
  const out = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    if (statSync(full).isDirectory()) out.push(...listFiles(full))
    else out.push(full)
  }
  return out
}

/** Check every file against the manifest. Returns the manifest; throws on any discrepancy. */
export function verifyBundle(dir) {
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error('manifest.json is missing from the bundle.')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.format !== 1 || !Array.isArray(manifest.objects)) {
    throw new Error('manifest.json has an unrecognized format.')
  }
  if (manifest.objects.length !== manifest.object_count) {
    throw new Error(
      `manifest.json lists ${manifest.objects.length} objects but records ${manifest.object_count}.`,
    )
  }

  const listed = new Set()
  let total = 0
  for (const [index, entry] of manifest.objects.entries()) {
    const label = `Object ${index + 1} of ${manifest.objects.length}`
    if (!STORAGE_PATH.test(entry.path)) throw new Error(`${label} has an invalid path.`)
    const file = join(dir, 'objects', ...entry.path.split('/'))
    if (!existsSync(file)) throw new Error(`${label} is missing from the bundle.`)
    const bytes = readFileSync(file)
    if (bytes.byteLength !== entry.size) {
      throw new Error(`${label} is ${bytes.byteLength} bytes; the manifest records ${entry.size}.`)
    }
    if (sha256(bytes) !== entry.sha256) throw new Error(`${label} does not match its hash.`)
    listed.add(entry.path)
    total += entry.size
  }
  if (total !== manifest.total_bytes) {
    throw new Error(`Objects total ${total} bytes; the manifest records ${manifest.total_bytes}.`)
  }

  const unlisted = listFiles(join(dir, 'objects')).filter(
    (file) => !listed.has(relative(join(dir, 'objects'), file).split(sep).join('/')),
  ).length
  if (unlisted > 0) throw new Error(`${unlisted} files in the bundle are not in the manifest.`)
  return manifest
}

/**
 * Upload every object, then read each back and compare hashes. `storage` is injected so the whole
 * flow is tested against a fake; the CLI below wires it to the Storage API.
 */
export async function restoreAttachments({
  dir,
  storage,
  concurrency = 4,
  attempts = 3,
  backoffMs = 2000,
}) {
  const manifest = verifyBundle(dir)
  const objects = manifest.objects
  let next = 0
  async function worker() {
    while (next < objects.length) {
      const index = next++
      const entry = objects[index]
      const bytes = readFileSync(join(dir, 'objects', ...entry.path.split('/')))
      let lastError
      let done = false
      for (let attempt = 1; attempt <= attempts && !done; attempt++) {
        if (attempt > 1) await new Promise((r) => setTimeout(r, backoffMs * (attempt - 1)))
        try {
          await storage.upload(entry.path, bytes, entry.mime_type)
          const back = await storage.download(entry.path)
          if (sha256(back) !== entry.sha256) throw new Error('read-back hash does not match')
          done = true
        } catch (error) {
          lastError = error
        }
      }
      if (!done) {
        throw new Error(
          `Object ${index + 1} of ${objects.length} failed after ${attempts} attempts: ${lastError?.message ?? lastError}`,
        )
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, objects.length) }, worker))
  return { objectCount: objects.length, totalBytes: manifest.total_bytes }
}

/** The Storage API, for a project URL and a service key (legacy JWT or new-style secret). */
export function storageApi(baseUrl, key) {
  const headers = key.startsWith('sb_')
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` }
  const url = (path) =>
    `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/${ATTACHMENTS_BUCKET}/${path}`
  return {
    async upload(path, bytes, mimeType) {
      const response = await fetch(url(path), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': mimeType ?? 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: bytes,
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) throw new Error(`upload failed with ${response.status}`)
    },
    async download(path) {
      const response = await fetch(url(path), { headers, signal: AbortSignal.timeout(120_000) })
      if (!response.ok) throw new Error(`read-back failed with ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const verifyOnly = args[0] === '--verify-only'
  const dir = verifyOnly ? args[1] : args[0]
  if (!dir) {
    throw new Error('usage: restore-attachments.mjs [--verify-only] <bundle>/attachments')
  }
  if (verifyOnly) {
    const manifest = verifyBundle(dir)
    console.log(
      `Verified ${manifest.object_count} attachment objects (${manifest.total_bytes} bytes) against the manifest.`,
    )
  } else {
    const { RESTORE_SUPABASE_URL, RESTORE_SERVICE_KEY } = process.env
    if (!RESTORE_SUPABASE_URL || !RESTORE_SERVICE_KEY) {
      throw new Error('RESTORE_SUPABASE_URL and RESTORE_SERVICE_KEY are required.')
    }
    const result = await restoreAttachments({
      dir,
      storage: storageApi(RESTORE_SUPABASE_URL, RESTORE_SERVICE_KEY),
    })
    console.log(
      `Restored and read back ${result.objectCount} attachment objects (${result.totalBytes} bytes).`,
    )
  }
}
