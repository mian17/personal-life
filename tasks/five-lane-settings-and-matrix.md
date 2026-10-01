# Five-Lane Verification — settings-and-matrix chapter

Gate: `five-lane-verification` (global §7 step 6). Branch `feat/eisenhower-matrix`.
Review range: `master..HEAD` (84 changed files). Suite gate run first, below.

## Suite gate (step 0) — GREEN

Built `@life/shared` first, then this chapter's changed specs per workspace:

| Workspace | Command (chapter-scoped specs) | Result |
|---|---|---|
| `@life/ui` | `npm run test:unit -- test/switch.test.tsx test/settings-row.test.tsx test/settings-block.test.tsx test/tab-bar.test.tsx test/matrix-block.test.tsx test/list-manager.test.tsx test/list-shell.test.tsx` | 7 suites, **47 passed** |
| `@life/app-kit` | `npm run test:unit -- test/pref-cookie.test.ts test/read-pref.test.ts test/set-pref.test.ts test/settings-route.test.ts` | 4 suites, **14 passed** |
| `@life/app` | `npm run test:unit -- test/matrix.test.ts test/routes-matrix.test.tsx test/routes-settings.test.tsx test/routes-manager-blocks.test.tsx test/routes-todo-edit.test.tsx test/routes-todos-list.test.tsx test/routes-todos-trash.test.tsx test/todo-groups.test.ts test/todo-query.test.ts` | 9 suites, **65 passed** |
| `@life/todo-service` | `npm run test:unit -- test/lists.e2e-spec.ts test/todo-cache.e2e-spec.ts test/todos.e2e-spec.ts` | 3 suites, **66 passed** |

Total 23 suites / 192 tests, exit 0. (Playwright E2E: not run this chapter — global §3 / profile; no e2e spec changed.)

## Round 1 — 2/5 FAIL (fail-closed)

| Lane | Verdict | Blockers |
|---|---|---|
| 1 Correctness / domain | **FAIL** | HIGH: create mode seeds `false`, never the selected list's `importantDefault` → a list default has no effect on UI-created todos (T18 acceptance requires the list default in create mode). MEDIUM: edit-mode save always PATCHes an explicit boolean, converting an inheriting todo (`important: null`) into a pinned override, contradicting `SPEC-todo-importance` and intent L6. |
| 2 Code quality | **FAIL** | HIGH: same root cause — the editor does not model the `null`/inherit tri-state, so list-default propagation dies for anything the UI touches. |
| 3 Security | PASS_WITH_NITS | None (cookie attrs, client boundary, Contract 2 ciphertext, DTO validation all sound). |
| 4 QA | PASS_WITH_NITS | None (behaviors a–f each covered by an executing spec; E2E omission judged adequate). Nit: behavior c's `MatrixSwitch.onCheckedChange → setPref` slice covered compositionally only. |
| 5 Plan correctness | PASS_WITH_NITS | None (every REQUIRED item evidenced; every FORBIDDEN item absent). Nits: stale `Notes` nav label in `SPEC-ui-list-shell.md` (pre-existing). |

**Failed lanes: correctness, code-quality.**

### Fix pass 1 — blockers handed to a fresh fix subagent

Scope: `apps/app/app/todo-editor.tsx`, `apps/app/test/routes-todo-edit.test.tsx`, plus the
spec/plan reconciliation so the written plan stays conformant
(`docs/specs/SPEC-matrix-ui.md`, `docs/specs/SPEC-todo-ui.md`,
`docs/specs/SPEC-todo-importance.md`, `tasks/plan-settings-and-matrix.md`,
`tasks/todo-settings-and-matrix.md`). No frozen surface, no commit.

Intended fix: model the tri-state — state is the user's explicit override
(`boolean | undefined`, `undefined` = untouched); the displayed value is
`override ?? seed`, with `seed = editing ? (todo.important ?? todo.effectiveImportant) : selectedList.importantDefault`;
the write includes `important` **only when the user changed the switch**, so an untouched
todo keeps `important: null` (inheritance) and create mode follows the selected list default.

Fix delivered on `apps/app/app/todo-editor.tsx` + `routes-todo-edit.test.tsx` (17/17
targeted tests) and reconciled `SPEC-matrix-ui.md` / `SPEC-todo-importance.md` /
`SPEC-todo-ui.md` / the plan + ledger T18 wording to the tri-state contract. Tech-lead
verification before re-run: typecheck clean; raw-HTML grep clean; mutation checks — dropping
the `importantOverride !== undefined` guard fails the omit-untouched test, ignoring the list
default fails the create-seed test (both bind).

## Round 2 — re-run FAILED lanes only (1, 2). Lanes 3/4/5 stand. **5/5 PASS**

| Lane | Round 1 | Round 2 |
|---|---|---|
| 1 Correctness / domain | FAIL | **PASS_WITH_NITS** (0 blockers — both prior blockers closed) |
| 2 Code quality | FAIL | **PASS_WITH_NITS** (0 blockers — prior HIGH closed) |
| 3 Security | PASS_WITH_NITS | (not re-run) |
| 4 QA | PASS_WITH_NITS | (not re-run) |
| 5 Plan correctness | PASS_WITH_NITS | (not re-run) |

**Merge condition: N/N PASS (5/5).** No commit happened in between rounds; the fix was
re-verified by the lanes, not self-certified.

### Carry-forward nits (non-blocking, recorded)

- `renameList` now always transmits `importantDefault`, so a pure rename rewrites a stored
  `null` to explicit `false` (semantically identical; the field could be omitted for a pure
  rename).
- `matrix.ts:isUrgent` proves "tomorrow" via `dueDateLabel(...) === 'Tomorrow'` (a
  presentation string); contract-pinned and rollover-tested, but an `isTomorrow` helper
  upstream would be cleaner.
- `MatrixSwitch` does not sync local state back to the `checked` prop (route is
  force-dynamic, so drift is invisible).
- Per-list `Default important` switches share one accessible name (frozen surface) — fine
  in the unit tree, but ambiguous for `getByRole` once >1 list exists.
- `SPEC-ui-list-shell.md` still lists never-rendered `Notes`/`Todos` `navTrailing` links
  (pre-existing, out of scope).
- QA nit: `/todos/settings` `MatrixSwitch.onCheckedChange → setPref` is covered
  compositionally (`set-pref.test.ts` + the source import-boundary guard), not by firing the
  handler.
