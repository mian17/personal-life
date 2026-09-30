# 0004 — Adding the helper is not the change; wire every render site

- **Date:** 2026-10-01
- **Source:** user feedback on the todo row still showing `2026-10-01`

## Feedback

> "wait why is the text still date, while today is 1/10/2026?"

## Lesson

Shipping a shared helper upstream does not change what the user sees. The change
is only real once **every render site consumes it**. `formatDate`/`dueDateLabel`
landed in `@life/ui`, but `todo-item.tsx` still rendered `DueDatePill`, which
prints the raw ISO string — so the user still saw `2026-10-01`.

Rules:

- When a change introduces a shared primitive/helper, either wire the consumers in
  the same change, or leave the work-in-progress **uncommitted** rather than
  committing a half-done state.
- Verify against the rendered output at the row/page, not just against the
  helper's unit tests.
- Do not hold a consumer edit behind an in-flight agent and commit the helper as
  if the change were complete.

## Applies to

Any change that adds/updates a shared `@life/ui` primitive or helper.
