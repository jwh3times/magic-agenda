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
- `research/` — dated investigations answering a question at a point in time. Same lifecycle: a
  research note records what was true when it was written and is superseded by later work rather
  than edited to stay current.

**Living — keep current.**

- `agents/` — the area guides `AGENTS.md` points at, plus the process docs the engineering skills
  read (issue tracker, triage labels, domain docs, human follow-up). Each guide is the **canonical**
  account of its area, not a summary of one: `AGENTS.md` holds what applies to every change and
  delegates the rest here. Change an area, change its guide in the same PR.
- `runbooks/` — operational procedures you follow when something has gone wrong, or is about to.
  These are undated and **must** track the current system: a stale runbook is worse than none,
  because it is trusted under pressure. If you change what a runbook describes, change the runbook
  in the same PR.
- `adr/` — architecture decision records: numbered, permanent notes on decisions that are hard to
  reverse and surprising without their rationale. Unlike a plan, an ADR is not superseded by the
  code moving on; it is superseded only by another ADR that says so.

Living documentation lives at the repository root: [README.md](../README.md) (humans, setup,
deployment), [AGENTS.md](../AGENTS.md) (coding agents — the map; `CLAUDE.md` imports it, and its
area guides are in [agents/](agents/)),
[CONTEXT.md](../CONTEXT.md) (the domain glossary — the words to use for domain concepts in issues,
comments, and product copy), [CHANGELOG.md](../CHANGELOG.md) (shipped work), and
[CONTRIBUTING.md](../CONTRIBUTING.md) (workflow and standards).

Planned work is **not** documented in this repository: it lives in GitHub Issues, with
[ROADMAP.md](../ROADMAP.md) as a pointer to the queue and the project board.
