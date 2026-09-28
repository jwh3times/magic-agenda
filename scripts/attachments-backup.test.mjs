// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  STORAGE_PATH,
  backupAttachments,
  selectServiceKey,
  storageHeaders,
} from './backup-attachments.mjs'
import { restoreAttachments, verifyBundle } from './restore-attachments.mjs'

/**
 * The attachment-bytes half of the nightly backup (#411), round-tripped end to end against fakes:
 * production storage -> bundle directory -> verify -> a rebuilt project's storage. What matters is
 * that each stage refuses rather than records a file it did not faithfully capture or restore.
 */

const B = '11111111-1111-4111-8111-111111111111'
const T = '22222222-2222-4222-8222-222222222222'
const path = (n) => `${B}/${T}/3333333${n}-3333-4333-8333-333333333333`

const bytesOf = (text) => new TextEncoder().encode(text)
const production = new Map([
  [path(1), bytesOf('a png, notionally')],
  [path(2), bytesOf('a pdf, somewhat longer than the png')],
])
const objects = [...production].map(([name, bytes]) => ({
  name,
  size: String(bytes.byteLength), // the Management API returns bigint as a string
  mime_type: 'image/png',
}))
const rows = objects.map((o) => ({ storage_path: o.name }))

const dirs = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'attachments-backup-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fromProduction = async (name) => production.get(name)

describe('backupAttachments', () => {
  test('writes every object at its storage path, with a manifest that verifies', async () => {
    const outDir = tempDir()
    const result = await backupAttachments({ objects, rows, download: fromProduction, outDir })

    expect(result).toEqual({
      objectCount: 2,
      totalBytes: 17 + 35,
      rowsWithoutObject: 0,
      rowCount: 2,
      vanished: 0,
      offShape: 0,
      unsized: 0,
    })
    expect(readFileSync(join(outDir, 'objects', B, T, path(1).split('/')[2]), 'utf8')).toBe(
      'a png, notionally',
    )
    expect(verifyBundle(outDir).object_count).toBe(2)
  })

  test('retries a short read, then refuses to record a truncated file', async () => {
    let calls = 0
    const flaky = async (name) =>
      ++calls === 1 ? production.get(name).slice(0, 3) : production.get(name)
    const outDir = tempDir()
    await backupAttachments({
      objects: objects.slice(0, 1),
      rows,
      download: flaky,
      outDir,
      backoffMs: 0,
    })
    expect(calls).toBe(2)

    const truncated = async (name) => production.get(name).slice(0, 3)
    await expect(
      backupAttachments({
        objects,
        rows,
        download: truncated,
        outDir: tempDir(),
        attempts: 2,
        backoffMs: 0,
      }),
    ).rejects.toThrow(/Object 1 of 2 failed after 2 attempts: read 3 of 17 bytes/)
  })

  test('skips, never writes, an object name outside the generated path shape', async () => {
    const outDir = tempDir()
    const odd = [
      '../../etc/passwd',
      `${B}/${T}`,
      `/${path(1)}`,
      `${path(1)}/x`,
      `${B}/.emptyFolderPlaceholder`,
    ]
    const result = await backupAttachments({
      objects: [...odd.map((name) => ({ name, size: '1', mime_type: null })), objects[0]],
      rows: [],
      download: fromProduction,
      outDir,
    })
    expect(result).toMatchObject({ objectCount: 1, offShape: odd.length })
    expect(verifyBundle(outDir).objects.map((o) => o.path)).toEqual([path(1)])
    expect(STORAGE_PATH.test(path(1))).toBe(true)
  })

  test('skips an object with no size in its metadata rather than reading null as 0 bytes', async () => {
    for (const size of [null, undefined, '', 'abc', '-1']) {
      const result = await backupAttachments({
        objects: [{ name: path(1), size, mime_type: null }],
        rows: [],
        download: fromProduction,
        outDir: tempDir(),
      })
      expect(result).toMatchObject({ objectCount: 0, unsized: 1 })
    }
  })

  test('an object deleted mid-run is left out, not a failed backup', async () => {
    const outDir = tempDir()
    const gone = async (name) => {
      if (name === path(2)) throw new Error('download failed with 400')
      return production.get(name)
    }
    const result = await backupAttachments({
      objects,
      rows,
      download: gone,
      stillExists: async (name) => name !== path(2),
      outDir,
      backoffMs: 0,
    })
    expect(result).toMatchObject({ objectCount: 1, vanished: 1, rowsWithoutObject: 1 })
    expect(verifyBundle(outDir).object_count).toBe(1)
  })

  test('an object that still exists but will not download fails the backup', async () => {
    const broken = async () => {
      throw new Error('download failed with 503')
    }
    await expect(
      backupAttachments({ objects, rows, download: broken, outDir: tempDir(), backoffMs: 0 }),
    ).rejects.toThrow(/failed after 3 attempts: download failed with 503/)
  })

  test('waits longer before each retry', async () => {
    let calls = 0
    const times = []
    const flaky = async (name) => {
      times.push(Date.now())
      return ++calls < 3 ? new Uint8Array(0) : production.get(name)
    }
    await backupAttachments({
      objects: objects.slice(0, 1),
      rows: [],
      download: flaky,
      outDir: tempDir(),
      backoffMs: 40,
    })
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(35)
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(75)
  })

  test('counts rows whose object is missing without failing the backup', async () => {
    const result = await backupAttachments({
      objects: objects.slice(0, 1),
      rows,
      download: fromProduction,
      outDir: tempDir(),
    })
    expect(result.rowsWithoutObject).toBe(1)
  })

  test('an empty bucket still produces a manifest that verifies', async () => {
    const outDir = tempDir()
    await backupAttachments({ objects: [], rows: [], download: fromProduction, outDir })
    expect(verifyBundle(outDir)).toMatchObject({ object_count: 0, total_bytes: 0 })
  })
})

describe('verifyBundle', () => {
  const bundle = async () => {
    const dir = tempDir()
    await backupAttachments({ objects, rows, download: fromProduction, outDir: dir })
    return dir
  }

  test('refuses an altered file', async () => {
    const dir = await bundle()
    const file = join(dir, 'objects', ...path(1).split('/'))
    writeFileSync(file, 'A png, notionally') // same length, different bytes
    expect(() => verifyBundle(dir)).toThrow(/Object 1 of 2 does not match its hash/)
  })

  test('refuses a missing file', async () => {
    const dir = await bundle()
    rmSync(join(dir, 'objects', ...path(2).split('/')))
    expect(() => verifyBundle(dir)).toThrow(/Object 2 of 2 is missing/)
  })

  test('refuses a file the manifest does not list', async () => {
    const dir = await bundle()
    mkdirSync(join(dir, 'objects', 'extra'), { recursive: true })
    writeFileSync(join(dir, 'objects', 'extra', 'file'), 'x')
    expect(() => verifyBundle(dir)).toThrow(/1 files in the bundle are not in the manifest/)
  })

  test('refuses a bundle with no manifest', () => {
    expect(() => verifyBundle(tempDir())).toThrow(/manifest.json is missing/)
  })
})

describe('restoreAttachments', () => {
  const fakeStorage = ({ corrupt = false } = {}) => {
    const store = new Map()
    return {
      store,
      async upload(name, bytes, mimeType) {
        store.set(name, { bytes: new Uint8Array(bytes), mimeType })
      },
      async download(name) {
        const bytes = store.get(name).bytes
        return corrupt ? bytes.slice(1) : bytes
      },
    }
  }

  test('uploads every object at its original path and reads each back', async () => {
    const dir = tempDir()
    await backupAttachments({ objects, rows, download: fromProduction, outDir: dir })
    const storage = fakeStorage()

    expect(await restoreAttachments({ dir, storage })).toEqual({ objectCount: 2, totalBytes: 52 })
    for (const [name, bytes] of production) {
      expect(storage.store.get(name)).toEqual({ bytes, mimeType: 'image/png' })
    }
  })

  test('fails when the read-back does not match, rather than reporting success', async () => {
    const dir = tempDir()
    await backupAttachments({ objects, rows, download: fromProduction, outDir: dir })
    await expect(
      restoreAttachments({
        dir,
        storage: fakeStorage({ corrupt: true }),
        attempts: 2,
        backoffMs: 0,
      }),
    ).rejects.toThrow(/failed after 2 attempts: read-back hash does not match/)
  })

  test('verifies the bundle before writing anything', async () => {
    const dir = tempDir()
    await backupAttachments({ objects, rows, download: fromProduction, outDir: dir })
    rmSync(join(dir, 'objects', ...path(1).split('/')))
    const storage = fakeStorage()
    await expect(restoreAttachments({ dir, storage })).rejects.toThrow(/missing/)
    expect(storage.store.size).toBe(0)
  })
})

describe('service key selection', () => {
  test('prefers a new-style secret key over the legacy service_role key', () => {
    const key = selectServiceKey([
      { name: 'anon', api_key: 'anon-jwt' },
      { name: 'service_role', api_key: 'service-jwt' },
      { name: 'default', type: 'secret', api_key: 'sb_secret_x' },
    ])
    expect(key).toEqual({ key: 'sb_secret_x', legacy: false })
  })

  test('falls back to the legacy service_role key, sent as a bearer token too', () => {
    const key = selectServiceKey([
      { name: 'anon', api_key: 'anon-jwt' },
      { name: 'service_role', api_key: 'service-jwt' },
    ])
    expect(key).toEqual({ key: 'service-jwt', legacy: true })
    expect(storageHeaders(key)).toEqual({
      apikey: 'service-jwt',
      Authorization: 'Bearer service-jwt',
    })
  })

  test('a new-style secret key is not a JWT and goes in apikey only', () => {
    const key = selectServiceKey([{ name: 'default', type: 'secret', api_key: 'sb_secret_x' }])
    expect(storageHeaders(key)).toEqual({ apikey: 'sb_secret_x' })
  })

  test('never selects the anon key', () => {
    expect(() => selectServiceKey([{ name: 'anon', api_key: 'anon-jwt' }])).toThrow(
      /No service_role or secret API key/,
    )
  })
})
