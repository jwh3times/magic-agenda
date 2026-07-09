# docs/

Historical planning artifacts — **not living documentation**.

- `plans/` — dated, self-contained implementation plans for work that has since shipped. Each is a
  point-in-time record: checkboxes, commands, and constraints reflect when the plan was written, and
  some guidance was superseded by later plans. They are kept as a record of how features were built,
  not updated to match current code.
- `specs/` — dated design specs that preceded those plans, same lifecycle.

Living documentation lives at the repository root: [README.md](../README.md) (humans, setup,
deployment), [AGENTS.md](../AGENTS.md) (coding agents — canonical; `CLAUDE.md` imports it),
[ROADMAP.md](../ROADMAP.md) (planned work), [CHANGELOG.md](../CHANGELOG.md) (shipped work), and
[CONTRIBUTING.md](../CONTRIBUTING.md) (workflow and standards).
