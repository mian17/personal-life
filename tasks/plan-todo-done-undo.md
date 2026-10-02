# Plan — durable Undo on the Done view (v1)

**Goal:** after the `Task completed` / `Undo` snackbar expires, there is still a way back.
The Done view gains an Undo control on **each task's newest completion row**, and the
server's undo rule is unified so that control is truthful for every row.

**Reference:** Apple Reminders — a completed reminder stays visible under the list's
**Completed** section and can be marked incomplete again indefinitely (Apple support:
*Mark reminders as completed or incomplete on Mac*). We already own that surface: the
Done view is our occurrence log.

**Scope decision (user, 02-Oct-2026):** v1 = undo the *latest* occurrence per task.
Occurrence-scoped undo on arbitrary rows is explicitly **out of scope** (it needs a new
patch field and different due-restoration rules).

**Governing spec:** `docs/specs/SPEC-todo-completion-history.md` (§UI, "Done view
composition", and the frozen selector-surface record). It currently states the log is
read-only — "no per-row delete, no Undo here" — so this plan **amends** it.

---

## Task 1 — Unify the server undo rule

### [TASK OBJECTIVE]
Collapse the two undo branches in `TodosService.update` into one rule — "delete this
todo's newest completion row; if its occurrence is a real date, restore the due and
re-arm the reminder" — so a `done:false` PATCH means the same thing for a repeating todo,
a one-off, and a repeat-cleared todo.

### [SCOPE & REPOSITORY CONTEXT]
- **Allowed files to edit/create (exact paths):**
  - `apps/todo-service/src/todos/todos.service.ts`
  - `apps/todo-service/test/todo-completion.e2e-spec.ts`
  - `docs/specs/SPEC-todo-completion-history.md` (Completion rules §3 and §4 only)
  - `docs/specs/SPEC-todo-service.md` (the one stale undo sentence only: "`done: false` on a one-off deletes only that occurrence's row" → the unified newest-row rule)
- **Reference files (read-only):** `apps/todo-service/src/todos/todo-completion.entity.ts`,
  `apps/todo-service/src/todos/recurrence.ts`, `apps/todo-service/src/todos/due-time.ts`,
  `apps/todo-service/test/todo-harness.ts`, `docs/lessons/`
- **Strictly prohibited files:** `apps/app/**`, `packages/**`,
  `docs/specs/SPEC-todo-ui.md`, and every other spec/intent file. Do **not** commit.

### [IMPLEMENTATION REQUIREMENTS]
1. In the `patch.done` transaction inside `TodosService.update`, replace the current
   `else if (todo.repeat !== null && todo.dueDate !== null)` (repeat undo) and the
   trailing `else` (one-off undo) with **one** branch, reached whenever
   `patch.done === false`:
   - `const repo = manager.getRepository(TodoCompletion);`
   - `const last = await repo.findOne({ where: { ownerSub: sub, todoId: id }, order: { completedAt: 'DESC' } });`
   - If `last` exists:
     - `await repo.delete({ id: last.id, ownerSub: sub });`
     - If `last.occurrence !== '~'` (a real date): set `todo.dueDate = last.occurrence;`
       (already in the persisted dual shape — assign verbatim, no conversion) and
       `todo.reminderScheduledAt = this.reminderAt(todo.dueDate, this.tz);`
     - If `last.occurrence === '~'` (undated one-off): leave `dueDate`/`reminderScheduledAt`
       untouched.
   - Always set `todo.done = false;`
   - If no row exists, change nothing except `done = false` (a safe no-op).
2. Keep the `patch.done === true` branches (repeating advance + one-off close)
   **byte-identical**. The `advance` flag, `version`/`updatedAt` increments, the
   post-commit `cache.bumpGeneration(sub)`, and the whole `dataSource.transaction` boundary
   are unchanged.
3. Do **not** change `recurrence.ts`, any entity, any DTO, or `@life/shared`.
4. Edge cases to preserve exactly:
   - Repeating undo: row deleted, due restored to that occurrence, reminder re-armed.
   - One-off with a date: its single row deleted, due unchanged in effect (restoring the
     same occurrence is a no-op), `done` false.
   - Undated one-off (`'~'`): row deleted, due left alone, `done` false.
   - A todo with several historical rows: only the **newest** is deleted; earlier rows are
     preserved.
   - **Due edited between tick and undo:** the old one-off rule
     (`delete … occurrence: todo.dueDate ?? '~'`) matched nothing once the due changed; the
     unified rule instead deletes the newest row (whatever its recorded occurrence) and
     restores that recorded occurrence as the due — the todo's due visibly reverts from the
     edited value to the originally completed occurrence, with the reminder re-armed.
   - No completion row at all: no throw, no due change.
5. Update the `update()` JSDoc and the `docs/specs/SPEC-todo-completion-history.md`
   Completion rules so **§3 and §4 describe this single rule** (delete newest row; restore
   the due only for a dated occurrence). Remove the now-inaccurate wording "the log is
   untouched" and the split repeat/non-repeat undo rules. Leave the rest of that spec
   (UI section, frozen-surface record) alone — Task 2 owns those.
6. In `docs/specs/SPEC-todo-service.md`, update the single stale undo sentence ("`done:
   false` on a one-off deletes **only that occurrence's** row") to the unified newest-row
   rule, and state the due-edited-between-tick-and-undo outcome above. Amend that sentence
   only — do not rewrite the document.

### [VERIFICATION & TESTING RULES]
- Permitted commands, from the repo root, in this order:
  ```
  npm run typecheck -w @life/todo-service
  npm run test:unit -w @life/todo-service -- test/todo-completion.e2e-spec.ts
  ```
- Ensure the existing case
  `'retains earlier rows when a repeat-cleared todo is ticked as a one-off then undone'`
  in `test/todo-completion.e2e-spec.ts` still passes unchanged, and add only the assertions
  the unified rule newly requires (the newest row is the one deleted; the due is restored
  from its recorded occurrence). Do **not** add a near-duplicate repeat-cleared case.
- Strict constraints: NO full test suites, NO E2E, no other test file. Max test
  executions: 2.

### [DEFINITION OF DONE]
- [ ] One undo branch; `done:true` branches byte-identical.
- [ ] The six edge cases above hold; the existing repeat-cleared case passes with the new
      assertions.
- [ ] Spec §3/§4 state the single rule; no "log is untouched" wording remains; the
      `SPEC-todo-service.md` one-off undo sentence states the unified rule.
- [ ] Typecheck clean; `test/todo-completion.e2e-spec.ts` fully green.
- [ ] No file outside the allowed scope modified; nothing committed.

---

## Task 2 — Undo control on each todo's newest Done-view row

### [TASK OBJECTIVE]
Render an Undo control on exactly one row per task in the Done view — that task's most
recent completion — which submits a new single-argument `undoTodoCompletionAction(todoId)`
that marks the todo not-done.

### [SCOPE & REPOSITORY CONTEXT]
- **Allowed files to edit/create (exact paths):**
  - `apps/app/app/todo-actions.ts` (add `undoTodoCompletionAction` only)
  - `apps/app/app/todo-completion-list.tsx`
  - `apps/app/test/routes-todos-completions.test.tsx`
  - `docs/specs/SPEC-todo-completion-history.md` (UI anatomy + frozen selector-surface record only)
  - `docs/specs/SPEC-todo-ui.md` (the "Done-view additions" section only)
- **Reference files (read-only):** `apps/app/app/todo-item.tsx` (the existing trash-button
  row-action pattern to copy), `packages/ui/src/components/list-item.tsx` (`leading` /
  `trailing` / `deleteAction` slots), `packages/ui/src/components/button.tsx`,
  `docs/lessons/`
- **Strictly prohibited files:** `apps/todo-service/**`, `packages/**`,
  `docs/specs/SPEC-todo-service.md`. Do **not** commit.

### [IMPLEMENTATION REQUIREMENTS]
1. In `TodoCompletionList`, determine which rows may show the control: walk the incoming
   `completions` array **in order** and mark a row undoable only the **first** time its
   `todoId` appears. The service returns the log newest-first, so the first row per
   `todoId` is that task's most recent completion. Use a local `Set<string>` — no new
   service call, no new prop, no `@life/shared` change.
2. Render the control with **existing `@life/ui` primitives only** — copy the trash
   action's shape from `todo-item.tsx` (a `<form action={…}>` wrapping a `Button` with
   `type="submit"`, `size="icon"`, and the `Undo2` glyph from `lucide-react` marked
   `aria-hidden`, exactly as that pattern pins `Trash2`). Pass it through `ListItem`'s
   `trailing` slot (`trailing` renders as a sibling of the row `<Link>`, so no interactive
   element is nested in the anchor). No raw `<button>`; no app-level CSS.
   Frozen selector surface (**user-approved, exactly this shape**): role `button`,
   `aria-label` = `` `Undo completion of ${completion.title}` ``, and a class hook
   `button.done-undo` mirroring the existing `button.trash-delete`.
3. Wire the control to a **new** single-argument server action that mirrors
   `deleteTodoAction` exactly — do **not** bind `updateTodoAction` directly (binding
   two args leaves `(expectedVersion?: number) => Promise<void>`, which is not
   assignable to React 19's form `action` type under `strictFunctionTypes`, and at
   runtime React's `FormData` argument would land in the `expectedVersion` slot):
   - In `apps/app/app/todo-actions.ts`, add:
     `export async function undoTodoCompletionAction(todoId: string): Promise<void>`
     whose body performs the `{ done: false }` write for the todo, mirroring the
     existing single-arg `deleteTodoAction` in that file (call the `@/lib/todo-api`
     write with `{ done: false }`, then `revalidateTodos()`).
   - The control's form uses `action={undoTodoCompletionAction.bind(null,
     completion.todoId)}`, exactly matching the `<form
     action={deleteTodoAction.bind(null, todo.id)}>` pattern in `todo-item.tsx`.
   - The new action carries **no `expectedVersion`** anywhere (the completion row
     carries no todo version, and the done write already bumped it — same reasoning
     as the snackbar Undo).
4. Accessible name: an `aria-label` naming the task, e.g.
   `` `Undo completion of ${completion.title}` ``. Reuse the existing visible strings
   (`Task completed`, `Undo`) nowhere else; the control is icon-only, so the `aria-label`
   is its accessible name.
5. Older rows (second and later for the same `todoId`) render exactly as today: no
   control, no link change, no text change.
6. Amend `docs/specs/SPEC-todo-completion-history.md`:
   - the Done-view row anatomy table: replace "**no** `deleteAction`, no `variant`" and the
     "the log is read-only (no per-row delete, no Undo here)" sentence with the new rule —
     newest completion row per task gets a `trailing` undo control; older rows stay
     read-only;
   - the primitive-reuse plan table: add the undo control's composed-from cell;
   - the frozen selector-surface record: add the new control's role (`button`), accessible
     name (`` `Undo completion of ${title}` ``) and class hook (`button.done-undo`), and
     state that occurrence-scoped undo on older rows is deliberately absent (v1 scope).
7. Amend `docs/specs/SPEC-todo-ui.md`'s "Done-view additions (todo-completion-history)"
   section: update the "**No done-toggle is rendered** (the log is read-only — no per-row
   delete, no Undo)" wording to the new rule — the newest completion row per task renders
   the `trailing` undo control (role `button`, accessible name `` `Undo completion of
   ${title}` ``, class hook `button.done-undo`); older rows stay read-only. Keep the
   amendment to that section only.
8. Do **not** change the Done row's existing meta (`dueDateLabel(completedAt, today)`),
   the `href`, the empty state, or the page chrome.

### [VERIFICATION & TESTING RULES]
- Permitted commands, from the repo root, in this order:
  ```
  npm run typecheck -w @life/app
  npm run test:unit -w @life/app -- test/routes-todos-completions.test.tsx
  ```
- In `test/routes-todos-completions.test.tsx`, extend the existing fixture (it already
  holds two completions of the same `todoId` plus one of another): assert exactly one
  control per `todoId`, that it is on the **newest** row for that `todoId`, and that the
  existing meta/empty-state assertions still hold. The existing fixture already exercises
  the exact case, so the file can observe the control; do **not** add a duplicate fixture
  and do **not** add a sibling test file.
- Strict constraints: NO full test suites, NO E2E, no other test file. Max test
  executions: 2.

### [DEFINITION OF DONE]
- [ ] Exactly one undo control per `todoId`, on its newest row; older rows unchanged.
- [ ] Control composed from existing primitives via `trailing`; no raw `<button>`; the
      single-arg `undoTodoCompletionAction` (no `expectedVersion`) wired via `.bind(null,
      completion.todoId)`; no `@life/shared` change.
- [ ] `Undo2` glyph pinned and `aria-hidden`; frozen-surface shape (`button`,
      `Undo completion of ${title}`, class `button.done-undo`) recorded in both specs.
- [ ] Spec UI anatomy + primitive-reuse row + frozen-surface record amended, v1 scope noted.
- [ ] Typecheck clean; the Done-view test file green.
- [ ] No file outside the allowed scope modified; nothing committed.

---

## Final verification (Tech Lead, not a delegated task)

1. `npm run typecheck` for every touched workspace (`@life/todo-service`, `@life/app`,
   `@life/ui`, `@life/shared`).
2. Both targeted suites: `test/todo-completion.e2e-spec.ts` and
   `test/routes-todos-completions.test.tsx`.
3. Contract 1 mechanical checks (`AGENTS.md`):
   `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps/app/app --include='*.tsx'`,
   `grep -rn "next/link" apps/app --include='*.tsx'`, and the raw-color grep over
   `apps` + `packages/ui/src` (`--include='*.css'`, ignoring `packages/ui/src/styles/tokens.css`).
4. Blast-radius review of the full diff against both tasks' allowed lists.
5. Five-lane verification gate — this delivers a new capability on a frozen surface.