# Confirmed Intent: todo-due-repeat-notify

Confirmed by the user 2026-10-02 via interview-me (explicit "yes", plus a refinement:
date-only reminders default to 09:00 local).

## Statement of intent

- Outcome: a todo's due value gains two optional dimensions and a phone ping.
  - **Time (optional):** a due stays a plain day (`YYYY-MM-DD`) or becomes a day **+ time**.
    A date-only due is unchanged and drift-proof; a timed due is entered in the client's
    **local** time and **stored as the canonical instant** so it is the same moment on any
    device/zone.
  - **Repeat (optional):** daily / weekly / monthly / yearly / every weekday, **anchored on
    the due date** (weekly = same weekday, monthly = same day-of-month, yearly = same
    month/day, weekdays = next Mon–Fri). Ticking a repeat advances it to its **next
    occurrence on/after today** and keeps it open; an unticked occurrence stays **overdue
    until ticked**; no completion history / occurrence rows (TickTick behavior).
  - **Push notification:** at the due moment the todo app sends a Web Push that arrives even
    when the app is closed, tapping it opens that todo. **A reminder needs a moment to fire
    at:** a timed due fires at its time; a **date-only due defaults to 09:00 local**.
- User: me, single user, on my **iPhone** (todo PWA saved to the Home Screen).
- Why now: a date alone is not precise enough, I want to actually be reminded, and the
  reminder is the input the future centralized postman/AI will read.
- Success: "water plants, every Thursday 09:00" → the row shows/sorts/flags by that
  instant → at 09:00 local my phone pings while todo is closed → tapping opens the todo →
  ticking advances it to next Thursday.
- Constraint:
  - Local-time input, canonical stored instant; **date-only stays naive `YYYY-MM-DD`**
    (lesson 0003's timezone rule stays intact for date-only).
  - Todo **owns** the push sender for now — **not** a separate notification service yet, but
    kept as its own bounded module so the future postman **replaces** it rather than digging
    `push` logic out of the todo write path (lesson 0012's failure shape).
  - Each todo also keeps a lasting **reminder record** ("this wants attention at <instant>")
    — the "letter" the future central postman will read; today todo's own sender delivers it.
  - One ping per occurrence; tick → reschedule next; unticked/overdue → no more pings.
  - UI from `@life/ui` only (Contract 1); backend service follows the cache contract
    (Contract 2), including per-service Redis (lesson 0011) and updated `MAP-*.md` (0012).
  - iPhone delivery requires the todo app to be **saved to the Home Screen**; permission is
    requested on an in-app button (iOS requires user interaction).
- Out of scope: the central postman service, the AI helper and the schedule/energy/mental-
  health state it would read; snooze; "every N days"; repeat end dates; per-occurrence
  history; notifications for notes/other apps; a notifier admin UI.

## Locked decisions (recorded here per the autonomy rule)

| # | Decision | Rationale |
|---|---|---|
| N1 | Timed due = **canonical instant** (local input normalized on write; rendered in client tz). Date-only due = naive `YYYY-MM-DD`, never round-tripped through `Date`. | User: "user defines local time, process stores the canonical/national time"; keeps lesson 0003 intact for date-only. |
| N2 | Recurrence **anchors on the due date**, not the creation timestamp. A repeat requires a due date. | User confirmed; matches TickTick; the next occurrence stays derivable from the row's own `dueDate` with no extra anchor column. |
| N3 | Advance-on-tick only, to the **next occurrence on/after today**; no scheduler; unticked overdue stays overdue; no history. | User confirmed TickTick behavior; avoids a background scheduler in this chapter. Weekly=due weekday, monthly=due day-of-month, yearly=due month/day, weekdays=Mon–Fri (TickTick dropdown labels). |
| N4 | **Push is in this chapter**, owned by todo as a **bounded sender module**, with a lasting reminder record per todo. | User: iPhone, "B also in this chapter"; keeps the letter so the future postman replaces the sender (0012). |
| N5 | **Date-only reminders default to 09:00 local** for the ping only; the due value itself stays date-only. | User refinement ("default to 9am like you suggested"); a ping needs an instant. |

## Follow-on chapters (not this one)

- The centralized notification **postman** (domain-agnostic delivery) + the todo producer
  rewiring to it; notes nominate later without touching the postman.
- The **AI attention layer** over candidate + self-state (schedule, energy, mental health),
  with legible, overridable decisions; self-state is its own service under the at-rest
  encryption contract.
