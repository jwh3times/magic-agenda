# Roadmap

**Planned work lives in GitHub Issues, not in this file.**

Every unbuilt item is an open issue carrying its own implementation sketch — approach, schema,
tests, and the risks worth knowing before starting. Ordering, priority, and size live on the
project board as fields rather than as prose that has to be rewritten whenever something ships.

- **[Open issues](https://github.com/jwh3times/magic-agenda/issues)** — the queue.
- **[Magic Agenda project board](https://github.com/users/jwh3times/projects/5)** — the same issues
  with `Phase`, `Priority` (P1 near-term / P2 medium / P3 nice-to-have), `Size` (S ≤ half a day /
  M 1–2 days / L 3–5 days / XL 1–2 weeks+), and `Status`. Private, and it also carries the
  maintainer-held items that have no public issue.
- **[CHANGELOG.md](./CHANGELOG.md)** — what has already shipped.

Nothing on the board is a commitment or has a date.

## Why this file is a pointer

It used to hold the phase tables, status checkboxes, and per-item sketches directly. That made it a
second copy of state GitHub already tracked authoritatively, and the copy drifted: items stayed
marked in-progress after both of their sub-items had shipped, and the build-order table had to be
hand-edited on every merge. The sketches themselves were worth keeping — they are now issue bodies,
which is where they get read at the moment someone builds the thing.

The general rule this follows: **state goes in GitHub, reasoning stays in files.** An issue has a
closed state and a dependency graph; a Markdown checkbox has neither. Durable reasoning that is
never "done" — the domain glossary, architecture decisions, operational procedure — stays in
[CONTEXT.md](./CONTEXT.md), [docs/adr/](./docs/adr/), and [docs/runbooks/](./docs/runbooks/).

## Ordering

Dependencies are recorded as GitHub's native **blocked-by** edges, so a blocked issue shows its
open blockers in the UI and the board can be filtered on them. There is no ordering to maintain
here.

Phase groupings are historical and describe how the work was originally sequenced; they are a
label on the board, not a gate. Phases 0–2 shipped in July 2026 and no longer appear.

## Conventions

Everything that used to be restated here — one PR per item, migrations landing before the client
that needs them, RLS as the only authorization boundary, test-first for pure logic, optimistic
writes with rollback, the recurrence invariants — is in [AGENTS.md](./AGENTS.md), which is the
canonical guide and is kept current with the code. Read it before starting an item rather than
trusting a summary that can go stale.
