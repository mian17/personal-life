# Task Ledger: ui-layout (Stack + Section → /todos parity)

Plan: `tasks/plan-ui-layout.md` · Spec: `docs/specs/SPEC-ui-layout.md` · Intent:
`docs/intent/todos-presentation.md`. Branch: `feature/todo-ecosystem`.

Process: global protocol (§5 template, §6 plan-validation gate, §7 review + §7.6
five-lane for feature work) + repo AGENTS.md (Project Profile, Contract 1/2). This
is a UI feature → upstream-first, §6 gate before code, five-lane at close.

## Tasks

- [ ] T1: `Stack` + `Section` primitives — module `ui-layout`
  - Description: add the two container primitives to `packages/ui` with tests and
    spec/map updates in the same change.
  - Files: `packages/ui/src/components/stack.tsx`, `section.tsx` (new),
    `packages/ui/src/index.ts`, `packages/ui/src/styles/blocks.css`,
    `packages/ui/test/**` (new suites), `docs/specs/SPEC-ui-blocks.md`,
    `docs/specs/MAP-ui-primitives.md`.
  - Acceptance: `Stack` grid + token gaps per prop; `Section` heading (h2/h3) +
    actions slot + `Stack` body; ARIA/ref/className pass-through; no new tokens.
  - Verify: `npm run test:unit -w @life/ui` && `npm run typecheck`.
  - Dependencies: none. Size: S–M.
- [ ] T2: consume `Stack`/`Section` from `/todos` — module `ui-layout`
  - Description: rewire the todo page's presentation onto the new primitives.
  - Files: `apps/app/app/todo-list.tsx`, `todo-composer.tsx`, `todo-item.tsx`,
    `list-manager-section.tsx`, `tag-manager-section.tsx`.
  - Acceptance: no bare stacking `div` in the todo components; `PillGroup`-as-heading
    gone; `/notes` untouched; frozen e2e text/roles unchanged.
  - Verify: `npm run test:unit -w @life/app` && `npm run build -w @life/app` &&
    `npm run typecheck`.
  - Dependencies: T1. Size: S.
- [ ] T3: close — gate on the final state
  - Description: §6 plan-validation was passed before T1; on completion re-run the
    five-lane gate across the chapter's final state and record it; the user eyeballs
    `/todos` in `npm run dev` and the frozen Playwright suite.
  - Verify: full suite gate (all workspaces) + typecheck, then lanes.
  - Dependencies: T1, T2. Size: S.

## Checkpoints

- After T1: `@life/ui` green, Contract 1 mechanical checks clean.
- After T2: app suite + typecheck + build green.
- After T3: five-lane N/N; user visual sign-off.

## Gate log

- 2026-09-30: intent confirmed (interview-me) → using-agent-skills →
  spec-driven-development. Spec + plan + ledger written. **§6 plan-validation gate:
  PENDING.**
