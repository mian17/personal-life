# Personal Life — Design System

A self-hosted personal life app (notes, todos, meals, pomodoro, feedback). The visual
language lives in one place: `@life/ui` (`packages/ui`). Every app renders from its
primitives and takes its colours, spacing, radii and type from
`packages/ui/src/styles/tokens.css`. Nothing below is a proposal — every value is quoted
from the tree at commit `1b7b4c5`.

## Visual Theme & Atmosphere

Dark-first, flat, and quiet. The default theme is dark: `:root` declares
`--bg: #0f1115` and `--text: #e8eaf0`, so a screen that never asks for a theme is a deep
near-black page with a single raised surface colour (`--panel: #181b22`) and one
attention colour (`--accent: #5b8cff`). There are no gradients anywhere in the tree, no
second accent, and one elevation shadow.

Light theme exists and is fully specified (see *Color Palette & Roles*), reached by
`:root[data-theme='light']` or by `@media (prefers-color-scheme: light)` when no theme is
pinned. `ThemeToggle` cycles `system → light → dark` and writes `localStorage.theme` plus
`document.documentElement.dataset.theme`.

The atmosphere is a document, not a dashboard: a single centred column capped at
`--content-width: 640px`, one typeface (`--font-stack: system-ui, -apple-system,
sans-serif` at `--font-size: 16px` / `--leading: 1.5`), 12px-radius rows stacked on a
0.5rem gap, a tab rail above them, and one floating action button in the bottom-right
corner. Colour carries meaning, not decoration: accent for the primary action and the
active tab, red for destructive and overdue, amber for in-progress and due-soon, green for
done. Borders are hairlines (`--border: #2a2f3a`, 1.29:1 against the panel) — they group,
they never signal.

## Color Palette & Roles

All eleven colours are declared once in `packages/ui/src/styles/tokens.css`. That file is
the only file in the repo allowed to contain a colour literal (mechanical check in
`AGENTS.md`; the two `#f4f5f7` / `#0f1115` values in `apps/app/app/layout.tsx` are the PWA
`viewport.themeColor` constant, app-owned and frozen).

| Token | Dark (`:root`) | Light (`data-theme='light'`) | Role |
|---|---|---|---|
| `--bg` | `#0f1115` | `#f4f5f7` | page ground; also the dialog scrim at 50% (`bg-bg/50`) |
| `--panel` | `#181b22` | `#ffffff` | raised surface: cards, rows, fields, tab rail, menus, toasts, dialog |
| `--text` | `#e8eaf0` | `#1a1d24` | primary text and default glyph colour |
| `--muted` | `#8b93a7` | `#5c6577` | meta lines, inactive tabs, placeholders, disabled text, done rows |
| `--accent` | `#5b8cff` | `#2f6bff` | primary button fill, active tab fill, selected switch track, focus ring |
| `--danger` | `#ff6b6b` | `#d64545` | destructive glyph/text, alert banner border, overdue date |
| `--danger-soft` | `#ff9e9e` | `#d97070` | lighter red: a future due date in the `signal` tone |
| `--amber` | `#f2b64c` | `#b45309` | in-progress status, due-soon rows, amber lens tone |
| `--green` | `#4cc38a` | `#15803d` | done/success status, green lens tone |
| `--border` | `#2a2f3a` | `#dfe3ea` | hairline borders; unchecked switch track |
| `--on-accent` | `white` | `white` (not overridden) | text and glyphs on an accent fill |

Colour reaches components through Tailwind v4 utilities, not `var()` in component files:
`packages/ui/src/styles/theme.css` maps `--color-<name>: var(--<name>)` in an `@theme`
block, so a component writes `bg-panel` / `text-muted` / `border-border` and the value
stays in `tokens.css`.

Measured contrast (computed from the declared values; ratios are exact, not rounded
targets):

| Pair | Dark | Light |
|---|---|---|
| `--text` on `--bg` | 15.71:1 | 15.46:1 |
| `--text` on `--panel` | 14.33:1 | 16.87:1 |
| `--muted` on `--bg` | 6.15:1 | 5.37:1 |
| `--muted` on `--panel` | 5.60:1 | 5.86:1 |
| `--accent` on `--bg` | 5.97:1 | 4.12:1 |
| `--accent` on `--panel` | 5.45:1 | 4.50:1 |
| `--on-accent` on `--accent` | 3.16:1 | 4.50:1 |
| `--danger` on `--panel` | 6.21:1 | 4.38:1 |
| `--danger-soft` on `--panel` | 8.73:1 | 3.23:1 |
| `--amber` on `--panel` | 9.49:1 | 5.02:1 |
| `--green` on `--panel` | 7.78:1 | 5.02:1 |
| `--border` on `--panel` | 1.29:1 | 1.29:1 |

Two consequences worth stating plainly: an accent fill with white text is a
large-text/bold pairing in dark (3.16:1) and only just meets AA for normal text in light
(4.50:1); and `--border` is decorative in both themes, so a border may never be the only
carrier of a state.

Status vocabulary maps to four tokens and nothing else
(`packages/ui/src/components/feedback-status.ts`, pinned by
`packages/ui/test/tokens.test.ts`): `open → --accent`, `in_progress → --amber`,
`done → --green`, `wont_do → --muted`.

## Typography Rules

One family, one size root, one leading, no display face.

- Family: `--font-stack: system-ui, -apple-system, sans-serif`. Applied once in
  `packages/ui/src/styles/base.css` as `font: var(--font-size)/var(--leading)
  var(--font-stack)` on `html, body`. A field re-states `[font:inherit]` because Tailwind
  preflight is deliberately not imported.
- Root size: `--font-size: 16px`; leading `--leading: 1.5`. Long-form writing uses
  `--fs-editor: 1.05rem` (16.8px) in the `editor` textarea variant.
- There is no declared type scale. Every other size is a spacing token used in a
  font-size position (`text-[length:var(--space-0-85)]`), so the sizes are exact and
  few:

| Value | Token | Where |
|---|---|---|
| 0.7rem (11.2px) | `--space-0-7` | dense todo rows |
| 0.8rem (12.8px) | `--space-0-8` | status chip text |
| 0.85rem (13.6px) | `--space-0-85` | meta/label lines, status read-out, settings descriptions |
| 0.9rem (14.4px) | `--space-0-9` | alert banner text, snackbar message |
| 0.95rem (15.2px) | `--space-0-95` | pill remove glyph |
| 1rem (16px) | `--font-size` | body and field text (`text-base`) |
| 1.05rem (16.8px) | `--fs-editor` | note editor body |
| 1.25rem (20px) | `--space-1-25` | dialog title, section heading |
| 2rem / 3rem | `--space-2` / `--space-3` | oversized numeric read-outs (countdown) |

- Weight: `font-semibold` for control labels and row titles, `font-bold` for the dialog
  title and section headings. Headings carry `tracking-[-0.02em]`; body text carries no
  tracking change.
- Truncation is a rule, not a fallback: a list title is one ellipsized line
  (`truncate`), a todo title reads up to two (`line-clamp-2 whitespace-normal`).

## Spacing & Layout Rhythm

The scale is not geometric and it is frozen: it is exactly the set of rem literals the
pre-migration `globals.css` contained, promoted to tokens and pinned by
`packages/ui/test/tokens.test.ts`. Nineteen steps exist; there is no arithmetic to a
missing step.

| Steps (rem) | px | Role |
|---|---|---|
| `--space-0-15` | 2.4 | title-to-meta gap, checkbox inset |
| `--space-0-2` | 3.2 | checkbox inset and corner radius, switch thumb inset |
| `--space-0-25` | 4 | nav-bar bottom margin |
| `--space-0-3` | 4.8 | chip icon gap |
| `--space-0-35` | 5.6 | filter pill vertical padding |
| `--space-0-4` | 6.4 | tab rail gap and inner padding |
| `--space-0-5` | 8 | the default tight gap: list rows, menu panel, dialog footer |
| `--space-0-6` | 9.6 | dense row vertical padding, banner vertical padding, toast padding |
| `--space-0-7` | 11.2 | filter pill horizontal padding |
| `--space-0-75` | 12 | row gap, tab trigger padding, chip horizontal padding |
| `--space-0-8` | 12.8 | status chip text size |
| `--space-0-85` | 13.6 | meta lines and pill text size; `bare` button horizontal padding |
| `--space-0-9` | 14.4 | the standard text inset inside a row; card padding |
| `--space-0-95` | 15.2 | pill remove-glyph size |
| `--space-1` | 16 | page padding, dialog padding, fab inset, `Stack` md gap |
| `--space-1-25` | 20 | switch thumb travel |
| `--space-2` | 32 | `Stack` lg gap, section top margin, dialog horizontal margin |
| `--space-3` | 48 | extra-large gap |
| `--space-5` | 80 | page bottom padding that clears the fab |

`Stack` binds three of them to names: `sm → --space-0-5`, `md → --space-1`,
`lg → --space-2`. Layout constants ride their own tokens: `--content-width: 640px`
(page column cap, dialog max width), `--tap-height: 48px` (declared; consumed only by the
autocomplete/command rows — the global 48px target comes from the `h-12` / `size-12`
utilities on controls), `--icon-btn-size: 40px`, `--fab-size: 56px`,
`--focus-ring: 2px`, `--border-width: 1px` (declared, no consumer: borders take Tailwind's
`border` utility).

The page frame is `PageShell`: `max-w-[var(--content-width)] mx-auto
px-[var(--space-1)] pt-[var(--space-1)] pb-[calc(var(--space-5)+env(safe-area-inset-bottom))]`.
Inside it: `NavBar` (gap `--space-0-5`, trailing group pushed right), `PageTitle`, a
`TabBar` rail, then sections on `--space-2` top margin, each a `Stack`. Rows are gathered
in a `List` (`gap-[var(--space-0-5)]`).

## Radii, Borders & Shadow

Three radii, one border width, one shadow.

- `--radius-md: 10px` — field shells, buttons, icon buttons, the tab rail and its
  triggers, menu and popover panels, toast, alert banner.
- `--radius-lg: 12px` — cards, list rows, and the centred dialog panel.
- `--radius-pill: 999px` — pills and chips (`rounded-full`), the fab, the switch track and
  thumb.
- Two radii are written outside the token set and stay that way: the checkbox corner is
  `rounded-[var(--space-0-2)]` (3.2px) and the full-screen dialog sheet is
  `rounded-none` (0).
- Borders are always 1px and always `--border`, except: the alert banner
  (`border-danger`), `ghost` buttons and icon buttons (`--border`), and the checkbox,
  which draws `border border-current` so a row tone tints its own box.
- Shadow: `--shadow-fab: 0 4px 12px rgba(0, 0, 0, 0.25)` is the only elevation. It lifts
  the floating layers — fab, fab menu panel, toast, dropdown panel, popover, centred
  dialog. Cards, rows, fields and rails sit flat and cast nothing.

## Motion

Two durations, one curve, all in `tokens.css`:

- `--duration-fast: 120ms` — declared, no consumer in the current tree.
- `--duration-base: 200ms` — list-row collapse (`height, opacity`), toast enter and leave.
- `--ease-standard: ease-out` — the only curve; used with `--duration-base`.
- Colour transitions ride `transition-colors` (Tailwind default 150ms) on buttons, tabs,
  fields, switches and rows. That duration is not a token.

Notable behaviours: a collapsing `ListItem` animates `height` and `opacity` to zero with
`[interpolate-size:allow-keywords]`; a toast enters with `starting:translate-y-[var(--space-1)]
starting:opacity-0`, holds for `duration` (default 5000ms), then mirrors the entry
(`translate-y-[var(--space-1)] opacity-0`) for the `EXIT_MS = 200` window in
`snackbar.tsx` before unmounting. There is no `prefers-reduced-motion` branch anywhere in
the tree.

## Component Stylings

These are the primitives actually vendored in `packages/ui/src/components` (61 files;
`code/components.json` carries the per-file export and prop snapshot). Registry copies are
marked with a provenance comment naming the shadcn item and snapshot
`ui-registry-2026-10-26`.

**Button** (`button.tsx`, cva). Base: `inline-flex items-center justify-center gap-2
whitespace-nowrap rounded-md font-semibold cursor-pointer transition-colors`, focus
`outline-solid outline-[length:var(--focus-ring)] outline-offset-[var(--focus-ring)]
outline-accent`, disabled `cursor-not-allowed opacity-50`.
Variants: `primary` = `bg-accent text-on-accent`; `ghost` = `border border-border
bg-transparent text-text`; `danger` = `bg-transparent text-danger`; `quiet` =
`bg-transparent text-accent`. Sizes: `default` = `h-12 px-5 py-3` (48px target);
`bare` = `h-auto px-3.5 py-1.5 text-sm`; `icon` = `size-12 p-0`. Compounds: danger+icon
adds `text-xl leading-none`; danger+default is `w-12`; danger+bare is `border
border-danger text-sm`. Defaults are `primary` / `default`.

**IconButton** (`icon-button.tsx`). A `size-10` (40px) square, `rounded-md`, `border`,
`border-border bg-panel text-text`; `ghost` is `border-transparent bg-transparent`. Every
icon button requires a `label` prop and renders it as `aria-label`.

**FabLink / FabMenu** (`fab-link.tsx`, `fab-menu.tsx`). Fixed bottom-right at
`calc(var(--space-1) + env(safe-area-inset-right|bottom))`, `size-[var(--fab-size)]` (56px),
`rounded-full`, `bg-accent text-on-accent`, `shadow-[var(--shadow-fab)]`, `z-10`. The menu
variant stacks its options panel upward (`flex-col-reverse`) on a `--space-0-5` gap; the
panel is `border border-border rounded-[var(--radius-md)] bg-panel shadow-[var(--shadow-fab)]`
with `p-[var(--space-0-5)]`.

**Input / Select / Textarea** (`input.tsx`, `select.tsx`, `textarea.tsx`). Shared shell:
`h-12 rounded-md border border-border bg-panel px-3 py-2 text-base text-text`, placeholder
`--muted`, focus the same 2px accent outline at 2px offset, `[font:inherit]` because
preflight is absent. Textarea: `min-h-16 resize-none` in `default`; the `editor` variant
drops shell, padding and focus ring and takes `--fs-editor`. Select is the native picker
styled as the field shell (no Radix select).

**Checkbox** (`checkbox.tsx`, Radix). Square `size-[var(--checkbox-size,var(--space-0-75))]`
(12px default; todo rows set `--checkbox-size: var(--space-1-25)` = 20px, dense rows keep
0.75rem), `p-[var(--space-0-15)]`, `rounded-[var(--space-0-2)]`, `border border-current`,
`data-[state=checked]:bg-current`. The check is a lucide `Check` at `strokeWidth={3}`
drawn in `--panel`, so it reads against the fill. A row `tone` tints box and glyph
(`danger` / `amber` / `accent`).

**Switch** (`switch.tsx`, Radix). Track
`h-[calc(var(--space-1)+var(--space-0-4))]` (22.4px) ×
`w-[calc(var(--space-1)+var(--space-0-4)+var(--space-1-25))]` (42.4px),
`p-[var(--space-0-2)] rounded-full`, `bg-border` off → `data-[state=checked]:bg-accent` on;
thumb `size-[var(--space-1)]` (16px) `bg-muted` → `bg-on-accent`, sliding one
`--space-1-25`. Requires a `label` (rendered as `aria-label`).

**Dialog** (`dialog.tsx`, Radix). Scrim `fixed inset-0 z-50 bg-bg/50`. Centred panel:
`border border-border bg-panel p-[var(--space-1)] text-text
shadow-[var(--shadow-fab)]`, `w-[calc(100%-var(--space-2))] max-w-[var(--content-width)]`,
`rounded-[var(--radius-lg)]`. `size="full"` swaps to an edge-to-edge sheet
(`inset-0 h-[100dvh] w-full rounded-none`). Header is title + close `IconButton` (`X`
size 20) on a `--space-0-5` gap; title is 1.25rem bold; footer right-aligns its actions on
the same gap. Radix owns the focus trap and Escape; the component restores focus to the
opener on close.

**Dropdown menu** (`menu.tsx`, Radix, non-modal). Trigger is an `IconButton` with
`MoreVertical` size 16; panel is `z-50 flex flex-col gap-[var(--space-0-4)]
p-[var(--space-0-5)] border rounded-[var(--radius-md)] bg-panel text-text
shadow-[var(--shadow-fab)]`, portalled so a card's `overflow: hidden` cannot clip it.

**Popover** (`popover.tsx`, Radix). Content: `z-50 overflow-hidden
rounded-[var(--radius-md)] border border-border bg-panel text-text
shadow-[var(--shadow-fab)] outline-none`, `sideOffset = 4`. Width and padding belong to
the caller.

**Tabs** (`tab-bar.tsx`, Radix). Rail: `inline-flex items-center gap-[var(--space-0-4)]
p-[var(--space-0-4)] mb-[var(--space-1)] rounded-[var(--radius-md)] border border-border
bg-panel`. Trigger: `px-[var(--space-0-75)] py-[var(--space-0-5)]
rounded-[var(--radius-md)] text-muted`, active `bg-accent text-on-accent`, focus ring as
everywhere. A trigger is a real route link (`next/link`), so activation navigates.

**Toast / Snackbar** (`snackbar.tsx`, Radix). Fixed `z-20` above the fab at
`left/bottom: calc(var(--space-1) + env(safe-area-inset-*))`,
`p-[var(--space-0-6)_var(--space-0-75)]`, `bg-panel text-text border border-border
rounded-[var(--radius-md)] shadow-[var(--shadow-fab)]`, message at `--space-0-9`, action a
`quiet`/`bare` button. `role="status"`; the Radix announcer is pointed at a hidden
container so the message is announced once.

**List / ListItem** (`list.tsx`, `list-item.tsx`). List: `list-none m-0 p-0 grid
gap-[var(--space-0-5)]`. Row: `bg-panel rounded-[var(--radius-lg)] overflow-hidden` with a
minimum two-line height, body padding `p-[var(--space-0-9)]` and
`gap-[var(--space-0-75)]`; title `font-semibold`; meta/snippet line `text-muted
text-[length:var(--space-0-85)]` with a `|` separator in `text-border`. Variants: `todo`
(two-line clamp, leading checkbox inset `ps-[var(--space-0-9)]`), `nested` (title line
above a child body), `feedback` (description line above the meta line, status pill on the
title line). `size="dense"` packs to `py-[var(--space-0-6)] ps-[var(--space-0-9)]
pe-[var(--space-0-4)]` with 0.7rem text. `done` strikes the title and mutes the row.

**Card** (`card.tsx`). `rounded-[var(--radius-lg)] border border-border bg-panel
p-[var(--space-0-9)] text-text overflow-hidden`; `fill` makes the card a screen
(`grid place-content-center-safe overflow-auto`).

**Pill** (`pill.tsx`, cva). `inline-flex items-center rounded-full`; `chip` = `gap-[var(--space-0-3)]
border border-border px-[var(--space-0-5)] py-[var(--space-0-2)] text-[length:var(--space-0-8)]`;
`filter` = `border-0 px-[var(--space-0-7)] py-[var(--space-0-35)]
text-[length:var(--space-0-85)]`. Active is `bg-accent text-on-accent`; otherwise
`bg-panel` plus the tone's text colour.

**AlertBanner** (`alert-banner.tsx`, cva). One tone, `warning`: `border-danger bg-panel
text-text`, `px-[var(--space-0-75)] py-[var(--space-0-6)] rounded-[var(--radius-md)]
mb-[var(--space-0-5)]`, message at `--space-0-9` with actions wrapped beside it.

**Section / Stack / Row / SettingsRow / NavBar / PageShell / PageTitle**. Section: top
margin `--space-2`, heading 1.25rem bold with `tracking-[-0.02em]`, and it keeps the shape
of its heading markup. Stack: `grid` with `sm|md|lg` gaps `--space-0-5 | --space-1 |
--space-2`. SettingsRow: label column plus control, stacking below `sm`.

## Iconography

`lucide-react` (peer dependency `^1.59.0`) is the only icon source — no emoji, no
hand-drawn SVG in components.

- Sizes in use, by frequency: `size={20}` (26 sites), `size={18}` (7), `size={16}` (6),
  `size={28}` (6), `size={14}` (1). Field and row glyphs are 16–20px; page and nav action
  glyphs are 28px; the only 14px glyph is the pill remove mark.
- Stroke width: lucide's default 2 unless stated. Nav and toolbar glyphs that sit at 28px
  pair with `strokeWidth={2.5}` (6 sites, e.g. `list-shell.tsx`, the notes/todos/matrix
  page headers); the checkbox check is the single `strokeWidth={3}` (a small glyph needs
  the extra weight).
- Decorative glyphs carry `aria-hidden`; a glyph-only control is an `IconButton` with a
  `label`, or `FabLink`/`IconLink` with a `label`.
- Glyphs are monochrome and inherit `currentColor`: `text-muted` by default in nav and
  meta positions, `text-danger` for destructive actions, `text-accent` for accent actions.

## States & Feedback

- **Focus** — one treatment everywhere: `outline` of `--focus-ring` (2px) in `--accent`,
  offset 2px, only on `:focus-visible`. After `outline-none`/`outline-hidden` a component
  must re-add `outline-solid`, otherwise Chromium computes `outline-style: none` and the
  ring is invisible (`switch.tsx`, `fab-link.tsx` and `tab-bar.tsx` document this).
- **Hover** — colour only, no elevation or size change. Rows rely on the link's own
  hover; controls change fill or text tone.
- **Disabled** — `cursor-not-allowed` (or `cursor-default` on the switch track) plus
  `opacity-50`; disabled fields also turn `text-muted`.
- **Danger** — `--danger` for destructive text/glyphs and overdue dates, `--danger-soft`
  for a future date in the `signal` tone, `border-danger` on the alert banner. Destructive
  buttons are borderless text buttons, never a filled red block.
- **Success / progress / neutral status** — `--green`, `--amber`, `--muted` through the
  four-token status map (`open/in_progress/done/wont_do`).
- **Transient feedback** — the snackbar is the only toast: `role="status"`, auto-dismiss
  at 5000ms, one optional `quiet` action, and a 200ms leave. Live read-outs
  (`StatusText`) use `role="status" aria-live="polite"` and hide with `visibility: hidden`
  so the layout never moves.
- **Empty and error surfaces** — `EmptyState` for an empty list, `AlertBanner` (warning
  tone) for a blocking condition such as a failed sync.

## Responsive Behavior

- The breakpoint scale is documented and owned by `packages/ui/test/tokens.test.ts`
  (`BREAKPOINTS`): `sm 640px`, `md 768px`, `lg 1024px`, `xl 1280px`, `2xl 1536px`.
  `tokens.css` deliberately declares no breakpoint custom properties — media queries
  cannot read them — so a media rule writes its literal with a comment naming the step.
- Only one breakpoint is consumed in the tree: `settings-row.tsx` uses
  `max-sm:flex-col max-sm:items-stretch`, so a settings row stacks its control under its
  label below 640px. `md`, `lg`, `xl` and `2xl` are scale entries without a consumer.
- Layout adapts by measure, not by breakpoints: the page is a 640px-max centred column
  with 16px side padding, so it is a phone column until the viewport is wider than 672px
  and stays that column after.
- Fixed layers respect safe areas: fab and toast insets add
  `env(safe-area-inset-right|bottom)`, the page reserves
  `calc(var(--space-5) + env(safe-area-inset-bottom))` at the bottom.
- Height-bound screens use `100dvh` (`editor-screen.tsx`, `list-shell.tsx`, the dialog
  sheet), and the dialog offers `size="full"` for an edge-to-edge sheet on a small screen.
- Rows and controls never reflow between breakpoints; the two row scales (`default`,
  `dense`) are consumer choices, not media-query outcomes.

## Accessibility Rules

- Touch targets: 48px for every primary control (`h-12` / `size-12` utilities); icon
  buttons are 40px, the pill remove glyph is the smallest interactive mark. `--tap-height:
  48px` exists as a token but is only consumed by autocomplete/command rows.
- Names: `IconButton`, `FabLink`, `IconLink`, `Switch` and `Checkbox` take a `label` and
  render it as `aria-label`. Visible app copy is frozen text supplied by the app.
- Decorative icons are `aria-hidden`. Icon-only controls never rely on the glyph for
  meaning.
- Focus is always visible: 2px accent outline, 2px offset, keyboard-only.
- Dialog and menu behaviour (focus trap, Escape, outside dismiss, restore) is Radix's;
  the dialog additionally hands focus back to its opener because a controlled surface has
  no Radix trigger.
- Live regions: snackbar `role="status"`, `StatusText` `role="status"
  aria-live="polite"`.
- Contrast, measured and recorded above: body text is 15.71:1 (dark) / 15.46:1 (light) on
  the ground and muted text stays ≥ 5.37:1 in both themes. Known limits: `--on-accent` on
  `--accent` is 3.16:1 in dark (bold or large text only), `--accent` text on `--bg` is
  4.12:1 in light, `--danger-soft` is 3.23:1 in light, and `--border` is 1.29:1 — never
  the sole carrier of meaning.
- Both themes are first class: any change must be checked in dark and light
  (`packages/ui/test/theme-parity.test.ts` does exactly that for the frozen colours).
- Gap in the current tree: no `prefers-reduced-motion` handling exists, so the toast and
  row-collapse transitions always run.

## Agent Prompt Guide

Read this before touching UI. The visual language is owned by `@life/ui`; an app composes
it and owns nothing visual.

1. Import from `@life/ui`. Never write a bare `<button>`, `<input>`, `<textarea>`,
   `<select>`, `<a>`, `<img>`, `<label>` or `<progress>` in `apps/*` UI code. `next/link`
   belongs to `@life/ui` too.
2. Colour, spacing, radii, shadow and motion come from `tokens.css` via the utilities in
   `theme.css` (`bg-panel`, `text-muted`, `border-border`, `bg-accent`, …). Never write a
   hex, `rgb()`, or raw `px`/`rem` value in app or component code.
3. If a value you need is not in the palette — a second accent, an elevation ladder, a new
   radius step, a gradient, a light-theme variant of `--on-accent` — stop. It is a token
   change with a `tokens.test.ts` update, not an implementation detail
   (`token-map/unmatched.json` lists these).
4. Use the documented sizes: text sizes as listed, `--radius-md` 10px for controls,
   `--radius-lg` 12px for cards and rows, `--radius-pill` for pills and the fab.
5. Elevation: `--shadow-fab` for floating layers only. Cards, rows and fields stay flat.
6. Focus: `outline-solid`, `outline-[length:var(--focus-ring)]`,
   `outline-offset-[var(--focus-ring)]`, `outline-accent`. Re-add `outline-solid` after any
   `outline-none`/`outline-hidden`.
7. Disabled = `opacity-50` plus a non-actionable cursor. No greyed-out colour literals.
8. Rows go in a `List`; a row is a `ListItem` with `variant` and `size`, not a new grid of
   divs.
9. Spacing: pick the next step from the 19-step scale. Do not compute a value between
   steps, and do not add a step.
10. Icons are `lucide-react`: 16–20px in rows and fields, 28px with `strokeWidth={2.5}`
    for page actions, `aria-hidden` when decorative, `label` when the control is
    glyph-only. No emoji, no new SVG files.
11. Typography: `font-semibold` for control labels and row titles, `font-bold` at 1.25rem
    for a section or dialog title, one-line truncation for a title.
12. Dark is the default theme; your screen must also read in light. Never ship a
    dark-only asset or a colour that only works on one theme.
13. Responsive: the layout is a 640px-max column with safe-area insets. The only consumed
    breakpoint is `sm` (640px) in `settings-row`. Do not add breakpoints without saying so.
14. Copy is real: no filler text, no invented testimonials, no placeholder metrics. Frozen
    visible text and aria labels come from the app and from you, not from the design system.
15. If a primitive does not fit, extend `@life/ui` upstream (prop, slot, variant) with its
    spec and its test. Never fork or wrap-reimplement a primitive in an app.
