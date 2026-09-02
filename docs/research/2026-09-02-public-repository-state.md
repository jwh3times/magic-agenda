# Public repository state and next-work evaluation

**Investigated:** 2026-09-02  
**Scope:** The public `jwh3times/magic-agenda` repository, its documentation, Git history, GitHub
issues, pull requests, Actions runs, and repository-linked GitHub Projects. No non-public checkout
was inspected.

## Conclusion

The public side of the portability work is shipped. [PR #246](https://github.com/jwh3times/magic-agenda/pull/246)
merged on 2026-08-28 as v1.8.28 with the bootstrap command, clean-workstation runbook, repository
policy, and session-closeout changes. Its required CI, RLS, E2E, Config, Agents, Cloudflare, and
CodeQL checks all passed. The current checkout is clean, is at the same commit as `origin/main`, and
that commit is tagged v1.8.32.

There is no open public portability issue, no open pull request of any kind, and no GitHub Project
linked to this repository. The public issue tracker is therefore the actionable public queue.

The authoritative private checkpoint was reconciled later on 2026-09-02, and the last human-only
recovery-record action was completed and verified. Portability is therefore closed; the execution
plan's older unchecked procedural steps are historical rather than active work. See
[the plan's resumption contract](../plans/2026-08-25-private-companion-repository.md#resumption-contract),
[its recorded rehearsal](../plans/2026-08-25-private-companion-repository.md#execution-checkpoint--2026-08-27-clean-machine-rehearsal-linux),
and [the v1.8.28 changelog entry](../../CHANGELOG.md#1828---2026-08-28).

## Evidence

### Portability delivery

- [PR #246](https://github.com/jwh3times/magic-agenda/pull/246) merged the public portability
  workflow. Its file list includes the bootstrap implementation and tests, maintainer recovery
  runbook, agent guidance, session-closeout skill, README, and changelog.
- The public interface is documented as `npm run bootstrap:private` in
  [README.md](../../README.md#development), while the complete public recovery path is in
  [the maintainer workstation runbook](../runbooks/maintainer-workstation-recovery.md).
- The plan records a real Linux clean-machine rehearsal that recovered credentials access, both
  checkouts, local development, Supabase link state, the full public verification suite, and backup
  decryption. It also records then-current follow-ups, which is why its later resumption contract
  matters more than unchecked boxes in the historical procedure.

### Current repository health

- `git fetch --prune --tags` left `HEAD...origin/main` at `0 0`; both point to `bc9a764`, tagged
  v1.8.32. The worktree was clean before this report was added.
- The latest `main` CI and Version runs succeeded on 2026-09-01, the scheduled CodeQL run succeeded
  on 2026-09-01, and the scheduled Backup run succeeded on 2026-09-02:
  [CI](https://github.com/jwh3times/magic-agenda/actions/runs/33520937484),
  [Version](https://github.com/jwh3times/magic-agenda/actions/runs/33520937468),
  [CodeQL](https://github.com/jwh3times/magic-agenda/actions/runs/33571150010), and
  [Backup](https://github.com/jwh3times/magic-agenda/actions/runs/33634417635).
- GitHub reports no open PRs. A repository-scoped ProjectsV2 query reports no linked projects.
  [The repository's issue-tracker instructions](../agents/issue-tracker.md) designate GitHub Issues
  as the source for issues and specs.

## Recommended next steps

1. **Portability is complete.** No additional implementation or recovery action remains. Treat the
   public plan's unchecked procedural steps as historical; the private companion's terminal
   checkpoint is authoritative for the confidential recovery state.

2. **Then triage the four untriaged offline/test issues.** [#249](https://github.com/jwh3times/magic-agenda/issues/249)
   can persist stale recurring-series definitions, and [#250](https://github.com/jwh3times/magic-agenda/issues/250)
   can disguise authorization or server failures as offline state; these are the highest-risk pair.
   [#251](https://github.com/jwh3times/magic-agenda/issues/251) is user-facing freshness/theming
   correctness, while [#252](https://github.com/jwh3times/magic-agenda/issues/252) is a testability
   trap that is inert until storage failure-path tests are added.

3. **For ready, already-specified feature work, start the Completion chain at #239.** The roadmap
   and issue dependencies define the order as
   [#239](https://github.com/jwh3times/magic-agenda/issues/239) →
   [#240](https://github.com/jwh3times/magic-agenda/issues/240) →
   [#241](https://github.com/jwh3times/magic-agenda/issues/241) →
   [#242](https://github.com/jwh3times/magic-agenda/issues/242). #239 is deliberately additive
   schema first because migrations and the deployed client race. This chain is marked
   `ready-for-agent` and is also represented in [ROADMAP.md](../../ROADMAP.md#phase-4--productivity--personalization).

4. **Keep #166 ahead of reminders implementation, but route it to a human modeling session.**
   [#166](https://github.com/jwh3times/magic-agenda/issues/166) must settle schedule placement,
   due-time, reminder, overdue, and timezone semantics. It is labeled `ready-for-human`; the roadmap
   describes reminders as P2, but implementing them before this vocabulary is settled risks
   encoding the wrong domain model.

## Open public queue at investigation time

| Issue                                                        | State                             | Recommended disposition                              |
| ------------------------------------------------------------ | --------------------------------- | ---------------------------------------------------- |
| [#249](https://github.com/jwh3times/magic-agenda/issues/249) | `bug`, `needs-triage`             | Triage first with #250; offline snapshot correctness |
| [#250](https://github.com/jwh3times/magic-agenda/issues/250) | `bug`, `needs-triage`             | Triage first; error/auth semantics can be hidden     |
| [#251](https://github.com/jwh3times/magic-agenda/issues/251) | `bug`, `needs-triage`             | Triage after #249/#250                               |
| [#252](https://github.com/jwh3times/magic-agenda/issues/252) | `needs-triage`                    | Low urgency; fix before adding storage stubs         |
| [#239](https://github.com/jwh3times/magic-agenda/issues/239) | `ready-for-agent`, `architecture` | First implementation slice in Completion chain       |
| [#240](https://github.com/jwh3times/magic-agenda/issues/240) | `ready-for-agent`, `architecture` | Blocked by #239                                      |
| [#241](https://github.com/jwh3times/magic-agenda/issues/241) | `ready-for-agent`, `architecture` | Blocked by #240                                      |
| [#242](https://github.com/jwh3times/magic-agenda/issues/242) | `ready-for-agent`, `enhancement`  | Blocked by #241                                      |
| [#166](https://github.com/jwh3times/magic-agenda/issues/166) | `ready-for-human`, `architecture` | Domain-modeling gate before reminders                |

## Method

Primary sources only: public repository files and Git metadata; GitHub's API through `gh` for the
repository, issues, PRs, Actions, and repository-linked Projects. Searches for portability-related
open and closed public issues returned no matching ticket; the merged PR is the public delivery
record.
