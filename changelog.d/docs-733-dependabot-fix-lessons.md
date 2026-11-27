### Internal

- **The Dependabot guides record what PR #729 confirmed.** The Playbook's oxlint bullet in
  `docs/agents/dependabot.md` said only new or sharper rules turn `Format` red; it now says a bump
  can also loosen a rule and leave a suppression unused, which `reportUnusedDisableDirectives`
  turns into a lint error, fixed by deleting the directive (`oxlint` 1.95.0 and `react/refs` in
  `src/dnd/dndKitNext.prototype.tsx`). `docs/agents/merging.md` said every Dependabot PR catches up
  with `gh pr update-branch <n> --rebase`. Its `Dependabot catch-up` now chooses by who has
  committed to the branch: a branch with only Dependabot's commits still rebases, and one carrying
  a pushed fix takes the plain `gh pr update-branch <n>`, which keeps the fix commit as it was
  tested. "Before merging" now says why Dependabot PRs rebase and points to that rule. (#733)
