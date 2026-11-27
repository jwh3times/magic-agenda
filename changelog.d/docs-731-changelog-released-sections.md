### Internal

- **The docs and the `Changelog` job say what the check enforces, and that it doesn't read a
  released section.** `docs/agents/releases.md`, `CONTRIBUTING.md` and the comment above the
  `Changelog` job in `.github/workflows/ci.yml` said the check rejects a branch that edits a
  released section of `CHANGELOG.md`. It compares only the version headings and the bullets under
  `Unreleased`, so a change inside a released section passes. All three now name what it rejects:
  a fragment that doesn't parse, a version section removed, renumbered or added other than a
  backfill, entries added to `Unreleased`, and an edit to or deletion of another merge's fragment.
  They also say only review catches a change to a released section. The job's step is now "Verify
  the changelog fragments and the version sections"; the required check's name is unchanged.
  (#731)
