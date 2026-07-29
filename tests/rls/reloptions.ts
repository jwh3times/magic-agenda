/**
 * Does a relation's `reloptions` array mark it `security_invoker`?
 *
 * Split into its own module so it can be tested directly. There are no views in `public` today,
 * so the definer-view assertion in structure.test.ts runs over an EMPTY SET -- it would never
 * execute this parsing, which is the one piece of logic standing between a definer view and the
 * Data API the day someone adds one. Same reasoning as `src/sw/policy.ts`: pulling the pure
 * predicate out is what makes the rule testable at all.
 *
 * `reloptions` stores the spelling used at DDL time, so `security_invoker = on` is exactly as
 * safe as `security_invoker=true`. Anything unrecognised is treated as NOT invoker, which fails
 * safe: the view is flagged for a human to look at rather than silently trusted.
 */
const TRUTHY = new Set(['true', 'on', 'yes', '1'])

export function isSecurityInvoker(options: string[] | null): boolean {
  return (options ?? []).some((o) => {
    const [key, value] = o.split('=')
    return key.trim() === 'security_invoker' && TRUTHY.has((value ?? '').trim().toLowerCase())
  })
}
