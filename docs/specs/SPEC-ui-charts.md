# Spec: `ui-charts` — chart + progress primitives for `@life/ui`

Module id: `ui-charts` (from the capability map `MAP-pomodoro-focus-stats.md`, whose §0
surfaces the run's assumptions before this spec's content; module-specific ones are in
§9). Serves the confirmed intent in `docs/intent/pomodoro-focus-stats.md`. This is
Contract 1 Rule 3's spec-first step: the implementation also restores
`MAP-ui-primitives.md` from `d1f54c9^` and registers the new components there.

## 1. Objective

For the repository owner (375 px iPhone SE first, desktop second): every chart in this
initiative is drawn by one `@life/ui` wrapper, so tokens, radii, axis treatment,
target-line semantics and accessibility are owned once — one styling change moves every
app — and no app ever imports `recharts`.

The module's whole surface:

- **`BarChart`** (name finalised at plan time, exported from `@life/ui`): wraps recharts
  bars. Props: `data: { label: string; value: number; target?: number }[]`, plus an
  accessible name. `value` is the bucket's minutes; `target` is that bucket's goal.
- **`ProgressBar`**: the intent's "plain `width:%` div" for today's bar — a plain div
  fill (percent width) styled from tokens. Not a chart.

Acceptance criteria:

- `apps/*` contains zero `recharts` imports; these wrapper files are recharts' only
  consumer.
- The wrappers style exclusively with `var(--…)` token references (fills, strokes, radii,
  axis colours); no colour literal exists in their source.
- Target-line semantics live here and nowhere else: each bucket may carry a `target`;
  the wrapper draws the targets as one stepped reference line over the bars (a straight
  line when the targets are equal), in the target token colour, labelled accessibly.
- 375 px: the wrapper thins x-axis ticks so 30 daily bars stay legible (at most 7
  labelled ticks) and never forces a wider screen.
- Accessibility is decided here: every chart exposes `role="img"` with an `aria-label`
  summary and a visually-hidden text alternative of its data (the numbers behind the
  bars), so screen-reader users get the same facts.
- `ProgressBar` reads `aria-valuenow`/`aria-valuemin`/`aria-valuemax` semantics (or an
  equivalent accessible label carrying the percentage) — decided here, not per app.
- Frozen token values (`packages/ui/test/tokens.test.ts`) are untouched.

## 2. Tech Stack

- TypeScript 5.7.x, React 19.x in `packages/ui` (`@life/ui`); jest 29.7.x + ts-jest +
  jsdom + @testing-library/react (already configured there).
- New dependency (approved by the intent): `recharts`, declared in `packages/ui` only.
- Styling: `var(--…)` from `packages/ui/src/styles/tokens.css` only — compatible with
  the current stylesheet and with the in-flight shadcn/Tailwind migration
  (`SPEC-ui-shadcn-primitives`); this module adds no stylesheet and no colour literal.

## 3. Commands

Repo profile commands only. The repo profile has no build knob, so this spec adds no
build step.

```bash
# typecheck — run in the touched workspace
npm run typecheck -w @life/ui
# typecheck — all workspaces (before handing the PR over)
npm run typecheck

# unit tests — one file, from the owning workspace; max 2 runs per command
npm run test:unit -w @life/ui -- test/bar-chart.test.tsx
```

## 4. Project Structure

```
packages/ui/src/components/bar-chart.tsx      the recharts wrapper (recharts' only home)
packages/ui/src/components/progress-bar.tsx   the plain width:% bar
packages/ui/src/index.ts                      exports both, like every primitive
packages/ui/test/bar-chart.test.tsx           wrapper suite
packages/ui/test/progress-bar.test.tsx        bar suite
packages/ui/test/tokens.test.ts               frozen value table — untouched
docs/specs/SPEC-ui-charts.md                  this spec
MAP-ui-primitives.md (docs/specs/)            restored from d1f54c9^, both components registered
```

## 5. Code Style

Small function components, prop types exported beside them, dense intent comments — the
existing `packages/ui` voice. Token strings are `var(--…)` references only:

```tsx
// packages/ui/src/components/progress-bar.tsx — the intent's "plain width:% div",
// promoted to a primitive so no app hand-rolls a styled div (Contract 1, Rule 1).
export interface ProgressBarProps {
  /** Percent filled, 0–100; the caller clamps. */
  value: number;
  /** Accessible name, e.g. "Today: 20 of 30 minutes". */
  label: string;
}

export function ProgressBar({ value, label }: Readonly<ProgressBarProps>) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className="progress-track"
    >
      <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
```

```tsx
// packages/ui/src/components/bar-chart.tsx — token references only; recharts defaults
// (which carry their own colours) are overridden everywhere a colour appears.
<BarChart data={data}>
  <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} />
  <ReferenceLine stroke="var(--amber)" strokeDasharray="4 4" />
  <XAxis tick={{ fill: 'var(--muted)' }} stroke="var(--border)" />
</BarChart>
```

(The radius and axis treatment above are the wrapper's decisions — apps never repeat
them.)

## 6. Testing Strategy

- Framework: jest + jsdom + @testing-library/react, suites in `packages/ui/test/`, one
  per component.
- `bar-chart.test.tsx` asserts: each bucket renders a bar at its `value`; per-bucket
  `target` renders as one stepped reference line at the right values; every colour
  attribute the wrapper renders is a `var(--…)` reference; `role="img"` + `aria-label`
  and the visually-hidden data alternative are present; 30 buckets render at most 7
  labelled x-ticks (the tick-thinning policy is a pure function the suite pins).
- `progress-bar.test.tsx` asserts: the fill width is the clamped percent, the
  `progressbar` role semantics, and that it does not depend on recharts.
- `packages/ui/test/tokens.test.ts` stays byte-identical and green.
- Levels: component unit only; the consuming surface's behaviour is e2e'd by
  `pomodoro-stats`. No screenshot baselines, no Storybook.
- Budget: max 2 runs per command.

## 7. Boundaries

**Always do**

- Style through tokens (`var(--…)`); own radius, axis, target-line and accessibility
  semantics in these two files.
- Keep the props minimal (`data` + labels; `target` per bucket) and export through
  `src/index.ts`.
- Register both components in `MAP-ui-primitives.md` (restored from `d1f54c9^`) in the
  same change (Contract 1, Rule 3).
- Run `npm run typecheck -w @life/ui`, the touched suites, and the Contract 1 mechanical
  greps (colour literals only in `tokens.css`, no raw HTML in apps, no `note`/`trash`/
  `tag-chip` identifiers in `packages/ui/src` code) at every review touching UI.

**Ask first**

- Any dependency beyond `recharts`.
- Any edit to `packages/ui/test/tokens.test.ts` or PWA constants.
- Prop renames once downstream consumption has started (the contract is this spec's).

**Never do**

- Let `apps/*` import `recharts`, or copy chart code into an app.
- Put a colour literal or raw length in the wrappers; change a token value.
- Add a second stylesheet, or conflict with the shadcn/Tailwind migration's layering.
- Grow the surface beyond what this initiative needs (line/area variants, legends,
  tooltips configs — YAGNI until a consumer asks).
- Add a build command or a build step (the repo profile declares none).
- Widen the test commands or exceed 2 runs per command.
- Merge the PR or push to `main`/`dev`.

## 8. Success Criteria

1. `npm run typecheck -w @life/ui` is green; `npm run test:unit -w @life/ui -- <file>` is
   green for both suites within 2 runs.
2. `grep -rn "recharts" apps --include='*.ts*'` returns zero hits.
3. `grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'` hits
   only `packages/ui/src/styles/tokens.css`, and no colour literal exists in the two
   component files.
4. `packages/ui/test/tokens.test.ts` is byte-identical to `origin/dev` and green.
5. `bar-chart.test.tsx` proves the target-line semantics (stepped line over per-bucket
   targets), the tick-thinning policy (≤ 7 labelled ticks for 30 buckets, thinned against
   the plot width recharts measured so neighbouring labels never touch), token-only
   colouring, a bar drawn for a zero-minute bucket (a `0` draws a 2 px hairline rather than
   nothing, so an empty day never reads as missing data), and the accessible name +
   visually-hidden data alternative.
6. `progress-bar.test.tsx` proves the plain `width:%` fill, the `progressbar` semantics,
   and zero recharts coupling.
7. `MAP-ui-primitives.md` (restored from `d1f54c9^`) lists both components with the
   `MAP-ui-primitives` entry shape.
8. Every colour attribute rendered by the wrappers resolves through a `var(--…)` chain
   to a frozen token value (the `SPEC-ui-shadcn-primitives` theme-parity pattern).

## 9. Assumptions

1. Component names `BarChart` and `ProgressBar`, exported from `@life/ui`; final names
   land at plan time and are registered in `MAP-ui-primitives.md` (map §0.14).
2. Target-line semantics (map §0.13): per-bucket `target` drawn as one stepped
   reference line — straight when equal. Apps pass numbers and never decide how a
   target looks.
3. `ProgressBar` is the intent's "plain `width:%` div" promoted to a primitive, because
   a styled div hand-rolled in `apps/*` violates Contract 1 Rule 1.
4. `recharts` is the only new dependency and lives in `packages/ui` (map §0, item on
   charts).
5. Accessibility minimum is `role="img"` + `aria-label` + a visually-hidden data
   alternative; if a real screen-reader pass says a table is required, it is added here,
   not per app.
6. The wrappers must render under both today's stylesheet and the in-flight
   shadcn/Tailwind theme (`SPEC-ui-shadcn-primitives`) because they only reference
   `var(--…)` tokens.

## 10. Open Questions

1. If map §0.11's reading is corrected and a second, distinct "trend" visualization is
   wanted, it lands here as one more wrapper — say so before the plan freezes.
2. The tick-thinning numbers (≤ 7 labelled ticks at 30 buckets) are tuned at plan/impl
   against a real 375 px render; the confirming check is `pomodoro-stats`'s 375 px e2e.
3. Whether the visually-hidden data alternative should be a `<table>` (more verbose,
   better for some screen readers) or a summary list — decided here once, after one
   accessibility pass.
