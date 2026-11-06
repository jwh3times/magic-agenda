# Triage Labels

The labels and what they mean are in `.agents/skills/ship/settings/triage-labels.md`. A skill's role name is the GitHub label to apply.

## Extra labels

- `deferred`: decided, and deliberately not now. It replaces `ready-for-agent` or `ready-for-human`.
- `blocked`: cannot progress until a condition outside the issue is met. It sits beside `deferred`,
  `needs-info` or `ready-for-human`, and never beside `ready-for-agent`.

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

## `blocked`, and how it differs from `deferred`

Added 2026-11-06, at the maintainer's request, during a refresh of the board. Before it, the only
record of which issues could not move was the board's `Gate` column. The board is private, and
`gh issue list` can't see it. The refresh found that **every open issue was blocked**, and that the
only work anyone could start sat in board drafts, which no label query reaches either.

The labels answer different questions. `deferred` records a decision: not now. `needs-info` records
missing evidence. `ready-for-human` says who does the work. `blocked` says the issue **cannot
progress** until a condition is met, whoever that condition belongs to: a purchase, an upstream
release, a piece of hardware, a report from real use. In practice every `deferred` issue is also
`blocked`. The label adds the `needs-info` and `ready-for-human` issues that are waiting too, and it
gives all of them one query.

**Applying it:**

- Add `blocked` whenever the board `Gate` is anything other than `Nothing — ready to work`, and
  remove it in the same pass that clears the Gate. The two say the same thing in two places, so they
  must move together.
- Name the condition in the issue body or a dated comment, as **Unblocks when:**.
- Beside `ready-for-human`, it means the human step is defined but its precondition is missing, such
  as a device nobody has yet. The [human follow-up workflow](human-follow-up.md) still requires
  `ready-for-human` on such an issue.
- Never put it beside `ready-for-agent`. That label promises the issue can be picked up now. If a
  ready issue becomes blocked, swap `ready-for-agent` for `deferred` or `needs-info`.

**What can be picked up now** is `ready-for-agent` without `blocked`:
`gh issue list --label ready-for-agent --search "-label:blocked"`. Run it in both repositories, since
the private companion carries the same labels.
