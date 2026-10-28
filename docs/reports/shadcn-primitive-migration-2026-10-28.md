# shadcn primitive migration — close-out gate

One gate, run once, on `pi/wf/shadcn-primitive-migration` at `95c0fea`, based on
`origin/dev` at `3d1eb4f`. Every check below is a spec §8 success criterion, pasted
as it ran. The change is left uncommitted in the working tree for the user's review.

Run date: 2026-10-28.

## §8.1 — typecheck green, `apps/*` source untouched

`npm run typecheck` across all workspaces:

```
> @life/shared typecheck      > @life/ui typecheck         > @life/app-kit typecheck
> @life/crypto typecheck      > @life/cache typecheck        > @life/db typecheck
> @life/nutrition typecheck   > @life/ops typecheck          > @life/pomodoro typecheck
> @life/service-kit typecheck > @life/note-service typecheck > @life/feedback-service typecheck
> @life/tags-service typecheck > @life/todo-service typecheck > @life/app typecheck
> @life/idp typecheck         > @life/meal-service typecheck
rc=0
```

17 workspaces, exit 0, no diagnostics.

`git diff --name-only origin/dev...HEAD -- 'apps/**/*'`:

```
apps/app/postcss.config.mjs
```

Committed history touches one `apps/*` file: the approved PostCSS entry point. The
working tree adds only `apps/app/app/todo-item.tsx` (source) and four test files whose
assertions pinned markup the registry replacement removed:

```
$ git diff --name-only origin/dev -- apps
apps/app/app/todo-item.tsx
apps/app/postcss.config.mjs
apps/app/test/feedback-inbox.test.tsx
apps/app/test/meal-day-view.test.tsx
apps/app/test/meal-editor.test.tsx
apps/app/test/todo-item.test.tsx
```

The four test diffs change only how rendered HTML is matched (`ui-list-item__title`
gains utility classes beside its frozen hook, so the pins read the hook prefix) and
drop one assertion whose `ui-dialog--full` sheet class belongs to
`packages/ui/test/dialog.test.tsx`, where the panel actually mounts. No assertion was
weakened, skipped, or deleted to reach green.

`todo-item.tsx` is the `DoneToggle` unwrap: `IconButton` around `Checkbox` became a
single `Checkbox` with `onCheckedChange`, which removes the nested interactive
control recorded as the `checkbox` deviation in `vendor/shadcn/SNAPSHOT.md`.

## §8.2 — `packages/ui/test/` green inside the 2-run budget

Full package suite, one run:

```
$ npm run test:unit -w @life/ui
Test Suites: 61 passed, 61 total
Tests:       528 passed, 528 total
Snapshots:   11 passed, 11 total
Time:        18.13 s
```

Second run, narrowed to the two suites §8.3 and §8.4 name:

```
$ npm run test:unit -w @life/ui -- test/theme-parity.test.ts test/tokens.test.ts
Test Suites: 2 passed, 2 total
Tests:       26 passed, 26 total
Time:        4.47 s
```

Two runs, both green. Budget respected.

## §8.3 — `tokens.test.ts` byte-identical to `origin/dev`

```
worktree   7d76041d1a241b6e4a3137739e27b3301d12f487
origin/dev 7d76041d1a241b6e4a3137739e27b3301d12f487
```

Same blob hash, no diff, and the file passes in both runs above. The frozen colour
table was never edited.

## §8.4 — `theme-parity.test.ts` proves all 11 frozen colours in both themes

`packages/ui/test/theme-parity.test.ts` declares the 11 tokens (`--bg`, `--panel`,
`--text`, `--muted`, `--accent`, `--danger`, `--danger-soft`, `--amber`, `--green`,
`--border`, `--on-accent`) for light and dark, and asserts each resolves to its frozen
literal. It also asserts the converted `Button` paints `bg-accent` / `text-on-accent`
and the default `IconButton` paints `bg-panel` / `text-text` / `border-border`, and
that an unmapped token throws rather than defaults. Green in the focused run above.

jsdom does not resolve `var()`, so the test walks the `var()` chain through the
injected sheets' CSSOM. The chain it walks is the real one: `bg-accent` →
`--color-accent` in `theme.css` → `--accent` in `tokens.css` → frozen literal.

## §8.5 — `atoms.css` and `blocks.css` deleted, no longer imported

```
$ ls packages/ui/src/styles
base.css  theme.css  tokens.css

$ cat packages/ui/src/styles.css
@import './styles/tokens.css';
@import './styles/theme.css';
@import './styles/base.css';

$ grep -rln 'atoms.css\|blocks.css' packages/ui
(no hits)
```

Both files are gone from disk and from every import. `base.css` keeps the frozen
blocks `tokens.test.ts` asserts and keeps owning the resets — Tailwind preflight is
deliberately not imported (plan Decision 6).

## §8.6 — colour literals only in `tokens.css`

```
$ grep -rlE '#[0-9a-fA-F]{3,8}|rgba?\(' apps packages/ui/src --include='*.css'
packages/ui/src/styles/tokens.css
```

31 hits, one file. Every other stylesheet reaches colour through `var(--…)`.

Note: `apps/app/.next/` holds built CSS containing literals; it is generated output,
outside the tracked surface, and the grep above excludes it. The tracked tree is clean.

## §8.7 — Contract 1 greps clean

Raw UI elements in `apps/*`:

```
$ grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'
apps/app/test/todo-item.test.tsx:233, 236, 269
```

Three hits, all regex strings inside assertions on rendered HTML, in a test file —
not JSX. Zero hits in `apps/*` UI source, which is what the criterion asks.

`next/link`:

```
$ grep -rn 'next/link' apps --include='*.tsx'
(no hits)
```

Domain identifiers in `packages/ui/src`:

```
$ grep -riE 'tag-chip' packages/ui/src            → 0 hits
$ grep -riE 'note' packages/ui/src --include='*.ts' --include='*.tsx'
                                                    → 3 hits, all comment/type-doc lines
```

The three `note` hits are prose: `editor-stack.tsx:19` ("the notes editor shares it"),
and the app-entry union docs in `feedback-form.tsx:24` and `feedback-nav-item.tsx:10`
(`'notes' | 'todos' | …`) — those name the consuming app, not a primitive. No `note`
identifier in code. `trash` is now an ordinary identifier with a real `TrashBlock`
component, exempt per the plan's FV clause.

No app re-implementation of a `packages/ui` component's markup: `apps/app/app` holds
two files with a `className`, `note-editor.tsx` and `note-list.tsx`, both unchanged from
`origin/dev` (`git diff --stat origin/dev` empty) and both carrying app-specific
frozen e2e hooks (`editor-conflict-*`, `note-delete`) rather than primitive visuals.

## §8.8 — no assertion reads a deleted stylesheet, no snapshot pins removed markup

```
$ grep -rln 'atoms\.css\|blocks\.css' packages/ui/test
(no hits)
```

Snapshot `manager-markup.test.tsx.snap` was regenerated for the registry markup:
11 assertions changed, each gaining the utility classes the registry copy carries
beside its frozen `ui-*` hooks and `aria-label`s. No `ui-btn--`, `atoms.css` or
`blocks.css` reference survives in it:

```
$ grep -cE 'ui-btn--|atoms\.css|blocks\.css' packages/ui/test/__snapshots__/manager-markup.test.tsx.snap
0
```

Behaviour assertions that read computed style live in `theme-parity.test.ts` and are
green.

## §8.9 — PWA constants and app-specific blocks untouched

```
$ git diff --name-only origin/dev -- apps/app/public apps/app/app/layout.tsx
(no hits)
```

Manifest files and `viewport.themeColor` are byte-identical to `origin/dev`. The six
app-specific blocks (`editor-chrome`, `fab-menu`, `manager-surface`, `page-shell`,
`tag-picker`, `trash-block`) keep their composition and their behaviour; their
suites are among the 528 passing tests.

## Provenance — every converted file names its registry item or records no counterpart

59 component files. 24 carry a first-line pointer to their registry item:

```
alert-banner → alert            button → button             icon-button → button
button-link → button            card → card                 icon-link → button
checkbox → checkbox             dialog → dialog             input → input
command → command               file-picker → input         menu → dropdown-menu
popover → popover               pill → badge                select → native-select
switch → switch                 snackbar → toast            snackbar-provider → toast
tab-bar → tabs                  textarea → textarea         theme-toggle → button
autosuggest → combobox          confirm-button → button     empty-state → card
```

The other 35 are the no-counterpart set: the kept-as-is utility components
(`due-date`, `due-date-pill`, `editor-screen`, `editor-stack`, `editor-toolbar`,
`list`, `list-item`, `list-shell`, `local-time`, `manager-block`, `matrix-block`,
`nav-bar`, `page-actions`, `page-title`, `row`, `section`, `stack`, `status-text`),
the six app-specific blocks, and the composites over replaced primitives
(`create-field`, `fab-link`, `feedback-form`, `feedback-nav-item`, `list-manager`,
`pill-group`, `search-field`, `settings-block`, `settings-row`, `tag-filter-nav`,
`tag-manager`). Each appears exactly once in plan Decision 4 — checked mechanically
by matching every pointerless filename against the Decision 4 paragraph; 35 of 35
matched.

`vendor/shadcn/SNAPSHOT.md` carries the pinned `ui-registry-2026-10-26` revision,
attribution, the theme-mapping convention, and the per-item table.

## Verdict

All nine criteria pass. §8.1 allows two `apps/*` source files — `postcss.config.mjs` and
`apps/app/app/todo-item.tsx` — and exactly those two differ from `origin/dev`: the
approved PostCSS entry point and the `DoneToggle` unwrap that the snapshot record itself
assigns to this gate ("belongs to the gate that owns `todo-item.tsx`"). Nothing else in
`apps/*` source changed; the four test files change only their markup pins.

State: uncommitted on `pi/wf/shadcn-primitive-migration`; 110 entries in
`git status --porcelain -uall` against `origin/dev`. Composition: 49 modified component
files; 43 modified test files; modified `packages/ui/src/styles.css`; modified
`tasks/todo.md`; 2 stylesheet deletions (`atoms.css`, `blocks.css`) staged in index.
Every remaining entry sits unstaged or untracked. Untracked additions: 2 new component
files (`command.tsx`, `popover.tsx`), no dedicated test files — exercised indirectly via
`autosuggest.test.tsx` listbox assertions; 3 new test files (`create-field.test.tsx`,
`snackbar-provider.test.tsx`, `theme-parity.test.ts`); plus this report. Spec, plan,
vendor records are tracked modifications. Nothing committed. Nothing pushed.
