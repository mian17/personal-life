# Spec: notes-port — apps/app onto `@life/ui`

Module id: `notes-port` (map: `docs/specs/MAP-ui-primitives.md`). Depends on `ui-blocks`.

## Objective

Rewrite `apps/app`'s UI layer onto `@life/ui` and absorb `app/globals.css` into the
package. **Pixel-identical refactor**: same computed styles, same DOM semantics, same
behavior, same visible text. The port is also the acceptance test of the primitives:
anything that doesn't fit is fixed upstream in `ui-atoms`/`ui-blocks`, not hacked
locally.

## The frozen contract (e2e- and human-visible surface)

The Playwright suite (`apps/app/test/e2e/**`, human-owned — never run, never edit)
queries **visible text, ARIA labels, roles, headings, and one CSS class hook**. These
must survive byte-identically:

- Headings/labels: `Notes` heading; labels `New note`, `Note body`, `Save`,
  `Search notes`, `Delete …`, `Trash`, `Back` — every `aria-label` string in the
  current markup, verbatim.
- Class hook: `button.trash-delete` must keep matching (passed via `className`, may
  carry no CSS).
- Theme contract: `document.documentElement.dataset.theme`, pre-hydration inline
  script in `layout.tsx`, `suppressHydrationWarning` — unchanged.
- Hydration behavior: `LocalTime` renders empty pre-hydration; no new
  server/client text mismatches.

## What moves vs. what stays

| Moves to `@life/ui` | Stays in `apps/app` |
|---|---|
| `note-list.tsx` markup → `List/ListItem/EmptyState` | `lib/api`, `lib/auth/**`, route handlers, middleware |
| `note-editor.tsx` markup → `EditorToolbar/AlertBanner/Textarea/Pill` | the autosave engine (~300 lines: drain, expectedVersion/409, keepalive) |
| `search-box.tsx` visuals → `SearchField` | debounce→`router.replace` wiring |
| `theme-toggle.tsx`, `local-time.tsx`, `confirm-submit.tsx` → atoms | server actions (`app/actions.ts`), `tags.ts`, `note-title.ts` |
| `globals.css` → `@life/ui/styles.css` (tokens+atoms+blocks) | a minimal app stylesheet only if a frozen hook needs a rule |

## Tech Stack

No new runtime deps. `next.config.mjs` gains `transpilePackages: ['@life/shared',
'@life/ui']`; root `workspaces` gains `packages/ui`; `apps/app` depends on
`"@life/ui": "*"`; jest `moduleNameMapper` gains `^@life/ui$` → source path.

## Commands

- `npm run lint -w apps/app` · `npm run test:unit -w apps/app` · `npm run build -w apps/app`
- `npm run lint -w packages/ui` · `npm run test -w packages/ui`
- Visual acceptance: the human's phone check + the human's e2e run (their suite).

## Project Structure

Touch only: `apps/app/app/**` (components/pages/layout), `apps/app/package.json`,
`apps/app/next.config.mjs`, `apps/app/jest` config block, root `package.json`.
Prohibited: `apps/app/test/e2e/**`, `apps/app/lib/**`, `apps/app/middleware.ts`,
`apps/*/data/**`.

## Code Style

Pages stay thin server components; app-specific composition keeps today's naming:

```tsx
export default async function Home({ searchParams }: Props) {
  const { tag, q } = await searchParams;
  const [notes, tags] = await Promise.all([listNotes(tag, q), listTags()]);
  return (
    <PageShell>
      <NavBar trailing={<ThemeToggle />} />
      <PageTitle>Notes</PageTitle>
      <SearchField label="Search notes" placeholder="Search notes…" onQueryChange={runSearch} />
      <TagFilterNav items={tags.map((t) => ({ name: t.name, href: hrefFor(t), active: t.name === tag }))} />
      <List>{notes.map((n) => <ListItem … deleteAction={<ConfirmButton …/>} />)}</List>
      <FabLink href="/notes/new" label="New note">+</FabLink>
    </PageShell>
  );
}
```

## Testing Strategy

- Existing app unit tests (auth/env/session) must stay green — untouched files.
- `packages/ui` unit tests cover the primitives (per their specs).
- Port-level verification (mechanical): `lint` + `test:unit` + `next build` green;
  a DOM-shape smoke test may assert the frozen labels/classes via
  `renderToStaticMarkup` where components render server-side.
- **No Playwright run by agents.** The human runs their e2e suite as acceptance.

## Boundaries

- Always: keep every frozen-contract string/class; keep hydration-sensitive behavior;
  prefer fixing primitives upstream over local overrides.
- Ask first: any app-level CSS that survives the port; any deviation from a primitive's
  prop contract; dependency changes of any kind.
- Never: run or edit `apps/app/test/e2e/**`; change visible copy; "improve" the visual
  design; touch `lib/**` or route handlers.

## Success Criteria

1. `apps/app` UI renders from `@life/ui` only; `globals.css` is gone (package owns CSS).
2. Computed styles identical (token values frozen in `ui-tokens`; markup semantics
   preserved); the app looks and behaves the same on the phone.
3. Frozen e2e surface intact — the human's e2e suite passes when they run it.
4. `lint`/`test:unit`/`build` green for `apps/app` and `packages/ui`; zero e2e runs by
   agents.

## Open Questions

- None. (If the port finds a primitive misfit, the fix goes upstream and this spec's
  component lists are updated first — living document.)
