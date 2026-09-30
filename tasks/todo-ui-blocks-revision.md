# Task Ledger: Stack + Section → /todos parity (ui-blocks revision)

Plan: `tasks/plan-ui-blocks-revision.md` · Revision spec: `docs/specs/SPEC-ui-blocks-revision.md`
· Prop contracts (owner): `docs/specs/SPEC-ui-blocks.md` · Intent: `docs/intent/todos-presentation.md`.
Branch: `feature/todo-ecosystem`. Module id: `ui-blocks` (existing; the
`-ui-blocks-revision` filenames are just artifact filenames).

Process: global protocol (§5 template, §6 plan-validation gate, §7 review, §7.6
five-lane for feature work) + repo AGENTS.md (Project Profile, Contract 1/2).
Test runs stay within §3: targeted, named files only; the full suite is the tech
lead's final integrated run, and the user's e2e pass is separate.

## Tasks

- [ ] T1: `Stack` primitive — module `ui-blocks`
  - Description: add the vertical-rhythm stack container and its `StackGap` type.
  - Files: `packages/ui/src/components/stack.tsx` (new), `packages/ui/src/index.ts`,
    `packages/ui/src/styles/blocks.css`, `packages/ui/test/stack.test.tsx` (new),
    `docs/specs/SPEC-ui-blocks.md`.
  - Acceptance: renders a `div` with `display: grid` and the token gap per `gap`
    prop (`sm`/`md`/`lg` → `--space-0-5`/`--space-1`/`--space-2`, default `md`); no
    outer margins; `as`/`className`/ref/ARIA pass through; `StackGap` exported.
  - Verify: `npm run test:unit -w @life/ui -- test/stack.test.tsx` && `npm run typecheck -w @life/ui`.
  - Dependencies: none. Size: S.
- [ ] T2: `Section` primitive — module `ui-blocks`
  - Description: add the labelled section (heading + actions slot + `Stack` body).
  - Files: `packages/ui/src/components/section.tsx` (new), `packages/ui/src/index.ts`,
    `packages/ui/src/styles/blocks.css`, `packages/ui/test/section.test.tsx` (new),
    `docs/specs/SPEC-ui-blocks.md`, `docs/specs/MAP-ui-primitives.md`.
  - Acceptance: `<section>` wrapper → heading row (label at `headingLevel`, default
    h2; `actions` trailing) → `Stack` body with `gap` default `md`; `margin-block-start
    --space-2` on the section, `--space-0-5` on the heading; no `label` → no heading;
    className/ref pass through.
  - Verify: `npm run test:unit -w @life/ui -- test/section.test.tsx` && `npm run typecheck -w @life/ui`.
  - Dependencies: T1 (Section's body is a `Stack`). Size: S.
- [ ] T3: consume `Stack`/`Section` from `/todos` — module `ui-blocks`
  - Description: rewire the todo page's presentation onto the new primitives.
  - Files: `apps/app/app/todo-list.tsx`, `todo-composer.tsx`, `todo-item.tsx`,
    `list-manager-section.tsx`, `todos/page.tsx` (wraps the shared tag manager).
    `tag-manager-section.tsx` is NOT modified (shared with `/notes`).
  - Primitive reuse plan (Contract 1 delegation field): `todo-list.tsx` —
    `<Section label={group.label}>{<List>…</List>}</Section>` per group (drops the
    `PillGroup`-as-heading; the row stays `ListItem`). `todo-composer.tsx` — the
    `<div role="group" aria-label="New todo">` becomes `<Stack role="group"
    aria-label="New todo" gap="md">`; children unchanged (`Input`, `Textarea`,
    `Input type=date`, `IconButton`, `PillGroup` of list pills, `TagPicker`,
    `Button`). `todo-item.tsx` — the edit block's bare `<div>` becomes `<Stack>`;
    the attached-chip `PillGroup` and the Save/Cancel `PillGroup` stay (they are
    genuine pill rows); the row stays `ListItem`. `list-manager-section.tsx` — panel
    wrapped in `<Section label="Lists">`. `todos/page.tsx` — `<Section label="Tags">
    <TagManagerSection /></Section>`. No other primitives invented; no raw HTML.
  - Acceptance: no bare stacking `div` remains in the five files; `PillGroup`-as-heading
    gone; all five manager/group sections carry headings; `/notes` renders unchanged;
    no existing e2e selector/role/text changed (new group + manager heading roles are
    added and recorded — user-approved, no assertion added or changed).
  - Known coverage gap (explicit): the rewired files have no unit test — they are
    presentational; verification is typecheck + app build + the user's visual pass.
    `todo-groups.test.ts` is a non-regression guard on the grouping logic only.
  - Verify: `npm run test:unit -w @life/app -- test/todo-groups.test.ts` &&
    `npm run build -w @life/app` && `npm run typecheck -w @life/app`.
  - Dependencies: T1, T2. Size: S.
- [ ] T4: close — gate on the final state
  - Description: on completion re-run the five-lane gate across the chapter's final
    state and record it (`tasks/five-lane-todo-ecosystem.md` updated). `/todos`
    acceptance is the user's visual pass in `npm run dev`; the frozen Playwright
    suite is a `/notes` non-regression (it has no `/todos` navigation).
  - Verify: tech-lead integrated run (the named workspace suites + typecheck), then
    lanes. (No full-suite runner per §3.)
  - Dependencies: T1-T3. Size: S.

## Checkpoints

- After T2: `@life/ui` named suites green, Contract 1 mechanical checks clean.
- After T3: app suite + typecheck + build green.
- After T4: five-lane N/N; user visual sign-off.

## Gate log

- 2026-09-30: intent confirmed (interview-me) → using-agent-skills →
  spec-driven-development. Spec + plan + ledger written (`a57d5ab`).
- 2026-09-30: **§6 plan-validation round 1: FAIL, 12 findings** — folded
  (`ce33c07`): no invented module id (contracts owned by `SPEC-ui-blocks.md`),
  shared-file handling, commands scoped, `StackGap` pinned, labels/headingLevel
  specified, phantom actions row dropped, `Stack`/`Section` split, test paths
  enumerated.
- 2026-09-30: **§6 plan-validation round 2: FAIL, 12 findings** — folded: the
  orphaned manager-panel requirement restored by wrapping the `/todos` tag-manager
  call site at page level (`todos/page.tsx`; `tag-manager-section.tsx` still not
  modified), the added heading roles recorded as explicitly user-approved, the
  `Section` gap default pinned (`md`), `typecheck` scoped per workspace, the
  not-yet-passed gate wording corrected, T3 acceptance split (no change vs. new
  roles), T4's e2e note corrected (the frozen suite has no `/todos` navigation),
  the heading-query claim corrected, the residual `ui-layout` naming eliminated
  (files renamed `-ui-blocks-revision`), T3's primitive-reuse plan added, and the
  presentational coverage gap stated explicitly.
- 2026-09-30: **§6 plan-validation round 3: PLAN VALIDATED (0 findings)** — all 12
  round-2 items verified closed against the tree; whole-plan walk clean (coverage,
  commands, §5 compliance, frozen surface, root cause). **Gate open — implementation
  starts at T1.**
