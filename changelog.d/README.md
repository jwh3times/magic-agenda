# Changelog fragments

Each branch writes its changelog entries here, in one file named for the branch with each `/`
replaced by `-` (`feat/512-board-colors` → `feat-512-board-colors.md`). `/open-pr` writes it; never
edit `CHANGELOG.md` on a branch.

A fragment holds only category headings and their bullets, with no version or date. Use Keep a
Changelog's categories, or this changelog's own `### Internal` and `### Docs`:

```markdown
### Added

- Boards can carry a color, shown on the board switcher.

### Fixed

- The week view no longer drops a Task dragged onto Sunday.
```

Name a file in backticks rather than linking it: a relative link resolves from `changelog.d/` on
the branch but from the repository root once stamped into `CHANGELOG.md`, so it breaks in one place
or the other.

After the merge, `.github/workflows/version.yml` runs `scripts/stamp-changelog.mjs`, which moves
the fragments that merge added into its dated section of `CHANGELOG.md`, deletes them, and tags
the merge (ADR 0005). A merge with no fragment gets one `### Changed` bullet from its PR title. A
fragment already on `main` belongs to the merge that added it: never edit or delete it, and the
`Changelog` check rejects a branch that does. This README is not a fragment.
