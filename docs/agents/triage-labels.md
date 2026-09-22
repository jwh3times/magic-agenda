# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual
label strings used in this repo's issue tracker, and adds **one role of our own** that the five do
not cover.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |
| —                          | `deferred`           | Decided, and deliberately not now        |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label
string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

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
