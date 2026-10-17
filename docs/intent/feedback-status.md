# Intent: feedback status workflow (Jira-style)

- Outcome: Feedback entries get a status workflow — Open (default on submit) → In Progress → Done, plus Won't Do — settable from the owner inbox via a per-row dropdown, with a status filter bar over the list; each status shows as a color-coded pill (distinct hue per status).
- User: The user, working their feedback backlog — knowing which items have been handled and which are still open.
- Why now: Feedback entries carry no state at all today (app/type/title/description only), so the inbox cannot distinguish "seen and handled" from "still pending" — everything must be re-read to know.
- Success: Flip a submitted item to Done from the inbox, filter to "Open" and it disappears from the view; filter to "Done" and it is back with its pill; new submissions always start Open.
- Constraint: Fixed status set (Open/In Progress/Done/Won't Do), any-to-any transitions via dropdown (no workflow graph); status is workflow metadata like `app`/`type`, not encrypted content; app→type grouping and newest-first order stay as-is within a filter; the row is a new `ListItem variant="feedback"` upstream in `packages/ui` (the `variant="todo"` precedent, `packages/ui/src/components/list-item.tsx`), never app-rolled markup; status colors are semantic `@life/ui` tokens with the `packages/ui/test/tokens.test.ts` + `SPEC-ui-tokens.md` value-table tripwires updated in the same change; `MAP-feedback.md` locked interfaces mean any HTTP/DTO shape change gets flagged in the spec.
- Out of scope: Board/column view, custom statuses, status history/audit trail, comments, assignment, notifications, per-status count badges, submit-flow or event-pipeline changes beyond what a status change needs, status palette theming.

## Confirmation
Confirmed: yes — the user explicitly answered "yes" to the six-line restate (2026-10-16), including the color-coding refinement and the `ListItem variant="feedback"` note. Approved to proceed.

## Design notes (from the interview)
- "Jira status style" means the workflow semantics, not the board presentation: fixed statuses an entry moves through; the Jira pill/dropdown is the visual vocabulary only. Explicitly rejected: columns/board, workflow-graph transition rules — this is a personal inbox, so any status can move to any status.
- Status set proposed as Jira's defaults trimmed to a personal tracker: Open (new submissions), In Progress, Done, Won't Do (decided not to act). User accepted the default.
- Inbox behavior: rows stay in place within the existing app→type grouping and newest-first order; a filter-by-status bar is in scope from day one (user asked for it), applied over the list without reshaping the grouping.
- Status is metadata, not content: `app`/`type` are plaintext columns while `title`/`description` are `enc.v1.` envelopes — status follows the metadata class (no envelope, no AAD), which the at-rest spec review should confirm.
- UI precedent researched: `ListItemVariant = 'todo' | 'nested'` and `ListItemTone` in `packages/ui/src/components/list-item.tsx`; the todo app's row is `ListItem variant="todo"` with tone tinting, spec'd in `SPEC-ui-blocks.md` (`ListItem.tone`). The feedback row becomes a third variant in the same upstream component — Contract 1 Rule 3 (extend `@life/ui`, spec-first, never app-rolled markup), with MAP-ui-primitives/SPEC-ui-blocks updated in the same change.
