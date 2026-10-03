# 0022 — A bug report names a symptom, not a cause: validate it in code before fixing, and never let the literal ask destroy a capability

**Summary:** Before fixing a reported bug, confirm the premise in code and name the real mechanism; when the report's literal ask would remove a capability (e.g. "remove the save button"), ask one precise question instead of complying — the requested change is often not what the user wants.

- **Date:** 2026-10-03
- **Source:** user bug list ("remove the save button in the log meal page, it doesn't work or anything")

## Feedback

> "remove the save button in the log meal page, it doesn't work or anything"

The report named a control and a fix. Both were wrong: there was **no dead button** (every
control was wired), and removing the one the user meant would have deleted the only path
that persists a meal.

## What it corrected

I began by validating the premise in code, which showed the report could not be taken
literally. Two save-ish controls existed, both working — so the *experience* was real but
the *diagnosis* was not:

- the header check icon ("Save meal") saves the diary entry, but it is `disabled` until
  dish + calories are confirmed, and **disabled rendered identically to enabled** — so
  clicking it while gated produced no feedback at all;
- "Save as meal" freezes a reusable template and never logs to the day, which reads as
  "does nothing" if you expected it to log.

The user's follow-up answer identified the real defect in one line: *"the disabled button
state seems just like the color of the regular button, looking at it i wouldn't know that
it is disabled."* The actual fix was a **visual** one (disabled state must look disabled)
plus feedback, not a removal. Had I obeyed the literal request, I would have broken the
core flow and shipped a worse product while technically "doing what was asked".

## The lesson

- **Validate the premise in code before touching it.** A report tells you what the user
  experienced; only the code tells you why. Read the controls/markup/state involved and
  name the mechanism before choosing a fix. If the mechanism contradicts the report, say
  so plainly — do not silently "fix" a report you know is misdiagnosed.
- **When the literal ask would remove a capability, ask exactly one question.** "Remove the
  save button" conflicts with "be able to save", so the request is under-specified, not
  wrong. One tight question (which control, what should happen to it) resolves it; guessing
  either way is a coin flip on destructive work.
- **An invisible state is a bug even when nothing is broken.** A gated control that looks
  live is a defect in its own right — the fix is to render the state the user must perceive,
  and to make a completed action announce itself. Prefer the app's existing feedback idiom
  (here, the snackbar other features already used) over a new one.
- **Distinguish the app-instinct from the app-contract.** "Looks like a tag" is a styling
  complaint about a control whose element semantics are frozen; the fix is a primitive that
  keeps the semantics (`role=link`) while changing the visual. Never trade an invariant for
  a visual request.

## Applies to

Any user-reported bug in this repo. Pairs with lesson 0015 (small fixes are delegated, not
planned) — this lesson governs what the delegated subagent must establish first.
