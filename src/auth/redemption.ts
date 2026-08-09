import { useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthProvider'
import type { RedeemType } from './authGateway'
import type { AuthFailure, AuthOutcome } from './authOutcome'

/**
 * What to do about an emailed `token_hash`.
 *
 * Pure, total, and the single home of the session-fixation guard. Before the auth seam this rule
 * had three encodings — a silent early return in `ResetPassword`, a latched `refused` state in
 * `AuthConfirm` behind an eslint-disable, and a third `session && redeemed` check for the
 * post-redeem redirect — which is how `ResetPassword` ended up telling a signed-in user with no
 * link at all that their "reset link wasn't used".
 *
 * **The clause order is the security property.** `hasSession` is tested before `tokenHash`, so an
 * existing session always wins and a valid token is never redeemed over it. That is what removes
 * the replace-a-real-session variant of the fixation finding in the 2026-07-25 security review.
 * Reordering these two lines silently reopens it, which is why `redemption.test.ts` asserts the
 * refusal for a *valid* token specifically.
 */
export type RedeemDecision =
  | { kind: 'wait' }
  | { kind: 'redeem'; tokenHash: string }
  | { kind: 'refuse'; hadToken: boolean }
  | { kind: 'idle' }

export function redeemDecision(input: {
  /** Auth state is still resolving; deciding now could refuse against a session that isn't loaded. */
  loading: boolean
  hasSession: boolean
  /** Empty string counts as absent — see `readTokenHash`. */
  tokenHash: string | null
}): RedeemDecision {
  if (input.loading) return { kind: 'wait' }
  if (input.hasSession) return { kind: 'refuse', hadToken: Boolean(input.tokenHash) }
  if (!input.tokenHash) return { kind: 'idle' }
  return { kind: 'redeem', tokenHash: input.tokenHash }
}

/**
 * Reads the token out of the query string, normalizing `?token_hash=` (which `URLSearchParams.get`
 * reports as `''`, not `null`) to absent.
 *
 * Without this the empty string is truthy in one place and falsy in another: `hadToken` would say
 * a link was present while the decision said it wasn't, and the refusal card would claim a reset
 * link "wasn't used" when the URL carried no usable token at all.
 */
export function readTokenHash(search: string): string | null {
  const raw = new URLSearchParams(search).get('token_hash')
  return raw ? raw : null
}

export type RedemptionStatus =
  /** Auth state still loading. */
  | 'waiting'
  /** A redemption is in flight. */
  | 'redeeming'
  /** An existing session; nothing was redeemed. Check `hadToken` for which copy to show. */
  | 'refused'
  /** The redemption resolved with a failure. Check `failure.reason`. */
  | 'failed'
  /** The redemption succeeded. */
  | 'done'
  /** Nothing to do — no token and no session. */
  | 'idle'

export interface Redemption {
  status: RedemptionStatus
  failure: AuthFailure | null
  /** Whether the URL carried a usable `token_hash` at mount. Drives copy, not behaviour. */
  hadToken: boolean
  /** This mount is the one redeeming — the post-redeem redirect gate. */
  attempted: boolean
}

/**
 * Drives one emailed-link redemption for a page, exactly once.
 *
 * Two mechanisms, deliberately separate, because they guard different things:
 *
 * - **The decision is latched in state** the first time auth state settles. Without that, our own
 *   successful redemption produces a session, `redeemDecision` recomputes to `refuse`, and the
 *   page flips to "you're already signed in" in the middle of the flow it just completed. Latching
 *   is a render-phase state update (React's documented pattern for deriving state from a change),
 *   not an effect — an effect here would be a `set-state-in-effect` violation and a wasted render.
 * - **A ref guards the redemption itself**, and is read only inside the effect, never during
 *   render. StrictMode runs effect setup → cleanup → setup against the same latched decision, so
 *   without it a single-use token would be spent twice.
 *
 * The token is captured once at mount and scrubbed from the URL before redemption, so a reload
 * cannot replay a spent token and history never holds it.
 */
export function useTokenRedemption(type: RedeemType): Redemption {
  const { session, loading, redeemToken } = useAuth()
  const [tokenHash] = useState(() => readTokenHash(window.location.search))
  const [outcome, setOutcome] = useState<AuthOutcome | null>(null)
  const [decision, setDecision] = useState<RedeemDecision>({ kind: 'wait' })

  const live = redeemDecision({ loading, hasSession: Boolean(session), tokenHash })
  if (decision.kind === 'wait' && live.kind !== 'wait') setDecision(live)

  const redeemedOnce = useRef(false)

  useEffect(() => {
    if (decision.kind !== 'redeem' || redeemedOnce.current) return
    redeemedOnce.current = true
    window.history.replaceState(window.history.state, '', window.location.pathname)
    void redeemToken(decision.tokenHash, type).then(setOutcome)
  }, [decision, redeemToken, type])

  const status: RedemptionStatus =
    outcome !== null
      ? outcome.ok
        ? 'done'
        : 'failed'
      : decision.kind === 'wait'
        ? 'waiting'
        : decision.kind === 'redeem'
          ? 'redeeming'
          : decision.kind === 'refuse'
            ? 'refused'
            : 'idle'

  return {
    status,
    failure: outcome && !outcome.ok ? outcome.failure : null,
    hadToken: tokenHash !== null,
    attempted: decision.kind === 'redeem',
  }
}
