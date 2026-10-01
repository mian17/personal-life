# Five-lane verification — shared page blocks

Gate: `five-lane-verification`. Diff under review: `fe43ffc..7b8fab5` (later rounds: HEAD at run time).
Locked plan: `tasks/plan-shared-page-blocks.md`.

## Suite gate (step 0)

Green on the integrated tree:

- `npm run typecheck -w packages/ui` / `-w packages/app-kit` / `-w @life/app` → exit 0, 0 errors.
- `npm run test:unit -w packages/ui -- test/{trash,manager,list-shell,editor-chrome}*.test.tsx` → 4/4 suites, 24/24 tests.
- `npm run test:unit -w packages/app-kit -- test/*.test.ts(x)` → 5/5 suites, 23/23 tests.
- `npm run test:unit -w @life/app -- test/manifests.test.ts` → 1/1 suite, 4/4 tests.
- Targeted journey E2E: 1 passed (pass on the config's own `E2E_*_PORT` knobs, see plan Deviation 7 — the default ports are held by a pre-existing dev stack, a hard-line the human clears).

Full suites were not run (repo profile §3).

## Round 1

| Lane | Verdict | Blockers |
|---|---|---|
| 1 correctness | PASS_WITH_NITS | 0 |
| 2 code-quality | PASS_WITH_NITS | 0 |
| 3 security | PASS_WITH_NITS | 0 |
| 4 qa | **FAIL** | 6 (HIGH) |
| 5 plan | PASS | 0 |

### Lane 4 blockers (must-fix)

1. `apps/app/app/todos/page.tsx` — `/todos` list reached only for a heading + manifest assertion; list search/filters/fab never exercised.
2. `apps/app/app/todos/trash/page.tsx` — route has no test; only `/notes/trash` is driven by the journey.
3. `apps/app/app/notes/tags/page.tsx` — `ManagerBlock` route has no test.
4. `apps/app/app/todos/tags/page.tsx` — `ManagerBlock` route has no test.
5. `apps/app/app/todos/lists/page.tsx` — `ManagerBlock` route has no test.
6. `apps/app/app/todos/[id]/edit/page.tsx` — edit-loader/`EditorChrome` route has no test.

### Fix pass (round 1 → round 2)

Route-wiring tests added under `apps/app/test/` (assert the route→block element tree with
mocked clients; no rendering, no new test infrastructure). Only the QA lane is re-run;
passing lanes are not re-run.

## Round 2

Only lane 4 was re-run (passing lanes stand, per skill §5).

| Lane | Verdict | Blockers |
|---|---|---|
| 4 qa | **PASS** | 0 |

Lane 4 ran the permitted commands (14 suites / 68 tests green: ui 4/24, app-kit 5/23,
app 5/21) and closed all six blockers with citations into the new tests and the route
sources — each assertion would fail if the wiring broke. Nits it left open (non-blocking):
`routes-todos-list` does not assert `ListShell`'s `body`/`TodoList` wiring, and the
manager tests assert the child section component type rather than its rendered content;
both are thin-wrapper concerns already covered at the block level.

## Verdict

**5/5 PASS.** Gate closed on round 2. Nothing merged to `master`; merge awaits the user's
explicit request. The port-cleanup checklist (plan deviation 7) remains the human's.

