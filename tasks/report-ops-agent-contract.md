# Report — ops-agent-contract

Spec: `docs/specs/SPEC-ops-agent-contract.md` (validated, 3 validator rounds).
Plan: `tasks/plan-ops-agent-contract.md` (validated, 2 validator rounds). Intent:
`docs/intent/ops-agent-contract.md` (confirmed).

Branch: `pi/wf/ops-agent-contract`. Worktree:
`/home/night/WebstormProjects/personal-life/.pi/worktrees/ops-agent-contract`.
Base checkout `/home/night/WebstormProjects/personal-life` (on `master`) untouched.

**Branch point / seed commit:** no seed commit was created. HEAD already resolved,
so the worktree rule's `git init` + `--allow-empty` branch never fired. The branch
was cut from `fc10f7f` (`docs(research): MCP protocol CLI OAuth best-practice
deltas`), which is the tip of the stacked `pi/wf/ops-shared-package` chapter, not
`master`. Worktree HEAD is `77b46db`, four docs commits ahead of that point.

## Priority

1. **Nothing blocks merge.** Spec gate, plan gate, 7/7 tasks implemented, review
   lifecycle PASS (5 steps), five-lane gate 5/5 PASS after 2 rounds.
2. **The change is uncommitted.** 11 modified + 9 untracked paths in the worktree,
   on `pi/wf/ops-agent-contract`, nothing staged. Commit or discard before the
   worktree is pruned; an uncommitted worktree is the only copy.
3. **Residual risk** (§ below) — none of it is a gate failure, all of it is a
   deliberate deferral already recorded in the spec.

## Five-lane gate

5 lanes, 2 rounds. Round 1 re-ran only the failed lanes; the fix pass never closed
its own blockers. Every lane was handed the same shared context block (spec, plan,
diff, acceptance criteria) and none saw another lane's verdict. Accepted verdicts
were `PASS` and `PASS_WITH_NITS`; a crash, missing verdict, or unrecognised verdict
counts as FAIL. Final: **5/5 PASS**.

| Lane | Verdict | Evidence |
|---|---|---|
| Correctness / domain | PASS | lifecycle, `structuredContent`, deadline and token-rotation paths asserted in `packages/ops/test/mcp-lifecycle.test.ts` (28 tests) and `test/token-provider.test.ts` |
| Code quality | PASS | `npm run typecheck` clean in `packages/ops`; no new runtime dependency, `dependencies` stays absent |
| Security | PASS | `vbsec-reports/scan-2026-10-18-211023.md` — raw verdict `{"verdict":"PASS","summary":{"critical":0,"high":0,"medium":0,"low":0,"passed":11},"files_reviewed":21,"findings":[]}` |
| QA | PASS | `npm run test:unit -- test/mcp-lifecycle.test.ts` → 1 suite, 28 tests; `-- test/sdk-client.test.ts` → 1 suite, 5 tests (real stdio child through the official SDK) |
| Plan conformance | PASS | every acceptance criterion in Tasks 1–7 maps to a named test or a file in the change |

Reports are advisory artifacts, not a substitute for a human audit. Open the scan
report at the path above to read the 11 passed checks in full.

## Change (uncommitted)

Modified: `package-lock.json` (dev-only additions, 11 entries),
`packages/ops/package.json` (`exports` map + SDK/zod `devDependencies`),
`src/core/types.ts`, `src/core/registry.ts`, `src/index.ts`, `src/mcp/server.ts`,
`src/mcp/tools.ts`, `src/transport/errors.ts`, `src/transport/executor.ts`,
`test/transport.test.ts`, `test/validation-schema.test.ts`.

Untracked: `src/auth/token-provider.ts`, `test/mcp-lifecycle.test.ts`,
`test/package-surface.test.ts`, `test/sdk-client.test.ts`,
`test/token-provider.test.ts`, `test/support/service-module.ts`,
`test/support/transpile-require.cjs`, `tasks/plan-ops-agent-contract.md`,
`vbsec-reports/scan-2026-10-18-211023.md`, and this report.

## Residual risk (stated once)

- **No `dist` build is exercised.** `exports` resolution is asserted via a linked
  package and `import.meta.resolve` (`test/package-surface.test.ts`); the SDK
  conformance child runs from source through `test/support/transpile-require.cjs`.
  A broken `tsconfig.build.json` emit would not be caught here.
- **Cross-workspace consumption is unproven.** Spec §9.4 narrowed to package
  self-reference because no workspace depends on `@life/ops` yet.
- **Deadline changes CLI hang behaviour** — recorded deviation (§8), the accepted
  cost of keeping one executor for both adapters.
- **`vbsec-reports/` is not in `.gitignore`.** Committing the scan report is not
  intended; the report recommends adding the directory.
- `@modelcontextprotocol/sdk` landed as a `devDependency` under the spec's
  Ask-first rule; `dependencies` stays absent and no `src/` module imports it.
