# Spec: meal-capture-ui

Module id: `meal-capture-ui` (see `MAP-meal-nutrition.md`). Depends on: `meal-service`.

## Objective

The user-facing surface: the three entry doors, the review-and-correct step, the day view with
total vs target, and the saved-meals list.

This module introduces **no visual language of its own**. Every element composes a `@life/ui`
primitive; any gap is fixed upstream in `packages/ui` per Contract 1 Rule 3, never patched here.

**User:** me, daily, mostly on a phone.
**Success:** logging a real meal takes seconds; a wrong guess is correctable without retyping;
the day's number is always the sum of what I confirmed.

## Tech Stack

- Next.js 15 App Router routes inside the existing `apps/app` (not a new frontend).
- Server components + server actions; the browser never calls `meal-service` directly. Data
  reaches the page through `apps/app/lib/meal-api.ts` (`import 'server-only'`,
  `callService(process.env.MEAL_API_URL, …)`) — the same shape as `lib/todo-api.ts`.
- `@life/ui` primitives + tokens only; `@life/nutrition` for units, davis and `%DV` rendering.

## Commands

```
typecheck:  npm run typecheck -w apps/app
test:unit:  npm run test:unit -w apps/app -- <file>
e2e (single spec): npx playwright test --config apps/app/playwright.config.ts <file> -g "<name>"
```

## Project Structure

```
apps/app/
  lib/meal-api.ts                 # server-only BFF client (the only caller of meal-service)
  app/(meals)/meals/page.tsx      # today: total vs target, meal groups, three doors
  app/(meals)/meals/[date]/…      # a specific day
  app/(meals)/meals/entry/[id]/…  # review-correct editor for one entry
  app/(meals)/meals/saved/…       # saved meals list + one-tap re-log
  app/(meals)/meals/target/…      # profile → target onboarding
  app/(meals)/meals/actions.ts    # server actions
  test/meal-*.test.ts
  test/e2e/meals.spec.ts
```

Route group `(meals)` mirrors how the todo app is mounted; each top-level route keeps the
app's existing shell, nav, and PWA identity (lesson 0005 — own route, own return).

## Code Style

Compose, never hand-roll. A meal row is `ListItem`, actions are `Button`/`IconButton`, the photo
door uses the existing attachment/upload primitives if present (otherwise a new atom goes
upstream first), the empty day is `EmptyState`, banners are `AlertBanner`, the picker is `Menu`
or `PillGroup`, forms use `Input`/`Select`/`Textarea`.

```tsx
// Illustrative — every element is a primitive; no raw <button>/<div className>.
<List>
  {entries.map((e) => (
    <ListItem key={e.id} variant="meal" title={e.label} meta={formatCalories(e.calories)} />
  ))}
</List>
```

- Nutrient display strings come from `@life/nutrition`'s formatter. **No app-local unit or
  `%DV` formatting** — a second copy of that table is the drift this feature cannot afford.
- Never show a fabricated `0` for an estimated-but-unknown value; render the model's
  "unknown" affordance (an em dash) — the intent doc's "must never invent numbers".
- Any inline hint text on the photo door is `Textarea` (optional, clearly labelled as
  steering the guess, not correcting it).

## Date rules

- **"Today" is the client's day, and its single owner already exists: `apps/app/lib/today.ts`
  (`getToday()`).** The meals routes import it exactly as the todo routes do — **no second
  owner is created** (lesson 0016; a duplicate was caught in plan validation and removed).
  `getToday()` reads the browser's IANA zone from the existing `tz` cookie (written by
  `<TimeZoneSync>`) and falls back to `FALLBACK_TZ`, so a host-clock "today" never enters a
  request path (lesson 0019). Production is UTC and the user is UTC+7, so a host-clock day
  would be wrong for the first seven hours of every local day.
- The service receives the resolved `YYYY-MM-DD` from the BFF and never re-derives it.
- Rendering a stored date uses the existing `@life/ui` helper (dd/mm/yyyy; relative text for
  Today/Tomorrow). No `toLocale*`, no ad-hoc `toISOString().slice(0,10)` (lesson 0003).

## Testing Strategy

| Concern | Test level | Why |
|---|---|---|
| Three doors all reachable from the day view | e2e | it is the product's main promise |
| Photo failure opens manual entry, shows no invented numbers | e2e | the specific correctness rule from the intent doc |
| Correct-then-save persists the corrected vector | e2e | the accuracy mechanism |
| Saved meal re-logs snapshot values, not a re-guess | e2e | the payoff of correcting once |
| Day total equals sum of confirmed entries | e2e | the number the app exists to show |
| "Today" across the midnight boundary in UTC+7 | unit | lesson 0019 regression guard |

Unit tests use the same stub pattern as the existing app tests. E2E uses the repo's single-spec
invocation and the frozen selector surface (roles, visible text, aria-labels — never change one
without explicit approval).

## Boundaries

- **Always:** compose `@life/ui` primitives; route data through the BFF; resolve "today" from
  the client's zone; render model-provided units; keep the review step before any save.
- **Ask first:** changing the frozen e2e selector surface; any new `packages/ui` primitive or
  token; adding a route outside the meals group.
- **Never:** raw `<button>`/`<input>`/`<img>`/`<label>` or styled `<div>` in UI code (Contract 1
  Rule 1); app-local CSS beyond tokens; a second copy of nutrient unit formatting; calling
  Gemini or `meal-service` from the browser; fabricating a `0` for an unknown value.

## Success Criteria

1. `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'`
   returns zero hits in the meals code (exemptions only).
2. `grep -rn "next/link" apps --include='*.tsx'` returns zero hits in the meals code.
3. Raw colour/length literals appear only in `packages/ui/src/styles/tokens.css`.
4. All five e2e concerns above pass on a single-spec run; the midnight-boundary unit test passes.
5. Loading a day, photographing a meal, correcting it, and saving it works end-to-end without a
   page reload that loses state.
