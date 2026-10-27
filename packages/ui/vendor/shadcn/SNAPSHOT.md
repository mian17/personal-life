# Vendored shadcn/ui snapshot

The single pin for every shadcn/ui registry copy inside `packages/ui`. Files under
`packages/ui/src/components` are copied from this snapshot once and then theme-mapped in place;
nothing here is fetched at build or test time, and no shadcn npm package is installed.

Every vendored file cites this record on its first line, so a reader can trace a component back
to its registry item:

```tsx
// shadcn/ui registry copy (`button`), snapshot `ui-registry-2026-10-26` — see vendor/shadcn/SNAPSHOT.md
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
  hooks that hold the frozen selector surface (plan Decision 1).

## Vendored items

One row per copied registry item. Append a row in the same change that lands the copy; never
rewrite a row in place.

| Registry item | Vendored file | Snapshot revision | Task |
| ------------- | ------------- | ----------------- | ---- |
