### Internal

- **`sync:agents` and its check are described as everything they cover.** `AGENTS.md`'s Commands
  block, `CONTRIBUTING.md`'s Agent configuration section and the fast-check fix in
  `docs/agents/open-pr.md` described the script as regenerating only `.codex/agents` and
  `.claude/skills`. They now also name the shared blocks it writes in `AGENTS.md` and the guard hooks
  it registers in `.claude/settings.json`. The Commands block adds that the check fails when
  `docs/agents/guard.md` doesn't parse. (#723)
- **The PR template's `sync:agents:check` box no longer says when the check matters.** It said
  "only relevant if you touched `.claude/agents/` or `.agents/skills/`", which left out the other
  inputs. It now links to `docs/agents/tooling.md`, which lists them, instead of copying a list
  that would drift. (#723)
