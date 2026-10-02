# Report — todo-custom-repeat (T10 integration review)

Module: `todo-custom-repeat`. Branch: `feat/todo-custom-repeat`.
Plan: `tasks/plan-todo-custom-repeat.md`. Spec: `docs/specs/SPEC-todo-custom-repeat.md`.
Reviewed range: `860e187..HEAD` (the chapter's own commits, `50cbec1`…`74b1428`; the branch is
stacked on the verified `feat/todo-completion-history` chapter).

## Commands and results

| Command | Result |
|---|---|
| `npm run typecheck -w @life/shared` | pass |
| `npm run typecheck -w @life/ui` | pass |
| `npm run typecheck -w @life/todo-service` | pass |
| `npm run typecheck -w @life/app` | pass |
| `npm run test:unit -w @life/shared -- test/index.test.ts` | pass — 1 suite, 2 tests |
| `npm run test:unit -w @life/ui -- test/format-date.test.ts test/dialog.test.tsx` | pass — 2 suites, 39 tests (`dialog.test.tsx`: 9 cases, incl. accessible-name, backdrop-outside, and keyboard-bubbled-child-click regressions) |
| `npm run test:unit -w @life/todo-service -- test/recurrence.test.ts test/todos-custom-repeat.e2e-spec.ts test/todo-cache.e2e-spec.ts test/todos.e2e-spec.ts test/ownership.e2e-spec.ts` | pass — 5 suites, 94 tests (`recurrence.test.ts` incl. the `terminates on an empty day set` regression) |
| `npm run test:unit -w @life/app -- test/todo-repeat-label.test.ts test/routes-todo-edit.test.tsx` | pass — 2 suites, 38 tests |
| Contract 1 grep — raw HTML controls in `apps` | zero hits outside test files |
| Contract 1 grep — `next/link` in `apps` | zero hits |
| Contract 1 grep — raw colors in `.css` | only `packages/ui/src/styles/tokens.css` (generated `.next/**` ignored) |
| Contract 2 grep — `getThrough` | `apps/todo-service/src/todos/todos.service.ts` present |
| Contract 2 grep — `## Cache Rules` | `SPEC-todo-custom-repeat.md` present |

## Blast radius

`git diff --name-only 860e187..HEAD` returns 39 changed paths, matching the plan's explicit-path
list: the four amended specs/maps (`SPEC-todo-service.md`, `SPEC-todo-ui.md`, `SPEC-ui-blocks.md`,
`MAP-ui-primitives.md`), the `@life/shared` `index.ts` (+test), the `@life/ui`
Dialog/date-parts/blocks/barrel (+tests), the todo-service source (+4 amended suites, plus the new
`todos-custom-repeat.e2e-spec.ts`), the app source and tests (label/dialog/editor/item plus the nine
key-set literal migrations the `repeatDays` wire key forced), the plan, the ledger, and this report.

The owner spec `docs/specs/SPEC-todo-custom-repeat.md` and the chapter's fifth amended spec,
`docs/specs/SPEC-todo-due-repeat-notify.md` (the enum owner), are **not** among these 39: both
predate the reviewed range. The latter's `'custom'` enum delta was applied at the base commit
`860e187` (a plan-repair commit, outside the `860e187..HEAD` reviewed range). Both are nonetheless
part of the chapter's spec amendments (plan T1).

No out-of-scope edit; working tree clean at review time. `tokens.css`,
`tokens.test.ts`, the PWA manifests, `viewport.themeColor`, the e2e selector surface, and every
`playwright*.config.ts` are untouched (frozen surfaces respected).

## Success criteria (owner spec §Success Criteria)

| # | Criterion | Evidence | Result |
|---|---|---|---|
| 1 | Create/update `repeat:'custom'` + `repeatDays:[4,5]` round-trips | `todos-custom-repeat.e2e-spec.ts`; `normalizeRepeat` + `formatRepeatDays` in service | pass |
| 2 | Editor renders `Custom (Thu, Fri)` and seeds the modal from committed/due days | `todo-repeat-label.test.ts`; `routes-todo-edit.test.tsx`; `recurrence-dialog.tsx` seeding effect | pass |
| 3 | Tick records a completion for the pre-advance due, advances to the next chosen weekday, re-arms reminder, `done:false` | `update()` `dataSource.transaction` advance branch (`writeCompletion` + set-aware `advanceToOnOrAfter`); `todos-custom-repeat.e2e-spec.ts` asserts exactly one `todo_completion` row | pass |
| 4 | `custom` without days → 400; non-custom stores `repeatDays=null`; clearing due clears both | `normalizeRepeat`; `todos-custom-repeat.e2e-spec.ts` | pass |
| 5 | `Dialog` renders in the native top layer, closes on Escape and an outside-backdrop click | native `<dialog>`; Escape via the element's `close` event, backdrop via the `<dialog>` `onClick` (target-is-dialog + outside-bounding-box guard); `dialog.test.tsx` (9 cases) | pass |
| 6 | No raw HTML in app UI; tokens only; cache carries no plaintext | Contract 1 greps; `todo-cache.e2e-spec.ts` `enc.v1.` assertion | pass |

## Deviations from the plan (with rationale)

- **`todos.e2e-spec.ts` / `ownership.e2e-spec.ts` exact key-set arrays** — the read DTO gained the
  required `repeatDays` key (16 total); both literal `Object.keys` assertions were updated in T7, as
  the plan's T7 scope recorded.
- **9 app test literals migrated in T2** — `Todo` now requires `repeatDays: null`; the locked
  plan's T2 scope includes these nine app test files (T1 is docs-only), a mechanical migration
  mirroring the completion-history one.
- **T9 helper widening** — `routes-todo-edit.test.tsx`'s local `EditorField` interface gained
  `value?`/`options?` to read the `Select` props; test-only, within scope.

## Residual gaps

- The **interactive browser path** (opening the modal in the real UI, ticking a custom todo and
  seeing the completion + next occurrence) is a user-run dev check, not covered by unit suites.
- **Monthly patterns / every-N-weeks intervals** are deferred by C1/C6; the Frequency dropdown and
  the stored rule shape are the stated seam.
- The **production reminder push** path is orthogonal to this chapter and remains human-verified
  (`TODO_VAPID_*` unset makes the sweep a no-op in dev/test).
