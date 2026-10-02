# Confirmed Intent: todo-custom-repeat

Confirmed by the user 2026-10-02 via interview-me (explicit "yes", plus a refinement:
the Custom modal also carries a Frequency dropdown, weekly-only for now).

## Statement of intent

- Outcome: the todo editor's **Repeat** field gains a **`Custom…`** option that opens a
  **modal** for building a recurrence pattern. v1 is **weekly on a chosen set of
  weekdays** (e.g. every **Thu + Fri**). The modal holds a **Frequency** dropdown (only
  *Weekly* today, so monthly can slot in later) and a **Mon–Sun multi-select**. Confirming
  sets a weekly rule on the chosen day(s); the Repeat field then reads a concrete summary
  such as `Custom (Thu, Fri)`.
- User: me, single user, in the todo editor (shared `@life/ui` surface, consumed by the
  todos app; `@life/ui` is the single owner per Contract 1).
- Why now: the canned repeats are fixed; a fixed-calendar "every Thu + Fri" commitment has
  no representation today. This is a fixed-calendar need, not a catch-up habit.
- Success: pick Custom → modal opens pre-ticked with the due date's weekday → tick Thu +
  Fri → Confirm → the field reads `Custom (Thu, Fri)`; ticking the todo records a completion
  for the pre-advance due then advances it to the next chosen weekday; its push reminder
  fires per occurrence.
- Constraint:
  - **v1 weekly-only.** The Frequency dropdown exists but lists only *Weekly*; the stored
    rule must be structured (frequency + weekday set) so monthly patterns are added later
    **without rewriting existing rows**.
  - **The due date stays the first occurrence** — no snapping. If Thu+Fri is chosen and the
    due is Monday Oct 5, it fires Mon Oct 5, then every following Thu/Fri. Matches Apple
    Reminders (the reminder date is the first occurrence; the pattern governs the rest).
  - **Modal**, not an inline row: a Mon–Sun multi-select. Built on the native `<dialog>`
    element (backdrop + top-layer + Escape + focus trapping for free — and it dodges the
    `.ui-card { overflow: hidden }` clipping that forces the row `Menu` to be inline).
  - Opens **pre-ticked with the due date's weekday**; **Confirm disabled until ≥1 day**;
    Escape / backdrop / Cancel leaves the previous repeat untouched (no half-applied state).
  - Reuse existing primitives (`Select`, `Pill`/`PillGroup`, `Button`); add only the new
    upstream `Dialog` block. UI from `@life/ui` only (Contract 1); the service keeps the
    BE → cache → DB layering and cache contract (Contract 2).
  - The tick **records a completion for the pre-advance due then advances** to the next
    occurrence on/after now (N2/N3 of `todo-due-repeat-notify`, whose advance-only wording is
    superseded on the completion point by `todo-completion-history`), now matching the chosen
    weekday set instead of a single weekday; `done` stays false.
- Out of scope: monthly/interval patterns ("first Monday", "every 2 weeks"), raw RRULE
  editing, completion-based repeat, per-day reminder times, repeat end dates,
  per-occurrence history, and any change to how the existing non-custom repeats behave.

## Locked decisions (recorded here per the autonomy rule)

| # | Decision | Rationale |
|---|---|---|
| C1 | Custom = **weekly by chosen weekdays** for v1; the Frequency dropdown shows only *Weekly* but is present as the extension seam. | User: "weekly as the only option for now"; matches Apple/TickTick (Custom → Frequency → Weekly → days). |
| C2 | **Due date is the first occurrence**; a due not in the chosen set still fires on its own date. No snapping. | User confirmed; Apple behavior; no silent mutation of a typed date. |
| C3 | The builder is a **modal** (Mon–Sun multi-select), opened by the `Custom…` dropdown option; opens pre-ticked with the due weekday; Confirm needs ≥1 day; Escape/backdrop/Cancel is a no-op. | User: "a modal when clicking the custom"; least-surprise cancel semantics. |
| C4 | Repeat field summary for a custom rule reads the concrete days: `Custom (Thu, Fri)`. | Keeps the self-describing-label rule from `todo-due-repeat-notify`. |
| C5 | The stored rule is **structured** (frequency + ISO weekday set), replacing the flat `repeat` enum's inability to express a set; the advance engine matches the weekday set. | So monthly extends later without a row rewrite (user constraint). |
| C6 | One new upstream primitive: a **`Dialog`** block on native `<dialog>`; the recurrence builder itself stays app behavior composed from primitives. | Contract 1 Rule 3 (extend upstream, spec-first); native `<dialog>` is the platform feature that covers backdrop/top-layer/Escape/focus. |

## Follow-on chapters (not this one)

- **Monthly pattern** ("first Monday of each month", "the nth weekday") added to the same
  Frequency dropdown and the same stored rule shape.
- **Interval** ("every 2 weeks") as an additional field on the weekly rule.
- These must not require rewriting existing `todo-custom-repeat` rows.
