# 0006 — "Same in the UI" means whole-page blocks, not primitives

**Summary:** "Same in the UI" means whole-page blocks with props, scoped by consistency (spacing) not byte-similarity; inventory the layer before extracting.

**Date:** 2026-10-01 — interview for the notes/todos shared-UI refactor.

## The feedback

> "i mean everything that is the same in the UI, refactor them to shared packges"

> "whole page with props, margin and padding, spacing even, the main idea is consistency
> and reusability with DRY principle across the whole applications ecosystem"

## What it corrected

1. My framing assumed there was duplicated visual markup to find. The inventory showed
   Contract 1 had already prevented that: both segments render from `@life/ui` — zero bare
   `<button>/<input>`, zero inline styles, zero raw colors in `apps/app`. The duplication
   that survived is *page-shaped* (trash page, manager template, list shell, search box,
   editor chrome), a layer a primitive-level contract does not reach.
2. I read "common" as a line-dedup exercise. The intent was **consistency**: even
   margin/padding is the goal, DRY the mechanism. Two segments sharing structure but not
   spacing read as two different apps — which directly undercuts the per-route PWA identity
   work shipped just before this.

## The lesson

- When the ask is "refactor what's common", inventory first and state which layer the
  duplication actually lives at — primitive, page template, or behavior glue — before
  proposing a target package. The right home depends on the layer.
- Shared UI is scoped by *consistency*, not by byte-similarity. Extract **whole pages with
  props** (data + copy as parameters) so structure and spacing are owned in one place.
  Extracting fragments and re-assembling them per app leaves the assembly free to drift
  again, which is the problem being solved.
- Ask which layers are in scope explicitly rather than assuming: page templates + page
  behavior yes; the data layer (three `call<T>` API clients, the server-action quartet) no —
  that is backend-facing plumbing, not UI.
