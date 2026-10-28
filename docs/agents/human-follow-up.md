# Required human follow-up

Whenever agent-completed work leaves a required human action, record it before reporting the work
or session complete: dashboard changes, missing permissions, credential provisioning, manual
verification, approvals, and required product decisions. Finish all already authorized agent work
first; an action the agent can perform is not a human dependency.

The procedure is the `## Procedure` the shared skills carry
(`.agents/skills/end-session/settings/human-follow-up.md`); the settings below bind it to this
repository. Each `##` heading is one setting.

**Done when:** every required human action has a matching open private issue labelled
`ready-for-human`, a verified board entry, and published, cross-linked wiki instructions. A wizard,
a local Markdown file, or a line in a summary alone is incomplete. Private URLs, identifiers and
content never enter public issues, PRs, committed public files, logs or chat; public status may say
only that human follow-up remains.

## Follow-up destination

`discover: git -C private remote get-url origin` — issues in the private companion, selected
explicitly with `-R`, even for follow-ups from public work. Check `private/.git` exists and pull it
`--ff-only` first. A public issue or a final-answer checklist never replaces the private follow-up.

## Follow-up label

`ready-for-human` (create it if absent). Remove a conflicting `ready-for-agent`, and remove
`needs-triage` once the decision is settled.

## Follow-up board

same as Board — set `Gate` (`Operator action`, `Owner decision`, `Evidence needed`, …) and the
applicable `Phase`, `Priority` and `Size`. Keep `Status` unfinished until the action and its
acceptance checks have succeeded.

## Follow-up wiki

`discover:` the private companion's wiki (its repository's `.wiki.git`). `human-todo` is the index;
longer procedures go on linked pages. Push without asking: publishing the follow-up is already
authorized. Use 1Password references for credentials, never values.
