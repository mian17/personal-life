# 0017 — Follow Apple Reminders' flow for recurring-task completion

**Summary:** For todo/recurrence UX, Apple Reminders is the reference: completing a repeating reminder records that occurrence as completed AND reveals the next occurrence — both visible, never advance-only.

- **Date:** 2026-10-02
- **Source:** user feedback while reviewing the Done filter for repeating tasks

## Feedback

> "there is one bug marked tasks are not shown as done on the filtered done search. is this
> the expected behaviour i expect the app to show marked tasks when i filter by done tho"

> "FYI, this occurs for repeating tasks"

> "no, i mean, even in apple reminder, it advances but also record the task as completed in
> its own filter too"

> "from now on please save to in the lesson learned to always follow apple reminders app flow"

## What it corrected

I explained the current advance-on-tick behaviour (a recurring tick advances the due date and
keeps `done = false`, so a repeating task can never appear under the Done filter) as "expected,
and matches TickTick". The user corrected the reference itself: Apple Reminders does **both** —
per the Apple Reminders User Guide, "If a reminder is set to have repeated notifications, and
you mark it as complete, the reminder for that day moves to the completed section of the list.
The reminder for the next repeat date appears in the reminders list."

The mistake was twofold:

1. I treated the locked no-history decision (`SPEC-todo-due-repeat-notify` N2/N3,
   "advance-on-tick, no completion history", TickTick-style) as the target behaviour and
   defended it, instead of checking the flow the user actually wants to mirror.
2. I asserted Apple advanced-and-kept-open, which is wrong — Apple records the completed
   occurrence **and** surfaces the next one, simultaneously.

## The lesson

- **Apple Reminders is the product reference for this domain.** When a todo behaviour is in
  question (recurrence, completion, lists, filters, reminders), check the Apple Reminders flow
  first and mirror it, rather than inventing or defending a TickTick-style alternative.
- **Completing a repeating reminder is a completion _and_ a re-arm.** The completed occurrence
  belongs in the completed/Done view (it is a real completion), and the next occurrence must be
  visible as an open item at the same time. "Advance only, never done" is not the reference
  behaviour.
- This overrides the earlier TickTick-flavoured locked decision for completion semantics; any
  spec that says "a recurring tick is not a completion" must be revised to the Apple flow.

## Applies to

Any recurrence/completion UX in the todos app (tick semantics, the Done/Completed filter,
reopening at the next occurrence), and future todo-domain product decisions generally.
