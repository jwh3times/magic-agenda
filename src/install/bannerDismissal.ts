// Per-device memory that the install suggestion on the Board was dismissed. Cleared from the
// SIGNED_OUT block with everything else, because that block promises everything, so the suggestion
// can come back after the next sign-in (#568).
const KEY = 'ma-install-banner-dismissed'

export function readInstallBannerDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}

export function writeInstallBannerDismissed(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // best-effort, like every other storage access here
  }
}

export function clearInstallBannerDismissed(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
