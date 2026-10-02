# Five-lane verification — durable Undo on the Done view (v1)

**Plan:** `tasks/plan-todo-done-undo.md` (PLAN VALIDATED, 3 consecutive rounds —
round 1 fixed 5 findings, round 2 fixed 1 `.bind` type mismatch, round 3 passed).
**Branch:** `feat/todo-custom-repeat`, base `f550b77`.
**Suite gate (step 0, run before lanes):** 4/4 workspaces typecheck clean
(`@life/todo-service`, `@life/app`, `@life/ui`, `@life/shared`);
`test/todo-completion.e2e-spec.ts` 12/12; `test/routes-todos-completions.test.tsx` 6/6;
Contract 1 greps clean (raw elements, `next/link`, raw colors — only `.next` build output).

## Round 1 verdicts (all lanes fired in parallel, none saw another's verdict)

| Lane | Verdict | Blockers |
|---|---|---|
| 1 Correctness / domain | `PASS_WITH_NITS` | none |
| 2 Code quality | `PASS` | none |
| 3 Security | `PASS` | none |
| 4 QA / end-to-end | `PASS_WITH_NITS` | none |
| 5 Plan correctness | `PASS` | none |

**Result: 5/5 PASS on round 1 — no fix pass required.**

### Lane notes (must-fix = 0; the following are nits, recorded not fixed)

1. **Undo `findOne` tie-break (lanes 1, 2).** Orders by `completedAt DESC` alone while the
   read path uses `completedAt DESC, id DESC`; a same-millisecond tie could delete a
   different row than the one shown. Not reachable today: `writeCompletion` dedups
   `(todoId, occurrence)` and a repeating tick strictly advances past the prior
   occurrence, so two rows cannot share an occurrence. One-token `id` tie-break would buy
   read/undo symmetry — deferred, needs a re-verification round.
2. **Double-submit of the Done-view control (lanes 1, 3).** No button disable, so a rapid
   second submit undoes a second occurrence on a multi-row todo (one-offs degrade to a
   safe no-op). Pre-existing in the service rule; only newly reachable via the log control.
   The UI drops the control once `done` flips false.
3. **Due cleared between tick and undo (lane 1).** The unified rule resurrects the recorded
   due even when the user later cleared it. Documented outcome of the locked rule (the
   due-edited edge), not corruption.
4. **Test nits (lane 4).** The bound `todoId` in `.bind(null, c.todoId)` is not exercised
   (action mocked); `aria-hidden` on `Undo2` is spec'd but unasserted.
5. **`button.done-undo` has no stylesheet rule (lane 4).** Selector hook only, exactly as
   `trash-delete`'s spec permits; visual weight comes from `ui-btn--ghost ui-btn--icon`.
   Visual check is the user's interactive dev check.

### Lane 4 coverage map (all passing)

Every named behavior has a jest case: newest-row-only control (`routes-todos-completions`),
newest-row deletion + verbatim due restore + reminder re-arm, one-off dated, undated `'~'`,
repeat-cleared, due-edited-between-tick-and-undo, no-row no-op
(`todo-completion.e2e-spec.ts`), meta/href/empty-state unchanged. No Playwright file
created or modified → per the repo's own §3 policy E2E is not triggered here.

## Blast radius

Exactly the 8 allowed files + this plan/report; nothing staged or committed at review time.
No `packages/**`, `@life/shared`, entity, DTO, `recurrence.ts`, or `SPEC-todo-ui.md`
edit outside its one owned section.
