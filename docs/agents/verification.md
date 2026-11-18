# Verification

How to prove a test, a fix or a claim before reporting it. Each rule here comes from a report that
was wrong, or a test that passed while proving nothing.

## Tests that pass for the wrong reason

- **Mutate every clause you claim is load-bearing**, including in tests written minutes earlier.
  Delete it, confirm a test goes red, restore it (with an inverse edit:
  [local runs](local-runs.md#worktrees)). A green suite says nothing about a clause no test can
  reach.
- **A fixture must contain a row that fails the narrowing.** When a predicate narrows by a field and
  every fixture row already satisfies it, the clause is decorative to the suite: deleting #228's
  `recurParentId` clause left all 61 tests green while inverting the fix on a real Board.
- **Ask what a test would still pass against, not only what it asserts.** Tests asserted that a
  Label refusal appeared, with `findByRole('alert')`, and passed with the alert rendered off-screen
  at the foot of the section. Scope anything positional (`within(row)`).
- **A green test can bless dead code.** A mutation pass found two guards no test could reach. Keep
  one that protects against something other than user input, with a comment saying it is
  unreachable on purpose; delete one that can't fire at all (a `disabled` button fires no click).
- **jsdom has silent gaps** ([UI](ui.md)): `matches(':focus-visible')` parses and always returns
  `false`, so a focus-ring test built on it passes forever; `Element.scrollIntoView` doesn't exist
  (it is polyfilled in `src/test/setup.ts`); Enter on a focused `<button>` synthesizes no click.
  Focus indicators need a real browser.

## Specs, issues and records

- **Issue text is a proposal, not a spec.** Two architecture issues had wrong "Solution" sections;
  read the code first.
- **Defects start in specs as often as in implementations.** A detailed plan reads as authoritative
  well before it is accurate. Ask implementers for a grep-backed inventory of what they did not
  change: that is what found a missed call site that would have shipped two different "today"s.
- **A closing comment saying another surface was updated is not evidence that it was.** Check the
  surface. A private issue closed saying its wiki procedure recorded completion; neither did, for
  five days.
- **Published records go stale silently**: wiki mirrors of dated reviews, completed actions still
  shown as pending, board fields no longer set, Gates pointing at closed blockers. Regenerate a
  mirror in the same change that amends its source, and audit the records on a schedule rather than
  when something breaks.
- **On what has actually been executed, the private evidence log outranks any summary**, including
  one written the same day. Read it to the end: its follow-ups are appended, and the head can still
  say "Immediate next action: none". Before filing a human follow-up, search both private files for
  the subject.
- **Check the provider's dashboard, not its docs, for plan limits.** For this project one documented
  limit was false and an undocumented one was true.

## Claims about what failed

- **State a correction plainly when a claim turns out wrong**, and say what evidence changed it. A
  "crash precursor" that was ordinary startup noise, and an "it's the runner" conclusion the data
  never supported, were both caught by a one-line question.
- **Run the experiment that would refute the explanation**, on a second layout or a second day: an
  overlay wait looked like the whole fix on a Sunday and lost 8 of 25 runs on Monday. Log passively
  rather than probing the page between steps, which can hide a race.
- **Reproduce a timing flake under load.** CPU throttling (`Emulation.setCPUThrottlingRate` ×4) took
  a 1-in-10 local flake to 4-in-10.
