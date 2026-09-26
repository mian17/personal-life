# Spec: ui-atoms — fixed-API visual primitives

Module id: `ui-atoms` (map: `docs/specs/MAP-ui-primitives.md`). Depends on `ui-tokens`.

## Objective

The atom layer of `@life/ui`: small, fixed-API, app-agnostic components that render the
notes app's current visuals exactly. Success = every atom is importable by a future app
with zero notes-specific knowledge, and the notes app can drop its hand-rolled markup
for these without any visible change.

## Components (prop contracts)

```tsx
// All atoms: className passthrough (frozen e2e hooks ride on it), no style props.
<Button variant="primary" | "ghost" | "danger" size="default" | "bare"
        type="submit" | "button" onClick? formAction? aria-label? title?>
<IconButton label: string            // renders aria-label={label} — text is part of the frozen contract
            variant="default" | "ghost">
<Input type? placeholder? aria-label? name? defaultValue? onChange? />
<Textarea aria-label? placeholder? rows? name? defaultValue? onChange? />
<Pill size="chip" | "filter" active? as="span" | "a" href? />
<Card>children</Card>                // the .note surface: panel bg, radius-lg, overflow hidden
<StatusText aria-live="polite">children</StatusText>
<LocalTime dateTime: string />       // renders empty pre-hydration (locale mismatch guard)
<ConfirmButton message: string>children</ConfirmButton>  // window.confirm gate on submit
<ThemeToggle />                      // system→light→dark cycle, aria-pressed, localStorage('theme')
```

Mapping from today: `Button` absorbs the global `button` rule + all overrides
(`.note-delete`, `.trash-restore`, `.trash-delete`, `.trash-empty`, `.editor-back`,
`.editor-save`, `.tag-chip-remove`, conflict buttons); `IconButton` absorbs the 40×40
bordered square (`.header-icon`, `.theme-toggle`, `.editor-back`, `.editor-save`);
`Pill` absorbs `.tag-chip`/`.tag-chip-remove`/`.filters a` pills; `LocalTime` /
`ConfirmButton` / `ThemeToggle` are direct generalizations of `app/local-time.tsx`,
`app/confirm-submit.tsx`, `app/theme-toggle.tsx`.

## Tech Stack

React 19 function components (TSX source). CSS in `@life/ui/styles.css`, class names
`ui-<component>[--<variant>]` — generic, never notes-shaped. Styling values come only
from `ui-tokens` tokens.

## Commands

- `npm run lint -w packages/ui`
- `npm run test -w packages/ui`

## Project Structure

```
packages/ui/src/components/button.tsx        # one file per atom
packages/ui/src/index.ts                     # barrel
packages/ui/src/styles/atoms.css             # imported by styles.css
packages/ui/test/*.test.tsx                  # one suite per atom
```

## Code Style

```tsx
export function IconButton({ label, variant = 'default', className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cx('ui-icon-btn', variant !== 'default' && `ui-icon-btn--${variant}`, className)}
      {...rest}
    />
  );
}
```

`cx` is the only util: joins truthy class strings. No style props, no polymorphism
except the two `Pill` render tags.

## Testing Strategy

Rendering + behavior unit tests per atom. Harness: jest + `jsdom` +
`@testing-library/react` (devDependencies of `packages/ui` only — the map's single
dependency addition; fallback if disallowed: `renderToStaticMarkup` markup assertions
in the node environment, behavior checks via stubbed globals). Cover: rendered DOM
classes/roles/labels, `ConfirmButton` cancel path does not submit, `ThemeToggle`
cycling + `aria-pressed`, `LocalTime` empty-first render, keyboard focusability.

## Boundaries

- Always: preserve every ARIA label the e2e suite can see; `className` merges, never
  replaces; forward refs/HTML attrs.
- Ask first: new dependencies; new atoms not in the list above; any prop that takes a
  style value.
- Never: import app code (types may come from `@life/shared` only); encode notes
  domain (names, verbs, copy) in props or class names; run e2e.

## Success Criteria

1. All 10 atoms render with computed styles identical to today's equivalents.
2. Frozen e2e surface preserved through `className` passthrough (labels verbatim).
3. Unit tests green for every atom; `npm run lint -w packages/ui` clean.
4. Zero notes-specific names in `packages/ui` (grep-enforced in review).

## Open Questions

- `jsdom` + `@testing-library/react` as `packages/ui` devDependencies: recommended
  (needs a test harness for behavior contracts). Fallback documented in Testing.
