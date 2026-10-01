# Five-Lane Verification — matrix 2×2 panels, full-height, list-row floor

Gate: `five-lane-verification` (global §7 step 6). Branch `feat/matrix-refinements`.
Review range: `c840673..HEAD` (list-row min-height · 2×2 muted panels + empty state ·
opt-in full-height `ListShell` + gate repair). Suite gate run first.

## Suite gate (step 0) — GREEN

| Workspace | Command (chapter-scoped) | Result |
|---|---|---|
| `@life/ui` | `npm run test:unit -- test/matrix-block.test.tsx test/list-shell.test.tsx test/list-item.test.tsx test/tokens.test.ts` | 36 passed |
| `@life/app` | `npm run test:unit -- test/routes-matrix.test.tsx` | 5 passed |

Both `npm run typecheck` clean (ui, app). Playwright E2E: not run (profile/§3; presentational
+ DOM/CSS wiring only — jsdom asserts the declaration contract, not computed geometry).

## Round 1 — 4 clean, QA must-fix; Round 2 — 5/5 PASS

| Lane | Round 1 | Round 2 | Blockers |
|---|---|---|---|
| Correctness / domain | PASS_WITH_NITS | (unchanged) | None — min-height calc = 4.725rem = 75.6px, token-only; 2×2 rows equal, no overflow; empty branch maps `items==null` → `.ui-matrix__empty`; the `fill` height chain is real and the fab reservation survives. |
| Code quality | PASS_WITH_NITS | (unchanged) | None — Contract 1 greps clean; `empty` slot keeps copy app-side; `.ui-matrix__empty` reuses existing muted/centered language; `ListShell.fill` is a sound opt-in, default DOM unchanged. |
| Security | PASS | (unchanged) | None — no server/client leak, no new fetch/authz, server gate intact, empty text is an inert app literal. |
| QA | **FAIL (1 MEDIUM)** | **PASS** | Round 1: the `fill` grow-CSS (`flex:1`, `100dvh` column) was DOM-wired but unasserted (deleting `flex:1` stayed green). Repair added the assertion; round 2 confirmed it is mutation-sensitive. |
| Plan conformance | PASS_WITH_NITS | PASS_WITH_NITS | None — D1–D4 evidenced with line numbers; both round-1 doc nits closed (stale `640px` comment removed; map D6 + intent L5 reconciled per lesson 0012). |

**Merge condition: N/N PASS (5/5) after the repair pass.**

### Repair pass (round 1 → 2), commit `2f63920`

- QA must-fix: `list-shell.test.tsx` now reads `blocks.css` and asserts
  `.ui-page.ui-list-shell--fill` (`display:flex; flex-direction:column; min-height:100dvh`)
  and `.ui-list-shell__body` (`flex:1; min-height:0`), token-guarded. Mutation-verified:
  deleting `flex:1` fails the test.
- Plan nit 1: removed the stale `640px` media clause from the `blocks.css` token-policy comment.
- Plan nit 2: `MAP-settings-and-matrix.md` D6 and `intent/eisenhower-matrix-and-settings.md`
  L5 now describe the shipped 2×2-panels-at-every-width design (lesson 0012 cross-chapter
  reconciliation), referencing the `SPEC-matrix-ui.md` reversal note.

### Nits recorded (non-blocking) and disposition

- Matrix route spec snippet omitted the `fill` prop → **fixed** (snippet + bullet).
- Stale "the one documented media-query breakpoint literal excepted" boundary clause in
  `SPEC-matrix-ui.md` → **fixed** (no such literal remains).
- `expect(matrix).not.toMatch(/border/)` guards the grid but not each quadrant → left as a nit.
- The "not media-gated" assertion only pattern-matches a `640px` block → left as a nit.
- `grid-auto-rows:1fr` equalizes rows within a row pair (q1↔q2, q3↔q4), not q1↔q3; spec wording
  is per-row → acceptable as recorded.

## Verdict

Behaviour-change gate PASSED 5/5. Merge to `master` awaits the user's explicit request.
