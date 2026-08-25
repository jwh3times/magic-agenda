# Private Companion Repository and Cross-Device Recovery Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. Tasks marked **MANUAL GATE** require Jerry to confirm the named external state before
> the orchestrator proceeds.
>
> **Safety boundary:** The public repository is `jwh3times/magic-agenda`. No file currently under
> `private/`, no 1Password secret value, and no generated authentication state may ever be staged
> or pushed to that public remote. A private remote's visibility must be verified through GitHub
> immediately before its first push.

**Research:** `private/2026-08-25-cross-device-private-docs-research.md` (private checkout only)

**Goal:** Make Magic Agenda resumable from a clean computer by moving durable confidential
documentation into a separate private GitHub repository, making 1Password the recoverable system
of record for credentials, updating the agent session workflow to keep both repositories
synchronized, and proving the result with a clean-machine recovery rehearsal.

**Architecture:** The public application repository remains self-contained. A separate private
GitHub repository is cloned as an ignored nested repository at `magic-agenda/private/`. Durable
private reasoning remains ordinary Markdown with Git history. Private repository Issues hold
actionable confidential work, and an optional private GitHub Project is only a derived planning
view. 1Password holds all credential values; the private repository holds only secret references,
ownership, rotation instructions, and recovery procedures.

**Tech Stack:** Git and GitHub CLI, a private GitHub repository, 1Password desktop application and
[1Password CLI](https://www.1password.dev/cli/), PowerShell on Windows, Node/npm, Supabase CLI, and
the repository's existing agent synchronization pipeline.

## Resumption contract

This file is the procedural plan. After Task 4 creates the nested repository,
`private/IMPLEMENTATION-STATUS.md` is the canonical execution checkpoint. A new computer or agent
must read this plan and then that status file, verify the recorded Git, 1Password, and provider
state, and resume only at its **Immediate next action**. Do not replay a completed external
mutation merely because an earlier checkbox or local artifact is unavailable.

At every manual gate and at the end of every work session, update the private status with:

- the timestamp and public/private Git state;
- completed task and step numbers, with evidence;
- external mutations already made;
- the active blocker or approval gate;
- the exact next action and its completion test; and
- local-only evidence or rollback artifacts that still exist.

Review, scan, verify private visibility, and obtain Jerry's explicit approval before committing
and pushing that checkpoint. Before Task 4, keep the same fields in an encrypted external task
ledger, then import its conclusions into `IMPLEMENTATION-STATUS.md` in Task 5. The status file is
runtime state; this plan remains the single procedure and must not be copied wholesale into it.

### Current execution checkpoint — 2026-08-25

- Tasks 1–6 are complete. The private companion is initialized, verified private, committed, and
  synchronized; its exact remote, commit, reference identifiers, and evidence hashes live only in
  `private/IMPLEMENTATION-STATUS.md`.
- Task 7 is in progress. All 11 GitHub Actions secret identifiers are covered by the private
  manifest. The database-backup and E2E-trace passphrases were each proven against a real retained
  artifact. The E2E account email was recovered and stored, and its current bearer session was
  accepted by the provider.
- The E2E password has **not** been recovered or rotated. Jerry redirected work to make this
  handoff durable before approving any rotation. The next gate is to ask for explicit approval to
  rotate that password and update the provider account, GitHub Actions secrets, private template,
  and regenerated local E2E state.
- Task 7 Steps 2, 5, and 6 remain open; Tasks 8–12 are pending, and Task 9 is optional.
- The public checkout remains on `main`; the Task 8 feature branch has not been created. At this
  checkpoint this plan file is still untracked locally, so the remotely committed private status
  is the portable source for the current resume point until Task 8 publishes the public workflow
  changes through a PR.

## Target layout

```text
magic-agenda/                         # public repository
  .git/
  private/                            # ignored by the public repository
    .git/                             # private companion repository
    README.md                         # current private index and handoff
    IMPLEMENTATION-STATUS.md          # canonical execution checkpoint and exact resume action
    RECOVERY.md                       # clean-computer recovery procedure
    SECRETS-MANIFEST.md               # secret metadata and op:// references; never values
    OPERATING-POLICY.md               # start/end session and classification rules
    onepassword/
      local-development.env.tpl       # op:// references only
      production-operations.env.tpl   # op:// references only
      e2e.env.tpl                     # op:// references only
    YYYY-MM-DD-*.md                   # reviews, decisions, plans, threat models
```

`private/` is a normal ignored nested repository, not a Git submodule. The public repository must
not contain a `.gitmodules` entry, a private repository URL, or a private commit pointer.

## Global constraints

- **1Password is the credential manager and system of record.** Do not use a generic local note,
  browser-only memory, GitHub Actions secrets, `.env.local`, or either Git repository as the only
  copy of a credential.
- Secret values never pass through chat, issue bodies, commit messages, command logs, or either Git
  repository. The private repository may contain `op://<vault>/<item>/<field>` references, but not
  the resolved values.
- Prefer `op run --env-file` or `op inject` over printing a value with `op read`. If `op read` is
  unavoidable, its output must flow directly to the consuming process and must not be echoed,
  logged, copied into shell history, or written beneath the repository.
- GitHub Actions secrets are installed deployment configuration, not recoverable storage. Every
  Actions secret needed for recovery or rotation must have an authoritative 1Password item.
- 1Password itself must have a break-glass recovery path outside the account: retain the Emergency
  Kit/Secret Key and required account-recovery material in a protected offline location. Do not
  make access to 1Password depend solely on being able to open 1Password.
- The public repository remains PR-only. Every public merge releases, so its eventual PR needs the
  exact changelog version computed at ship time.
- The private companion repository may accept direct pushes to `main`; its purpose is low-friction
  session synchronization. Never force-push it.
- A dated private review is evidence from the state it reviewed. Amend it; never rewrite its body
  to make it appear current.
- Do not delete or clean any existing ignored content until the clean-machine recovery rehearsal
  succeeds and Jerry separately approves cleanup.
- `tests/e2e/.auth/user.json` is a generated bearer session and must never be copied to another
  computer. Regenerate it through the E2E setup using credentials supplied from 1Password.
- `supabase/.temp/` and `supabase/.branches/` are machine-local CLI/link state. Recreate them on a
  new computer; do not synchronize their files.

---

### Task 1: MANUAL GATE — freeze the source inventory and make a rollback copy

**Files:**

- Read: all current files under `private/`
- Read: ignored-path inventory from `git status --ignored=matching`
- Create outside the repository: encrypted rollback archive and SHA-256 manifest

- [x] **Step 1: Confirm the public repository is at a safe baseline.**

Run:

```powershell
git status --short --branch
git stash list
git worktree list --porcelain
git remote -v
```

Expected: `main` matches `origin/main`, no stash exists, no secondary worktree exists, and the only
public remote is `https://github.com/jwh3times/magic-agenda.git`.

- [x] **Step 2: Enumerate the ignored state.** Record counts and filenames for `private/`,
      `.superpowers/`, `.env.local`, `supabase/.temp/`, `supabase/.branches/`,
      `tests/e2e/.auth/`, dependency directories, and `*.tsbuildinfo` without printing secret
      values.

- [x] **Step 3: Create an encrypted rollback archive of `private/` outside the public checkout.**
      The archive passphrase must be generated and stored in 1Password before the archive is made.
      Record the archive's location and SHA-256 hash in the task ledger, not in the public repo.

- [x] **Step 4: Generate a filename, size, and SHA-256 manifest for every private document.** Keep
      one copy beside the encrypted archive and one copy in the new private repository after it is
      created.

- [x] **Step 5: Scan the prospective private history for secret values.** At minimum, check for
      private-key headers, GitHub/Supabase token shapes, JWTs, passwords, passphrases, database
      connection strings, and copied `.env` assignments. A document may name a secret identifier;
      it may not contain its value.

- [x] **Step 6: STOP and ask Jerry to confirm:**

> The encrypted rollback archive opens successfully, its hash is recorded, the document manifest
> matches the source directory, and the secret scan found no credential values. May I proceed to
> create the private GitHub remote?

---

### Task 2: MANUAL GATE — establish 1Password as the recovery root

**Produces:** A recoverable 1Password structure, verified CLI access, and a non-circular account
recovery path.

- [x] **Step 1: Install or update the 1Password desktop application and 1Password CLI on the
      workstation.** Enable desktop-app CLI integration under 1Password's Developer settings and
      enable Windows Hello where available. Follow the official
      [CLI setup documentation](https://www.1password.dev/cli/get-started/).

- [x] **Step 2: Authenticate and verify CLI access:**

```powershell
op --version
op signin
op whoami
op vault list
```

`op signin` is idempotent with desktop integration, and `op whoami` must fail when no account is
authenticated. See the official [`op signin`](https://www.1password.dev/cli/reference/commands/signin)
and [`op whoami`](https://www.1password.dev/cli/reference/commands/whoami) references.

- [x] **Step 3: Create or select a dedicated 1Password vault for Magic Agenda.** Its exact name is
      private metadata and belongs in the private recovery document, not this public plan.

- [x] **Step 4: Create logical items for:**

1. local development (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`);
2. Supabase production operations (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
   `SUPABASE_PROJECT_ID`);
3. authentication providers (`RESEND_API_KEY`, `GOOGLE_OAUTH_CLIENT_SECRET`);
4. production E2E (`E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`, `E2E_SUPABASE_URL`,
   `E2E_SUPABASE_ANON_KEY`, `E2E_BASE_URL`);
5. encrypted artifacts (`BACKUP_GPG_PASSPHRASE`, `E2E_TRACE_GPG_PASSPHRASE`); and
6. account recovery references for GitHub, Supabase, Cloudflare, Resend, and Google Cloud.

- [x] **Step 5: For each existing field, verify that an `op://` secret reference resolves; give
      every unresolved field an explicit rotation task.** Use
      [`op read`](https://www.1password.dev/cli/reference/commands/read) only for controlled
      validation; never paste or record its output. Record the reference itself later in the
      private `SECRETS-MANIFEST.md`. At this checkpoint `E2E_TEST_PASSWORD` is the sole unresolved
      field and Task 7 records its approved-mutation gate.

- [x] **Step 6: Establish break-glass access.** Store the 1Password Emergency Kit/Secret Key and
      necessary account-recovery material in a protected offline location accessible if every
      current computer is lost. Test that Jerry knows where it is; do not copy it into either repo.

- [x] **Step 7: STOP and ask Jerry to confirm:**

> 1Password desktop integration works, `op whoami` identifies the intended account, every Magic
> Agenda credential has an item or an explicit rotation plan, and the offline 1Password recovery
> material exists outside 1Password. May I proceed?

---

### Task 3: MANUAL GATE — create and verify the private GitHub remote

**Produces:** An empty private GitHub repository. No private document is uploaded in this task.

- [x] **Step 1: Choose an available private repository name** under `jwh3times` (recommended:
      `magic-agenda-private`). Record the chosen URL in 1Password and the private recovery notes;
      do not add it to the public repository.

- [x] **Step 2: Create the repository as `PRIVATE` and empty.** Do not initialize it with a README,
      license, `.gitignore`, Actions workflow, or initial commit.

- [x] **Step 3: Verify visibility through the GitHub API:**

```powershell
gh repo view <owner>/<private-repository> --json nameWithOwner,visibility,url
```

Expected: `visibility` is exactly `PRIVATE`.

- [x] **Step 4: Open the repository settings in GitHub and independently confirm private
      visibility.** Enable Issues if private work tracking is desired. Leave Pages and Actions off
      unless a future need is documented.

- [x] **Step 5: STOP and present the API output and settings confirmation to Jerry.** Do not
      proceed if visibility is missing, ambiguous, or public.

---

### Task 4: Initialize `private/` as the companion repository

**Files:**

- Create: `private/.git/` through `git init`
- Create: `private/.gitignore`
- Preserve: every existing `private/*.md` file byte-for-byte

- [x] **Step 1: Initialize the existing directory in place:**

```powershell
git -C private init -b main
git -C private remote add origin <verified-private-repository-url>
```

- [x] **Step 2: Compare both remotes side-by-side:**

```powershell
git remote -v
git -C private remote -v
```

Expected: the parent points only to the public application repository; the nested repository points
only to the verified private repository.

- [x] **Step 3: Create `private/.gitignore`.** Ignore decrypted exports, `.env` files, credentials,
      private keys, editor state, OS files, temporary files, and generated recovery artifacts. The
      ignore file is defense in depth, not permission to place secrets in the directory.

- [x] **Step 4: Verify public containment:**

```powershell
git check-ignore -v private/README.md
git status --short --ignored=matching
```

Expected: the parent repository continues to ignore the entire nested repository.

- [x] **Step 5: Do not commit yet.** Task 5 creates the private operating documents first so the
      initial private commit is self-explanatory on a clean clone.

---

### Task 5: Create the private recovery and operating documents

**Files in the private companion repository:**

- Modify: `README.md`
- Create: `IMPLEMENTATION-STATUS.md`
- Create: `RECOVERY.md`
- Create: `SECRETS-MANIFEST.md`
- Create: `OPERATING-POLICY.md`
- Create: `onepassword/local-development.env.tpl`
- Create: `onepassword/production-operations.env.tpl`
- Create: `onepassword/e2e.env.tpl`

- [x] **Step 1: Amend `README.md`.** Preserve its current dated evidence and implementation
      register. Change the visibility/storage description from "local-only" to "canonical private
      companion repository," add the public repository association, and link the three new
      operational documents.

- [x] **Step 2: Write `RECOVERY.md`.** It must cover:

1. new-computer prerequisites;
2. GitHub and 1Password authentication;
3. cloning the public repository;
4. cloning the private repository into `magic-agenda/private`;
5. `op signin`, `op whoami`, and vault-access checks;
6. local environment injection through `op run`;
7. Supabase login/link recreation;
8. dependency installation and verification commands;
9. E2E storage-state regeneration;
10. database-backup download and decryption verification; and
11. start/end session synchronization.

- [x] **Step 3: Write `SECRETS-MANIFEST.md`.** For every secret, record only:

- identifier;
- owning service;
- purpose;
- authoritative `op://` reference;
- services where the value is installed;
- rotation procedure;
- safe verification procedure;
- last verified date; and
- whether losing the current value invalidates historical artifacts.

The document must explicitly prohibit resolved values.

- [x] **Step 4: Write `OPERATING-POLICY.md`.** Define:

- public versus private classification;
- files versus private Issues versus Security Advisories;
- start-of-session `pull --ff-only` for both repositories;
- end-of-session review, commit, and push for both repositories;
- no force-push policy;
- divergence handling;
- dated-evidence amendment rules; and
- the clean-worktree acceptance check.

- [x] **Step 5: Create `IMPLEMENTATION-STATUS.md`.** Import the external task ledger's completed
      work and evidence, identify the active approval gate, and name one exact next action. Make
      this file the canonical cross-device execution checkpoint; do not duplicate this plan's full
      procedure.

- [x] **Step 6: Create 1Password environment templates containing references only.** Example
      shape:

```dotenv
VITE_SUPABASE_URL=op://<vault>/<local-development-item>/VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY=op://<vault>/<local-development-item>/VITE_SUPABASE_ANON_KEY
```

The real vault, item, and field names may appear in this private repository. No resolved value may
appear. 1Password documents this `op://vault/item/field` syntax and supports passing such templates
to [`op run --env-file`](https://www.1password.dev/cli/secrets-environment-variables).

- [x] **Step 7: Document the preferred local development command:**

```powershell
op run --env-file=private/onepassword/local-development.env.tpl -- npm run dev
```

This avoids creating `.env.local` on a new workstation. Retaining `.env.local` on the current
workstation is allowed, but 1Password—not that file—is authoritative.

- [x] **Step 8: For tools that require a physical config file, use a template plus `op inject` to
      a temporary path outside the repository, restrict its permissions, and delete it after the
      command.** See the official
      [secret-reference documentation](https://www.1password.dev/cli/secret-references).

- [x] **Step 9: Re-run the manifest comparison and secret scan.** The original dated documents
      must be unchanged except for the intended `README.md` amendment; the new files may contain
      secret references but no values.

---

### Task 6: MANUAL GATE — commit and push the private repository

- [x] **Step 1: Stage every intended private file and inspect the staged diff:**

```powershell
git -C private add .
git -C private status --short
git -C private diff --cached
```

- [x] **Step 2: Run the secret scan against staged private content.** Fail closed on any plausible
      credential value until Jerry classifies or removes it.

- [x] **Step 3: Re-verify the remote immediately before the first push:**

```powershell
git -C private remote get-url origin
gh repo view <owner>/<private-repository> --json nameWithOwner,visibility,url
```

Expected: the URL matches and visibility is `PRIVATE`.

- [x] **Step 4: STOP and show Jerry:** the private remote URL, private visibility result, staged
      filenames, and secret-scan result. Wait for explicit approval to push.

- [x] **Step 5: Commit and push:**

```powershell
git -C private commit -m "docs: establish cross-device maintainer records"
git -C private push -u origin main
```

- [x] **Step 6: Verify the remote contains the expected files and the local private repository is
      clean, tracking `origin/main`, and neither ahead nor behind.** Verify the parent public
      repository still reports no private files.

- [x] **Step 7: Retain the encrypted rollback archive until Task 10's clean-machine rehearsal is
      complete.**

**Checkpoint correction:** The initial Task 6 push predated `IMPLEMENTATION-STATUS.md`. Include
the new status file in the next approved private commit/push before treating this execution state
as portable.

---

### Task 7: Reconcile and test credentials through 1Password

**Consumes:** The private `SECRETS-MANIFEST.md` and 1Password items.

- [x] **Step 1: Compare every secret referenced by `.github/workflows/**` with the manifest.** Each
      must have exactly one authoritative 1Password field or an explicit rotation task.

- [ ] **Step 2: Resolve missing ordinary credentials.** Recover an existing value from its owning
      provider when supported; otherwise create/rotate it, update the affected service and GitHub
      Actions secret, and store the replacement in 1Password. External rotations require Jerry's
      approval immediately before mutation.

- [x] **Step 3: Resolve `BACKUP_GPG_PASSPHRASE` first.**

1. If the current value is known, store it in 1Password and decrypt an existing artifact.
2. If it is unknown, generate a replacement in 1Password, update the GitHub Actions secret, run a
   fresh backup, download it, and decrypt it using the 1Password-held value.
3. Record the cutoff: artifacts encrypted with a lost prior passphrase remain unrecoverable.

- [x] **Step 4: Resolve `E2E_TRACE_GPG_PASSPHRASE` with the same ownership model.** A missing value
      may be rotated because old diagnostic traces are disposable, but the rotation and validation
      still need to be recorded.

- [ ] **Step 5: Use `op run` around private rotation/verification scripts.** Pass resolved secrets
      through process environment or stdin, not command-line literals. Scripts must not enable
      shell tracing, print environment variables, or write resolved values into the repository.

- [ ] **Step 6: Update `SECRETS-MANIFEST.md` and `IMPLEMENTATION-STATUS.md` with verification dates,
      completed mutations, and the next action. Push those metadata-only changes to the private
      repository after the same visibility and staged-diff checks used in Task 6.**

---

### Task 8: Update the public repository's private-document workflow

**Files in the public repository:**

- Modify: `.gitignore` (comment only; retain the `private/` rule)
- Modify: `AGENTS.md`
- Modify: `.agents/skills/end-session/SKILL.md` (authored source)
- Regenerate: `.claude/skills/end-session/SKILL.md`
- Create: `docs/runbooks/maintainer-workstation-recovery.md`
- Modify: `CHANGELOG.md` at ship time

- [ ] **Step 1: Create a public feature branch** from fresh `main`, recommended
      `docs/private-companion-workflow`.

- [ ] **Step 2: Update `.gitignore`'s comment.** Describe `private/` as an ignored, separately
      versioned private companion repository rather than an unbacked local-only directory. Do not
      add the private URL.

- [ ] **Step 3: Update `AGENTS.md`.** State that:

- `private/`, when present, is a separate private Git repository;
- agents pull it with fast-forward-only semantics before relying on its index;
- its contents must never enter the public repository, issues, logs, or chat;
- its durable records remain Markdown;
- 1Password is the credential authority and is accessible through `op`;
- secret references may cross into private operational templates, but resolved values may not;
- contributors without private access continue using public code/docs and treat documented private
  security decisions as load-bearing; and
- absence of the private checkout never authorizes weakening a security boundary.

- [ ] **Step 4: Update the authored end-session skill at
      `.agents/skills/end-session/SKILL.md`.** Its private-repository behavior must:

1. detect `private/.git` separately from mere directory existence;
2. fetch and report ahead/behind/diverged state;
3. refuse force pushes and refuse automatic conflict resolution;
4. reconcile private documents as it does today;
5. show the staged private diff without exposing secret values;
6. verify the GitHub remote is private before any push;
7. request Jerry's explicit approval before a private commit or push;
8. allow the private companion push as a narrowly named exception while retaining the prohibition
   against pushing/merging the public application repository;
9. report the private commit SHA and synchronization state; and
10. warn—not silently claim success—when private changes remain local or ahead of the remote.

- [ ] **Step 5: Create the public recovery runbook.** It may document installing Git, Node,
      1Password CLI, GitHub CLI, Docker, and Supabase CLI; cloning the companion into `private/`;
      and running `op signin`/`op whoami`. It must not name 1Password vaults/items, contain
      `op://` references, reveal the private repository URL, or duplicate private security
      reasoning.

- [ ] **Step 6: Apply the agent-generation order:**

```powershell
npm run format
npm run codex:sync
npm run codex:check
```

`.agents/skills/end-session/` is authored; `.claude/skills/end-session/` is generated and must not
be hand-edited.

- [ ] **Step 7: Run proportionate public checks:**

```powershell
npm run format:check
npm run codex:check
npm run check
npm test
npm run build
```

- [ ] **Step 8: Do not ship yet.** Task 10 rehearses the workflow before its public documentation
      and skill changes are merged.

---

### Task 9: Configure optional private work tracking

This task is optional and must not block cross-device file recovery.

- [ ] **Step 1: Use private companion repository Issues for actionable confidential work.** Link
      to a private Markdown document when the reasoning is long; do not duplicate the full record
      in an issue.

- [ ] **Step 2: Create a private GitHub Project only if a board view is useful.** Verify its
      visibility before adding private drafts or issues. A public issue remains public even when
      shown on a private Project.

- [ ] **Step 3: If the Project is managed through `gh`, obtain `read:project`/`project` scopes only
      with Jerry's explicit approval.** The current CLI authentication lacks `read:project`; using
      the browser is an acceptable alternative.

- [ ] **Step 4: Keep the Project derivative.** No unique threat model, credential reference,
      accepted-risk rationale, or recovery instruction may exist only in a Project field or draft
      card.

- [ ] **Step 5: Reserve repository Security Advisories for concrete undisclosed vulnerabilities
      that need a coordinated private fix/disclosure lifecycle.** Do not migrate broad audits,
      accepted risks, cost decisions, domain modeling, or general implementation plans into
      advisories.

---

### Task 10: MANUAL GATE — clean-machine recovery rehearsal

**Goal:** Prove that losing the original computer does not lose code, private reasoning, or access
to required credentials.

- [ ] **Step 1: Use a second computer or a fresh directory outside the current checkout.** Do not
      reuse the current `.git`, `.env.local`, Supabase state, dependency directories, or browser
      session.

- [ ] **Step 2: Recover 1Password access first.** Install the desktop app and CLI, authenticate via
      the documented account recovery path, then run:

```powershell
op signin
op whoami
op vault list
```

- [ ] **Step 3: Authenticate GitHub and clone the public repository.** Clone the verified private
      repository into its `private/` path. Confirm the parent ignores it.

- [ ] **Step 4: Compare the private filename/hash manifest.** Every expected document must exist
      and match the initial source or have an explained later commit.

- [ ] **Step 5: Read only the recovered `private/README.md`,
      `private/IMPLEMENTATION-STATUS.md`, and recovery documents, then identify the current
      implementation boundary, completed plan steps, external mutations, open approval gate, and
      exact next action.** The original computer may not be consulted for this step.

- [ ] **Step 6: Install dependencies and run the application with 1Password injection:**

```powershell
npm ci
op run --env-file=private/onepassword/local-development.env.tpl -- npm run dev
```

Verify startup without copying the values into `.env.local`.

- [ ] **Step 7: Recreate Supabase CLI link state from 1Password-backed inputs.** Use a private
      script under `op run`; do not copy `supabase/.temp/` or `supabase/.branches/` from the old
      machine. Perform a read-only verification after linking; do not push migrations or config.

- [ ] **Step 8: Run the public verification suite:**

```powershell
npm run format:check
npm run codex:check
npm run check
npm test
npm run build
```

- [ ] **Step 9: Regenerate E2E storage state from the 1Password E2E template.** Confirm
      `tests/e2e/.auth/user.json` is newly generated and remains ignored. Do not commit or copy it.

- [ ] **Step 10: Download and decrypt a newly generated database backup using the passphrase held
      in 1Password.** Follow the existing restore runbook through its non-production verification
      boundary. Do not restore over production.

- [ ] **Step 11: Exercise round-trip private synchronization.** Make a harmless amendment in the
      recovered private repository, commit and push it, then fetch it on the original computer.
      Both clones must finish clean and synchronized.

- [ ] **Step 12: Exercise the updated end-session behavior.** Confirm it detects a private change,
      verifies private visibility, asks before pushing, reports the private commit SHA, and does not
      push the public application repository.

- [ ] **Step 13: Record the rehearsal date, machine context, commands, and outcomes in
      `private/README.md` or `private/RECOVERY.md`, then commit and push that private amendment.**

- [ ] **Step 14: STOP and ask Jerry to confirm:**

> The clean machine recovered 1Password, both repositories, local development, Supabase link state,
> E2E authentication, and backup decryption without consulting untracked state from the original
> computer. May I declare the portability migration proven?

---

### Task 11: Dispose of historical scratch only after recovery succeeds

**Files:** `.superpowers/` only. This task is destructive and separately approved.

- [ ] **Step 1: Review the 196 existing `.superpowers/` files for unique conclusions.** Task
      briefs, generated review diffs, and shipped implementation reports are not canonical when the
      public Git history and durable documents already carry their result.

- [ ] **Step 2: Promote only durable, unique conclusions.** Put public architectural knowledge in
      public docs/ADRs/issues and confidential reasoning in the private companion repository. Do
      not move raw transcripts or duplicate Git diffs into the private repository.

- [ ] **Step 3: Optionally retain one encrypted cold archive outside GitHub.** Store its passphrase
      in 1Password and record its location/hash in the private recovery document.

- [ ] **Step 4: Present the exact deletion target and recovery status to Jerry and wait for
      explicit approval.** Do not include `.env.local`, `private/`, `supabase/.temp/`,
      `supabase/.branches/`, or `tests/e2e/.auth/` in the target.

- [ ] **Step 5: Remove only the approved `.superpowers/` scratch and report whether the external
      archive exists.** This deletion is not required for portability; it is cleanup after proof.

---

### Task 12: Ship the public workflow changes

- [ ] **Step 1: Rebase or merge fresh `main` into the public feature branch as appropriate.**
      Re-run the checks from Task 8 after resolving any drift.

- [ ] **Step 2: Invoke the `ship` skill.** It owns documentation refresh, exact changelog version,
      fast checks, push, and PR creation/update. Suggested changelog content:

- private maintainer documentation now lives in a separately versioned private companion repo;
- 1Password CLI is the credential recovery path;
- the end-session workflow verifies and synchronizes private records without ever pushing the
  public app repository; and
- the maintainer recovery runbook is now reproducible from a clean workstation.

- [ ] **Step 3: Review the public PR for accidental disclosure.** Search the entire diff for:

- private repository URL/name if the chosen policy keeps it undisclosed;
- real `op://` references;
- 1Password vault/item names;
- secret values or token-shaped strings;
- private document excerpts; and
- machine-specific paths outside public examples.

- [ ] **Step 4: Merge only after all required checks pass and every review thread is resolved.**
      Confirm the release workflow mints the changelog's version.

- [ ] **Step 5: Run one final end-session closeout.** Both repositories must be clean and
      synchronized. Report the public release/tag and the private companion commit SHA separately.

## Acceptance criteria

The implementation is complete only when all of these are true:

- [ ] GitHub independently reports the companion repository as private.
- [ ] Every durable private document exists in that repository with Git history.
- [ ] `private/IMPLEMENTATION-STATUS.md` is current, committed, pushed, and names one exact next
      action that a fresh agent can execute without consulting the original computer.
- [ ] The public repository contains no private content, secret values, private remote URL, or
      private commit pointer.
- [ ] 1Password is the authoritative store for every Magic Agenda credential and can be accessed
      through 1Password CLI on a clean workstation.
- [ ] Offline break-glass material can recover 1Password when no existing device is available.
- [ ] Local development can run through `op run` without creating a plaintext `.env.local`.
- [ ] GitHub Actions secret values needed for rotation/recovery have matching 1Password fields.
- [ ] A current database backup has been decrypted with the 1Password-held passphrase.
- [ ] The clean-machine rehearsal restores both repositories, Supabase link state, E2E access, and
      the application's normal checks without consulting the original computer.
- [ ] The end-session skill detects and refuses unverified, diverged, or unpushed private state.
- [ ] The private Project, if created, is derivative rather than the only copy of any reasoning.
- [ ] Security Advisories are reserved for genuine undisclosed vulnerabilities.
- [ ] No ignored content was deleted before recovery was proven and separately approved.

## Rollback and incident handling

- Before the first private push, rollback is the encrypted source archive plus the untouched
  `private/` directory.
- After the first private push, rollback is any verified clone plus the encrypted archive. Never
  force-push or rewrite the private history merely to make it tidy.
- If the intended private remote is discovered to be public **before** a push, stop and correct or
  recreate it; no content has been disclosed.
- If private material is ever pushed to a public remote, treat it as a disclosure, not a routine
  Git mistake: stop further pushes, preserve evidence, remove public access, rotate every possibly
  exposed credential through 1Password/provider workflows, and assume deletion cannot retract
  existing clones or caches.
- If the end-session automation proves unreliable, revert its public PR without removing the
  private repository. Manual `pull --ff-only`, reviewed commit, visibility verification, and push
  remain the safe fallback.

## Self-review notes

- The companion repository solves document synchronization; 1Password solves credential recovery.
  Neither is allowed to impersonate the other.
- The clean-machine rehearsal is the proof of completion. A successful initial push is only the
  start of the migration.
- The public application repository remains usable for contributors who have no knowledge of or
  access to the companion repository.
- The plan deliberately preserves the existing `private/` path, dated-document rules, protected
  public `main`, and authored/generated agent skill pipeline.
