# shadcn primitive migration — close-out gate

One gate, run once, on `pi/wf/shadcn-primitive-migration` at `95c0fea`, based on
`origin/dev` at `3d1eb4f`. Every check below is a spec §8 success criterion, pasted
as it ran. The migration itself is commit `62461f5`; this gate round's repairs are left
uncommitted on top of it for the user's review.

Run date: 2026-10-28.

## §8.1 — typecheck green, `apps/*` source unchanged beyond the two sanctioned files

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
apps/app/app/todo-item.tsx
apps/app/postcss.config.mjs
apps/app/test/feedback-inbox.test.tsx
apps/app/test/meal-day-view.test.tsx
apps/app/test/meal-editor.test.tsx
apps/app/test/todo-item.test.tsx
```

Exactly the two files spec §8.1 sanctions — the PostCSS entry point and the `DoneToggle`
recomposition — plus four test files whose assertions pinned markup the registry
replacement removed. Committed history and the working tree agree on that set:

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
Tests:       536 passed, 536 total
Snapshots:   11 passed, 11 total
Time:        16.095 s
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
suites are among the 536 passing tests.

## §8.10 — focus rings survive the utility-class port

The registry recipes reach for `focus-visible:outline-2` without
`focus-visible:outline-solid`. Tailwind v4 compiles `outline-2` to
`outline-style: var(--tw-outline-style)` while 11 converted atoms also carry
`outline-none`, which sets `--tw-outline-style: none`. Without an explicit
`outline-solid` the ring is computed but never painted. `origin/dev` drew that ring on
eight selectors across the deleted stylesheets — `.ui-icon-btn`, `.ui-icon-link`,
`.ui-pill--button`, `.ui-switch`, `.ui-tab`, `.ui-fab-link`, `.ui-fab-menu__trigger`
and the two-part `.ui-file-picker__input:focus-visible + .ui-file-picker__surface` —
so those are regressions being repaired. `button`, `input`, `select` and `textarea`
had no authored ring before; the registry recipe adds one, and without the reset it
would have been silently dead CSS rather than a visible improvement. Five files
already carried the reset (`checkbox`, `switch`, `tab-bar`, `fab-link`, `fab-menu`);
the other eight (`button`, `icon-button`, `icon-link`, `input`, `select`, `textarea`,
`pill`, and `file-picker` as `peer-focus-visible:outline-solid` on its peer input) now
do too:

```
$ grep -rln "focus-visible:outline-solid" packages/ui/src/components/*.tsx | wc -l
13
$ grep -rln "outline-none" packages/ui/src/components/*.tsx | wc -l
11
```

Covered by 8 new tests across `button`, `icon-button`, `icon-link`, `input`,
`select`, `textarea`, `pill` and `file-picker` (the 528 → 536 delta in §8.2).

### Ring geometry rides `--focus-ring`

Width and offset come from the token, not a literal, so a token change moves the
ring (plan Task 7: the treatment is `over --focus-ring`; `tokens.css:24` declares
`--focus-ring: 2px`):

```
$ grep -rl "outline-\[length:var(--focus-ring)\]" packages/ui/src/components/*.tsx | wc -l
13
$ grep -rl "outline-offset-\[var(--focus-ring)\]" packages/ui/src/components/*.tsx | wc -l
13
$ grep -rn "outline-2\|outline-offset-2" packages/ui/src/components/*.tsx | wc -l
0
```

Tailwind v4 compiles both arbitrary utilities as expected (`outline-width:
var(--focus-ring)`, `outline-offset: var(--focus-ring)`), and the per-component
companion suites assert the token-bearing class beside `focus-visible:outline-solid`.

## §8.11 — e2e selector surface green after the maintainer's revocation

The frozen surface was revoked (Task 1 ledger row (f)), but the plan-pinned specs
still have to pass. Full suite, one run:

```
$ npx playwright test --config apps/app/playwright.config.ts
  2 skipped
  27 passed (3.0m)
```

The two skips are `test/e2e/hop.spec.ts`, env-gated on `E2E_HOP=1` — unrelated to
this change. Both plan-pinned tests pass:

- `test/e2e/feedback.spec.ts` › *submit feedback from the notes toolbar and read it back in the inbox*
- `test/e2e/feedback.spec.ts` › *flipping an entry to Done removes it from Open and returns it under Done*

`test/e2e/meals.spec.ts` passes 7/7.

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

State: the migration is commit `62461f5` on `pi/wf/shadcn-primitive-migration`,
116 files against `origin/dev`. The gate round's own repairs sit on top of it, uncommitted:
21 modified files — 8 component files gaining `focus-visible:outline-solid`, 8 test
files with the matching regression assertions, the `manager-markup` snapshot, this
report, `tasks/plan.md`, `tasks/todo.md` and `packages/ui/vendor/shadcn/SNAPSHOT.md`. Nothing pushed.
