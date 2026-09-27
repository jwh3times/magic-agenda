import { useFlags } from './useFlags'
import { useRole } from './useRole'

/**
 * Whether the Board-sharing UI is shown (#443): to administrators always, and to everyone once the
 * `board-sharing` flag is enabled.
 *
 * The rollout decided for sharing is "admins first, then everyone", but a feature flag here is
 * global — one `enabled` boolean, no per-account targeting — so the flag alone cannot express the
 * first stage. Showing it to admins unconditionally is that stage: it begins when this ships, the
 * flag is the second stage, and neither needs a code change later.
 *
 * Like every flag, this is UI-only. The commands and policies behind sharing hold for everyone
 * regardless; a non-admin who is invited can accept and use a shared Board before the flag is on,
 * they simply do not see the membership controls yet.
 */
export function useBoardSharing(): boolean {
  const { isAdmin } = useRole()
  const { isEnabled } = useFlags()
  return isAdmin || isEnabled('board-sharing')
}
