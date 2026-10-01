# 0010 — Fixing the plan is part of handing off to subagents

- **Date:** 2026-10-01
- **Source:** user feedback on the `validating-plans` loop (inline-tag terminator plan)

## Feedback

> "save in the lessons learned that fixing the plan based on the validating plan skill is
> also part of the handing off to subagents"

## What it corrected

I ran the `validating-plans` gate as if a FAIL implied the *originating planner subagent*
must be re-invoked. Round 2 came back with four defects and I sent the whole plan back for
a subagent rewrite. Round 3 came back with four **one-line** defects — a `grep` with no file
argument, a grep whose stated output its pattern could never print, a `<same name>`
placeholder left inside a command, and one sentence contradicting the authoritative
implementation block. None changed scope, behaviour, or a locked decision. I fixed those
four in place as Tech Lead and dispatched a **fresh, read-only** validator — no planner
re-invocation. That is the right default: the repair step lives *inside* the delegation
loop, and its size is chosen by the defect, not by the fact that a gate failed.

## The lesson

- The validation loop is **plan → validate → repair → fresh validate**, and repair is not
  automatically a subagent handoff. Delegate it when the defect is substantive or changes
  scope/contracts; apply it directly when it is mechanical (a bad command, a placeholder,
  an internal inconsistency). Both paths end the same way: a **new** validator, never the
  one that failed, because no partial pass carries over.
- The validator stays strictly read-only even when the fix is one character. It never
  repairs what it found — if it also fixed, "fresh context" would be worthless.
- Never let "I fixed it" substitute for re-validation. Four green checks after a repair do
  not mean the repaired artifact is clean; only a fresh full pass does.
- When re-invoking the planner *is* warranted, say so explicitly with the defect list and
  the locked decisions to preserve, so the rewrite fixes only what broke instead of
  re-opening what the previous rounds already settled.

## Applies to

The `validating-plans` gate loop (global protocol §6), the §4/§5 delegation template, and
any review gate whose failure produces a repair step.
