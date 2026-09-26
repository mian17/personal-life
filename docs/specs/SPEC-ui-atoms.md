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
// Element semantics are frozen: today's anchors render as links, today's buttons
// as buttons — an atom never swaps the element type.
<Button children: ReactNode
        variant="primary" | "ghost" | "danger" | "quiet" size="default" | "bare"
        type="submit" | "button" onClick? formAction? aria-label? title?>
<IconButton label: string            // <button>; renders aria-label={label} — frozen text
            children: ReactNode      // the icon
            variant="default" | "ghost">
<IconLink href label>children</IconLink>  // <a>/<Link> with the 40×40 bordered visual
<Input type? placeholder? aria-label? name? defaultValue? onChange? />
<Textarea aria-label? placeholder? rows? name? defaultValue? onChange?
          variant="default" | "editor" />   // "editor" reproduces .editor-body values
<Pill size="chip" | "filter" active? as="span" | "a" href?
     onRemove?: () => void removeLabel?: string />
   // remove affordance lives inside the chip (owns .tag-chip-remove);
   //   removeLabel renders verbatim as the remove button's aria-label (frozen)
<Card>children</Card>                // generic panel surface atom (token values match the
                                   //   legacy .note surface); no legacy class
                                   //   counterpart in the shipped app — the `.note`
                                   //   surface+row are owned by ListItem, whose `li`
                                   //   bore the class (see SPEC-ui-blocks)
<StatusText role="status" aria-live="polite">children</StatusText> // owns .editor-status
<LocalTime dateTime: string />       // renders empty pre-hydration (locale mismatch guard)
<ConfirmButton message: string>children</ConfirmButton>
   // window.confirm gate on submit; className passthrough carries frozen hooks
   // (e.g. the port passes className="trash-delete" + variant="danger" here —
   //  that hook lives on ConfirmSubmit in the app today, trash/page.tsx)
<ThemeToggle />                      // system→light→dark cycle, aria-pressed,
                                     //   localStorage('theme'); Monitor/Sun/Moon icons
                                     //   from lucide-react (peerDep — consumer provides)
```

Mapping from today (each rule has exactly one owner): `Button` absorbs the global
`button` element rule + button overrides (`.note-delete`, `.trash-restore`,
`.trash-empty`, `.editor-conflict-actions button`, `.editor-conflict-load`,
`.editor-conflict-overwrite`); `Input`/`Textarea` absorb the global `textarea, input`
rule and the bare `textarea` rule (globals.css:139-152); `IconButton` is the **sole** owner of the 40×40
bordered square classes `.theme-toggle`, `.editor-back`, `.editor-save` — all three
render as `<button>` today (note-editor.tsx:346, :352); `IconLink` absorbs
`.header-icon` — which in the app is used **only on `next/link` anchors**
(page.tsx:30, trash/page.tsx:17), so it must render a link; `StatusText` owns
`.editor-status` (span `role="status"`, note-editor.tsx:349); `ConfirmButton`
owns the frozen `trash-delete` hook (on `ConfirmSubmit`, trash/page.tsx:59-64);
`Pill` owns `.tag-chip`, `.tag-chip-remove` (the remove affordance is part of the
chip), the `.filters a` pill, and the `.active` active-state values; `Textarea`
variant `editor` absorbs `.editor-body`; `LocalTime` / `ConfirmButton` /
`ThemeToggle` are direct generalizations of `app/local-time.tsx`,
`app/confirm-submit.tsx`, `app/theme-toggle.tsx`.

## Tech Stack

React 19 function components (TSX source). CSS in the `atoms.css` partial (composed by
`@life/ui/styles.css`, see `SPEC-ui-tokens.md`), class names `ui-<component>[--<variant>]`
— generic, never notes-shaped. Styling values come only from `ui-tokens` tokens.

## Commands

- `npm run lint -w packages/ui`
- `npm run test -w packages/ui`

## Project Structure

```
packages/ui/src/components/button.tsx        # one file per atom (incl. icon-link.tsx)
packages/ui/src/index.ts                     # barrel
packages/ui/src/styles/atoms.css             # partial, composed by styles.css
packages/ui/test/*.test.tsx                  # one suite per atom
```

## Code Style

```tsx
export function IconButton({ label, variant = 'default', className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cx('ui-icon-btn', variant !== 'default' && `ui-icon-btn--${variant}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
```

`cx` is the only util: joins truthy class strings. No style props, no polymorphism
except the two `Pill` render tags.

## Testing Strategy

Rendering + behavior unit tests per atom. Harness: jest + `jest-environment-jsdom` +
`@testing-library/react` (devDependencies of `packages/ui` only — the map's single
dependency addition; fallback if disallowed: `renderToStaticMarkup` markup assertions
in the node environment, behavior checks via stubbed globals). Cover: rendered DOM
classes/roles/labels/element types, `ConfirmButton` cancel path does not submit,
`ThemeToggle` cycling + `aria-pressed`, `LocalTime` empty-first render, `IconLink`
renders an anchor, keyboard focusability.

## Boundaries

- Always: preserve every ARIA label the e2e suite can see; `className` merges, never
  replaces; forward refs/HTML attrs; keep today's element types.
- Ask first: new dependencies; new atoms not in the list above; any prop that takes a
  style value.
- Never: import app code (types may come from `@life/shared` only); encode notes
  domain (names, verbs, copy) in props or class names; run e2e.

## Success Criteria

1. All 11 atoms render with computed styles identical to today's equivalents.
2. Frozen e2e surface preserved through `className` passthrough (labels verbatim).
3. Unit tests green for every atom; `npm run lint -w packages/ui` clean.
4. Zero notes-specific names in `packages/ui` (grep-enforced in review).

## Open Questions

- `jest-environment-jsdom` + `@testing-library/react` as `packages/ui` devDependencies: recommended
  (needs a test harness for behavior contracts). Fallback documented in Testing.
