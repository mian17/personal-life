# Five-Lane Verification: shared UI primitives

Branch: `feature/ui-primitives`. Diff under review: `git diff master...HEAD` (chapter,
15 commits at final run). Run date: 2026-09-27.

## Final verdict: **N/N — MERGED** (`2873976 → 12ace81`, fast-forward)

Trail: suite gate green → lanes 1–5 fired in parallel → lanes 1 & 5 FAIL (4 MEDIUM
blockers) → one fix pass (`38c1247`, `tests_pass=true`) → failed lanes re-run only →
**5/5 PASS**.

Standing rule honored: the chapter stayed unmerged until the user's explicit merge
request (2026-09-27), after their own deploy + verification.

Human deploy + acceptance attestation (2026-09-27): the user deployed the stack
(`docker compose up -d --build`) and verified the live app ("i verified it", no
discrepancies). Deploy prerequisites discovered and fixed at deploy time (post-gate):
the three Dockerfiles lacked the `packages/ui` workspace (`12ace81`) — an honest gap
in the chapter plan (specs never covered deployment packaging); caught by the
pre-deploy verification build, human-verified after rollout.

## Suite gate (step 0) — GREEN

repo lint clean (4 workspaces) · `packages/ui` **26 suites / 156 tests** ·
`apps/app` **14 suites / 129 tests** · `next build` ✓ (single CSS chunk,
`globals.css` gone). Zero idp/note-service files in this diff — their suites are not
diff-attributable and were not run (cost discipline).

## Lane verdicts

| # | Lane | Verdict | Blockers | Notes |
|---|------|---------|----------|-------|
| 1 | correctness-domain (pixel identity) | **PASS_WITH_NITS** (re-run) | 0 | full legacy-rule value walk against the built CSS; engine bytes, hydration, debounce, theme contract all parity |
| 2 | code-quality | PASS_WITH_NITS | 0 | five axes; typing rigor, boundary hygiene, mapping tables verified accurate |
| 3 | security | **PASS** | 0 | injection/XSS clean, theme script unchanged, supply chain clean (1 workspace link + 54 dev-only packages), hard lines intact |
| 4 | qa-e2e | PASS_WITH_NITS | 0 | every acceptance behavior mapped to named passing tests; e2e suite byte-untouched; frozen selector surface verified in the ported markup |
| 5 | plan-conformance | **PASS_WITH_NITS** (re-run) | 0 | 24 components vs frozen contracts signature-by-signature; blast radii match every commit; forbidden surface absent |

## Fix pass (`38c1247`) — 4 blockers closed

- **`.note-delete` vs `.trash-delete` type metrics** (lane 1 MEDIUM): one danger rule
  was serving both legacy classes; legacy `.trash-delete` computed `16px/1.5` while
  `.note-delete` declared `1.25rem/1`. `Button` `size` now `'default'|'bare'|'icon'`
  — each call site computes its exact legacy value. (Icon-only button: no visible
  drift, but a changed computed value is a gate failure — fixed at value level.)
- **Tag-filter pills lost `next/link`** (lane 1 MEDIUM): `Pill as="a"` rendered a raw
  `<a>`; legacy pills soft-navigated. Anchor now routes through `next/link`
  (stub-asserted in tests).
- **Task 2 blast-radius record** (lane 5 MEDIUM): ledger amended (dated note) for the
  review-time `--on-accent` tokenization in `tokens.css`/token test.
- **SPEC-ui-tokens drift** (lane 5 MEDIUM): Code Style now records `--on-accent` and
  `--fs-editor`; frozen inventories unchanged (20 rem / 11 px).

## Recorded nits (non-blocking)

- Dead modifier classes: `ui-alert-banner--warning`, `ui-pill-group__label/__actions`
  (no CSS rules); harmless, candidates for a later tidy.
- `NavBar` renders `<nav>` where legacy rendered a `<div class="nav-bar">` — two
  navigation landmarks on home (spec-sanctioned; e2e queries no landmark).
- Bare-`h1` intermediate value unobservable (no bare `h1` in the app); `PageTitle`
  carries the combined `h1.page-title` value.
- Test nits: a dead assertion in `pill.test.tsx` ("types the tag as span|a"), a
  redundant `textarea` `it.each`, `classesOf` copied across suites, a
  `console.error`-emitting `button.test.tsx` case.
- `ListItem` `children` renders inside the row link — footgun for future interactive
  children (no current consumer).
- `Pill`/`IconLink`/`FabLink` forward unvalidated `href` (all current call sites are
  server-built; generic-package hardening note for later).
- `ConfirmButton` chains the caller's `onClick` even on confirm-cancel (no caller
  passes one); unnamed `nav` landmark; `--fs-editor` naming among `--font-*` tokens;
  `next` peer resolved via workspace hoisting; stale comment in `index.ts`.
- Ledger Task 3 text still says "Card (`.note` surface values)" while Task 8
  re-documented Card as generic-only (values true, wording stale).
- Port-level DOM-shape smoke test not built (spec marks it optional); composed labels
  (`Delete ${title}` etc.) pinned via passthrough + grep, not app-literal tests —
  the human e2e run is the backstop.

## Machine-readable verdicts

```json
{"suite_gate":"GREEN","lint":"clean","ui":"26/156","app":"14/129","build":"pass"}
{"round":1,"lanes":{"correctness-domain":"FAIL","code-quality":"PASS_WITH_NITS","security":"PASS","qa-e2e":"PASS_WITH_NITS","plan-conformance":"FAIL"},"blockers":4}
{"fix_pass":"38c1247","tests_pass":true,"fixed":["note-delete/trash-delete type metrics","Pill anchor next/link","Task 2 radius record","SPEC-ui-tokens drift"]}
{"round":2,"re_run":["correctness-domain","plan-conformance"],"lanes":{"correctness-domain":"PASS_WITH_NITS","code-quality":"PASS_WITH_NITS","security":"PASS","qa-e2e":"PASS_WITH_NITS","plan-conformance":"PASS_WITH_NITS"}}
{"gate":"MERGEABLE","score":"5/5","merge_condition":"N/N","merge_status":"MERGED","merged":"2026-09-27 fast-forward 2873976..12ace81","deploy":"human-deployed + verified 2026-09-27 (docker compose; Dockerfile workspace fix 12ace81 at deploy time)"}
```

## Next

Chapter closed. `@life/ui` is on `master` and in production (human-deployed and
verified 2026-09-27). The AGENTS.md Shared UI Contract governs all future frontend
work — next chapter candidates: `todo-service` (its UI assembles from `@life/ui`) or
the user's ruling.
