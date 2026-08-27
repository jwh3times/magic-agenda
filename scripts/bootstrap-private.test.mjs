import { describe, expect, test } from 'vitest'
import { DEFAULT_OP_REFERENCE, isReportedPrivate, validateCloneUrl } from './bootstrap-private.mjs'

describe('validateCloneUrl', () => {
  test('accepts a github.com HTTPS URL and extracts the slug', () => {
    expect(validateCloneUrl('https://github.com/owner/repo.git')).toEqual({
      ok: true,
      url: 'https://github.com/owner/repo.git',
      slug: 'owner/repo',
    })
    expect(validateCloneUrl('https://github.com/owner/repo').slug).toBe('owner/repo')
    expect(validateCloneUrl('https://GitHub.com/owner/repo/').slug).toBe('owner/repo')
  })

  test('accepts a GitHub SSH URL and extracts the slug', () => {
    expect(validateCloneUrl('git@github.com:owner/some-repo.git')).toEqual({
      ok: true,
      url: 'git@github.com:owner/some-repo.git',
      slug: 'owner/some-repo',
    })
    expect(validateCloneUrl('git@github.com:owner/some-repo').slug).toBe('owner/some-repo')
  })

  test('trims surrounding whitespace, which `op read` may leave', () => {
    expect(validateCloneUrl('  https://github.com/owner/repo\n')).toMatchObject({ ok: true })
  })

  test('refuses an embedded credential -- it would land in .git/config', () => {
    expect(validateCloneUrl('https://user:tok@github.com/owner/repo').ok).toBe(false)
    expect(validateCloneUrl('https://ghp_abc@github.com/owner/repo').ok).toBe(false)
  })

  test('refuses hosts other than github.com, including lookalikes', () => {
    expect(validateCloneUrl('https://gitlab.com/owner/repo').ok).toBe(false)
    expect(validateCloneUrl('https://github.com.evil.example/owner/repo').ok).toBe(false)
    expect(validateCloneUrl('git@github.com.evil.example:owner/repo.git').ok).toBe(false)
  })

  test('refuses plain http', () => {
    expect(validateCloneUrl('http://github.com/owner/repo').ok).toBe(false)
  })

  test('refuses multi-line, empty, and non-string input', () => {
    expect(validateCloneUrl('https://github.com/a/b\nhttps://github.com/c/d').ok).toBe(false)
    expect(validateCloneUrl('').ok).toBe(false)
    expect(validateCloneUrl(undefined).ok).toBe(false)
  })

  test('refuses a URL that is not owner/repo shaped', () => {
    expect(validateCloneUrl('https://github.com/owner').ok).toBe(false)
    expect(validateCloneUrl('https://github.com/owner/repo/tree/main').ok).toBe(false)
  })
})

describe('isReportedPrivate', () => {
  test('only an explicit PRIVATE passes', () => {
    expect(isReportedPrivate('{"nameWithOwner":"o/r","visibility":"PRIVATE"}')).toBe(true)
    expect(isReportedPrivate('{"nameWithOwner":"o/r","visibility":"PUBLIC"}')).toBe(false)
    expect(isReportedPrivate('{"nameWithOwner":"o/r","visibility":"INTERNAL"}')).toBe(false)
    expect(isReportedPrivate('{"nameWithOwner":"o/r"}')).toBe(false)
  })

  test('unparseable output is a refusal, not a pass', () => {
    expect(isReportedPrivate('')).toBe(false)
    expect(isReportedPrivate('gh: not logged in')).toBe(false)
  })
})

test('the default reference names a URL field, not a credential field', () => {
  expect(DEFAULT_OP_REFERENCE).toMatch(/^op:\/\/[^/]+\/[^/]+\/PRIVATE_REPOSITORY_URL$/u)
})
