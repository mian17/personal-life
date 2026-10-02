# 0015 — Small UI feedback and bug fixes skip the plan workflow; delegate straight to subagents

**Summary:** Size the process: small UI fixes skip planning/validating-plans and five-lane; delegate straight to a subagent, still verify.

- **Date:** 2026-10-02
- **Source:** user feedback while starting the completed-todo declutter change

## Feedback

> "for small UI feedback and bug fix changes, no need to follow the workflow skill.
> just hand things off to subagents is enough. please save that into lesson learned"

## What it corrected

I was about to run the full `planning-and-task-breakdown` → `validating-plans` gate for
what is a small, bounded UI change (dim/strike a done row, auto-hide it on tick, add one
`revalidatePath` line). I had already loaded `validating-plans` and was drafting a
strict plan with the 10-step workflow and a fresh-context validation loop.

That process is for **new chapters / multi-module features** where a plan must be
decomposed, type-consistent across many tasks, and validated against a design spec. For
small UI feedback and bug fixes it is pure overhead: the change is one or two files, the
"spec" is a sentence, and the Tech Lead can scope, delegate and verify it directly.

## Follow-up (same instruction)

> "and also dont do 5 lanes verification at the end for what i said too"

The carve-out extends to the closing gate as well: small UI feedback and bug fixes skip
the `five-lane-verification` gate (global §7 step 6) too — not just the planning workflow.
The plain §7 lifecycle is the whole verification: blast-radius diff review, contract check,
the repo's mechanical checks, and targeted typecheck/tests (`max-test-runs: 2`). No
parallel five-lane dispatch for these.

## The lesson

- **Size the process to the change.** Small UI feedback and bug fixes → hand off to a
  subagent directly with the §5 template (objective, blast radius, exact contracts,
  permitted verification). Do **not** invoke the planning/validating-plans workflow, and do
  **not** run the five-lane gate at the end.
- Reserve the `planning-and-task-breakdown` → `validating-plans` → `five-lane-verification`
  chain for work that actually needs it: a new module/chapter, a multi-file decomposition,
  or a change whose correctness depends on cross-task type contracts.
- This refines global §6 and §7.6 for small changes; it does not waive verification. The
  subagent still gets a bounded blast radius and prescribed targeted tests/typecheck, and
  the Tech Lead still runs the §7 review (blast radius, contracts, mechanical checks).
  Standing rules — frozen surfaces, tokens-only, no merge to `master` — are unchanged.

## Applies to

Day-to-day UI copy/layout tweaks, styling fixes, and small bug fixes in any app. Not to
new chapters, service contracts, or cross-cutting design work.
