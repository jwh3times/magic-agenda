import { readTokenHash } from '../auth/tokenCapture'

/** Installs the in-memory side of the head bootstrap for redemption-page tests. */
export function installCapturedAuthToken(tokenHash: string | null): void {
  let captured = tokenHash
  Object.defineProperty(window, '__magicAgendaAuthTokenCapture', {
    configurable: true,
    value: {
      read: () => captured,
      consume: () => {
        captured = null
      },
    },
  })
}

/** Loads a URL through the same capture/scrub boundary that runs before the app in production. */
export function loadCapturedAuthTokenUrl(url: string): void {
  window.history.replaceState(null, '', url)
  const tokenHash = readTokenHash(window.location.search)
  window.history.replaceState(window.history.state, '', window.location.pathname)
  installCapturedAuthToken(tokenHash)
}
