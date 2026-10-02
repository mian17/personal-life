# Five-Lane Verification Report — `todo-due-repeat-notify`

Branch: `feat/todo-due-repeat-notify`. Commit: `168272d feat(todos): due time, recurrence, and Web Push reminders`.
Gate: global §7.6. Verdict: **N/N PASS** at round 2 (after one fix pass).

## Suite gate (pre-lanes)

| Command | Result |
|---|---|
| `npm run build -w @life/shared` | PASS |
| `npm run typecheck -w @life/todo-service` | PASS (0 errors) |
| `npm run test:unit -w @life/todo-service -- due-time … ownership` (8 files) | PASS — 8/8 suites, 108 tests |
| `npm run typecheck -w @life/ui` | PASS |
| `npm run test:unit -w @life/ui -- format-date … due-date-pill` | PASS — 2/2, 38 tests |
| `npm run typecheck -w @life/app` | PASS |
| `npm run test:unit -w @life/app -- todo-item … push-toggle` | PASS — 4/4, 57 tests |

Total: 14 suites, 203 tests green.

## Round 1

| Lane | Verdict | Blockers |
|---|---|---|
| 1 Correctness/domain | FAIL | `recurrence.ts` `weekdays` emits an invalid date at month end (e.g. `2026-10-33`) — HIGH |
| 2 Code quality | FAIL | same HIGH; + 5 LOW nits |
| 3 Security | PASS_WITH_NITS | 2 LOW (endpoint scheme/length; blank key when unset) |
| 4 QA | PASS_WITH_NITS | 3 nits (cursor-shape assertion; 404 branch; re-arm-after-edit) |
| 5 Plan conformance | FAIL | same `recurrence.ts` HIGH; 2 nits |

## Fix pass (failed lanes 1/2/5)

- `apps/todo-service/src/todos/recurrence.ts`: the `weekdays` branch now calls `normalize(p)` inside the weekend-skip loop, so a Fri/weekend crossing a month end rolls into the next month instead of producing `YYYY-MM-DD-32/33`.
- `apps/todo-service/test/recurrence.test.ts`: added the month-end regression (`2026-10-30 → 2026-11-02`, `2026-01-30 → 2026-02-02`, and the `advanceToOnOrAfter` case).

## Round 2 (failed lanes re-run only)

| Lane | Verdict | Blockers |
|---|---|---|
| 1 Correctness/domain | PASS_WITH_NITS | none — fix verified by trace |
| 2 Code quality | PASS_WITH_NITS | none |
| 3 Security | PASS_WITH_NITS (round 1, standing) | — |
| 4 QA | PASS_WITH_NITS (round 1, standing) | — |
| 5 Plan conformance | PASS_WITH_NITS | none |

No commit occurred between rounds; the chapter committed only on N/N PASS.

## Carried nits (non-blocking; follow-ups)

- `recurrence.ts` local parse/pad/format overlaps `due-time.ts` — consolidate into one shared helper (lesson 0016).
- `reminders/reminder.service.ts` `titleAad` duplicates `todos.service.ts` `todoTitleAad` — export one owner.
- `push-client.ts` `PushResult.reason` is not surfaced by `PushToggle` on a failed subscribe.
- `format-date.ts` renders a malformed non-empty value as `''` vs the spec's `No date` (unreachable via `ISO_DUE`/DB).
- Repeat-option order renders `TODO_REPEATS` order (`Weekdays` second) vs the spec's cosmetic list.
- Security LOW: constrain the push `endpoint` to `https:` + length; fail closed on an unset VAPID public key.

## Recorded gap

The interactive iOS Web Push path (Home-Screen install → Allow tap → real notification) is a user-run dev check; no automated suite can exercise Apple's push service.
