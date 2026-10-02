# Confirmed Intent: todo-completion-history

Confirmed by the user 2026-10-02 (design agreed in conversation, explicit "yes, go ahead").
Branch: `feat/todo-completion-history` (stacked on `feat/todo-custom-repeat`; it changes the
tick/completion contract that chapter builds on, so it lands first). `master` untouched.

## Statement of intent

- Outcome: introduce a **completion history** for todos. A todo becomes a **definition**
  (title, note, list, due, repeat rule, current next-due); each time it is completed, an
  **occurrence record** is appended to a new `todo_completion` table. This is the definition
  vs. occurrence split, and it is the Apple Reminders model: completing a repeating reminder
  records that occurrence as completed **and** the next occurrence stays visible.
- Why now: the current model conflates the two. A single todo row is both the definition and
  the mutable "current occurrence", so ticking a repeating todo had to either refuse to record
  a completion ("advance-only") or destroy the previous occurrence to advance. That produced
  the reported bug — a ticked repeating task never appears under the Done filter — and a hack
  (mark `done=true`, then have the reminder sweep reopen it) that keeps three sources of truth
  for one fact. A completion log removes the conflation, makes completed dates correct, and
  needs no reopening logic.
- Success:
  - Ticking a **repeating** todo inserts one completion row for the occurrence that was
    satisfied, advances the todo to its next occurrence, re-arms the reminder, and leaves the
    live row **open** (`done` stays `false`).
  - Ticking a **one-off** todo inserts one completion row and sets `done = true`.
  - The **Done** view reads the completion log (joined to the todo for title/list), newest
    first, so a repeating task shows every occurrence it has completed, each with its real
    completion date; a one-off shows once.
  - Un-completing a one-off removes its completion row; a double-tick can never double-record
    (`UNIQUE (todoId, occurrence)`).
- User: the single account owner, in the todos app.

## Locked decisions

| # | Decision | Rationale |
|---|---|---|
| C1 | **Definition vs. occurrence split.** The recurrence *rule* stays on the todo; occurrences are **not** materialized ahead of time — future ones are computed. | Materializing future occurrences is unbounded and needs "how far ahead" + override machinery; a personal todo app needs the rule + the log. |
| C2 | **Append-only `todo_completion` log**, one row per completion. Columns: `id` (uuid), `ownerSub`, `todoId` (FK → `todo.id` **ON DELETE CASCADE**), `occurrence` (the due this tick satisfied: `YYYY-MM-DD` or canonical instant), `completedAt` (canonical UTC instant of the tick). | Two different facts — *which* occurrence vs *when* completed; Apple keeps both. |
| C3 | **`UNIQUE (todoId, occurrence)`** as the idempotency key. | A retried/duplicated tick can never create phantom history; un-complete is a clean single-row delete. |
| C4 | **Repeating tick:** insert completion + advance due + re-arm reminder; the todo row stays **open** (`done` unchanged, `false`). **No reopen logic anywhere** — the sweep-reopen hack is deleted. | The row is the living recurring task; the log is the record. One source of truth per fact. |
| C5 | **One-off tick:** insert completion + set `done = true` (the flag now means only "closed in the Open list"). Un-complete (`done:false`) deletes that todo's completion row. | Preserves today's one-off behaviour and Undo while the log is the durable record. |
| C6 | **The Done view reads the log** (join `todo` for title/list; order `completedAt DESC`). `todo.done` no longer drives history. | Single owner for history = the log. |
| C7 | **No title snapshot** in v1: cascade-delete history with the todo; the view joins the live todo. | Trash is soft (history survives restore); only permanent delete discards it — the correct lifecycle. A nullable encrypted `title` snapshot is the deferred upgrade if history must outlive the task. |
| C8 | **Cache:** a new read-through shape `todo:<sub>:v<gen>:completions` (rows as persisted); invalidation rides the existing per-owner generation bump on tick/un-complete/permanent-delete; TTL backstop; fail-open. Filters/pagination never enter the key (Contract 2). | The log is the second cached shape; one entry serves every view variant. |

## Out of scope (follow-on chapters)

- Materialized occurrences, `RECURRENCE-ID`/`EXDATE` exception overrides, editing or
  un-completing a **past repeating occurrence** from the UI.
- Retention/pruning policy for old completion rows; a per-todo history view; stats.
- A denormalized title/list snapshot so history outlives a permanently deleted todo (C7 upgrade).
- Multi-device sync of the log beyond the existing per-owner model.
