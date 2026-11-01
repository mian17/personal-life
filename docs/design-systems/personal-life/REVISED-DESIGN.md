# Personal Life — Revised Design System

The visual and behavioural contract behind the five `revised-*` prototypes: Notes, Tasks,
Meals, Focus and Feedback. This document describes the revision, not the shipped
`@life/ui` system — `DESIGN.md` keeps that record. Every number below is quoted from the
eight reference files beside it (`apps/revised-notes.html`, `apps/revised-todos.html`,
`apps/revised-meals.html`, `apps/revised-pomodoro.html`, `apps/revised-feedback.html`,
`revised-design-system.html`, `revised-components.html`, `revised-palette.html`). A value
that is not in those files is not in this document.

The five apps are standalone HTML files with no dependency, no network request and no
font file. They share one stylesheet verbatim: the same token block, the same type rules,
the same row, card and sheet classes. Only the `--max` / `--max-press` / `--on-max`
declarations differ, one accent per app.

## 1. Visual Theme & Atmosphere

Calm, warm, and drawn for a phone. The ground is a warm off-white `#F4F4F1` in light and
a soft charcoal `#16171A` in dark; neither scheme uses pure black or pure white for a
large fill. Text is near-black `#1B1B1F` on light and warm off-white `#E9E7E2` on dark.
Nothing glows, nothing gradients, nothing ticks.

Both schemes are first class. `:root, [data-theme="light"]` declares the light token set
and `[data-theme="dark"]` the dark one, so a screen with no attribute is light by
definition. `@media (prefers-color-scheme: dark)` restates the dark set under
`:root:not([data-theme])`, so `System` follows the OS until the visitor chooses. The
choice is stored under the `calm-theme` key in `localStorage` and applied by a small
inline script in the head, before first paint:

```html
var choice = localStorage.getItem('calm-theme');
if (choice === 'light' || choice === 'dark') document.documentElement.setAttribute('data-theme', choice);
```

Layering is the one correction worth stating plainly, because getting it backwards makes
every other colour decision wrong. `--page` is the screen ground — `#F4F4F1` light,
`#16171A` dark — and the frame paints it edge to edge: `.frame { background: var(--page);
border-inline: 1px solid var(--line); }`. `--surface` is the raised layer — `#FFFFFF`
light, `#1E2024` dark — and carries the groups, cards, rows, fields and sheets:
`.group { background: var(--surface); border: 1px solid var(--line); }`. Everything sits
on the ground; the ground shows through the gaps between cards because the cards are the
only thing painted on top of it. A group is not a hole in a white page. (The two
documentation pages differ on one point: their demo frame paints `--surface`, because a
document is one continuous sheet rather than a screen with cards floating on ground.)

The atmosphere is a document, not a dashboard: one column capped at `--frame-max: 414px`,
a 28px page title, grouped rows on hairlines, a single accent per app, and one floating
action button per list screen. Colour carries state, and always with its word beside it.

**Differs shipped system:** shipped is dark-first (`:root` holds the dark `--bg` and
`--text`, light reached only through `data-theme='light'` or the OS query) and stores the
choice under `localStorage.theme`; the revision is light-first, keyed `calm-theme`, and
paints an explicit `--page` ground under a raised `--surface` where the shipped system
paints `--bg` under `--panel`.

## 2. Color Palette & Roles

Twenty colour tokens carry the whole page: seventeen identical in all five files and
three (`--max`, `--max-press`, `--on-max`) set per app. Each scheme declares them once,
and no component rule re-declares one.

| Token | Light `[data-theme="light"]` | Dark `[data-theme="dark"]` | Role |
|---|---|---|---|
| `--page` | `#F4F4F1` | `#16171A` | screen ground, painted by `.frame` |
| `--surface` | `#FFFFFF` | `#1E2024` | raised layer: groups, cards, rows, fields, sheets |
| `--surface-sunken` | `#F7F7F4` | `#24262B` | neutral pill, segment trough, matrix quadrant |
| `--press` | `#ECECE9` | `#2C2F35` | pressed wash under a row, chip, icon button, button |
| `--ink` | `#1B1B1F` | `#E9E7E2` | titles and body text |
| `--ink-2` | `#58585E` | `#A9A79F` | meta lines, field labels, section labels, inactive segment |
| `--ink-3` | `#63636A` | `#96948D` | quiet counts, placeholders, decorative glyphs |
| `--line` | `rgba(0, 0, 0, 0.08)` | `rgba(255, 255, 255, 0.07)` | hairline between rows and around groups |
| `--line-strong` | `#8A8A8A` | `#767B84` | control boundary: fields, chips, checkbox, ghost button |
| `--focus` | `#2A5D8F` | `#8FBCE8` | focus ring |
| `--ok-soft` | `#EAF1EA` | `#202A21` | tint behind a done pill (word is `--ok`) |
| `--warn-soft` | `#F5F0E0` | `#2A2418` | tint behind a due-soon pill (word is `--warn`) |
| `--danger-soft` | `#F6E9E9` | `#2C1F1F` | tint behind an overdue pill (word is `--danger`) |
| `--chart-muted` | `#C9C9C6` | `#3A3D43` | a zero day in a chart: a muted stub, never a gap |

Semantic pairs sit beside them and are read from the same declarations: `--ok` `#335B3F`
light / `#9FC0A3` dark, `--warn` `#6E5A16` / `#D9C68A`, `--danger` `#8A3B3B` / `#D98C86`.
Each is only ever used as text on its own soft fill.

Measured contrast, computed with the WCAG 2.1 relative-luminance formula and recorded in
the header comment of every app stylesheet:

| Pair | Light | Dark |
|---|---|---|
| `--ink` on `--page` | 15.58 | 14.50 |
| `--ink` on `--surface` | 17.17 | 13.20 |
| `--ink-2` on `--page` | 6.41 | 7.44 |
| `--ink-2` on `--surface` | 7.06 | 6.77 |
| `--ink-3` on `--page` | 5.41 | 5.90 |
| `--ink-3` on `--surface` | 5.96 | 5.37 |
| `--line-strong` on `--page` | 3.13 | 4.21 |
| `--line-strong` on `--surface` | 3.45 | 3.83 |
| `--focus` on `--page` | 6.23 | 8.98 |
| `--line` on `--surface` | 1.19 | 1.17 |

The bar: 4.5:1 for body text, 3:1 for large text and control boundaries. `--line-strong`
is measured as a non-text boundary and clears 3:1 on both grounds in both schemes. The
hairline `--line` is decorative and holds no ratio — 1.19 and 1.17 — so it may never be
the only thing marking a boundary a person must see; fields, chips and the checkbox use
`--line-strong` instead.

**Differs shipped system:** shipped declares eleven tokens named `--bg`, `--panel`,
`--text`, `--muted`, `--accent`, `--danger`, `--danger-soft`, `--amber`, `--green`,
`--border`, `--on-accent`, with one hairline and no boundary colour; the revision splits
ground from surface, carries three ink steps, adds a 3:1 `--line-strong`, and moves status
colour onto soft fills that always pair with a word.

## 3. Five Accents

One accent per app, always for the same three jobs: a primary fill, the current selection,
and a progress mark. Each app file hard-codes its own `--max` / `--max-press` / `--on-max`
and nothing else in the file mentions an accent literal.

| App | Light `--max` | Light `--max-press` | Dark `--max` | Dark `--max-press` | `--on-max` on `--max` |
|---|---|---|---|---|---|
| notes | `#4F6B52` | `#405743` | `#9FC0A3` | `#B0CDB3` | 5.90 / 9.00 |
| todos | `#2F5F61` | `#254B4D` | `#82B5B6` | `#97C5C6` | 7.17 / 7.88 |
| meals | `#8B5A45` | `#744A38` | `#DCA489` | `#E4B39C` | 5.76 / 8.29 |
| pomodoro | `#5A5285` | `#4A4470` | `#B6AEDC` | `#C7C1E6` | 7.05 / 8.60 |
| feedback | `#6F5570` | `#5B455C` | `#C4A9C6` | `#D0BACF` | 6.54 / 8.40 |

`--on-max` is `#FFFFFF` in light and `#16171A` in dark for every one of the five. The
ratios are the `--on-max on --max` row each app file records in its own header comment;
the lowest is meals at 5.76:1 light, comfortably past 4.5:1.

The accent is a fill, never a small piece of body text: `.btn { background: var(--max);
color: var(--on-max); }`, `.chip[aria-pressed="true"] { background: var(--max); }`,
`.seg__btn[aria-pressed="true"] { background: var(--max); }`,
`.check[aria-checked="true"] .check__box { background: var(--max); }`,
`.track__fill { background: var(--max); }`, `.dot--on`, `.chart__bar`, `.fab`,
`.row__switch[aria-pressed="true"]`. It is also the focus ring's neighbour, never its
replacement — the ring is `--focus`, which is not the accent.

State never rests on colour alone. Every status is a pill with its own word —
`<span class="pill pill--danger">Overdue</span>`, `pill--warn` "In progress",
`pill--ok` "Done", `pill--neutral` "Open" — and every progress bar carries its numbers in
an `aria-label` ("58 percent of the daily energy target") plus a written value beside it.

**Differs shipped system:** shipped has one `--accent` pair shared by every app, with
`--on-accent: white` in both schemes; the revision gives each of the five apps its own
`--max` / `--max-press` pair, uses `#FFFFFF` in light and `#16171A` in dark for the text
on it, and nothing in the revision is named `--accent`.

## 4. Typography Rules

One stack, eleven declared sizes. Family is
`-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`, set once on
`body`, so the page matches the phone it runs on and no font is ever downloaded.

| Size | Line-height | Weight | Tracking | Role |
|---|---|---|---|---|
| 28px | 1.14 | 700 | -0.021em | page title, one per screen (`.h1`) |
| 20px | 1.25 | 700 | -0.015em | sheet title (`.sheet__title`) |
| 17px | 1.47 | 400 | 0 | body: note text, prose, the `body` default |
| 16px | 1.35 | 600 | -0.008em | row title (`.row__title`) |
| 16px | 1 | 600 | -0.005em | button (`.btn`) |
| 15px | 1 | 600 | 0 | chip and segment (`.chip`, `.seg__btn`, `.select`) |
| 14px | inherit (1.47) | 600 | 0 | macro label and value, timer hint, in-row switch, sheet subtitle |
| 13.5px | 1.4 | 400 | 0 | row meta (`.row__meta`) |
| 13px | 1 | 650 | 0.06em | section label, uppercase (`.slabel`, `.field__label`) |
| 12.5px | 1 | 600 | 0.005em | pill (`.pill`) |
| 12px | 1 | 600 | 0.02em | count, right of a section label (`.slabel__count`) |

Body is 17px at 1.47. The textarea re-states it at 17px / 1.55 for long-form writing.
Two sizes sit outside the eleven and are read-outs, not type: `.kpi` at 40px / 1.05 / 700 /
-0.03em and `.timer__time` at 64px / 1 / 600 / -0.04em. Chart axis and value labels are
11px / 600 in the SVG, set in `font-family: inherit` so they take the document stack. Every number that changes —
kpi, macro value, timer, facts value, chart axis — carries
`font-variant-numeric: tabular-nums`, so digits do not jump.

Truncation is not declared anywhere: no `text-overflow`, no `line-clamp`, no `truncate`
class exists in the five stylesheets. A long row title wraps instead, because
`.row__main` sets `min-width: 0` and `flex: 1` inside a `display: flex` row, so the text
column shrinks before the trailing pill does. What stays on one line is single-token
content: `.pill` and `.chip` declare `white-space: nowrap`, and `.group` and
`.card--flush` declare `overflow: hidden` so a rounded group clips its own children
rather than letting them escape the corner.

**Differs shipped system:** shipped roots at 16px / 1.5 with no type scale at all (sizes
are spacing tokens used in a font-size position) and a `system-ui, -apple-system,
sans-serif` stack; the revision roots at 17px / 1.47, declares eleven named steps from 28px
down to 12px, and adds two read-out sizes at 40px and 64px.

## 5. Spacing & Layout Rhythm

Seven steps, every one a multiple of 4, and no value between them.

| Step | Value | Where |
|---|---|---|
| `--s1` | 4px | gap inside `.row__main`, `.seg` gap and trough padding, `.sheet__sub` and `.phead__sub` offsets, `.phead__actions` gap |
| `--s2` | 8px | `.row__trail` gap, `.filters` gap, `.field__label` bottom offset, `.slabel` baseline gap, `.sheet` top padding |
| `--s3` | 12px | row gap and row padding (`.row { gap: var(--s3); padding: var(--s3) var(--s4) }`), `.search` inline padding, macro gap |
| `--s4` | 16px | screen padding (`.panel { padding: var(--s2) var(--s4) var(--s6) }`), card padding, `.field` top margin |
| `--s5` | 20px | button horizontal padding (`.btn { padding: 0 var(--s5) }`) |
| `--s6` | 24px | `.slabel` top margin, sheet bottom padding, panel bottom padding |
| `--s8` | 32px | empty-state padding (`.empty { padding: var(--s8) var(--s4) }`) |

The frame is `--frame-max: 414px`, centred with `margin-inline: auto`, `min-height:
100dvh`, and safe-area padding at both ends:
`padding-top: env(safe-area-inset-top)` and
`padding-bottom: calc(env(safe-area-inset-bottom) + var(--s6))`. The meta viewport
carries `viewport-fit=cover`, so those insets are live on a notched phone. The fab adds
its own bottom inset, `calc(env(safe-area-inset-bottom) + var(--s4))`, and keeps further
in than the frame edge with
`right: max(var(--s4), calc((100vw - var(--frame-max)) / 2 + var(--s4)))`.

`--tap: 48px` is the touch minimum, not a suggestion: `.btn`, `.iconbtn`, `.chip`,
`.seg__btn`, `.input`, `.search`, `.select` and `.backlink` all take `min-height` or
`height: var(--tap)`. A row is `min-height: 56px`. A checkbox is a 24px painted box inside
a 48px `.check` button, pulled back over the row's own padding with
`margin: calc(var(--s2) * -1) 0 calc(var(--s2) * -1) calc(var(--s3) * -1)` so the paint
stays aligned while the target grows.

**Differs shipped system:** shipped has a frozen nineteen-step rem scale and a wider
fixed column cap, with a declared tap height consumed only by command rows; the revision
has seven 4px steps, a 414px frame, and `--tap: 48px` consumed by every control.

## 6. Radii, Borders & Shadow

Four radii, one border width, no product shadow.

| Token | Value | Used for |
|---|---|---|
| `--r-sm` | 8px | checkbox box, segment button, quadrant item, the focus ring's own corner |
| `--r-md` | 12px | fields, icon buttons, primary and ghost buttons, segmented trough, back link, checkbox target |
| `--r-lg` | 16px | groups, cards, empty state, quadrant, sheet top corners (`var(--r-lg) var(--r-lg) 0 0`) |
| `--r-pill` | 999px | pills, chips, track and fill, dots, sheet grab handle, switch-in-row, fab |

Borders are 1px and almost always `--line`: `.group`, `.card`, `.seg`, `.empty`, `.quad`,
`.sheet` (top only), `.subfoot` (top only), `.list__item + .list__item` (top only). A
control boundary instead takes `--line-strong`: `.input`, `.textarea`, `.select`,
`.search`, `.chip`, `.btn--ghost`, `.row__switch`, and the checkbox at `1.5px solid
var(--line-strong)`. The primary button's border is its own fill, `1px solid var(--max)`,
so pressing it changes fill and border together. `.btn--danger` has `border-color:
transparent` and text in `--danger` — a destructive action is a word, never a red block.

No `box-shadow` is declared anywhere in the five app stylesheets, and no shadow token
exists in the token block. A card reads as raised because it is `--surface` fill plus a
1px `--line` border on the `--page` ground — the layering does the work a shadow would do
elsewhere. The documentation layer of `revised-design-system.html` and
`revised-components.html` does declare `--shadow-1: 0 1px 2px rgba(0, 0, 0, 0.04)` and
`--shadow-2: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 20px rgba(0, 0, 0, 0.05)` (dark:
`rgba(0, 0, 0, 0.40)` and `rgba(0, 0, 0, 0.40), 0 8px 20px rgba(0, 0, 0, 0.36)`), for the
doc pages' own chrome; the product layer above it uses none of them.

**Differs shipped system:** shipped puts controls and cards one radius step smaller
(`--radius-md` / `--radius-lg`), takes the checkbox corner from a spacing token, and
lifts floating layers with one `--shadow-fab`; the revision uses `--r-sm` 8px,
`--r-md` 12px, `--r-lg` 16px and `--r-pill` 999px, and gives the product no shadow at all.

## 7. Motion

Two durations and one curve:

| Token | Value | Used for |
|---|---|---|
| `--d-fast` | 200ms | colour transitions on `.chip`, `.seg__btn`, `.row`, `.iconbtn`, `.btn`, `.check`; scrim opacity; the one-shot view entrance |
| `--d-base` | 260ms | sheet travel (`transform`), progress width on `.track__fill` |
| `--ease` | `cubic-bezier(0.25, 1, 0.5, 1)` | every transition above except the progress fill, which runs `linear`; no bounce, no overshoot |

Every one of them lives inside `@media (prefers-reduced-motion: no-preference)`:

```css
.chip, .seg__btn, .row, .iconbtn, .btn, .check { transition: background-color var(--d-fast) var(--ease), color var(--d-fast) var(--ease), border-color var(--d-fast) var(--ease); }
.sheet { transition: transform var(--d-base) var(--ease); }
.scrim { transition: opacity var(--d-fast) var(--ease); }
.track__fill { transition: width var(--d-base) linear; }
.panel:not([hidden]) { animation: view-in var(--d-fast) var(--ease) both; }
```

`prefers-reduced-motion: reduce` then collapses the whole page:
`animation-duration: 0.001ms !important; animation-iteration-count: 1 !important;
transition-duration: 0.001ms !important`. State does not travel; it is simply there.

The only entrance is `view-in`, a one-shot opacity fade from 0 to 1 on
`.panel:not([hidden])`. There is no looping animation, no autoplay, no ticker, no
parallax. The sheet is opened by a class, and its close timer matches the duration it
animates at: `window.setTimeout(finish, 260)` when motion is allowed, and an immediate
finish when `reduceMotion()` is true.

**Differs shipped system:** shipped declares a fast and a base duration both shorter
than the revision's, eases with `ease-out`, uses Tailwind's un-tokened `transition-colors`
on most controls, and has no `prefers-reduced-motion` branch anywhere; the revision makes
motion a strict opt-in at 200ms / 260ms on one cubic-bezier.

## 8. Component Stylings

Every class below is plain CSS in the app stylesheets — no utility framework, no
component library, no build step.

**`.list__item` inside `.group`.** The group is `--surface` fill, `1px solid var(--line)`,
`--r-lg`, `overflow: hidden`. `.list__item + .list__item { border-top: 1px solid
var(--line); }` — that hairline is the only divider; a row draws none of its own.

**`.row`.** `display: flex`, `align-items: center`, `gap: var(--s3)`, `min-height: 56px`,
`padding: var(--s3) var(--s4)`, transparent fill, `:active { background: var(--press); }`.
Body is `.row__main` (column, `gap: var(--s1)`, `min-width: 0`), title `.row__title`,
meta `.row__meta` in `--ink-2`, trail `.row__trail` in `--ink-3`. `.row--done` strikes the
title at `1px` thickness and demotes title to `--ink-2`, meta to `--ink-3`. A row that
does nothing is `[data-static]`: `cursor: default` and no press wash.

**`.check` / `.check__box`.** 48px square target, `--r-md`, negative margin so the 24px
box lands on the row's text edge. Box: `1.5px solid var(--line-strong)`, `--r-sm`,
`--surface` fill, glyph transparent. Checked: fill and border `--max`, glyph `--on-max`;
the glyph itself is 16px. A checkbox and its row text are sibling buttons, never nested.

**`.filters` / `.chip`.** Filters is a horizontally scrolling strip with
`margin: var(--s3) calc(var(--s4) * -1) 0`, `padding: 0 var(--s4)`, `gap: var(--s2)`,
`overflow-x: auto`, `scrollbar-width: none` and a hidden webkit scrollbar; `--inset`
removes the bleed. A chip is `min-height: var(--tap)`, `padding: 0 var(--s4)`, `1px solid
var(--line-strong)`, `--r-pill`, `15px / 600`, `white-space: nowrap`; pressed takes
`--max` fill and `--on-max` text, pressed-and-active takes `--max-press`.

**`.seg` / `.seg__btn`.** Trough `inline-flex`, `gap: var(--s1)`, `padding: var(--s1)`,
`1px solid var(--line)`, `--r-md`, `--surface-sunken` fill. Button `min-height: var(--tap)`,
`padding: 0 var(--s4)`, `--r-sm`, transparent fill, `--ink-2` text, `15px / 600`; the
pressed button takes `--max` / `--on-max`. `.seg--theme` widens it to full width with
three equal `flex: 1` parts, and inside a `.group` it drops its margin, border, radius and
background, keeping `padding: var(--s2)`.

**`.search`.** `height: var(--tap)`, `padding: 0 var(--s3)`, `1px solid var(--line-strong)`,
`--r-md`, `--surface` fill, `--ink-3` glyph and placeholder; focus is
`.search:focus-within { outline: var(--focus-ring) solid var(--focus); outline-offset:
var(--focus-ring); }` because the ring belongs to the shell, not the inner input.

**`.input` / `.field` / `.textarea` / `.select`.** Input `height: var(--tap)`,
`padding: 0 var(--s4)`, 16px. `.field` is `display: block; margin-top: var(--s4)` with a
`.field__label` above it at 13px / 650 / 0.06em uppercase in `--ink-2`. Textarea
`min-height: 200px`, `padding: var(--s3) var(--s4)`, 17px / 1.55, `resize: none`; the
`.textarea--sm` form variant is 112px and `.note-body` is `min-height: 56dvh`. Select is
`height: var(--tap)`, `padding: 0 var(--s3)`, 15px / 600. All four share
`outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring)` on
focus.

**`.btn` and its variants.** Full width by default, `min-height: var(--tap)`,
`inline-flex` centred, `gap: var(--s2)`, `padding: 0 var(--s5)`, `1px solid var(--max)`,
`--r-md`, `--max` fill, `--on-max` text, 16px / 600 / -0.005em. `:active` moves fill and
border to `--max-press`. `.btn--ghost` is transparent with `--line-strong` border and
`--ink` text, pressing to `--press`. `.btn--danger` is transparent with transparent border
and `--danger` text, pressing to `--danger-soft`. `[disabled]` is `opacity: 0.5;
cursor: not-allowed`. `.btn-row` wraps them on `--s2` with `--s4` top margin; `.grow` and
`.no-grow` let a row of buttons split.

**`.iconbtn`.** 48px square, `--r-md`, transparent fill, `--ink-2` glyph, `:active` to
`--press`. It always carries `aria-label`; the glyph inside is `aria-hidden`.

**`.fab`.** Fixed, `z-index: 30`, `width: var(--fab-size)` = 56px, `--r-pill`, fill and
border `--max`, glyph `--on-max` at `24px` with `stroke-width: 2`, `:active` to
`--max-press`. Positioned inside the frame's inline edge and above the home indicator, as
described in *Spacing & Layout Rhythm*. One per list screen, and it is the list screens'
only create affordance.

**`.pill` and its tones.** `inline-flex`, `height: var(--s6)` (24px), `padding: 0 var(--s2)`,
`--r-pill`, 12.5px / 600 / 0.005em, `white-space: nowrap`. Four tones: `--neutral`
(`--surface-sunken` on `--ink-2`), `--warn` (`--warn-soft` on `--warn`), `--danger`
(`--danger-soft` on `--danger`), `--ok` (`--ok-soft` on `--ok`).

**`.card`.** `padding: var(--s4)`, `1px solid var(--line)`, `--r-lg`, `--surface` fill;
`.card + .card { margin-top: var(--s3); }`; `--flush` sets `padding: 0; overflow: hidden`
for a card that holds a chart.

**Sheet parts.** `.scrim` is `position: fixed; inset: 0; z-index: 40` at
`rgba(0, 0, 0, 0.32)`, opacity 0 and 1 by `.is-open`. `.sheet` is `position: fixed;
z-index: 50`, `left: 50%; bottom: 0`, `width: 100%; max-width: var(--frame-max)`,
`max-height: calc(100dvh - 40px)`, `overflow-y: auto`,
`padding: var(--s2) var(--s4) calc(var(--s6) + env(safe-area-inset-bottom))`,
`border-top: 1px solid var(--line)`, `border-radius: var(--r-lg) var(--r-lg) 0 0`,
`transform: translate(-50%, 100%)` and `translate(-50%, 0)` when open. `.sheet__grab` is
a 36×4px `--r-pill` bar in `--line-strong`; `.sheet__head` is a space-between flex row;
`.sheet__title` is 20px / 1.25 / 700 / -0.015em; `.sheet__sub` 14px in `--ink-2`;
`.sheet__form` sits on `--s4` and `.sheet__foot` on `--s6`.

**`.slabel`.** A baseline flex row, `margin: var(--s6) 0 var(--s2)`, 13px / 650 / 0.06em
uppercase in `--ink-2`, with `.slabel__count` on the right at 12px / 600 / 0.02em, not
uppercase, in `--ink-3`. A heading stays when its group is empty, so the layout does not
jump.

**`.empty`.** `padding: var(--s8) var(--s4)`, `1px solid var(--line)`, `--r-lg`, centred,
`--ink-2` body with `.empty__title` at 16px / 600 in `--ink` and `.empty__body` at 15px on
`--s1`. It says what to do next: "Nothing yet." / "870 kcal left for the day."

**`.editor-status`.** A save read-out under a toolbar: `display: flex`,
`gap: var(--s2)`, `min-height: 20px`, `margin-top: var(--s2)`, 13.5px in `--ink-2`, with
an 8px `--r-pill` dot in `--ok` (or `--ink-3` when `data-state="idle"`); `:empty` sets
`display: none` so an empty line takes no space.

**`.subfoot`.** The foot of a detail screen: column flex, `gap: var(--s2)`,
`margin-top: var(--s6)`, `padding-top: var(--s4)`, `border-top: 1px solid var(--line)`.
It holds secondary actions ("Delete note", "Move to trash"), never a Save/Cancel pair.

**`.matrix` / `.quad`.** Two equal columns on `--s2`, quadrants on `--surface-sunken`
with `min-height: 132px`, `--s3` padding, `1px solid var(--line)`, `--r-lg`; a quadrant
item is `min-height: var(--tap)`, `--r-sm`, `--surface`, 13.5px / 1.35 / 600, and an empty
quadrant says "Nothing here." instead of collapsing.

**Differs shipped system:** shipped primitives are Tailwind + cva React components
(`button.tsx`, `card.tsx`, `pill.tsx`, `list.tsx`, Radix dialog and menu) whose size,
padding and radius come from utility strings; the revision's primitives are plain CSS
classes over token variables in standalone HTML, with no framework, no Radix and no build.

## 9. Iconography

Eighteen symbols, one SVG sprite per file, inline in the document:

`i-notes`, `i-todos`, `i-meals`, `i-timer`, `i-feedback`, `i-plus`, `i-close`, `i-back`,
`i-chev`, `i-check`, `i-search`, `i-sliders`, `i-play`, `i-pause`, `i-reset`, `i-chart`,
`i-trash`, `i-calendar`.

The sprite is a single `<svg width="0" height="0" aria-hidden="true" focusable="false"
class="sprite">` holding a `<defs>` block at the top of the body of every app file and of
both documentation pages that render components (`revised-design-system.html`,
`revised-components.html`). Each symbol is a 24-unit `viewBox` of paths; a use site is
`<svg class="icon" aria-hidden="true"><use href="#i-plus"></use></svg>`. There is no icon
font, no emoji, no external file and no network request.

Sizes and stroke: `.icon` is 22×22 at `stroke-width: 1.75`, `fill: none`,
`stroke: currentColor`, round caps and joins. `.icon--sm` is 18×18 for row trails, back
links and buttons. The fab's own `.icon` is 24×24 at `stroke-width: 2`. The checkbox glyph
is 16×16 and the `i-check` path itself carries `stroke-width: 2.75`, because a 16px mark
needs the extra weight. Monochrome throughout: the glyph inherits whatever `color` its
container sets — `--ink-2` in an icon button, `--ink-3` in a row trail, `--on-max` inside
an accent fill, `--danger` on a destructive control.

Decorative glyphs carry `aria-hidden="true"` and the control carries the name: every
glyph-only control in the five files has an `aria-label` — "Notes settings",
"Feedback settings", "Daily target", "Close", "New note", "Log food", "Reset session".
A chevron in a trail is decoration on a row whose own text names the destination.

**Differs shipped system:** shipped draws from `lucide-react` (peer `^1.59.0`) at 14–28px
with `strokeWidth` 2 or 2.5 per site; the revision draws eighteen hand-authored symbols
from an inline sprite at 18 / 22 / 24 / 16px and a fixed 1.75 stroke.

## 10. Screens & Settings Structure

Five files, sixteen screens, addressed by `data-screen` on a `.panel` inside
`.frame > main`:

| App | Screen ids |
|---|---|
| notes | `today`, `editor`, `settings` |
| todos | `today`, `task`, `settings` |
| meals | `today`, `meal`, `target`, `settings` |
| pomodoro | `today`, `stats`, `settings` |
| feedback | `today`, `entry`, `settings` |

`show(name)` hides every panel whose `data-screen` is not the target, then moves focus to
that panel's `.h1` — `heading.setAttribute('tabindex', '-1'); heading.focus({
preventScroll: true })` — and scrolls to the top. Escape does the same thing the back
link does: it returns to `today` (or closes the sheet if one is open). A sub-screen
replaces its parent; it never stacks on top of it. The back link names the parent in
words ("Notes", "Tasks", "Meals", "Focus", "Feedback").

One settings shape, shared by all five, in this order:

1. A `subnav` with a `.backlink` naming the app, then `<h1 class="h1 mt2">Settings</h1>`.
2. `.slabel` **Appearance** — a `.group` holding `.seg--theme` with three buttons:
   `data-theme-set="light"` Light, `"dark"` Dark, `"system"` System, `aria-pressed`
   reflecting the stored choice.
3. `.slabel` **Comfort** — a `.group` of inert `data-static` rows. Every app carries
   "Reduce motion" (meta "Follows the system setting.", with a `pill--neutral` read-out
   that says `System`, `Reduced` or `Standard`, painted from
   `matchMedia('(prefers-reduced-motion: reduce)')`); Notes adds a second row, "Larger
   text" (meta "Follows Dynamic Type.", pill "System").
4. `.slabel` naming the app, with one row: Notes "Tags" — inert, meta "home · work ·
   health", pill "3"; Tasks "Matrix lens" — inert, meta "Adds a second view of the same
   tasks.", a `.row__switch` reading "On"; Meals "Daily target" — a button to the
   `target` screen, meta "2,050 kcal · 120 / 220 / 68 g", pill "Edit"; Focus "Daily goal"
   — inert, meta "Minutes across all blocks.", pill "100 min"; Feedback "Statuses" under
   the label "Inbox" — inert, meta "Open · In progress · Done · Won't do", pill "4".
5. `.slabel` **Support** — a `.group` holding a `.row` button `data-sheet="feedback"`
   titled "Send feedback", meta "Tell us what got in the way.", trailing chevron.
6. A closing line: `<p class="row__meta mt4">Personal Life · prototype</p>`.

The feedback sheet lives in every file, not only the Feedback app, because the Support
row opens it from any settings screen: `.scrim` plus `#sheet-feedback` with
`role="dialog" aria-modal="true" aria-labelledby="sheet-title"`, a grab handle, a title
"Send feedback", a close icon button, a `seg--theme` kind switch (Problem / Idea /
Praise), a Title input, a "What happened" textarea, an `.editor-status` line announcing
through `role="status" aria-live="polite"`, and a Send button in `.sheet__foot`. Tab is
kept inside while it is open, focus returns to the trigger on close, and the scrim click
closes it.

**Differs shipped system:** shipped screens are Next routes in `apps/app` composed from
`@life/ui` blocks with a `TabBar` rail; the revision is five standalone HTML files whose
screens are hidden panels in one document, with no router, no tab rail and a floating
action button in its place.

## 11. Accessibility Rules

- Contrast is measured, not asserted. Every text pair in the revision is recorded in
  each app stylesheet's header and reproduced in *Color Palette & Roles*: `--ink` on the
  ground is 15.58 light / 14.50 dark, `--ink-2` never drops below 6.41, `--ink-3` never
  below 5.37, and `--line-strong` clears 3:1 on both grounds as a non-text boundary
  (3.13 / 4.21 on `--page`, 3.45 / 3.83 on `--surface`). The hairline `--line` is
  decorative at 1.19 / 1.17 and carries nothing a reader must perceive.
- Touch targets are 48px: `--tap` on every control, a 24px checkbox painted inside a 48px
  button, a 56px row minimum.
- Focus is always visible and always the same: `:focus-visible { outline:
  var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring);
  border-radius: var(--r-sm); }`, plus the same treatment re-stated on `.input`,
  `.textarea`, `.select` and `.search:focus-within`.
- State is never carried by colour alone. Status is a pill with a word; a progress track
  carries its numbers in `aria-label`; a done row says "Done 09:12"; the reduce-motion row
  writes its read-out as `System` / `Reduced` / `Standard`.
- Live regions: the save read-out and the form status are `.editor-status` with
  `role="status" aria-live="polite"`; the timer hint is `role="status"` and the timer
  digits themselves are `aria-live="off"`, so a countdown does not announce every second.
- Reduced motion is contained: every transition and the one entrance animation sit inside
  `@media (prefers-reduced-motion: no-preference)`, and the `reduce` branch collapses all
  durations to 0.001ms. The sheet's close timer matches — 260ms with motion, immediate
  without.
- Focus management: a screen change moves focus to the new screen's heading; the sheet
  traps Tab between its first and last focusable control and hands focus back to the
  trigger on close; Escape closes the sheet or returns to `today`.
- Fields validate at the boundary and say so in words, in the order the fields appear:
  "Add a title first." then "Say what happened.", each followed by moving focus to that
  field.
- Charts carry an `aria-label` with the total ("Focus minutes per day for the last seven
  days"), and a zero day is a muted stub rather than a missing bar.

**Differs shipped system:** shipped has no `prefers-reduced-motion` handling, pairs
`--on-accent` with `--accent` below AA for normal text in dark, and relies on a wider
column cap and a smaller icon button; the revision gates all motion, keeps the accent
pairing at 5.76:1 or better, and makes every control 48px.

## 12. Agent Prompt Guide

Read this before editing a `revised-*` file.

1. **These are standalone design prototypes, not the shipped application.** A change here
   is not a change to `@life/ui`, and it does not change any app in `apps/`. Nothing you
   do in these files ships to a user.
2. Start from the token block at the top of the file you are editing. The five app files
   share it verbatim except for `--max` / `--max-press` / `--on-max`. Change a value in
   one app's block and you have forked the vocabulary; change it in all five or not at
   all.
3. Use only the tokens declared at the top of the file and the seven space steps. No hex, no raw `px`, no `rem`
   outside the token block — a value that is not on the scale is not available.
4. Ground and surface are not interchangeable. `--page` is the frame; `--surface` is a
   group, card, row, field or sheet painted on top of it. A card gets no shadow.
5. One accent per app, and only for fill, selection and progress. Never set body text in
   `--max`.
6. Every status gets a word. A pill carries its label, a track carries its numbers in
   `aria-label`, a done row says when.
7. 48px minimum target, 8 / 12 / 16 / 999 radii, 17px / 1.47 body, one system stack.
   Numbers that change take `font-variant-numeric: tabular-nums`.
8. Motion goes inside `@media (prefers-reduced-motion: no-preference)`, uses `--d-fast`
   (200ms), `--d-base` (260ms) and `--ease` only, and never loops.
9. Icon only from the file's own sprite by `id`. `aria-hidden` on decoration, `aria-label`
   on a glyph-only control. No emoji, no new SVG file, no icon font.
10. Keep the settings order — Appearance, Comfort, the app's own section, Send feedback,
    `Personal Life · prototype` — in all five apps. If you change one, change five.
11. Both schemes are first class. Check the screen in light and in dark before calling it
    done; `System` means your screen has to work with no attribute at all.
12. Copy is real. No filler text, no invented metrics, no lorem.

**Differs shipped system:** shipped `DESIGN.md` instructs a reader to compose
`@life/ui`, extend it upstream and never touch colour literals in app code; the revision
instructs a reader to treat `revised-*` as prototypes that change nothing in `@life/ui` or
`apps/`, and to edit tokens in place because the prototypes have no upstream.
