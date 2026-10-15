# 0021 — Ground a plan in the existing code before validation, or the gate becomes whack-a-mole

**Summary:** Before writing specs/plans that extend an existing surface, read the real code that already owns the rules (cache package, existing helpers, root workspace list, test harness); ungrounded drafting makes the §6 gate surface your drafting errors one round at a time instead of converging.
- **Date:** 2026-10-02
- **Source:** user pushback during the meal-nutrition plan-validation loop

## Feedback

> "yousure this has been too much updating plan?"

Asked after four consecutive FAIL rounds of the §6 Plan Validation Gate (`tasks/plan-meal-nutrition.md`):
r1 found 8 issues, r2 found 5, r3 found 4, r4 found 10. The user was right: four repair rounds for one
plan is a symptom, not bad luck.

## What it corrected

The gate was doing its job — §6 has no round bound on purpose. The defect was upstream: the plan and
its four specs were written in one pass **without reading the code that already owned the rules they
touched**. Every round's findings were overwhelmingly my own drafting errors, and each was discoverable
by reading a file that already existed:

- **r3** — I invented `apps/app/lib/meal-today.ts` as the "single owner" of "which day is now" when
  `apps/app/lib/today.ts` (`getToday()`) already owned it, was already consumed by the todo routes, and
  was already tested. I wrote a duplicate owner into a spec whose stated purpose is preventing duplicate
  owners (lesson 0016) — caught only because a validator read the actual code.
- **r4** — my cache key table omitted the per-owner `<sub>` segment, contradicting `@life/cache`'s
  `createCache` shape and Contract 2 Rule 3. A plan built from that spec would emit owner-colliding cache
  keys. `packages/cache/src/index.ts` was right there and unread.
- **r4** — the plan prescribed `npm run … -w apps/meal-service` while never adding that workspace to the
  root `workspaces` array (explicit list, no glob), and prescribed `-w @life/nutrition` commands in tasks
  that ran before the workspace was registered. The root `package.json` was unread.
- **r4** — Task 5 verified a `test/health.e2e-spec.ts` no task created, and omitted `test/setup-env.ts`
  that the note-service-mirrored jest config requires. The existing harness was unread.
- **r2** — repairing the plan left the *spec* still carrying `MEAL_REDIS_URL`, so the fix re-opened the
  same defect from the other side (lesson 0012: intra-chapter validation cannot see a cross-chapter
  inconsistency the repair created).

Writing first and validating later made the §6 gate the **primary filter for drafting errors** it was
never meant to be. The gate is the last line, not the first reader.

## The lesson

- **Read the owning code before specifying a surface.** Any plan that extends an existing surface —
  a cache, a helper, a route, a workspace, an env file, a test harness — must first read the artifact
  that already owns that rule, and reconcile against it rather than restating it locally. Reading first
  is what makes the plan correct; validating first is what makes it iterate.
- **A repeated *class* of finding means the artifact is under-researched, not that the plan is hard.**
  When successive validation rounds surface the same kind of error (invented owner, invented convention,
  unregistered workspace), stop patching findings one at a time. Re-ground the whole artifact against
  real code and repair in one thorough pass.
- **Concrete pre-flight before writing specs/plans** for a new service/package in this repo:
  `packages/cache/src/index.ts` (key shape), root `package.json` `workspaces` (explicit list, no glob),
  the nearest existing service's `package.json` + `test/setup-env.ts` (jest harness), `apps/app/lib/*`
  (existing BFF/helpers — check for an owner before inventing one), `.env.example` + `compose.yaml`
  (env/audience/iinstance wiring), and the existing e2e spec layout.
- **Fixing a finding can create a new one.** After any repair, re-check the *neighbouring* artifacts
  (the spec the plan cites, the config the plan edits), not only the line that was flagged.
- **Repair in one pass, not one finding per round.** Multiple thin repairs multiply validation rounds;
  a single grounded rewrite converges.

## Applies to

Every new chapter/service/package that extends an existing surface in this repo, at the
`spec-driven-development` → `planning-and-task-breakdown` stage, before the §6 Plan Validation Gate.
Pairs with lesson 0012 (cross-chapter invariants) and lesson 0016 (one owner per rule) — 0012 says to
read the governing artifact, 0016 says not to duplicate the owner, and this lesson says to do both
*before* drafting rather than after the gate flags it.
