# Task Ledger: Stack + Section → /todos parity (ui-blocks revision)

Plan: `tasks/plan-ui-layout.md` · Revision spec: `docs/specs/SPEC-ui-layout.md` ·
Prop contracts: `docs/specs/SPEC-ui-blocks.md` · Intent: `docs/intent/todos-presentation.md`.
Branch: `feature/todo-ecosystem`. Module id: `ui-blocks` (existing).

Process: global protocol (§5 template, §6 plan-validation gate, §7 review, §7.6
five-lane for feature work) + repo AGENTS.md (Project Profile, Contract 1/2).
UI feature → upstream-first; §6 passed before code; five-lane at close. Test runs
stay within §3: targeted, named files only; the full suite is the tech lead's final
integrated run and the user's e2e pass.

## Tasks

- [ ] T1: `Stack` primitive — module `ui-blocks`
  - Description: add the vertical-rhythm stack container and its `StackGap` type.
  - Files: `packages/ui/src/components/stack.tsx` (new), `packages/ui/src/index.ts`,
    `packages/ui/src/styles/blocks.css`, `packages/ui/test/stack.test.tsx` (new),
    `docs/specs/SPEC-ui-blocks.md`.
  - Acceptance: renders a `div` with `display: grid` and the token gap per `gap`
    prop (`sm`/`md`/`lg` → `--space-0-5`/`--space-1`/`--space-2`, default `md`); no
    outer margins; `as`/`className`/ref/ARIA pass through; `StackGap` exported.
  - Verify: `npm run test:unit -w @life/ui -- test/stack.test.tsx` && `npm run typecheck`.
  - Dependencies: none. Size: S.
- [ ] T2: `Section` primitive — module `ui-blocks`
  - Description: add the labelled section (heading + actions slot + `Stack` body).
  - Files: `packages/ui/src/components/section.tsx` (new), `packages/ui/src/index.ts`,
    `packages/ui/src/styles/blocks.css`, `packages/ui/test/section.test.tsx` (new),
    `docs/specs/SPEC-ui-blocks.md`, `docs/specs/MAP-ui-primitives.md`.
  - Acceptance: `<section>` wrapper → heading row (label at `headingLevel`, default
    h2; `actions` trailing) → `Stack` body; `margin-block-start --space-2` on the
    section, `--space-0-5` on the heading; no `label` → no heading; className/ref pass
    through.
  - Verify: `npm run test:unit -w @life/ui -- test/section.test.tsx` && `npm run typecheck`.
  - Dependencies: T1 (Section's body is a `Stack`). Size: S.
- [ ] T3: consume `Stack`/`Section` from `/todos` — module `ui-blocks`
  - Description: rewire the todo page's presentation onto the new primitives.
  - Files: `apps/app/app/todo-list.tsx` (Section per group), `todo-composer.tsx`
    (`Stack role="group" aria-label="New todo"`), `todo-item.tsx` (edit block →
    `Stack`; PillGroups kept), `list-manager-section.tsx` (`Section label="Lists"`).
    **`tag-manager-section.tsx` is NOT touched** (shared with `/notes`).
  - Acceptance: no bare stacking `div` remains in the four files; `PillGroup`-as-heading
    gone; `/notes` renders unchanged; frozen e2e text/roles unchanged (group headings
    added per the revision spec).
  - Verify: `npm run test:unit -w @life/app -- test/todo-groups.test.ts` &&
    `npm run build -w @life/app` && `npm run typecheck`.
  - Dependencies: T1, T2. Size: S.
- [ ] T4: close — gate on the final state
  - Description: on completion re-run the five-lane gate across the chapter's final
    state and record it; the user eyeballs `/todos` in `npm run dev` and runs the
    frozen Playwright suite (the human e2e pass).
  - Verify: tech-lead integrated run (the named workspace suites + typecheck), then
    lanes. (No full-suite runner per §3 — the user's e2e pass is separate.)
  - Dependencies: T1-T3. Size: S.

## Checkpoints

- After T2: `@life/ui` named suites green, Contract 1 mechanical checks clean.
- After T3: app suite + typecheck + build green.
- After T4: five-lane N/N; user visual sign-off.

## Gate log

- 2026-09-30: intent confirmed (interview-me) → using-agent-skills →
  spec-driven-development. Spec + plan + ledger written (`a57d5ab`).
- 2026-09-30: **§6 plan-validation round 1: FAIL, 12 findings** — all folded in:
  invented `ui-layout` module id dropped (module is `ui-blocks`; prop contracts moved
  to their owner `SPEC-ui-blocks.md`), the shared `tag-manager-section.tsx` removed
  from the blast radius (it renders on `/notes`), T3 Verify scoped to named files per
  §3, `StackGap` type pinned, manager labels/`headingLevel` specified, the phantom
  composer "actions row" deleted (Save/Cancel PillGroup explicitly kept), `Stack`/`Section`
  split into two bounded tasks, the added heading roles recorded, exact test files
  enumerated. §6 round 2: PENDING.
