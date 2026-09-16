---
# GENERATED from .agents/skills/lets-go/SKILL.md by scripts/sync-codex.mjs — do not edit; edit the source and run `npm run codex:sync`.
name: lets-go
description: Resume this repository's active handoff from Proton Drive and mark it consumed in handoff_map.json.
disable-model-invocation: true
---

# Let's go

Pick up the handoff `/handoff` left for this repository, possibly on the other machine. A handoff
is **consumed** once its map entry is `null`, so each one is resumed exactly once.

`../handoff/scripts/handoff-map.mjs`, relative to this file, owns the folder location, the map
key, and the map format. Run it with `node`; do not edit the map by hand.

## Transport

Decide once, before step 1, using the **Transport** section of the `handoff` skill beside this
one: **desktop client** (the folder syncs itself; skip every CLI step) or **CLI mirror**
(`HANDOFFS_DIR` is a local mirror of `/my-files/Documents/Handoffs`, pulled and pushed with the
`proton-drive` CLI). The same stop conditions apply: an unset `HANDOFFS_DIR` or a
`You need to login first` answer means ask the user and stop.

## Steps

### 1. Find the active handoff

**Pull** (CLI mirror only) — fetch the current map before reading it:

```bash
proton-drive filesystem download -f remove /my-files/Documents/Handoffs/handoff_map.json "$HANDOFFS_DIR"
```

Complete when the transfer summary lists the map as downloaded.

Run `node <skills dir>/handoff/scripts/handoff-map.mjs resolve`.

- **Non-zero exit** — report its message and stop.
- **`active` is `null`** — tell the user this repository has no active handoff and stop.
- **`docExists` is `false`, CLI mirror** — the document is in the cloud but not in the mirror.
  Pull just that one file, then run `resolve` again:

  ```bash
  proton-drive filesystem download -f remove "/my-files/Documents/Handoffs/<active>" "$HANDOFFS_DIR"
  ```

  If `docExists` is still `false`, the map names a document that is not in the cloud either.
  Report the file name and stop, leaving the map untouched.
- **`docExists` is `false`, desktop client** — the map names a document the client has not synced
  here yet. Report the file name and stop, leaving the map untouched, so a retry after sync still
  works.

### 2. Read and verify

Read the whole document. Then run `git fetch origin` and check its **Repository state** against
the checkout and GitHub: branches, commits, open PRs, and unmerged work. The handoff was written
before `end-session` ran and before any merge since, so the checkout and GitHub win. Tell the user
about each difference.

If `private/.git` exists, bring the companion up to date per `AGENTS.md` before relying on it.

### 3. Mark it consumed

`node <skills dir>/handoff/scripts/handoff-map.mjs set null`. Do this before starting the work so
the other machine cannot resume the same handoff. The document stays in the folder.

**Push** (CLI mirror only) — the cleared map goes back to the cloud, so the other machine cannot
resume the same handoff a second time:

```bash
proton-drive filesystem upload -f create-new-revision -t "$HANDOFFS_DIR/handoff_map.json" /my-files/Documents/Handoffs
```

Complete when the transfer summary lists the map as uploaded. Until it does, the handoff is
consumed here but still active in the cloud; report a failed upload before starting the work.

### 4. Proceed

State the resume objective in one line, invoke the handoff's suggested skills where they apply, and
start on its first next step. When a step needs the user's decision, ask before acting on it.
