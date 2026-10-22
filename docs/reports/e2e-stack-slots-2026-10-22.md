# Report: e2e stack slots — fair cross-worktree e2e isolation (2026-10-22)

**Verdict: PASS** — every hard gate passed. Change is **committed** on the worktree branch,
unmerged; base checkout untouched.

- Repo/worktree: `/home/night/WebstormProjects/personal-life/.pi/worktrees/e2e-stack-slots`
- Branch: `pi/wf/e2e-stack-slots` (base `master` untouched)
- Committed range: `5101055...HEAD` — `481a09d test(e2e): slot-derived stack isolation with a cross-worktree queue`, `2763c48 fix(app): hop the loopback login to localhost before setting the attempt cookie`, `d52df29 docs(e2e): put the loopback login hop in the slot spec's scope`
- Spec: `docs/specs/SPEC-e2e-stack-slots.md` (frozen, validated) · Intent: `docs/intent/e2e-stack-slots.md` (confirmed) · Plan: `tasks/plan.md` (6 tasks)
- Five-lane gate: **5/5 PASS, 1 round**

## Gates

| Gate | Result | Evidence |
|---|---|---|
| Intent | confirmed | `docs/intent/e2e-stack-slots.md` — six-line restate + `Confirmed: yes` |
| Spec | VALIDATED | `docs/specs/SPEC-e2e-stack-slots.md` — AC1–AC5, §8 success criteria |
| Plan | VALIDATED | `tasks/plan.md` — 6 tasks, checkpoint after 1–3 and 4–5 |
| Implementation | 6/6 tasks; typecheck + targeted unit green | `apps/app/test/slot-queue.test.ts` (22), `apps/app/test/slot-ports.test.ts` (6), `apps/app/test/origin.test.ts` (12) |
| Review lifecycle | PASS (5 steps) | — |
| Five-lane gate | 5/5 PASS, 1 round | correctness, code-quality, security, qa, plan-conformance — each lane saw only the shared context block, none saw another lane's verdict; only failed lanes would have been re-run (none failed); fix pass never closes its own blockers |

## Change — files touched (25 committed)

Added (5):
`apps/app/test/e2e/slot-queue.ts` (496) — machine-scoped FIFO claim/release, stale reclaim,
measured ETA, `E2E_QUEUE_BUSY` / `E2E_QUEUE_TIMEOUT`, exit 75;
`apps/app/test/slot-queue.test.ts` (296), `apps/app/test/slot-ports.test.ts` (113),
`docs/intent/e2e-stack-slots.md`, `docs/specs/SPEC-e2e-stack-slots.md`, `tasks/plan.md`.

Modified — harness wiring (11):
`apps/app/test/e2e/config.ts`, `global-setup.ts`, `global-setup.dev.ts`,
`global-teardown.ts`, `global-teardown.dev.ts`, `teardown.ts`, `stack.ts`,
`degraded-app.ts`, `hop-app.ts`, `playwright.config.ts`, `playwright.dev.config.ts`.

Modified — loopback login hop (4):
`apps/app/app/auth/login/route.ts`, `apps/app/lib/auth/origin.ts`,
`apps/app/test/origin.test.ts`, `apps/app/middleware.ts`.

Modified — spec callsites and repo hygiene (4):
`apps/app/test/e2e/access-gate.spec.ts`, `apps/app/test/e2e/journey.prod.spec.ts`,
`apps/app/test/e2e/dev/journey.dev.spec.ts` (port references now slot-derived),
`apps/app/.gitignore` (ignores the runtime `service-slot.json`).

## Security lane

Scan report: `vbsec-reports/scan-2026-10-22-164436.md` — raw verdict line 10 is
`## VERDICT: PASS`; the machine summary at line 64 reads
`{"verdict":"PASS","summary":{"critical":0,"high":0,"medium":0,"low":0,"passed":21},...}`.
Scope of that scan: the same committed range `5101055...HEAD`, 25 files, TypeScript overlay,
mode LARGE. The two L1 surfaces the change touches — the loopback redirect construction in
`origin.ts`/`route.ts` (`requestOrigin` canonicalises to a constant origin, `sanitizeReturnTo`
still gates `returnTo`, no new server-side fetch) and the temp-directory queue (paths composed
from `queueDirectory()` plus numeric slot/pid names, never from an interpolated env value) —
stay inside their rule's trust boundary. No new credential, no new dependency.

## Residual risk

Two working-tree side effects are **not** in the committed range: `apps/app/next-env.d.ts`
carries a Next-regenerated 2-line import rewrite (`.next/types` → `.next/dev/types`) from a
dev-mode run, and `apps/app/AGENTS.md` is untracked (Next.js agent-rules drop). Review before
committing or discarding. Beyond that: the queue's fairness and stale-reclaim guarantees are
POSIX-pid based and machine-scoped by design (cross-machine locking is explicitly out of
scope), and Playwright still does not retry a queued-out attempt itself — the caller honours
`retryAfter`.
