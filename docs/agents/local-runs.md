# Local runs

Running the suites, the lint and the local stack on a development machine without a false result.
What each layer covers, and how to run E2E locally, is in [Testing layers and lint policy](testing.md);
this file holds the traps, most of them on the maintainer's Windows machine.

## Judging a result

- **Judge lint and tests by exit code**, never by piped or tailed output. `npm run lint | tail` once
  showed only `npm notice` lines, and a grep for `Found` missed oxlint's `path:line:col: error`
  format, so three real errors "passed". Run `npx oxlint . ; echo $?`.
- **Lint red on files you didn't change** is usually a stale install: `node_modules` held oxlint
  1.80.0 against a `^1.82.0` pin and reported 388 errors. Compare
  `node -e "console.log(require('./node_modules/oxlint/package.json').version)"` with
  `package.json`, then `npm install`.
- **Gate a `src/**` change with `npm run format:check` and `npm run build`** as well as tests and
  lint: `build` type-checks the tests, and once caught a typing break the others missed.
- **The full unit suite can fail locally under parallel load and pass in CI.** Before investigating,
  rerun the failing file alone and rerun the whole suite; if both pass, it is load. One exception
  that is real: a test that fails in the suite but passes alone, in file order, is often an
  unconsumed `mockRejectedValueOnce` from the test before it.
- **`vitest run src/` is not `npm test`.** `npm test` also runs the Vitest tests under `scripts/`,
  in jsdom (the `environment` default in `vite.config.ts`'s `test` block) unless a file opts into
  node with `// @vitest-environment node` on line 1. `src/test/setup.ts` loads in both
  environments, so guard any DOM global there with `typeof X !== 'undefined'`.
- **`npm test` never runs the canonical scripts' `node:test` suites; `npm run test:scripts` does.**
  They are listed once, in `scripts/node-test-suites.ts`, and `vite.config.ts` excludes the same
  list from `npm test`. A new one needs no environment header, but it must go on that list: left
  off, `npm test` picks it up and fails it with "No test suite found in file". Never run them as a
  glob (`node --test scripts/*.test.mjs`): that sweeps in the Vitest-based files too, and node's
  runner reports failures for them that aren't real.
- **A new Vitest test under `scripts/` that builds a path from `import.meta.url` needs
  `// @vitest-environment node` on line 1.** Under the configured jsdom environment
  `new URL('../x', import.meta.url)` throws before any test runs, and the file reports "no tests".

## Formatting

- **Run Prettier only on the files you changed**, never on a directory. Over `supabase/` it rewrites
  the Edge Functions (which `deno fmt --check` then fails) and the production auth email templates,
  and local `format:check` catches neither. Over `src/dnd/` it rewrote an unrelated `.html`
  prototype. Before pushing, check `git diff --name-only origin/main` for files you didn't mean to
  touch.
- **Run `npm run format` before `npm run sync:agents`**, never after: `.claude/agents/*.md` is
  formatted and is the source of the generated TOML.

## Edge Functions

- **Run `deno test` from inside `supabase/functions/`.** Deno finds `deno.json` and `deno.lock` from
  the working directory upward, never from a path argument, and a root-invoked run fails on cold
  caches.
- **`deno fmt` owns `supabase/functions/`**, with its own line width. The `format` script's globs
  leave `supabase/` out, but `.prettierignore` does not. Run `deno fmt` from inside
  `supabase/functions/` before pushing: the `Functions` check runs `deno fmt --check` there.
- **A stray `deno.lock` at the repository root**, or a change to `supabase/functions/deno.lock`, can
  appear after a Deno run. Delete or restore it before committing: the committed
  `supabase/functions/deno.lock` is the real one.
- **A new transitive dependency needs `node_modules` rebuilt**, not just `deno install`:
  `rm -rf supabase/functions/node_modules && deno install`. The symptom is `ERR_MODULE_NOT_FOUND`
  for a package that is installed.
- **An untyped `createClient` infers rows as `never`.** Use `.returns<T[]>()`, and derive a parameter
  type from a factory (`type Admin = ReturnType<typeof adminClient>`).
- **The planner graph loaded by `materialize-series`** (series, recurrence, dates, checklist steps,
  field ownership, mappers) needs explicit `.ts` import specifiers, because Deno loads it
  ([Recurrence](recurrence.md)).

## The local stack

- **Windows WinNAT can reserve every local Supabase port.** `supabase start` fails with `bind: An
attempt was made to access a socket in a way forbidden` on 54322, and
  `netsh int ipv4 show excludedportrange protocol=tcp` shows a range such as 54216–54515. The fix is
  `net stop winnat` then `net start winnat` in an administrator shell. Never move the ports: they
  live in `supabase/config.toml`, which is production config.
- **`npm run test:rls:up` restores a cached stack and doesn't apply new migrations.**
  `npx supabase db reset` does; it targets the local stack by default since Supabase CLI v3.
- **Stopping a background `vite preview` can leave its child listening on 4173**, so the next
  `--strictPort` preview fails while the old process serves whatever `dist/` now holds. Find it with
  `netstat -ano | grep ":4173 .*LISTENING"` and stop it by PID.
- **Rehearsing TOTP needs no dependency.** About 20 lines of `node:crypto` (base32-decode the secret,
  HMAC-SHA1 over the big-endian 30-second counter, dynamic truncation) is a working generator;
  `supabase.auth.mfa.enroll` returns `totp.secret`. `tests/rls/helpers.ts` has the client and
  stack-config patterns.

## Windows shells and scripts

- **`python` is the Microsoft Store stub and hangs** rather than failing, so a `python … || node …`
  fallback never runs. Use Node with a script file.
- **Never pass a script to Git Bash as `spawnSync('bash', ['-c', script])` from Node.** Node quotes
  the argument by MSVCRT rules and MSYS2 parses it by its own, so `\\` collapses and long text
  arrives truncated (#571). Write the script to a file or send it on stdin.
- **PowerShell's execution policy rejects the `npm.ps1` and `npx.ps1` shims.** Call `npm.cmd` and
  `npx.cmd`.
- **`$TMPDIR` is unset in Git Bash here**, so `"$TMPDIR/x"` resolves to `/`. Use an explicit path.
- **A script outside the repository can't resolve its `node_modules`.** Import by absolute
  `file:///…/node_modules/<package>/…` path.
- **Playwright on Windows turns `/c/Users/...` into `C:cUsers...`.** Write `C:/Users/...` in a
  spec.
- **Don't use `git stash -u` here.** An undeletable empty `.codex-domain-issues/` makes it fail after
  writing the stash, leaving the changes in the tree and a duplicate stash entry. Use a worktree.

## Worktrees

- **A worktree's local `main` goes stale**: `git fetch` doesn't move a branch that isn't checked out
  there. Diff against `origin/main`, and branch with `git checkout -b <topic> origin/main`.
- **Undo a deliberate mutation with an inverse edit**, written in the same step as the mutation,
  never with `git checkout <file>` or `git restore`: those have discarded uncommitted work three
  times. Make a checkpoint commit or a copy first.

## The private wiki

`human-todo` holds only outstanding steps. When an action is done, close its issue, set the board
item to Done, and move its section, ticked and with its result, to the top of `Human-todo-archive`.

Wiki pages are stored with LF line endings, but a machine with `core.autocrlf=true` checks them out
as CRLF. Clone, edit and commit with the same setting throughout: committing with
`core.autocrlf=false` on a default clone rewrites every page. Check `git diff --stat` before
pushing.
