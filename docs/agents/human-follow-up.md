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

## Follow-up board

same as Board — set `Gate` (`Operator action`, `Owner decision`, `Evidence needed`, …) and the
applicable `Phase`, `Priority` and `Size`. Keep `Status` unfinished until the action and its
acceptance checks have succeeded.
