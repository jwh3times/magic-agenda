# Required human follow-up

Whenever agent-completed work leaves a required human action, record it before reporting the
work or session complete. This includes dashboard changes, missing permissions, credential
provisioning, manual verification, approvals, and required product decisions. Finish all already
authorized agent work first; an action the agent can perform is not a human dependency.

## Record and publish

1. Check the private companion is installed (`private/.git`) and reconcile it with `--ff-only`
   before using its configuration. Follow its operating policy. Discover the private repository,
   its designated private project board, and its wiki through private configuration and authenticated
   metadata; keep their identifiers and contents within private surfaces.
2. Search existing private issues and wiki instructions for the same action. Create a follow-up
   issue in the **private repository**, or update the existing matching issue. Group steps only
   when they share one independently verifiable outcome. Record the originating work/PR, what the
   agent completed, the remaining action, why a human is needed, prerequisites, and acceptance
   criteria. A public issue or final-answer checklist does not replace this private follow-up.
3. Apply `ready-for-human` (create the label if absent), remove a conflicting `ready-for-agent`
   label, and remove `needs-triage` once the decision is settled. Add the issue to the designated
   **private board** explicitly and populate its status and applicable priority, phase, and size
   fields using that board's actual schema. Verify the destination is private; do not assume the
   public project's automation or project number applies.
4. Publish numbered, step-by-step instructions in the **private repository wiki**. Use the
   `human-todo` page as the index; place longer procedures on linked wiki pages. Include the
   required access/role, exact commands or verified dashboard navigation, expected results,
   verification and completion criteria, and rollback/recovery steps where applicable. State any
   uncertainty about current UI instead of inventing clicks. Include conditional actions and the
   condition that triggers each. The instructions must remain usable without the chat transcript
   or a temporary wizard. Link durable runbooks and scripts when useful, and explain required
   inputs. Keep credential values out of issues, wiki pages, logs, and chat; use 1Password for
   credentials and only permitted secret references in private documentation.
5. Link the private issue to its wiki procedure and link back from the wiki. Public work may be
   referenced from private records; private URLs, identifiers, and content must not enter public
   issues, PRs, committed public files, logs, or chat. Public status may say only that human
   follow-up remains. Keep the issue open and its board status unfinished until the required
   action and its acceptance checks have actually succeeded; then update both records.
6. Read back the published issue, its label and board fields, and the published wiki page to
   verify persistence and cross-links. Docs-updater may perform this workflow itself or give the
   coordinating agent an explicit outstanding action when its execution scope cannot publish;
   the coordinator owns completing it before the final report.

**Done when:** every required human action has a matching open private issue labeled
`ready-for-human`, a verified private board entry, and published, cross-linked wiki instructions.
Creating a wizard, writing a local Markdown file, or mentioning the action in a summary alone
is incomplete. Report publication status without exposing private details.

If private repository, board, wiki, or publishing access is unavailable, preserve any prepared
material only in an available private location and report which recording step is blocked.
Continue independent authorized work, but do not claim the human follow-up has been recorded
or silently substitute a public issue or board. Honor authorization already given in the session;
this workflow does not introduce another permission request for authorized publication.
