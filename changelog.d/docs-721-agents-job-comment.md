### Internal

- **Every step of the `Agents` CI job is described where it runs.** The comment above the job
  read as a full account of it but covered three of its six steps, and `check-skills.mjs` was
  described nowhere in the workflow. The header now introduces the job and each step has its own
  comment. The steps themselves are unchanged. (#721)
- **`sync:agents:check` is described as everything it checks.** The `ci.yml` comment and
  `docs/agents/tooling.md` named only the generated trees. They now also name the shared blocks in
  `AGENTS.md`, the guard hooks in `.claude/settings.json` and the parse of
  `docs/agents/guard.md`. (#721)
