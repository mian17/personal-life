# Vendored shadcn/ui snapshot

The single pin for every shadcn/ui registry copy inside `packages/ui`. Files under
`packages/ui/src/components` are copied from this snapshot once and then theme-mapped in place;
nothing here is fetched at build or test time, and no shadcn npm package is installed.

Every vendored file cites this record on its first line, so a reader can trace a component back
to its registry item. The pointer carries the item name and the snapshot date, which is what spec
§5 asks of a provenance comment:

```tsx
// shadcn/ui registry copy (`button`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
```

## Pinned revision

| Field               | Value                                                        |
| ------------------- | ------------------------------------------------------------ |
| Snapshot revision   | `ui-registry-2026-10-26`                                     |
| Snapshot date       | 2026-10-26                                                   |
| Registry style      | `new-york-v4` (Tailwind v4 utilities, Radix behaviour)        |
| Item URL shape      | `https://ui.shadcn.com/r/styles/new-york-v4/<item>.json`      |
| Upstream commit     | unresolved — registry fetch blocked when this record was written; the dated tag is the pin until the next refresh resolves it |

The revision is a date-stamped tag of this snapshot, not a floating "latest". A refresh means a
new date, a new row per re-copied item, and a new first-line pointer in the affected files.

One item is fetched by its URL and pasted into `src/components`:

```bash
curl -sf https://ui.shadcn.com/r/styles/new-york-v4/button.json
```

The item URL is the whole pin: same URL, same date tag, same source.

## Attribution

shadcn/ui is MIT licensed; the licence notice and copyright line travel with the copied source
and are not stripped. Vendored files also carry the Radix UI primitives they import, likewise MIT.
That MIT notice plus the per-file one-line pointer is the attribution this repo records — spec §10
question 4 is answered by this section: no separate `NOTICE` file and no per-file licence header
beyond the pointer.

## Theme-mapping convention

Registry source arrives with Tailwind colour utilities that name our tokens without the leading
dashes:

| Registry utility | Resolves to token |
| ---------------- | ----------------- |
| `bg-accent`      | `--accent`        |
| `text-on-accent` | `--on-accent`     |
| `bg-danger`      | `--danger`        |

- Colour names equal token names minus `--`. The mapping itself lives in `src/styles/theme.css`
  under `@theme`, referencing `var(--…)`; `src/styles/tokens.css` stays the only file holding
  colour literals.
- Geometry, spacing, radii and type take shadcn defaults through the utility scale.
- cva variants, `data-slot` attributes and Radix behaviour stay exactly as vendored. The only
  edits a copy receives are class strings, the provenance pointer, and the inert `ui-*` compat
  hooks that keep existing `apps/*` locators working where the converted markup can carry them
  (plan Decision 1); where it cannot, the pinned assertion is updated in the same task.

## Vendored items

One row per copied registry item, appended in the same change that lands the copy; never rewrite a
row in place. The template:

```markdown
| `button` | `src/components/button.tsx` | `ui-registry-2026-10-26` | 4 |
```

| Registry item | Vendored file | Snapshot revision | Task |
| ------------- | ------------- | ----------------- | ---- |
| `button` | `src/components/button.tsx`, `src/components/icon-button.tsx` | `ui-registry-2026-10-26` | 4 |
| `checkbox` | `src/components/checkbox.tsx` | `ui-registry-2026-10-26` | 8 |
| `switch` | `src/components/switch.tsx` | `ui-registry-2026-10-26` | 8 |
| `dropdown-menu` | `src/components/menu.tsx` | `ui-registry-2026-10-26` | 19 |

## Recorded deviations

Per spec §9 assumption 1 a component kept as a recorded deviation, never half-migrated. There are
none: every component with a registry counterpart is the registry copy, and the no-counterpart
components are listed in `tasks/plan.md` Decision 4.

### Resolved — `checkbox` nesting

An earlier draft of this task vendored the registry `checkbox` **indicator** alone and recorded the
omission as deviation D1: `Checkbox` renders a `<button role="checkbox">` and its only consumer,
`DoneToggle` in `apps/app/app/todo-item.tsx`, wraps it in `IconButton` — also a `<button>` — so
backing the square with the Radix root nests one interactive control inside another.

The spec has no exemption list (§1) and §9.1 limits deviations to components with no shadcn
counterpart, and `checkbox` has one, so D1 was not a valid deviation. The atom is now the real
registry copy (`CheckboxPrimitive.Root` + `Indicator` + `Check`). Removing the nested `IconButton`
from `DoneToggle` is a composition change in `apps/*`, which `tasks/plan.md` keeps out of a
conversion task's blast radius; it belongs to the gate that owns `todo-item.tsx`, not to Task 8.
