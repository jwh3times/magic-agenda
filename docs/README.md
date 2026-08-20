# docs/

Mostly historical planning artifacts, plus one directory that is the opposite — read the distinction
before editing anything here.

**Historical — not living documentation.** Dated point-in-time records, kept to show how something
was built. Do not update them to match current code.

- `plans/` — dated, self-contained implementation plans for work that has since shipped. Each is a
  point-in-time record: checkboxes, commands, and constraints reflect when the plan was written, and
  some guidance was superseded by later plans. They are kept as a record of how features were built,
  not updated to match current code.
- `specs/` — dated design specs that preceded those plans, same lifecycle.

**Living — keep current.**

- `runbooks/` — operational procedures you follow when something has gone wrong, or is about to.
  These are undated and **must** track the current system: a stale runbook is worse than none,
  because it is trusted under pressure. If you change what a runbook describes, change the runbook
  in the same PR.
- `adr/` — architecture decision records: numbered, permanent notes on decisions that are hard to
  reverse and surprising without their rationale. Unlike a plan, an ADR is not superseded by the
  code moving on; it is superseded only by another ADR that says so.

Living documentation lives at the repository root: [README.md](../README.md) (humans, setup,
deployment), [AGENTS.md](../AGENTS.md) (coding agents — canonical; `CLAUDE.md` imports it),
[CONTEXT.md](../CONTEXT.md) (the domain glossary — the words to use for domain concepts in issues,
comments, and product copy), [ROADMAP.md](../ROADMAP.md) (planned work),
[CHANGELOG.md](../CHANGELOG.md) (shipped work), and [CONTRIBUTING.md](../CONTRIBUTING.md) (workflow
and standards).
