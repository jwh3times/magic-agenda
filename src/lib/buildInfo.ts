/** Resolved by `scripts/build-info.ts` while the bundle is built; see the reasoning there. */
export interface BuildInfo {
  version: string | null
  commit: string | null
}

export const buildInfo: BuildInfo = __BUILD_INFO__

/** What Settings shows, or null when the build knows nothing worth showing. */
export function buildLabel(info: BuildInfo): string | null {
  if (info.version) return info.commit ? `v${info.version} · ${info.commit}` : `v${info.version}`
  return info.commit ? `Build ${info.commit}` : null
}
