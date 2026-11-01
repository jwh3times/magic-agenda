# Triage Labels

The labels and what they mean are in `.agents/skills/ship/settings/triage-labels.md`. A skill's role name is the GitHub label to apply.

## Extra labels

- `deferred`: decided, and deliberately not now. It replaces `ready-for-agent` or `ready-for-human`.

## `deferred`, and why the five were not enough

Added 2026-09-22 (#414). **A decided-but-not-now issue matched no label query at all**, and that is
a common state here rather than a rare one: work that is expected, has been triaged, and cannot be
started yet.

None of the five fits it. `wontfix` is wrong because the work _is_ expected. `needs-triage` is wrong
because it has been triaged. `ready-for-agent` is actively harmful — it promises a queue reader a
resolution the issue does not contain, and the 2026-09-20 label audit did exactly that to two
issues, after which three consecutive sessions each rediscovered the mistake before doing any work.

The workaround until now was to carry **no** triage label and rely on the board's `Gate` field plus a
GitHub dependency edge. The Gate and the edge are still the right place for _why_ something is
deferred and _what_ unblocks it — `deferred` does not replace them. What it adds is that the state is
visible to `gh issue list --label deferred`, which "no label" never was. An invisible state is how a
deferred issue gets lost, and this label exists so that losing it takes an act rather than an
oversight.

**Applying it:** `deferred` replaces `ready-for-agent` or `ready-for-human`, never accompanies them —
both of those mean "someone can pick this up now", which is the claim being withdrawn. Record the
reason and the reopen conditions in the issue body or a dated comment, set the board `Gate`, and add
a real dependency edge when another item unblocks it. Remove `deferred` when it becomes startable;
nothing prunes it automatically.
