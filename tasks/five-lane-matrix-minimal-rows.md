# Five-Lane Verification — minimal TickTick-style matrix rows

Gate: `five-lane-verification` (global §7 step 6). Branch `feat/matrix-refinements`.
Change: commit `275f2f5` — matrix rows (borderless leading tick, name + due label only,
dense) + one-line truncating quadrant headings; default `/todos` row unchanged.

## Suite gate (step 0) — GREEN

| Workspace | Command (chapter-scoped) | Result |
|---|---|---|
| `@life/ui` | `test:unit -- test/list-item.test.tsx test/matrix-block.test.tsx` | 19 passed |
| `@life/app` | `test:unit -- test/routes-matrix.test.tsx test/todo-item.test.tsx` | 9 passed |

Both `npm run typecheck` clean. `@life/shared` built. Four mutation checks (drop the label
ellipsis, raw-px the dense title, drop `mode="matrix"`, drop `leading`) each failed their
assertion — the tests bind. No Playwright E2E (profile/§3; visual + DOM/CSS wiring only).

## Round 1 — 5/5 PASS, zero blockers

| Lane | Verdict | Notes |
|---|---|---|
| Correctness / domain | PASS | Matrix branch returns before delete/snippet/list-name are constructed; default branch byte-equivalent; `leading` renders first; `dense`/label CSS token-only with the ellipsis trio. |
| Code quality | PASS_WITH_NITS | Contract 1 clean; `mode` seam proportionate; `leading`/`dense` are the right upstream slots; tests meaningful. Nits: self-closing `ListItem`, pre-existing dead `attached`/`Pill` imports, `dense` lowers type but not the `min-height` floor, `as any` fixture, `lists` unused by the matrix branch. |
| Security | PASS | No client/server leak, no `dangerouslySetInnerHTML`, server gate intact, `todo.title` escaped in JSX/aria. |
| QA | PASS | Each of D1–D4 has an existing passing test at the DOM/CSS level; no test freezes a defect. |
| Plan conformance | PASS | D1–D4 cited with line numbers across component/CSS/page/spec; L1–L8 / D1–D8 numbering consistent; frozen selector surface untouched. |

## Post-gate nits closed in the commit

- Stale anchor: MAP D6 / intent L5 cited `SPEC-matrix-ui.md:451-462`; the reversal note now
  lives at `:480-483` → anchors corrected.
- Self-closing the matrix `<ListItem />` (code-quality nit).

## Nits left (non-blocking, recorded)

- `dense` shrinks type only; `.ui-list-item` `min-height` floor is unchanged, so rows are
  not shorter overall. Consistent with the spec's "dense type" wording — revisit if compact
  row height is wanted.
- Pre-existing dead `attached` / `Pill` / `PillGroup` in `TodoItem` (not introduced here).
- `lists` is passed to `TodoItem` on the matrix lens but unused by the matrix branch.

## Verdict

Behaviour-change gate PASSED 5/5. Merge to `master` awaits the user's explicit request.
