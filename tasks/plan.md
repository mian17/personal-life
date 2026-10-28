# Implementation Plan: shadcn/ui primitive migration for `@life/ui`

*Produced by planning-and-task-breakdown; source spec: `docs/specs/SPEC-ui-shadcn-primitives.md`;
confirmed intent: `docs/intent/shadcn-primitive-migration.md`*

## Overview

Replace the hand-written CSS primitives in `packages/ui` with vendored shadcn/ui registry copies
(Radix behaviour + Tailwind v4 utilities mapped onto the frozen tokens), then delete
`src/styles/atoms.css` and `src/styles/blocks.css`. One sequential migration: the endpoint ("no
hand-written atoms/blocks CSS, new primitive = registry copy") is reached only when every consumer
is converted.

## Decisions that bind every task

1. **The old selector surface is not frozen.** `ui-*` class strings, `aria-current="page"`,
   nesting depth and `button.trash-delete` are ordinary implementation details. A registry
   replacement owns its markup; a test or e2e pinning the old markup is updated, or that
   assertion is deleted, in the same task as the replacement. `apps/*` source still does not
   change — only its tests, where a hook they referenced is gone.
2. **Suite policy is spec §6.** Assertions that read `atoms.css`/`blocks.css` file text are
   deleted with the CSS rule they read; behaviour, DOM, role and visible-text assertions that
   still hold stay. Roles and visible text are no longer frozen surfaces.
   Per-task acceptance lines that say a `ui-*` hook "still renders" are advisory: keep the hook
   where the registry markup carries it without contortion, drop it otherwise and update the test
   that pinned it. No task stops over a hook, a role or a nesting depth.
3. **Deletion is paced per component**, in the same change as its conversion; the close-out task
   deletes the then-empty files.
4. **No-registry-counterpart components**: the three lists below name every component no task
   replaces from a registry source, each exactly once.
   - **Kept as-is, styled with utilities only:** `due-date`, `due-date-pill`, `editor-screen`,
     `editor-stack`, `editor-toolbar`, `list`, `list-item`, `list-shell`, `local-time`,
     `manager-block`, `matrix-block`, `nav-bar`, `page-actions`, `page-title`, `row`, `section`,
     `stack`, `status-text`.
   - **App-specific blocks (spec §1 out of scope, composition only):** `editor-chrome`, `fab-menu`,
     `manager-surface`, `page-shell`, `tag-picker`, `trash-block`.
   - **Composites over replaced primitives:** `confirm-button`, `create-field`, `empty-state`,
     `fab-link`, `feedback-form`, `feedback-nav-item`, `list-manager`, `pill-group`, `search-field`,
     `settings-block`, `settings-row`, `tag-filter-nav`, `tag-manager`, `theme-toggle`.
   `icon-link` is **not** here: Task 6 replaces it with the registry `button` source in `asChild` form.
   `autosuggest` is the Combobox (`Popover` + `Command`, `cmdk`) under the maintainer's rule "if there
   is a counterpart in shadcn, replace it".
5. **`select` uses the native-select recipe**, no Radix: native `<select>`, same registry
   provenance, no DOM change, no selector risk.
6. **`base.css` keeps its frozen blocks** that `tokens.test.ts` asserts verbatim, and keeps owning
   the resets: Tailwind's preflight is deliberately not imported by `theme.css` (spec §5).
7. **No px/hex literals in our stylesheets**: geometry from Tailwind's scale, `theme.css` maps to
   `var(--…)` only, colour literals only in `tokens.css`.

## Task 1 approvals (Ask-First ledger)

Every answer is quoted from the maintainer's 2026-10-27 ruling, which supersedes the earlier
"ask first" list in this plan. Nothing here is open: the migration is unblocked.

| Item | Question | Answer | Source |
|---|---|---|---|
| (a) | Edit `apps/app/postcss.config.mjs` | **approved** | maintainer, 2026-10-27: "1. approve"; spec §2 now records the file as the CSS pipeline entry point |
| (a) | Add `tailwindcss`, `@tailwindcss/postcss`, `class-variance-authority`, `@radix-ui/react-*` | **approved** | intent, "Decisions taken during the interview" ("adopt Tailwind"); spec §2 |
| (b) | Component scope | **approved — redefined** | maintainer: "if there is a counterpart in shadcn, replace it … anything that is blocking the migration must all be removed." Decision 4 now lists only components with no registry counterpart |
| (c) | Regenerate or delete `packages/ui/test/manager-markup.test.tsx.snap` | **approved** | spec §6 and §9 assumption 3: a snapshot of markup the replacement removed is deleted, not preserved |
| (d) | `cmdk` for the Autosuggest combobox | **approved** | maintainer: "if there is a counterpart in shadcn, replace it"; spec §2 |
| (e) | Let the stylesheet-reading suites change | **approved** | maintainer: "delete all old tests spec … test that tests specifically opacity: 0.5 must be deleted"; spec §6 |
| (f) | Frozen e2e selector surface (`ui-*`, aria labels, `button.trash-delete`, `aria-current`) | **revoked** | maintainer: "remove the frozen spec … anything that is blocking the migration must all be removed" |
| (g) | `tab-bar` → shadcn `tabs` | **approved** | maintainer, 2026-10-27: "2. swap it" |
| (h) | `apps/app/app/todo-item.tsx`: unwrap `DoneToggle`'s `IconButton` so the registry `Checkbox` is the only interactive control | **approved — derived** | maintainer, 2026-10-27: "if there is a counterpart in shadcn, replace it … anything that is blocking the migration must all be removed" — the `IconButton`-around-`Checkbox` nest is the blocker the registry copy cannot keep (§9.1 forbids the `checkbox` deviation); the same ruling's scope carries it, and no new question was open |

## Stop conditions

Only two conditions end a run:

- A `tokens.test.ts` value-table drift. The colour table is the one invariant; a mismatch means
  the theme mapping is wrong, and the fix is the mapping.
- A required dependency outside the spec §2 list. Ask, then continue.

Anything else that used to be listed here — a selector pin, a snapshot, a stylesheet-reading
assertion, a `ui-*` hook, `aria-current`, a per-item e2e approval — is now removed by the task
that trips over it, not escalated.

## Verification protocol (FV)

Every task touching primitive markup ends its Verification with **FV**:

- **Contract 1 greps clean:** `grep -rnE "<(button|input|textarea|select|a|img|label|progress)\b" apps --include='*.tsx'` → zero hits in `apps/*` UI source (the regex-string matches in
`apps/app/test/todo-item.test.tsx` are assertions on rendered HTML, not JSX); `grep -rn "next/link" apps --include='*.tsx'` → zero hits; `grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'` → only `tokens.css`.
- **Identifier greps:** `grep -riE "tag-chip" packages/ui/src` → zero hits; `grep -riE "note" packages/ui/src --include='*.ts' --include='*.tsx'` → comment lines only, no `note` identifier in code. (`trash` is now an ordinary identifier: `TrashBlock` is a real component and is exempt from no grep.)
- **No orphaned assertion:** no suite under `packages/ui/test/` reads a `.css` file that the task deleted, and no snapshot pins markup the task replaced.
- **Behaviour preserved:** the component's suite is green for everything that is not a deleted stylesheet assertion.

## Intent trace

- Outcome (primitives are registry copies) → Tasks 4, 6-39.
- Success (exports unchanged, colour parity, no hand-written atoms/blocks) → Tasks 2, 5, 40, 41.
- Constraint (frozen colour tokens/PWA, branch from `origin/dev`, no merge) → Tasks 1, 41.
- Out of scope (app blocks keep composition; no Storybook, screenshot store, backend, `apps/*`
  business logic) → Tasks 37-39 restyle only where they consume a replaced primitive; Task 41
  asserts no `apps/*` source change beyond the approved PostCSS config.

## Task 1: Record the maintainer's rulings

**Description:** Write the 2026-10-27 rulings into the ledger above: PostCSS config approved,
`cmdk` approved, the frozen selector surface revoked, the stylesheet-reading assertions deletable,
`tab-bar` swapped. No code is edited here.
**Acceptance criteria:**
- [x] The ledger above carries every answer with its source; no row is open
- [x] Decision 4's no-counterpart list matches spec §1: every component with no registry copy
      appears exactly once and no component with a copy appears; no stop condition remains for a stale
      selector, snapshot or stylesheet assertion
**Verification:**
- [x] Typecheck passes: npm run typecheck
- [x] Focused unit tests pass: npm run test:unit -w @life/ui -- test/tokens.test.ts
- [x] Manual check: no `open` row remains in the ledger
**Dependencies:** None
**Files likely touched:** `tasks/plan.md`, `tasks/todo.md`
**Estimated scope:** Small: 1-2 files

## Task 2: Stand up the Tailwind v4 theme pipeline

**Description:** Rewrite `theme.css` as the theme/utilities layers only — `@layer theme, base,
components, utilities;`, `@import 'tailwindcss/theme.css' layer(theme)`, `@import
'tailwindcss/utilities.css' layer(utilities)`, `@source` globs for `packages/ui/src` and `apps`,
and the `@theme` block mapping all 11 colours to `var(--…)`. Tailwind's preflight is deliberately
**not** imported: `base.css` owns the resets. Import `theme.css` between `tokens.css` and `base.css`
in `styles.css`. Add `tailwindcss`, `@tailwindcss/postcss`, `class-variance-authority`, `cmdk`,
`@radix-ui/react-{slot,checkbox,switch,dialog,dropdown-menu,tabs,toast,popover}` plus any icon peer
the registry copies import, so no later task touches the lockfile. Wire `@tailwindcss/postcss` into
`apps/app/postcss.config.mjs`.
**Acceptance criteria:**
- [ ] `theme.css` maps all 11 frozen colours to `var(--…)` with no hex/rgb literal; imports only the
      theme and utilities layers; no preflight. `styles.css` imports theme between tokens and base —
      `atoms.css`/`blocks.css` keep their imports until Task 40 deletes them
- [ ] `base.css` unchanged; `package.json`/`package-lock.json` carry every dependency the later
      tasks need, so Tasks 8, 18, 19, 20, 21, 23 add none
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/tokens.test.ts
- [ ] Manual check: `npm run dev -w apps/app`, load `/todos`, confirm the rendered CSS resolves
      `bg-bg`/`text-text` and has no unresolved `@import 'tailwindcss'`; FV
**Dependencies:** 1
**Files likely touched:** `packages/ui/src/styles/theme.css`, `packages/ui/src/styles.css`, `packages/ui/package.json`, `package-lock.json`, `apps/app/postcss.config.mjs`
**Estimated scope:** Large: 5+ files

## Task 3: Pin the vendored shadcn snapshot record

**Description:** Record the pinned registry revision and snapshot date, the attribution/licence note
(spec §10 q4), the theme-mapping convention (`--accent` → `bg-accent`) and an appendable per-item
row, so each converted file carries a one-line pointer.
**Acceptance criteria:**
- [ ] `packages/ui/vendor/shadcn/SNAPSHOT.md` states revision, date, attribution, convention, item rows
- [ ] No component or stylesheet changes in this task
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/manager-markup.test.tsx
- [ ] Manual check: the record names a concrete revision and Task 4 links to it from its provenance comment
**Dependencies:** 1
**Files likely touched:** `packages/ui/vendor/shadcn/SNAPSHOT.md`
**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 1-3

- [ ] Gate answers recorded; theme pipeline compiles in `apps/app`; snapshot record names its revision
- [ ] No component, token value or `apps/*` source touched
- [ ] `npm run typecheck` green and each touched suite green within its 2-run budget

## Task 4: Convert Button and IconButton from the registry copy

**Description:** Replace both files with theme-mapped shadcn `button` registry source (cva variants,
`data-slot`), keeping exports, variant names, `ui-btn`/`ui-btn--*`/`ui-icon-btn(--ghost)` hooks, tap
geometry via the utility scale and the disabled treatment; remove both `atoms.css` blocks.
**Acceptance criteria:**
- [ ] `Button`, `ButtonVariant`, `ButtonSize`, `ButtonProps`, `IconButton`, `IconButtonProps` names, shapes, defaults unchanged
- [ ] `Button`/`IconButton` render from the registry `button` source with `data-slot`; both `atoms.css` blocks gone; both suites green for everything that is not a deleted stylesheet assertion
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/button.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/icon-button.test.tsx
- [ ] Manual check: `grep -n "ui-btn\|ui-icon-btn" packages/ui/src/styles/atoms.css` returns nothing while the hooks remain in `components`; FV
**Dependencies:** 2, 3
**Files likely touched:** `packages/ui/src/components/button.tsx`, `packages/ui/src/components/icon-button.tsx`, `packages/ui/src/styles/atoms.css`
**Estimated scope:** Medium: 3-5 files

## Task 5: Prove colour parity with computed-style assertions

**Description:** Add `theme-parity.test.ts`: inject `tokens.css` + `theme.css` into jsdom, render the
converted primitives in light and dark, and resolve each utility's `var(--token)` chain through the
injected sheet's CSSOM (jsdom does not resolve `var()`), asserting the 11 frozen values.
**Acceptance criteria:**
- [ ] All 11 frozen colours asserted in both `[data-theme='light']` and dark; an unmapped token fails the suite
- [ ] `test/tokens.test.ts` untouched and green; a drifted value in `theme.css`/`tokens.css` fails
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/theme-parity.test.ts
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/tokens.test.ts
- [ ] Manual check: change one `theme.css` mapping, confirm the suite goes red, revert; FV
**Dependencies:** 4
**Files likely touched:** `packages/ui/test/theme-parity.test.ts`
**Estimated scope:** Small: 1-2 files

## Task 6: Convert ButtonLink and IconLink

**Description:** Replace both with the registry `button` source in `asChild` form over `next/link`
(still owned by `packages/ui`), keeping `ui-btn`/`ui-icon-link` hooks and anchor semantics; move
styling out of `atoms.css`.
**Acceptance criteria:**
- [ ] `ButtonLink`/`ButtonLinkProps`/`IconLink`/`IconLinkProps` unchanged; `next/link` imported only inside `packages/ui`
- [ ] Anchors keep `ui-btn`-family and `ui-icon-link` hooks; no `atoms.css` rule remains; no `next/link` in `apps/*`
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/button-link.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/icon-link.test.tsx
- [ ] Manual check: `grep -n "ui-icon-link" packages/ui/src/styles/atoms.css` returns nothing while the hook remains in `components`; `grep -rn "next/link" apps --include='*.tsx'` returns zero hits; FV
**Dependencies:** 4
**Files likely touched:** `packages/ui/src/components/button-link.tsx`, `packages/ui/src/components/icon-link.tsx`, `packages/ui/src/styles/atoms.css`
**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 4-6

- [ ] First vertical slice green: registry copy + theme mapping + parity proof
- [ ] `test/tokens.test.ts` byte-identical to `origin/dev`; review with the human before the remaining 50 components
- [ ] `npm run typecheck` green; each touched suite green within its 2-run budget

## Task 7: Convert Input and Textarea

**Description:** Replace both with shadcn `input`/`textarea` source, preserving
`ui-input`/`ui-textarea`/`ui-textarea--editor`, focus-visible and disabled treatments over
`--focus-ring`/`--border`/`--muted`, and tap geometry; remove both `atoms.css` blocks.
**Acceptance criteria:**
- [ ] `Input`/`InputProps`/`Textarea`/`TextareaProps`/`TextareaVariant` unchanged; the three hooks still render
- [ ] Neither component has an `atoms.css` rule; both suites green for everything that is not a deleted stylesheet assertion
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/input.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/textarea.test.tsx
- [ ] Manual check: `grep -n "ui-input\|ui-textarea" packages/ui/src/styles/atoms.css` returns nothing; FV
**Dependencies:** 4
**Files likely touched:** `packages/ui/src/components/input.tsx`, `packages/ui/src/components/textarea.tsx`, `packages/ui/src/styles/atoms.css`
**Estimated scope:** Medium: 3-5 files

## Task 8: Convert Checkbox and Switch

**Description:** Replace both with the Radix-backed shadcn `checkbox`/`switch` source (imports
installed in Task 2), keeping the `ui-checkbox`/`ui-checkbox--checked`/`ui-switch`/`ui-switch--on`
compatibility hooks. The registry checkbox is an interactive control, so `DoneToggle` in
`apps/app/app/todo-item.tsx` recomposes to render `Checkbox` directly as the toggle — no
`IconButton` wrapper — with `checked={done}`, `onCheckedChange={onToggle}`, and the frozen
"Mark … done" text carried by a new upstream `label` prop on `Checkbox` (rendered as
`aria-label`, mirroring `SwitchProps.label`). `CheckboxProps` must advertise only what the
implementation honours: add `label?: string`, and add `'defaultChecked'` to the `Omit` so no
phantom uncontrolled API is typed (the checkbox is controlled like `Switch`);
`Switch`/`SwitchProps` stay unchanged.
**Acceptance criteria:**
- [ ] `Checkbox`/`Switch` render from the Radix-backed registry source; the four hooks still render
- [ ] No nested interactive control: the done toggle is one keyboard-operable checkbox button carrying `aria-label="Mark … done"` — no `IconButton` wrapper, no React descendant/hydration errors from the rendered todo row
- [ ] `CheckboxProps` adds `label?: string` and omits `defaultChecked`; `SwitchProps` unchanged; nothing typed that the implementations do not honour
- [ ] `apps/app/test/todo-item.test.tsx` asserts the toggle off `ui-icon-btn--ghost` (the checkbox button carries the `aria-label`), and the duplicate comment pair at `markup()` is reduced to the one sentence that the registry `Checkbox` is stateful and needs the real hook
- [ ] No `atoms.css` block for either; keyboard and label association covered by the updated `apps/app/test/todo-item.test.tsx` and the unmodified `packages/ui` suites
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/checkbox.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/switch.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/app -- test/todo-item.test.tsx
- [ ] Manual check: `grep -n "ui-checkbox\|ui-switch" packages/ui/src/styles/atoms.css` returns nothing, and a probe render of `TodoItem` shows the checkbox button as the row's only leading button (no nested `<button>`, no React descendant errors); FV
**Dependencies:** 2, 4
**Files likely touched:** `packages/ui/src/components/checkbox.tsx`, `packages/ui/src/components/switch.tsx`, `packages/ui/src/styles/atoms.css`, `apps/app/app/todo-item.tsx`, `apps/app/test/todo-item.test.tsx`
**Estimated scope:** Medium: 4-5 files

## Task 9: Convert Select to the native-select recipe

**Description:** Restyle the native `<select>` atom from the shadcn native-select recipe: utilities
only, no Radix, so the platform picker and `<option>` mapping stay; keep `ui-select`, the
`options`-driven API, and delete the `atoms.css` block.
**Acceptance criteria:**
- [ ] Native `<select>` with `<option>` children; `SelectProps`/`SelectOption` unchanged; `ui-select` still renders
- [ ] `atoms.css` block gone; no `@radix-ui/react-select` added; suite assertions untouched
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/select.test.tsx
- [ ] Manual check: `grep -n "ui-select" packages/ui/src/styles/atoms.css` returns nothing and `git diff` adds no Radix select; FV
**Dependencies:** 4, 7
**Files likely touched:** `packages/ui/src/components/select.tsx`, `packages/ui/src/styles/atoms.css`
**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 7-9

- [ ] `Input`, `Textarea`, `Checkbox`, `Switch`, `Select` render from utilities/registry copies
- [ ] Their `atoms.css` sections gone; no rule has two owners
- [ ] `npm run typecheck` green; each touched suite green within its 2-run budget

## Task 10: Convert SearchField and CreateField

**Description:** Rebuild `search-field.tsx` (input + leading icon + clear) and `create-field.tsx`
(label + input + submit) on converted `Input`/`Button`, removing `.ui-search-box`,
`.ui-field-label`, `.ui-field` from `blocks.css`; add a `create-field` suite (label wiring, submit,
disabled).
**Acceptance criteria:**
- [ ] Both compose `Input`/`Button` with no new visual CSS; `SearchField`/`SearchFieldProps`/`CreateField` unchanged; `ui-search-box`/`ui-field` hooks still render
- [ ] `test/create-field.test.tsx` asserts label association, submit payload and disabled state
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/search-field.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/create-field.test.tsx
- [ ] Manual check: `grep -n "ui-search-box\|ui-field-label\|ui-field " packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 4, 7
**Files likely touched:** `packages/ui/src/components/search-field.tsx`, `packages/ui/src/components/create-field.tsx`, `packages/ui/test/create-field.test.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Large: 5+ files

## Task 11: Convert FilePicker

**Description:** Rebuild `file-picker.tsx` on the shadcn input recipe for `type="file"` (visually
hidden native input driving a styled surface), keeping `ui-file-picker`/`__*` hooks and the
focus/disabled affordances as utilities rather than sibling-combinator rules.
**Acceptance criteria:**
- [ ] `FilePicker`/`FilePickerProps` unchanged; the native input stays the only interactive element; hooks still render
- [ ] No `atoms.css` block remains; behaviour assertions untouched
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/file-picker.test.tsx
- [ ] Manual check: `grep -n "ui-file-picker" packages/ui/src/styles/atoms.css` returns nothing; FV
**Dependencies:** 4
**Files likely touched:** `packages/ui/src/components/file-picker.tsx`, `packages/ui/src/styles/atoms.css`
**Estimated scope:** Small: 1-2 files

## Task 12: Convert StatusText and LocalTime

**Description:** Restyle both with utilities only; `StatusText` keeps `ui-status-text`,
`ui-status-text--display` and `ui-invisible` (asserted by `apps/pomodoro` and a suite CSS read — the
component is converted, and the assertion goes with the CSS rule it read).
**Acceptance criteria:**
- [ ] `StatusText`/`LocalTime` exports and props unchanged; the three hooks still render
- [ ] `ui-invisible` comes from the `invisible` utility; no `atoms.css` rule for either component
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/status-text.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/local-time.test.tsx
- [ ] Manual check: `grep -n "ui-status-text\|ui-invisible" packages/ui/src/styles/atoms.css` returns nothing; FV
**Dependencies:** 4
**Files likely touched:** `packages/ui/src/components/status-text.tsx`, `packages/ui/src/components/local-time.tsx`, `packages/ui/src/styles/atoms.css`
**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 10-12

- [ ] Every form control renders from util/source with hooks intact
- [ ] `atoms.css` shrank by exactly the converted sections
- [ ] `npm run typecheck` green; each touched suite green within its 2-run budget

## Task 13: Convert Pill

**Description:** Replace `pill.tsx` with the shadcn `badge` source extended with the `active` toggle
and the three render modes (`span`/`a`/`button`), keeping the `Pill` export set, the `tone`
vocabulary mapped onto frozen tokens, and every `ui-pill*` hook.
**Acceptance criteria:**
- [ ] `Pill`/`PillProps`/`PillSize`/`PillTag`/`PillButtonType` and tag-selection logic unchanged; the class strings `apps/app` asserts render where the registry markup carries them, and the pinned
  test is updated in this task otherwise
- [ ] Tone→colour via token utilities only; `atoms.css` pill block gone; `row.locator('.ui-pill')` still matches (retire the pin and update the test in this task if the
  registry `badge` markup cannot carry the hook)
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/pill.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/pill-group.test.tsx
- [x] E2E passes (run 2026-10-28, `playwright.config.ts`): npx playwright test --config apps/app/playwright.config.ts test/e2e/feedback.spec.ts -g "flipping an entry to Done removes it from Open and returns it under Done"
- [ ] Manual check: `grep -n "ui-pill" packages/ui/src/styles/atoms.css` returns nothing; FV
**Dependencies:** 4
**Files likely touched:** `packages/ui/src/components/pill.tsx`, `packages/ui/src/styles/atoms.css`
**Estimated scope:** Small: 1-2 files

## Task 14: Convert PillGroup and TagFilterNav

**Description:** Rebuild both as layout compositions over the converted `Pill` with utilities,
removing `.ui-pill-group` and `.ui-tag-filter-nav` from `blocks.css`; `ui-pill-group` stays as a hook
because `apps/app` tests slice rendered HTML on it.
**Acceptance criteria:**
- [ ] `PillGroup`/`TagFilterNav` exports, props and `active` contract unchanged; both hooks still render
- [ ] Both compose `Pill`, no hand-rolled visuals; both `blocks.css` blocks gone
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/pill-group.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/tag-filter-nav.test.tsx
- [ ] Manual check: `grep -n "ui-pill-group\|ui-tag-filter-nav" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 13
**Files likely touched:** `packages/ui/src/components/pill-group.tsx`, `packages/ui/src/components/tag-filter-nav.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Task 15: Convert DueDatePill and DueDate

**Description:** Restyle both as badge/text components in place (neither file imports `Pill` or
`StatusText` today; keep it that way unless a later primitive needs the composition), keeping
overdue/today/later semantics, the `ui-due-pill--*`/`ui-due-date--*` hooks and signal colours
resolved from `--danger`/`--accent`/`--muted` utilities.
**Acceptance criteria:**
- [ ] `DueDatePill`/`DueDatePillProps`/`DueDateState`/`DueDate`/`DueDateProps`/`DueDateTone` unchanged; the hooks still render
- [ ] Both `atoms.css` blocks gone; signal colours come from token utilities only
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/due-date-pill.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/due-date.test.tsx
- [ ] Manual check: `grep -n "ui-due" packages/ui/src/styles/atoms.css` returns nothing; FV
**Dependencies:** 2
**Files likely touched:** `packages/ui/src/components/due-date-pill.tsx`, `packages/ui/src/components/due-date.tsx`, `packages/ui/src/styles/atoms.css`
**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 13-15

- [ ] `Pill`, `PillGroup`, `TagFilterNav`, `DueDatePill`, `DueDate` render from utilities over tokens
- [ ] Every `ui-pill*`/`ui-due*` hook renders with unchanged nesting; e2e flip-to-Done green
- [ ] FV clean for every task in the range

## Task 16: Convert Card

**Description:** Replace `card.tsx` with the shadcn `card` source mapped to `--panel`/`--border`/
`--radius-lg`, keeping the `fill` opt-in and `ui-card`/`ui-card--fill` hooks; delete the card block.
**Acceptance criteria:**
- [ ] `Card`/`CardProps` unchanged; `fill` keeps its full-height behaviour; both hooks still render
- [ ] The `atoms.css` card block is gone; surface colours come from token utilities
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/card.test.tsx
- [ ] Manual check: `grep -n "ui-card" packages/ui/src/styles/atoms.css` returns nothing; FV
**Dependencies:** 4
**Files likely touched:** `packages/ui/src/components/card.tsx`, `packages/ui/src/styles/atoms.css`
**Estimated scope:** Small: 1-2 files

## Task 17: Convert AlertBanner and EmptyState

**Description:** Rebuild `alert-banner.tsx` on the shadcn `alert` source with tone variants over the
frozen palette, and `empty-state.tsx` as a `Card`-composed utility layout; `ui-alert-banner` stays on
the element the `meals.spec.ts` locator finds.
**Acceptance criteria:**
- [ ] `AlertBanner`/`AlertBannerProps`/`AlertBannerTone` and `EmptyState`/`EmptyStateProps` unchanged; `ui-alert-banner` renders on the located element where the registry `alert` markup carries it; the
  `meals.spec.ts` locator is updated in this task otherwise
- [ ] `blocks.css` no longer holds `.ui-alert-banner` or `.ui-empty`
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/alert-banner.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/empty-state.test.tsx
- [ ] Manual check: `grep -n "ui-alert-banner\|ui-empty" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 16
**Files likely touched:** `packages/ui/src/components/alert-banner.tsx`, `packages/ui/src/components/empty-state.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Task 18: Convert Dialog to the Radix dialog

**Description:** Replace the native-`<dialog>` implementation with the shadcn `dialog` source (Radix
dialog from Task 2), keeping the controlled `open`/`onOpenChange` contract, the `size="full"`
sheet layout, the labelled title, focus trap/restore, and the `ui-dialog`/`ui-dialog--full` hooks.
**Acceptance criteria:**
- [ ] `Dialog`/`DialogProps`, controlled props and Escape/backdrop behaviour unchanged; accessible name still comes from `title`
- [ ] Hooks still render on the asserted element; `blocks.css` no longer holds the dialog rules
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/dialog.test.tsx
- [x] E2E passes (run 2026-10-28, `playwright.config.ts`): npx playwright test --config apps/app/playwright.config.ts test/e2e/feedback.spec.ts -g "submit feedback from the notes toolbar and read it back in the inbox"
- [ ] Manual check: `grep -n "ui-dialog" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 2, 4, 6
**Files likely touched:** `packages/ui/src/components/dialog.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 16-18

- [ ] Card, banner and empty state green on their suites; `dialog.tsx` is the Radix `dialog` source
- [ ] `blocks.css` shrinks monotonically; the e2e feedback flows in range are green
- [ ] `npm run typecheck` green; each touched suite green within its 2-run budget

## Task 19: Convert Menu to the Radix dropdown

**Description:** Replace the hand-rolled disclosure with the shadcn `dropdown-menu` source (Radix
from Task 2), keeping `label`/`summary`/`open`/`onOpenChange`, the always-visible summary row, the
`⋯` trigger and the `ui-menu`/`__summary`/`__label`/`__panel` hooks; `menu.tsx` stops importing
`lib/panel-dismiss.ts`.
**Acceptance criteria:**
- [ ] `Menu`/`MenuProps` unchanged; Escape and outside-click still reported through `onOpenChange`
- [ ] `ui-menu*` hooks still render on the same elements; `blocks.css` menu block gone
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/menu.test.tsx
- [x] E2E passes (run 2026-10-28, `playwright.config.ts`): npx playwright test --config apps/app/playwright.config.ts test/e2e/feedback.spec.ts -g "flipping an entry to Done removes it from Open and returns it under Done"
- [ ] Manual check: `grep -n "^\.ui-menu" packages/ui/src/styles/blocks.css` returns nothing (the `.ui-list-manager__row > .ui-menu` layout rules belong to Tasks 33-34); FV
**Dependencies:** 4, 18
**Files likely touched:** `packages/ui/src/components/menu.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Small: 1-2 files

## Task 20: Convert TabBar and Tab

**Description:** Replace `tab-bar.tsx` with the shadcn `tabs` source (Radix `Tabs` from Task 2).
Each tab stays a link: `Tabs.Trigger asChild` wraps the `<a>` so `href` and navigation survive, and
the active tab is driven by the current route. `role="tablist"`/`role="tab"` and roving focus replace
the hand-written `aria-current` list; the `test/tab-bar.test.tsx` assertions that pinned `nav` +
`aria-current` are updated to the tab roles, or deleted where they only pinned the old markup.
**Acceptance criteria:**
- [ ] `Tab`/`TabBar`/`TabProps`/`TabBarProps` export names and prop shapes unchanged; each tab is still an `<a href>`
- [ ] Rendered from the registry `tabs` source with `data-slot` intact; tab rules leave `blocks.css`; no stale `aria-current` assertion remains
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/tab-bar.test.tsx
- [ ] Manual check: `grep -n "ui-tab" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 4
**Files likely touched:** `packages/ui/src/components/tab-bar.tsx`, `packages/ui/test/tab-bar.test.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Small: 1-2 files

## Task 21: Convert Snackbar and SnackbarProvider

**Description:** Rebuild both on the shadcn `toast` source (Radix toast from Task 2; no `sonner`),
preserving `useSnackbar`, `SnackbarApi`/`SnackbarOptions`, leaving-animation timing and the
`ui-snackbar`/`ui-snackbar--leaving` hooks; add the missing provider suite.
**Acceptance criteria:**
- [ ] `Snackbar`/`SnackbarProvider`/`useSnackbar`/`SnackbarApi`/`SnackbarOptions` unchanged; `apps/*` consumers still compile
- [ ] Hooks still render; only approved deps used; snackbar rules leave `blocks.css`; `test/snackbar-provider.test.tsx` asserts enqueue, auto-dismiss, removal
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/snackbar.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/snackbar-provider.test.tsx
- [ ] Manual check: `grep -n "ui-snackbar" packages/ui/src/styles/blocks.css` returns nothing and no `sonner` dependency; FV
**Dependencies:** 4
**Files likely touched:** `packages/ui/src/components/snackbar.tsx`, `packages/ui/src/components/snackbar-provider.tsx`, `packages/ui/test/snackbar-provider.test.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Large: 5+ files

## Checkpoint: After Tasks 19-21

- [ ] The Radix dropdown, tab bar and toast overlays render and behave correctly against their suites
- [ ] `blocks.css` shrank by exactly the menu, tab and snackbar sections; no section gained a second owner
- [ ] `npm run typecheck` green; each touched suite green within its 2-run budget

## Task 22: Convert ThemeToggle and ConfirmButton

**Description:** Rebuild `theme-toggle.tsx` as an `IconButton` composition with the registry variants
and `confirm-button.tsx` as a `Button` composition keeping its two-step confirm state machine; theme
read/write logic stays put and the leftover bespoke CSS goes.
**Acceptance criteria:**
- [ ] `ThemeToggle`/`ThemeToggleProps`/`ConfirmButton`/`ConfirmButtonProps` and confirm sequencing unchanged; any `ui-theme-toggle`/`ui-confirm*` hooks still render
- [ ] Both compose converted primitives with no bespoke visual CSS remaining
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/theme-toggle.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/confirm-button.test.tsx
- [ ] Manual check: `grep -n "ui-theme\|ui-confirm" packages/ui/src/styles/*.css` returns nothing; FV
**Dependencies:** 4
**Files likely touched:** `packages/ui/src/components/theme-toggle.tsx`, `packages/ui/src/components/confirm-button.tsx`
**Estimated scope:** Small: 1-2 files

## Task 23: Convert Autosuggest to the combobox recipe

**Description:** Replace the 299-line hand-written combobox with the shadcn `combobox` recipe —
`Popover` + `Command` (`cmdk`, approved in Task 1d). `Command` owns the accessible listbox, keyboard
navigation and `aria-activedescendant`; the API, the `onQueryChange`/`minChars` contract and the
option filtering stay ours. Assertions that inspect `ui-autosuggest__*` markup or the hand-rolled
listbox are deleted with the markup; assertions on selection, keyboard nav and the reported query
stay.
**Acceptance criteria:**
- [ ] `Autosuggest`/`AutosuggestOption`/`AutosuggestProps` unchanged; selecting an option and reporting a query behave as before
- [ ] Rendered from the registry `combobox`/`command` source; `blocks.css` no longer holds the autosuggest rules; no hand-written listbox markup remains
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/autosuggest.test.tsx
- [x] E2E passes (run 2026-10-28, `playwright.config.ts`): npx playwright test --config apps/app/playwright.config.ts test/e2e/feedback.spec.ts -g "submit feedback from the notes toolbar and read it back in the inbox"
- [ ] Manual check: `grep -n "ui-autosuggest" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 4, 7
**Files likely touched:** `packages/ui/src/components/autosuggest.tsx`, `packages/ui/src/components/command.tsx`, `packages/ui/src/components/popover.tsx`, `packages/ui/test/autosuggest.test.tsx`, `packages/ui/src/styles/blocks.css`

**Decision 5 — `cmdk`'s first-row auto-highlight is suppressed, keeping "no highlight on open".**
The recipe opens a list with row 1 already selected, so a bare `Enter` or `Tab` right after typing
picks and clears on a row the user never walked to. The hand-rolled list this replaces opened
unchosen and ignored `Enter` until a walk happened, and the description requires selection and
query-reporting behaviour to hold as before. So `Autosuggest` holds the `Command` root's `value`
at a sentinel no row carries (`NO_ROW`) and returns to it on every query change; the walk then
only starts on an explicit `ArrowDown`/`Home`/`End`. Reopening on `ArrowDown` still lands on row 1,
as the hand-rolled list did. The deviation is confined to `autosuggest.tsx`; the vendored
`command.tsx` keeps the registry behaviour and documents the `value` hook it rides. The
`ignores Enter with no highlight` case and the selection assertions stay in the suite.

**Estimated scope:** Medium: 3-5 files

## Task 24: Convert FeedbackForm and FeedbackNavItem

**Description:** Rebuild the 183-line `feedback-form.tsx` and `feedback-nav-item.tsx` as compositions
of `Input`, `Textarea`, `Select`, `Button`, `Pill`, `Card` with utilities only, keeping the form
action, validation messaging, status options and the item markup the app's regexes read. The form
emits `ui-field`, `ui-field-label`, `ui-field-label--strong` and `ui-field-label__required` hooks in
its own markup; Task 10 already removed those `blocks.css` rules, so Task 24's `ui-field` grep is a
sanity check, not a removal.
**Acceptance criteria:**
- [ ] `FeedbackForm`/`FeedbackFormProps`/`FeedbackNavItem`/`FeedbackNavItemProps` and submission behaviour unchanged; every control inside is a converted primitive
- [ ] The status-pill class strings render where the converted markup carries them (update the pinned
  assertion in this task otherwise); both `blocks.css` blocks gone
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/feedback-form.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/feedback-nav-item.test.tsx
- [x] E2E passes (run 2026-10-28, `playwright.config.ts`): npx playwright test --config apps/app/playwright.config.ts test/e2e/feedback.spec.ts -g "submit feedback from the notes toolbar and read it back in the inbox"
- [ ] Manual check: `grep -n "ui-feedback\|ui-nav-item\|ui-field" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 4, 7, 13, 14, 17, 18
**Files likely touched:** `packages/ui/src/components/feedback-form.tsx`, `packages/ui/src/components/feedback-nav-item.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 22-24

- [ ] Composite widgets and feedback compositions are utility-styled with their hooks intact
- [ ] No `sonner` or other unapproved dependency in `package-lock.json` (`cmdk`, `class-variance-authority`, `tailwindcss`, `@tailwindcss/postcss` are approved by Task 2)
- [ ] `npm run typecheck` green; each touched suite green within its 2-run budget

## Task 25: Convert Stack, Row and EditorStack

**Description:** Restyle the three layout atoms with utilities mapped to the spacing tokens, removing
`.ui-stack*`, `.ui-row*`, `.ui-editor-stack*` from `blocks.css`; no registry counterpart (Decision
4), so DOM, `as` handling and gap/align props stay exactly as documented.
**Acceptance criteria:**
- [ ] `Stack`/`StackProps`/`StackGap`/`Row`/`RowProps`/`EditorStack`/`EditorStackProps` exports and defaults unchanged
- [ ] Gap/alignment hooks (`ui-stack--sm|md|lg`, `ui-stack--center|end`, `ui-row--*`) still render; no stack rule remains
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/stack.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/row.test.tsx
- [ ] Manual check: `grep -n "ui-stack\|ui-row\|ui-editor-stack" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 2
**Files likely touched:** `packages/ui/src/components/stack.tsx`, `packages/ui/src/components/row.tsx`, `packages/ui/src/components/editor-stack.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Large: 5+ files

## Task 26: Convert Section and PageActions

**Description:** Restyle the page-furniture pair with utilities, keeping heading levels, the action
slot, the `ui-section`/`__heading`/`__actions` and `ui-page-actions` hooks and the
`section > div > h2` nesting the e2e locator walks; remove the section and page-actions rules.
**Acceptance criteria:**
- [ ] `Section`/`SectionProps`/`SectionHeadingLevel`/`PageActions`/`PageActionsProps` unchanged
- [ ] `section.ui-section > div > h2.ui-section__heading` preserved in rendered markup; the section and page-actions rule blocks gone
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/section.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/page-actions.test.tsx
- [x] E2E passes (run 2026-10-28, `playwright.config.ts`): npx playwright test --config apps/app/playwright.config.ts test/e2e/feedback.spec.ts -g "flipping an entry to Done removes it from Open and returns it under Done"
- [ ] Manual check: `grep -n "ui-section\|ui-page-actions" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 2, 25
**Files likely touched:** `packages/ui/src/components/section.tsx`, `packages/ui/src/components/page-actions.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Task 27: Convert PageTitle

**Description:** Restyle `page-title.tsx` with utilities, keeping the heading level, the description
slot and the `ui-page-title` hooks; no registry counterpart (Decision 4), so DOM and props stay as
documented and the page-title rule block leaves `blocks.css`.
**Acceptance criteria:**
- [ ] `PageTitle`/`PageTitleProps` unchanged; `ui-page-title` hooks still render with unchanged nesting
- [ ] The `blocks.css` page-title rules are gone; typography comes from token utilities only
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/page-title.test.tsx
- [ ] Manual check: `grep -n "ui-page-title" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 2
**Files likely touched:** `packages/ui/src/components/page-title.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 25-27

- [ ] Layout atoms, the section/page-actions pair and the page title render from utilities with hooks intact
- [ ] `blocks.css` shrank by exactly the converted sections; no section gained a second owner
- [ ] `npm run typecheck` green; each touched suite green within its 2-run budget

## Task 28: Convert NavBar and FabLink

**Description:** Restyle both with utilities; `FabLink` composes the converted `Button` in `asChild`
form over `next/link` instead of a bespoke `.ui-fab-link` rule, and `--fab-size` is expressed
through the utility scale.
**Acceptance criteria:**
- [ ] `NavBar`/`NavBarProps`/`FabLink`/`FabLinkProps` unchanged; FabLink still renders an anchor through `next/link`
- [ ] `ui-nav-bar`/`ui-fab-link` hooks still render; both `blocks.css` blocks gone
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/nav-bar.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/fab-link.test.tsx
- [ ] Manual check: `grep -n "ui-nav-bar\|ui-fab-link" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 2, 4, 6
**Files likely touched:** `packages/ui/src/components/nav-bar.tsx`, `packages/ui/src/components/fab-link.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Task 29: Convert List and ListShell

**Description:** Restyle the `ul` owner and the list surface wrapper with utilities, keeping the
`ui-list`/`ui-list-shell` hooks and the nesting `ListItem` styles depend on.
**Acceptance criteria:**
- [ ] `List`/`ListProps`/`ListShell`/`ListShellProps` unchanged; list stays a semantic `<ul>`; both hooks still render
- [ ] `blocks.css` no longer holds the list or shell rules
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/list.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/list-shell.test.tsx
- [ ] Manual check: `grep -n "ui-list \|ui-list-shell" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 2, 27, 28 (PageShell is not restyled until Task 37 — ListShell composes it as-is, so it is not prerequisite)
**Files likely touched:** `packages/ui/src/components/list.tsx`, `packages/ui/src/components/list-shell.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Task 30: Convert ListItem

**Description:** Restyle the 140-line rich row with utilities, preserving every asserted variant hook
(`ui-list-item`, `--todo|done|dense|nested|collapsing`, `--accent|amber|danger`, `__title`,
`--with-action`, `__title-action`, `__snippet`, `__sub`, `__link`, `__nested-body`), row height, tap
target and the `button.trash-delete` affordance.
**Acceptance criteria:**
- [ ] `ListItem`/`ListItemProps`/`ListItemSize`/`ListItemTone`/`ListItemVariant` and defaults unchanged
- [ ] Every hook renders on the element the app regexes match with unchanged nesting; `button.trash-delete` still matches; `.ui-list-item*` block gone
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/list-item.test.tsx
- [x] E2E passes (run 2026-10-28, `playwright.config.ts`): npx playwright test --config apps/app/playwright.config.ts test/e2e/feedback.spec.ts -g "flipping an entry to Done removes it from Open and returns it under Done"
- [ ] Manual check: `grep -n "ui-list-item" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 29
**Files likely touched:** `packages/ui/src/components/list-item.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 28-30

- [ ] Navigation, the list surface and the rich row are utility-styled with hooks intact
- [ ] `button.trash-delete` still matches and `blocks.css` shrank monotonically
- [ ] `npm run typecheck` green; each touched suite green within its 2-run budget

## Task 31: Convert SettingsRow and SettingsBlock

**Description:** Rebuild both as `Card`-composed rows and blocks with utilities, keeping labels,
control slots, delete-affordance placement and the `ui-settings-row`/`ui-settings-block` hooks.
**Acceptance criteria:**
- [ ] `SettingsRow`/`SettingsRowProps`/`SettingsBlock`/`SettingsBlockProps` unchanged; both compose converted primitives with no bespoke visual CSS
- [ ] `blocks.css` no longer holds `.ui-settings-row` or the settings-block rules
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/settings-row.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/settings-block.test.tsx
- [ ] Manual check: `grep -n "ui-settings" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 16, 25, 26
**Files likely touched:** `packages/ui/src/components/settings-row.tsx`, `packages/ui/src/components/settings-block.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Task 32: Convert ManagerSurface and ManagerBlock

**Description:** Restyle the shared manager surface and manager block with utilities, keeping the
element order the `manager-markup` snapshots record and the `ui-manager-*` hooks.
**Acceptance criteria:**
- [ ] `ManagerBlock`/`ManagerBlockProps` unchanged; `ManagerSurface` keeps its internal shape
- [ ] Manager snapshot regenerated or deleted in this change, diff explained; no manager layout rule
survives after Tasks 33-34 (the surface renders `classPrefix`, so its rules live in their section)
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/manager-block.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/manager-markup.test.tsx
- [ ] Manual check: `grep -n "ui-manager" packages/ui/src/styles/blocks.css` returns nothing (the manager rules are `.ui-tag-manager*`/`.ui-list-manager*`, deleted by Tasks 33-34 in their own sections); FV
**Dependencies:** 4, 6, 7, 10, 19, 27, 28 (PageShell is not restyled until Task 37 — ManagerBlock composes it as-is, so it is not a prerequisite)
**Files likely touched:** `packages/ui/src/components/manager-surface.tsx`, `packages/ui/src/components/manager-block.tsx`
**Estimated scope:** Medium: 3-5 files

## Task 33: Convert TagManager

**Description:** Rebuild the tag manager on the converted composition (`ManagerSurface`, `Input`,
`Button`, `Menu`, `SettingsRow`) with utilities, keeping the per-row `Menu` pattern, the
`ui-tag-manager__*` hooks and the snapshot-recorded markup.
**Acceptance criteria:**
- [ ] `TagManager`/`TagManagerProps` unchanged; row/name/create hooks still render
- [ ] Manager snapshot regenerated or deleted in this change, diff explained; manager rules leave `blocks.css`
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/tag-manager.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/manager-markup.test.tsx
- [ ] Manual check: `grep -n "ui-tag-manager" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 4, 7, 19, 31, 32 (TagPicker is not restyled until Task 38 — TagManager type-imports it only, so it is not a prerequisite)
**Files likely touched:** `packages/ui/src/components/tag-manager.tsx`, `packages/ui/test/__snapshots__/manager-markup.test.tsx.snap`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Task 34: Convert ListManager

**Description:** Rebuild the list manager on the same converted composition (`ManagerSurface`,
`Input`, `Button`, `Menu`, `SettingsRow`) with utilities, keeping the per-row `Menu` pattern, the
inline rename editor, the `ui-list-manager__*` hooks and the snapshot-recorded markup.
**Acceptance criteria:**
- [ ] `ListManager`/`ListManagerProps`/`TodoListOption` unchanged; row/name/create/list hooks still render
- [ ] Manager snapshot regenerated or deleted in this change, diff explained; manager rules leave `blocks.css`
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/list-manager.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/manager-markup.test.tsx
- [ ] Manual check: `grep -n "ui-list-manager" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 4, 7, 19, 31, 32, 33
**Files likely touched:** `packages/ui/src/components/list-manager.tsx`, `packages/ui/test/__snapshots__/manager-markup.test.tsx.snap`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 31-34

- [ ] Settings rows, the manager surface and both managers converted
- [ ] The manager markup contract still holds; snapshots regenerated or deleted in-task with the diff explained
- [ ] `npm run typecheck` green; each touched suite green within its 2-run budget

## Task 35: Convert MatrixBlock and EditorToolbar

**Description:** Restyle the matrix block and the editor toolbar with utilities, keeping the
quadrant/tone vocabulary, toolbar slot order and the `ui-matrix`/`ui-editor-toolbar` hooks.
**Acceptance criteria:**
- [ ] `MatrixBlock`/`MatrixBlockProps`/`MatrixQuadrant`/`MatrixTone`/`EditorToolbar`/`EditorToolbarProps`/`EditorToolbarBack` unchanged
- [ ] Hooks still render; the 2×2 grid survives every breakpoint via utilities; both rule blocks gone
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/matrix-block.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/editor-toolbar.test.tsx
- [ ] Manual check: `grep -n "ui-matrix\|ui-editor-toolbar" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 4, 25, 26
**Files likely touched:** `packages/ui/src/components/matrix-block.tsx`, `packages/ui/src/components/editor-toolbar.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Task 36: Convert EditorScreen

**Description:** Restyle the editor screen wrapper with utilities (grid, safe-area padding, scroll
containment), keeping `ui-editor-screen` and the slot structure the editor pages rely on.
**Acceptance criteria:**
- [ ] `EditorScreen`/`EditorScreenProps` unchanged; `ui-editor-screen` still renders and layout comes from utilities only
- [ ] `blocks.css` no longer holds `.ui-editor-screen`
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/editor-screen.test.tsx
- [ ] Manual check: `grep -n "ui-editor-screen" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 25
**Files likely touched:** `packages/ui/src/components/editor-screen.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Small: 1-2 files

## Task 37: Restyle PageShell and EditorChrome

**Description:** Out-of-scope blocks keep their design and composition (spec §1); all their `blocks.css`
rules move to utilities so Task 40 can delete the file, each rebuilt on the converted primitives it
composes — PageShell's page grid, EditorChrome's chrome frame and tag-picker slot.
**Acceptance criteria:**
- [ ] `PageShell`/`PageShellProps`/`EditorChrome`/`EditorChromeProps`/`EditorChromeTagPicker` and slot composition unchanged; rendered structure identical apart from `class` contents
- [ ] Both `blocks.css` sections removed; no visual rule recreated outside utilities
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/page-shell.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/editor-chrome.test.tsx
- [ ] Manual check: `grep -n "ui-page \|ui-editor-chrome" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 25, 35, 36 (TagPicker is not restyled until Task 38 — EditorChrome composes it as-is, so it is not a prerequisite)
**Files likely touched:** `packages/ui/src/components/page-shell.tsx`, `packages/ui/src/components/editor-chrome.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 35-37

- [ ] Matrix, toolbar, editor screen, page shell and editor chrome are utility-styled with hooks intact
- [ ] Only the remaining out-of-scope block sections survive in `blocks.css`
- [ ] `npm run typecheck` green; each touched suite green within its 2-run budget

## Task 38: Restyle FabMenu and TagPicker

**Description:** Second out-of-scope pass: `FabMenu` and `TagPicker` keep composition and behaviour;
only their own `blocks.css` rules move to utilities. `FabMenu` keeps its own disclosure markup —
`fab-menu.tsx` composes no primitives (only `useRef`, `cx`, `usePanelDismiss`), so Tasks 19 and 28
are not its dependencies.
**Acceptance criteria:**
- [ ] `FabMenu`/`FabMenuProps`/`TagPicker`/`TagPickerProps`/`TagOption` unchanged; `ui-fab-menu*`/`ui-tag-picker*` hooks still render with unchanged nesting
- [ ] Both `blocks.css` sections removed
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/fab-menu.test.tsx
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/tag-picker.test.tsx
- [ ] Manual check: `grep -n "ui-fab-menu\|ui-tag-picker" packages/ui/src/styles/blocks.css` returns nothing; FV
**Dependencies:** 10, 13
**Files likely touched:** `packages/ui/src/components/fab-menu.tsx`, `packages/ui/src/components/tag-picker.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Medium: 3-5 files

## Task 39: Restyle TrashBlock

**Description:** Final out-of-scope pass: `TrashBlock` keeps its list/restore/empty composition and
the `button.trash-delete` affordance e2e drives; its `blocks.css` rules move to utilities so the file
can be deleted.
**Acceptance criteria:**
- [ ] `TrashBlock`/`TrashBlockProps`/`TrashBlockItem`/`TrashFormAction` unchanged; restore/empty hooks still render
- [ ] `button.trash-delete` still renders and matches; the trash section leaves `blocks.css`
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/trash-block.test.tsx
- [ ] Manual check: `grep -n "ui-trash\|trash-delete\|trash-empty\|trash-restore" packages/ui/src/styles/*.css` returns nothing and `grep -rn "trash-delete" packages/ui/src/components/trash-block.tsx` still finds it; FV
**Dependencies:** 4, 6, 17, 22, 26, 27, 28, 29, 30 (PageShell is not restyled until Task 37 — TrashBlock composes it as-is, so it is not prerequisite)
**Files likely touched:** `packages/ui/src/components/trash-block.tsx`, `packages/ui/src/styles/blocks.css`
**Estimated scope:** Small: 1-2 files

## Task 40: Delete `atoms.css` and `blocks.css`

**Description:** Remove both stylesheets and their imports, leaving `tokens.css`, `theme.css` and
`base.css`. Any suite still reading a rule block from either file loses that assertion here — the
assertion reads a file that no longer exists, so it goes with the CSS (spec §6). Behaviour, DOM and
computed-style assertions stay.
**Acceptance criteria:**
- [ ] Both files gone and unimported; `styles.css` imports only tokens, theme, base
- [ ] No suite under `packages/ui/test/` reads either path; no colour literal outside `tokens.css`
**Verification:**
- [ ] Typecheck passes: npm run typecheck
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/tokens.test.ts
- [ ] Focused unit tests pass: npm run test:unit -w @life/ui -- test/theme-parity.test.ts
- [ ] Manual check: `grep -rnE "#[0-9a-fA-F]{3,8}|rgba?\(" apps packages/ui/src --include='*.css'` hits only `packages/ui/src/styles/tokens.css`, and `grep -rln "atoms.css\|blocks.css" packages/ui` returns nothing; FV
**Dependencies:** 6, 12, 17, 24, 36, 39
**Files likely touched:** `packages/ui/src/styles/atoms.css`, `packages/ui/src/styles/blocks.css`, `packages/ui/src/styles.css`, `packages/ui/test/*.test.tsx`
**Estimated scope:** Large: 5+ files

## Checkpoint: After Tasks 38-40

- [ ] `blocks.css` and `atoms.css` are deleted; `styles.css` imports tokens, theme, base only
- [ ] The six out-of-scope blocks keep unchanged structure and behaviour
- [ ] All 57 component files are accounted for: converted from the registry, or no-counterpart and styled with utilities

## Task 41: Run the close-out gate

**Description:** Run the spec §8 checks as one gate and paste the output into `docs/reports/shadcn-primitive-migration-<date>.md`:
typecheck across workspaces, every `packages/ui/test/` suite, the Contract 1 greps, the
`apps/*` diff, and `tokens.test.ts` byte-identical to `origin/dev`.
**Acceptance criteria:**
- [x] `npm run typecheck` green; every `packages/ui/test/` suite green within its 2-run budget
- [x] `git diff --name-only origin/dev...HEAD -- 'apps/**/*'` lists only `apps/app/postcss.config.mjs` and
      `apps/app/app/todo-item.tsx` in source (spec §8.1's two sanctioned files) and, at most, test files
      whose assertions pinned markup a replacement removed
- [x] `tokens.test.ts` byte-identical to `origin/dev`; every replaced component file names its registry item or records that it has no counterpart
**Verification:**
- [x] Typecheck passes: npm run typecheck
- [x] Focused unit tests pass: npm run test:unit -w @life/ui -- test/tokens.test.ts
- [x] Focused unit tests pass: npm run test:unit -w @life/ui -- test/theme-parity.test.ts
- [x] Manual check: the Contract 1 greps, the `no app re-implementation of a packages/ui component's markup` check, and the `git diff --name-only origin/dev...HEAD -- 'apps/**/*'` output are pasted into `docs/reports/shadcn-primitive-migration-<date>.md`; FV
**Dependencies:** 40
**Files likely touched:** `tasks/plan.md`, `docs/reports/shadcn-primitive-migration-<date>.md`
**Estimated scope:** Small: 1-2 files

## Checkpoint: Complete

- [x] `npm run typecheck` green across all workspaces; every `packages/ui/test/` suite green
- [x] `theme-parity.test.ts` proves all 11 frozen colours in light and dark; `tokens.test.ts` byte-identical to `origin/dev`
- [x] `atoms.css`/`blocks.css` deleted; no colour literal outside `tokens.css`
- [x] No suite reads a deleted stylesheet; no snapshot pins replaced markup
- [x] `apps/*` source unchanged beyond spec §8.1's two sanctioned files (`apps/app/postcss.config.mjs`, the `DoneToggle` recomposition in `apps/app/app/todo-item.tsx`); the migration is commit
  `62461f5` on `pi/wf/shadcn-primitive-migration`, and the gate round's own repairs stay uncommitted
  on top of it for review

Per-task verification blocks below Task 41 record the plan as written, not a ticked
execution log: the tasks were implemented and their suites run during the run, but the
individual boxes were not maintained per task. The evidence of record is the §8 gate
output pasted into `docs/reports/shadcn-primitive-migration-2026-10-28.md`, and a task
box left unticked here does not mean its work is outstanding.

## Open Questions

None. The 2026-10-27 rulings settled the PostCSS entry point, `cmdk`, the deviation scope, the
snapshot policy, the stylesheet-reading assertions and the selector surface.

