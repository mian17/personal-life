# 0024 — Verify at the level the artifact actually fails, and don't hand a subagent a diagnosis you haven't checked

**Summary:** A subagent may report success without eyeballing the artifact it should have produced — read the diff/test it claims to have written before committing its work; and when a subagent's explanation contradicts your own evidence, revert it and re-derive rather than shipping a plausible story.

- **Date:** 2026-10-03
- **Source:** the five-fix bug batch and the invisible-manual-meal investigation

## What it corrected

Two distinct failure modes, both mine to catch as Tech Lead:

- A subagent reported "added a rendered-level assertion" for the row-spacing fix, but its
  own summary described a DOM chain (`ui-section → ui-stack → ui-row`) that did not match
  the JSX it claimed to have written. Reading the actual diff resolved the discrepancy (the
  `Section` atom does render an inner `ui-stack`), and the assertion was in fact correct —
  but only because I looked. Had it been wrong, the report alone would have shipped a test
  that asserted nothing.
- Earlier in the same feature, the first explanation for "manual meal saves but doesn't
  appear on the home screen" was wrong (a `router.back()` theory). Checking it against the
  rendered day view showed the real cause (the row rendered calories with no dish, and the
  dish was stored but never displayed), and the wrong change was reverted.

## The lesson

- **A subagent's report is a claim, not evidence.** After any delegated change, read the
  artifact it says it produced (the diff, the new test, the rendered output) before you
  commit. The report tells you the intent; the artifact tells you the result. Cheap to check,
  expensive to trust blindly.
- **Never commit on a story you have not tested.** A plausible root cause is not a verified
  one. Verify against the real artifact (rendered page, failing assertion, DB row) — the same
  rule as §10.7: use the real check, don't reason your way to a conclusion.
- **When new evidence contradicts a settled explanation, revert and re-derive.** Say exactly
  what changed your mind; do not keep a wrong fix because a subagent produced a tidy narrative
  for it.
- **Ban `router.back` / navigation from a "stale view" diagnosis until the page tree shows
  the missing data.** The failure was in rendering, not navigation; the reflex to blame
  caching/navigation cost a full investigation.

## Applies to

Every delegated task (global §5/§7): the Tech Lead's review step is where a subagent's claim
becomes verified reality. Pairs with lesson 0010 (fixes are delegated) — delegation does not
transfer the verification obligation.
