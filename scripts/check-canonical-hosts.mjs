import { pathToFileURL } from 'node:url'

/** Read-only live checks. Synthetic auth query values are never redeemed (HEAD, no browser). */
export async function checkCanonicalHosts(previewUrl, fetchImpl = fetch) {
  const preview = new URL(previewUrl)
  if (
    preview.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.magic-agenda\.pages\.dev$/.test(preview.hostname) ||
    preview.username ||
    preview.password ||
    preview.port
  ) {
    throw new Error('Provide an HTTPS Magic Agenda preview URL, not the production Pages alias.')
  }
  const paths = [
    '/',
    '/settings',
    '/auth/callback?code=canonical-host-probe',
    '/auth/reset?token_hash=canonical-host-probe&type=recovery',
    '/auth/confirm?token_hash=canonical-host-probe&type=signup',
  ]
  for (const path of paths) {
    for (const origin of ['https://www.magicagenda.app', 'https://magic-agenda.pages.dev']) {
      const response = await fetchImpl(origin + path, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      })
      if (
        response.status !== 301 ||
        response.headers.get('location') !== 'https://magicagenda.app' + path
      ) {
        throw new Error(`Canonical redirect failed for ${origin}${path}: status ${response.status}`)
      }
    }
    for (const origin of ['https://magicagenda.app', preview.origin]) {
      const response = await fetchImpl(origin + path, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      })
      if (response.status !== 200 || response.headers.has('location'))
        throw new Error(
          `Expected direct app response for ${origin}${path}: status ${response.status}`,
        )
    }
  }
  return paths.length * 4
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const count = await checkCanonicalHosts(process.argv[2])
    console.log(`Passed ${count} live canonical-host checks (paths, auth queries, apex, preview).`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
