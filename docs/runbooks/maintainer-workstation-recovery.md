# Maintainer workstation recovery

Bring a new (or wiped) computer to the point where it can develop, test, and operate Magic Agenda
with nothing copied from the old machine. This is the public half of the procedure: it gets you to
a checkout with the private companion installed and 1Password reachable. From there,
`private/RECOVERY.md` takes over — it holds the parts that name vaults, items, and the companion's
remote, none of which belong in this repository.

Contributors without access to the companion need only steps 1, 3, and 4 with a `.env.local`
copied from `.env.example`; everything else here is maintainer-only.

## 1. Install the tools

- Git, Node (the version in `.nvmrc`), npm
- [GitHub CLI](https://cli.github.com/) (`gh`) — the bootstrap script needs it authenticated
- [1Password CLI](https://developer.1password.com/docs/cli/) (`op`) and, on a workstation, the
  1Password desktop app with CLI integration enabled
- Docker (for `npm run test:rls`), GnuPG (for backup verification)

The Supabase CLI is a pinned `devDependency`, so it arrives with `npm ci`; do not install it
globally — `npx` prefers the local copy.

## 2. Authenticate

```bash
gh auth login          # normal browser flow; do not paste a token anywhere
gh auth status
op signin              # desktop-app integration makes this idempotent
op whoami              # must name the intended account, not a service account
op vault list
```

Stop here if `op whoami` fails or reports an identity you did not intend. Every later step
resolves credentials through this identity, and a wrong one either fails or, worse, reads the
wrong vault.

## 3. Clone the public repository

```bash
git clone https://github.com/jwh3times/magic-agenda.git
cd magic-agenda
npm ci
```

## 4. Install the private companion

```bash
npm run bootstrap:private
```

`scripts/bootstrap-private.mjs` resolves the companion's clone URL from 1Password, confirms via
`gh` that GitHub reports the repository as `PRIVATE`, clones it into the already-ignored
`private/`, and verifies the parent still ignores it. It refuses a URL with an embedded
credential, refuses to overwrite a non-empty `private/` that is not a Git worktree, and — run
again later — fast-forwards an installed companion or reports its ahead/behind state. Pass
`--url <clone-url>` to bypass 1Password if you have the URL by other means; `--op-reference`
overrides which 1Password field it reads.

Check the result:

```bash
git check-ignore -v private/README.md     # must print the .gitignore rule
git -C private remote -v                   # the companion, not the app repo
git status --short                         # must not list private/
```

## 5. Continue in the companion

Open `private/README.md`, then `private/RECOVERY.md`. It covers, in order: verifying the
recovered documents against their hash manifest; running the dev server with credentials
injected by `op run` (no `.env.local` is created); recreating the Supabase CLI link state
(never copy `supabase/.temp/` from another machine); regenerating E2E storage state; decrypting
a current database backup; and the start/end-of-session synchronization rules. The `end-session`
skill implements those rules for agent sessions.

## What this runbook deliberately does not contain

Vault or item names, `op://` references, the companion's remote URL, and any private security
reasoning. If you find yourself wanting to add one of those here, it belongs in
`private/RECOVERY.md` instead.
