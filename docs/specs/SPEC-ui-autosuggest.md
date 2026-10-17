# Spec: ui-autosuggest — combobox query field + suggestion list

Module id: `ui-autosuggest` (map: `docs/specs/MAP-ui-primitives.md`). Depends on `ui-atoms`.

Component ownership (registered in `docs/specs/MAP-ui-primitives.md`): `Autosuggest` belongs
to `ui-blocks`. First consumer: `manual-log-ui` (`docs/specs/SPEC-manual-log-ui.md`) — the
manual log door's food search.

## Objective

A combobox block: a text field that owns its own text and reports a **query** to a caller
that supplies the already-filtered candidates, plus the suggestion list the caller's
options render into. Success = an app composes a search-as-you-type picker with a handful
of props, all filter/ranking/data decisions stay in the app, and the list is fully
operable from the keyboard with no mouse.

The gap it closes: `SearchField` (`docs/specs/SPEC-ui-blocks.md`) debounces a query but
renders **no** list, and `food-picker.tsx` hand-rolls an in-flow `List` under it. That
composition is not reusable and has no combobox semantics — no `role="combobox"`, no
highlight, no keyboard list control. `Autosuggest` is the upstream fix (Contract 1
Rule 3), not a per-app fork.

## Components (prop contracts)

```tsx
export interface AutosuggestOption {
  id: string;            // React key + the option's DOM id
  label: string;         // primary row text
  meta?: string;         // quiet trailing text (per-100 facts, counts); omitted ⇒ no node
}

export interface AutosuggestProps {
  /** Pre-filtered, best-first candidates; the block never filters, sorts or fetches. */
  options: readonly AutosuggestOption[];
  /** Reported once the trimmed text is at least `minChars`, after `debounceMs`.
   *  `''` means "do not search" (below threshold, or the field was cleared). */
  onQueryChange: (query: string) => void;
  /** A row was picked (click, Enter on the highlight, Tab on the highlight). */
  onSelect: (option: AutosuggestOption) => void;
  /** The field's accessible name (`aria-label`); the list needs no second name. */
  label: string;
  placeholder?: string;
  /** Popup body when the query is long enough but `options` is empty.
   *  Omitted ⇒ no popup at all in that state (an app with no empty message). */
  emptyLabel?: string;
  /** `true` (default) clears the field on a pick; `false` keeps the query and the
   *  popup open, for multi-add. */
  clearOnSelect?: boolean;
  /** Shortest trimmed query that searches. Default 3. */
  minChars?: number;
  /** Query report delay in ms. `0` (default) reports synchronously per keystroke. */
  debounceMs?: number;
  /** Rows visible in the popup before it scrolls. Default 8. */
  maxVisible?: number;
}
```

Rendered structure:

```tsx
// The field is the `Input` atom; the block adds the combobox wiring.
<Input
  type="text"
  style={{ anchorName }}                    // per-instance CSS anchor (see CSS ownership)
  placeholder={placeholder}
  aria-label={label}
  role="combobox"
  autoComplete="off"
  aria-autocomplete="list"
  aria-expanded={open}
  aria-controls={popupId}
  aria-activedescendant={open && highlight >= 0 ? `${popupId}-option-${highlight}` : undefined}
  value={text}
  onChange={…}
  onKeyDown={…}
  onPointerDown={() => setDismissed(false)}   // a press on the field clears a light dismissal
  onFocus={() => setDismissed(false)}         // so does returning focus after a blur
/>

// The popup, rendered only while open — a native popover.
<div
  id={popupId}
  popover="manual"
  role={options.length > 0 ? 'listbox' : undefined}
  style={{ positionAnchor: anchorName, '--ui-autosuggest-rows': maxVisible }}
  className="ui-autosuggest__popup"
>
  {options.length === 0 ? (
    <p className="ui-autosuggest__empty" role="status">{emptyLabel}</p>
  ) : (
    options.map((option, index) => (
      <div
        id={`${popupId}-option-${index}`}
        role="option"
        aria-selected={index === highlight}
        className={cx('ui-autosuggest__option', index === highlight && 'ui-autosuggest__option--active')}
        onMouseDown={(e) => e.preventDefault()}     // else the field blurs and the click is lost
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => select(option)}
      >
        <span className="ui-autosuggest__label">{option.label}</span>
        {option.meta != null && <span className="ui-autosuggest__meta">{option.meta}</span>}
      </div>
    ))
  )}
</div>
```

Two effects sit outside the markup: a `scrollIntoView({ block: 'nearest' })` on the highlighted row
keeps it inside the popup's visible slice as the highlight moves, and a document `pointerdown`
capture listener dismisses when the press lands outside both the popup and the field.

### Semantics and edge cases

- **Ownership.** The field owns its text in internal state; the caller never supplies or
  reads the raw text — it only receives `onQueryChange(query)` and `onSelect(option)`.
  The caller owns filtering, ranking, fetching and the domain meaning of an option;
  the block owns gating, debouncing, highlight and popup state.
- **Gating (`minChars`, default 3).** Measured on the **trimmed** text. Below it the
  popup is closed and `''` is reported (never the short text). At or above it the
  trimmed text is reported. Re-evaluated on every keystroke: deleting back under the
  threshold closes the popup at once and never waits for a timer. The popup opens when
  the query is long enough **and** (`options.length > 0` **or** `emptyLabel` is set) —
  `emptyLabel` is the opt-in that makes the zero-result state visible.
- **Debounce (`debounceMs`, default 0).** `0` reports synchronously on every keystroke and
  creates no timer. Above `0`, the input's own rendering is never delayed — only the
  report: each keystroke cancels the pending timer, only the latest text fires, a drop
  back under `minChars` cancels the pending report instead of firing the short text, and
  unmount cancels it. Selection and clearing are **never** debounced.
- **Highlight.** Reset whenever a query is reported, so a highlight never survives the
  options it pointed at. `aria-activedescendant` and `aria-selected` are the only carriers
  of it: DOM focus stays on the field, never moves into the list (which is why the rows
  are `div`s with no nested interactive element and the mouse handlers `preventDefault`
  the press).
- **Selection.** The whole row is the option; a tap anywhere in it selects. With
  `clearOnSelect` (default) the text clears and the popup closes; with `clearOnSelect:
  false` the text and the popup stay, which is what makes a multi-add flow (log several
  foods in a row) one screen.
- **Keyboard.** `ArrowDown`/`ArrowUp` move the highlight and clamp at both ends (no wrap).
  `ArrowDown` while closed and long enough reopens the popup on the first option.
  `Alt+ArrowDown` opens without a highlight. `Enter` selects the highlighted option and
  does nothing with none. `Home`/`End` jump to the first/last option. `Escape` closes the
  popup; the next `Escape` (popup already closed) clears the field. `Tab` accepts the
  highlight, closes the popup and lets focus move on.
- **Dismissal.** Closing the popup does not touch the text. Every way back into the field
  clears the dismissal — typing a long-enough query, pressing the field that kept focus, or
  focusing it again after a blur. Re-entry only re-opens; it never touches the text.
- **Empty state.** With no options and no `emptyLabel`, nothing renders (no empty popup
  frame). With `emptyLabel`, the popup holds a `role="status"` paragraph instead of a
  `listbox` — there is nothing to select, and the announcement should not read as a list.
- **No domain knowledge.** The block imports nothing from `apps/*`, performs no fetch and
  no routing; the query string and the options are opaque to it.

### Element-by-element composition — the manual log door (`manual-log-ui`)

| Element | Composed from |
|---|---|
| Query field | `Autosuggest label="Search foods" placeholder="Search your foods" minChars={3} clearOnSelect={false}` |
| Candidates | App state: the caller filters its catalog by the reported query and passes `options` |
| Row | `AutosuggestOption { id, label, meta }` — `meta` carries the per-100 facts |
| Empty query | `emptyLabel` (e.g. a "no foods match" line); the app passes no `options` |
| Pick | `onSelect(option)` appends the editor item; `clearOnSelect={false}` keeps the text and the popup up so the next food can be typed straight away |

The catalog fetch, the match rule and what a pick does to the log stay in `apps/*`.

## CSS ownership

- `blocks.css` owns `.ui-autosuggest__popup`, `.ui-autosuggest__option`,
  `.ui-autosuggest__option--active`, `.ui-autosuggest__label`, `.ui-autosuggest__meta`,
  `.ui-autosuggest__empty`. Token-only: `--panel`, `--border`, `--border-width`,
  `--radius-md`, `--shadow-fab`, `--text`, `--muted`, `--accent`, `--on-accent`,
  `--space-*`, `--tap-height`. **No token was added** and `tokens.css`,
  `test/tokens.test.ts` and `SPEC-ui-tokens.md` are untouched.
- The field's own visuals belong to the `Input` atom (`.ui-input`), same rule as
  `SearchField`'s `.ui-search-box` note.
- **Popup layering — the decision.** The popup is a native **`popover`** element: the
  platform lifts it into the top layer, so an ancestor's `overflow: hidden`
  (`.ui-card`) cannot clip it, with **no portal and no JS positioning** — the same
  platform escape `.ui-dialog` already relies on. Placement is **CSS anchor positioning**
  (`position-area: bottom span-right`, `position-try-fallbacks: flip-block`,
  `width: anchor-size(width)`), not a `getBoundingClientRect` effect. `anchor-name` is a
  page-global ident, so the field's name is generated per instance from `useId()` and the
  popup takes it as `position-anchor`; both, plus `--ui-autosuggest-rows` (`maxVisible`),
  are per-instance values no theme token can describe, so they ride the elements'
  `style`. `.ui-menu__panel`'s "push the content down instead" pattern was rejected here:
  an inline panel cannot escape clipping, and a search field must not reflow the page
  under the user's finger.
- **Test consequence (recorded, not hidden):** jsdom has no `showPopover`/`hidePopover`,
  so the suite stubs them (the Dialog suite's `showModal`/`close` precedent) and asserts
  call order, not top-layer geometry. The escape-from-clipping property is a browser
  behaviour; it is verified in a real browser, not in jsdom.

## Tech Stack

React 19 TSX source, `'use client'` (state, effects, keyboard handlers),
`@life/ui/styles.css` (`blocks.css`), `ui-*` generic class names, tokens only. No new
dependency: `Input` is the atom, `cx` is the package's own helper.

## Commands

- `npm run typecheck -w packages/ui`
- `npm run test:unit -w packages/ui -- test/autosuggest.test.tsx`

## Project Structure

```
packages/ui/src/components/autosuggest.tsx   # Autosuggest + AutosuggestOption/AutosuggestProps
packages/ui/src/index.ts                     # re-exports Autosuggest + types
packages/ui/src/styles/blocks.css            # .ui-autosuggest__* rules + the block mapping row
packages/ui/test/autosuggest.test.tsx        # one suite for the block
docs/specs/SPEC-ui-autosuggest.md            # this file
docs/specs/MAP-ui-primitives.md              # ui-blocks row lists Autosuggest
```

## Code Style

The caller keeps every data decision; the block keeps the interaction:

```tsx
const [query, setQuery] = useState('');
const options = query === '' ? [] : matchFoods(foods, query); // app rule

<Autosuggest
  label="Search foods"
  placeholder="Search your foods"
  options={options}
  emptyLabel="No foods match"
  onQueryChange={setQuery}
  onSelect={appendItem}
/>
```

## Testing Strategy

Unit tests only (jest + `@testing-library/react`, `packages/ui`; harness per
`SPEC-ui-atoms`). The suite covers:

- gating (1–2 chars ⇒ `''` and no list; 3 chars ⇒ trimmed text and open),
- debounce (`0` synchronous, `>0` delayed with only the latest query, cancel on
  drop-below-`minChars`, cancel on unmount),
- keyboard (highlight movement and clamping, `ArrowDown`-while-closed opens on the first
  option, `Alt+ArrowDown` with no highlight, `Home`/`End`, `Enter`, `Tab`, the two-stage
  `Escape`, `Enter` with no highlight is inert),
- selection (row click with the press default-prevented so focus stays on the field,
  `clearOnSelect` default and `false`),
- ARIA wiring (`role`, `aria-expanded`, `aria-controls`, `aria-activedescendant`,
  `aria-selected`, row ids),
- empty state (`emptyLabel` with no options; no popup without it),
- popover call order (`showPopover` on open, `hidePopover` on unmount) and the
  `maxVisible` custom property,
- dismissal and re-entry (an outside press dismisses without clearing the text; then a press
  on the still-focused field, and a re-focus after a blur, each bring the list back).

No E2E here (the popup's top-layer placement is exercised by the consuming app's e2e).

## Boundaries

- Always: the caller owns filtering/ranking/fetching/domain meaning; the block owns text,
  gating, debounce, highlight and popup; `role="combobox"` + `aria-activedescendant`
  semantics with DOM focus on the field; tokens only; rows carry no nested interactive
  element; the popup stays a native `popover` with CSS anchor positioning.
- Ask first: any new prop or prop rename; any token addition (it moves the tripwire);
  any change to the `popover`/anchor-positioning decision; delegating popup placement to a
  portal or a measuring effect.
- Never: filtering or sorting `options` inside the block; fetching or importing app
  modules; a second app-wide stylesheet; inline styles for anything a token covers;
  raw hex/rgb/px/rem/z-index values; a per-app fork of the combobox.

## Success Criteria

1. An app renders a working search-as-you-type picker with `options`, `onQueryChange`,
   `onSelect` and `label` only, and no markup of its own.
2. The keyboard contract above is fully operable with the mouse untouched, and the
   highlight is always visible through `aria-activedescendant` + `--active`.
3. The popup escapes an `overflow: hidden` ancestor without a portal or a JS measuring
   effect (verified in a real browser).
4. `grep -riE "note|trash|tag-chip" packages/ui/src/components/autosuggest.tsx` → no hits;
   no `apps/*` import; `tokens.css` unchanged.
5. `npm run typecheck -w packages/ui` and `test/autosuggest.test.tsx` are green.

## Open Questions

- **Dismiss the popup when the user taps away?** Resolved. A document `pointerdown`
  listener dismisses when the press lands outside both the popup and the field, keeping
  the text. The field is spared so clicking it keeps the list up. The popup stays
  `popover="manual"` because `auto` would hand `Escape` to the platform and break the
  two-stage `Escape`-then-clear behaviour.
- Everything else decided above (`emptyLabel`'s zero-result popup, `maxVisible`'s row cap,
  `popover` placement, the jsdom stub).

## Success Criteria (addendum)

6. With more matches than `maxVisible`, moving the highlight scrolls the highlighted row
   into view; the highlight is never left outside the popup's visible slice.
7. A press outside the popup and the field dismisses the list without clearing the text.
8. After that dismissal, pressing the field or focusing it again brings the list back without
   touching the text.
