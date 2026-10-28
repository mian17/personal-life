# shadcn primitive migration — five-lane gate

Gate over the change on `pi/wf/shadcn-primitive-migration`. Worktree
`.pi/worktrees/shadcn-primitive-migration`, base `origin/dev` (`3d1eb4f`).
Committed range `origin/dev...HEAD`: 13 commits, 115 files, +6530 −3449, tip `62461f5`.
Base checkout untouched.

Lanes: correctness, code-quality, security, qa, plan-conformance. Every lane read the
same shared context block and none saw another lane's verdict. Only failed lanes were
re-run; a fix pass never closed its own blocker.

**Result: 5/5 PASS after 3 rounds.** Verdicts accepted: `PASS` or `PASS_WITH_NITS`;
crash, missing verdict, or unrecognised verdict counted FAIL.

Run date: 2026-10-28.

## Per-lane evidence

| Lane | Verdict | Evidence |
|---|---|---|
| correctness | PASS | `npm run typecheck` 17 workspaces, `rc=0`, no diagnostics. `@life/ui` suite 61/61 suites, 536/536 tests, 11 snapshots, one run. Playwright 27 passed, 2 skipped (`hop.spec.ts`, `E2E_HOP=1`). Recorded verbatim in §8.1, §8.2, §8.11 of `docs/reports/shadcn-primitive-migration-2026-10-28.md`. |
| code-quality | PASS | Contract 1 greps clean: zero raw UI elements in `apps/*` source, zero `next/link`, colour literals only in `packages/ui/src/styles/tokens.css`, zero `atoms.css`/`blocks.css` imports in `packages/ui`. 13 components carry `focus-visible:outline-solid`, 11 carry `outline-none`, 0 raw `outline-2`/`outline-offset-2` — the §8.10 dead-ring repair. |
| security | PASS | `vbsec-reports/scan-2026-10-28-020144.md`, raw verdict below. |
| qa | PASS | Two test runs total, inside the `max-test-runs: 2` budget: full `@life/ui` suite, then a focused `theme-parity` + `tokens` run. One e2e run (27 passed, 2 env-gated skips). Zero failures, zero retries needed for green. |
| plan-conformance | PASS | All 41 tasks of `tasks/plan.md` implemented in the range; spec §8.1–§8.11 each pasted as it ran in the gate report. Provenance: 24 of 59 components carry a registry-item pointer, the other 35 each appear once in plan Decision 4 (35/35 matched). `apps/*` source delta is exactly the two files §8.1 sanctions. |

## Security scan — open it yourself

Path: `vbsec-reports/scan-2026-10-28-020144.md` (scope: committed range
`origin/dev...HEAD`, 115 files, mode LARGE, 21 checks passed).

Raw verdict, verbatim from the report:

```json
{"verdict":"PASS","summary":{"critical":0,"high":0,"medium":0,"low":0,"passed":21},"scope":"committed range origin/dev...HEAD","files_reviewed":115,"primary_language":"typescript","specialized_rules_used":true,"mode":"large","date":"2026-10-28","findings":[]}
```

Report headline: `## VERDICT: PASS` — no CRITICAL, no HIGH, no findings.

## Files the change touches

Committed range, `origin/dev...HEAD` (115 files):

- `packages/ui` — 103 files. 59 components under `src/components/` (24 converted from
  registry recipes, 35 kept or recomposed), their suites under `test/` (61 files),
  `test/__snapshots__/manager-markup.test.tsx.snap`, `src/styles/` (`atoms.css` and
  `blocks.css` deleted, `theme.css` added), `src/styles.css`, `vendor/shadcn/SNAPSHOT.md`,
  `package.json`.
- `apps/app` — 6 files. Two sanctioned source files (`app/todo-item.tsx` `DoneToggle`
  unwrap, `postcss.config.mjs`) and four test files whose markup pins tracked the
  registry replacement.
- `tasks/plan.md`, `tasks/todo.md`, `package-lock.json`, and three docs:
  `docs/specs/SPEC-ui-shadcn-primitives.md`, `docs/intent/shadcn-primitive-migration.md`,
  `docs/reports/shadcn-primitive-migration-2026-10-28.md`.

Uncommitted on top of `62461f5` (28 files, left for review): the gate round's own
repairs — 13 components gaining `focus-visible:outline-solid`, 10 test files with the
matching regression assertions, the `manager-markup` snapshot, `vendor/shadcn/SNAPSHOT.md`,
`tasks/plan.md`, `tasks/todo.md`, and the gate report.

## Residual risk — stated once

The committed range alone does not contain the §8.10 focus-ring repair: `HEAD:packages/ui/src/components/button.tsx`
still has `outline-2` and no `outline-solid`. The repair lives in 24 uncommitted files
(+128 −42). Commit them with the change, or the range ships the dead focus ring. Two
documentation nits ride along: `tasks/todo.md` has only Task 1 ticked (the file states the
boxes mirror the plan and are not an execution log), and `apps/app/app/feedback-row.tsx:22`
still names `atoms.css` in a comment — pre-existing text in a file this change never edits.

`kendex` is not on `PATH`, so the drift check could not run. Nothing here changes an
install; the overseer refreshes the base checkout after merge.

## State

Nothing pushed. Commit `62461f5` plus 28 uncommitted files sit on
`pi/wf/shadcn-primitive-migration` for the user's review.
