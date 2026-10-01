# 0010 — Fixing the plan after validating-plans is a subagent handoff

- **Date:** 2026-10-01
- **Source:** user feedback on the `validating-plans` loop (inline-tag terminator plan)

## Feedback

> "save in the lessons learned that fixing the plan based on the validating plan skill is
> also part of the handing off to subagents"

then, correcting my written version of it:

> "wait what, i told you that fixing plan validator findings must be handed off the
> subagents to fix them instead of techlead"

## What it corrected

I read "part of the handing off to subagents" as "the fix lives inside the delegation
loop", and wrote that up with a carve-out: substantive defects go to a subagent, mechanical
one-line defects (a `grep` missing its file argument, a placeholder left inside a command,
a whisper of internal inconsistency) the Tech Lead applies directly. I then fixed four
such findings myself and dispatched a fresh validator.

That is not the rule — and I had already written it into this file in the wrong shape. The
rule is simpler and without a size exemption: **fixing what a validator found is itself a
delegated task.** The validator's findings are handed to a subagent to repair; the Tech
Lead orchestrates and re-validates, and does not edit the plan with its own hands. I had
also inverted the point of the earlier feedback the first time round (round 2's four
defects went to the *planner*, round 3's four went to *me*) — both were the wrong seat.

## The lesson

- The `validating-plans` loop is: **plan → validate (fresh, read-only subagent) →
  dispatch a repair subagent with the validator's exact findings → validate again
  (fresh, read-only subagent).** The repair leg is a handoff to a subagent, not a
  Tech-Lead edit.
- **There is no "mechanical, so I'll do it myself" exemption.** Diff size is not the
  boundary. A one-line grep fix is delegated exactly like a scope rewrite. Classifying
  findings into "small enough for me" and "big enough for a subagent" is the exact drift the
  rule exists to stop.
- The repair subagent is given: the findings verbatim with plan line numbers, the locked
  decisions it must not re-open, the plan as its only writable file, and read-only access to
  the sources of truth. It fixes only what was found — it does not re-litigate what earlier
  rounds settled.
- The validator and the repairer are always **different, fresh** contexts, and the validator
  never repairs what it found; that separation is what makes "fresh context" mean anything.
- Keep the Tech Lead in the orchestrator seat (global §1/§4): dispatching, scoping, and
  re-validating — not authoring the artifact.

## Applies to

The `validating-plans` gate loop (global protocol §6) and the §4/§5 delegation template,
for every plan repair however small.
