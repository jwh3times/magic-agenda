// @vitest-environment node
import { expect, test } from 'vitest'
import { checkCanonicalHosts } from './check-canonical-hosts.mjs'

const preview = 'https://preview-123.magic-agenda.pages.dev'
const correct = async (url, options) => {
  expect(options.method).toBe('HEAD')
  expect(options.redirect).toBe('manual')
  const u = new URL(url)
  return u.origin === preview || u.origin === 'https://magicagenda.app'
    ? new Response(null, { status: 200 })
    : new Response(null, {
        status: 301,
        headers: { location: 'https://magicagenda.app' + u.pathname + u.search },
      })
}

test('verifies both aliases, exact paths and auth queries without redirecting apex or preview', async () => {
  expect(await checkCanonicalHosts(preview, correct)).toBe(20)
})
test('rejects dropped auth queries', async () => {
  await expect(
    checkCanonicalHosts(preview, async (url, options) => {
      const result = await correct(url, options)
      if (result.status === 301)
        result.headers.set('location', result.headers.get('location').split('?')[0])
      return result
    }),
  ).rejects.toThrow('Canonical redirect failed')
})
test('rejects a wildcard rule that redirects preview deployments', async () => {
  await expect(
    checkCanonicalHosts(preview, async (url, options) =>
      new URL(url).origin === preview
        ? new Response(null, { status: 301, headers: { location: 'https://magicagenda.app/' } })
        : correct(url, options),
    ),
  ).rejects.toThrow('Expected direct app response')
})
test('rejects aliases that still serve the app instead of redirecting', async () => {
  await expect(
    checkCanonicalHosts(preview, async () => new Response(null, { status: 200 })),
  ).rejects.toThrow('Canonical redirect failed')
})
test('refuses the bare Pages alias as a preview test target', async () => {
  await expect(checkCanonicalHosts('https://magic-agenda.pages.dev', correct)).rejects.toThrow(
    'preview URL',
  )
})
