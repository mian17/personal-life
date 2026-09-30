# Spec: ui-editor-chrome — editor screen chrome

Module id: `ui-editor-chrome` (map: `docs/specs/MAP-shared-page-blocks.md`). Depends on `ui-blocks`.

## Objective

A shared `@life/ui` editor chrome: `EditorScreen` + `EditorToolbar` (back + title + status
+ actions slots) + `EditorStack` body slot + `TagPicker` wiring. The block owns the
editor's fixed frame and its spacing; it owns **no** autosave, no flush, no routing. The
app supplies the fields, the callbacks and the copy. Success = the note and todo editors
both render their frame from this block and differ only in field content and callbacks.

## Components (prop contracts)

```tsx
import type { ReactNode } from 'react';
import type { TagOption } from './tag-picker';
import type { StackGap } from './stack';

export interface EditorChromeTagPicker {
  /** Available tags (id + display name) — `TagPicker`'s data shape. */
  tags: readonly TagOption[];
  /** Currently attached ids. */
  selectedIds: readonly number[];
  /** Attach/detach callback; the app owns the state. */
  onToggle: (id: number) => void;
  /** Picker label, e.g. "Attached tags" / "Tags". */
  label?: string;
}

export interface EditorChromeProps {
  /** Back control: a BUTTON, never an href (frozen — calling it flushes/leaves). */
  back: { label: string; onBack: () => void };
  /** Centred `<h1>` title for create/edit screens; wins over `status` in the toolbar. */
  title?: ReactNode;
  /** Status read-out rendered when there is no `title` (e.g. `<StatusText>Saved</StatusText>`). */
  status?: ReactNode;
  /** Toolbar right-side actions (e.g. the Save/Add `IconButton`). */
  actions?: ReactNode;
  /** Banner between toolbar and body (e.g. the app's conflict `AlertBanner`). */
  banner?: ReactNode;
  /** Tag picker wiring; omitted when the screen has no tags. */
  tagPicker?: EditorChromeTagPicker;
  /** `EditorStack` gap; default "lg". */
  gap?: StackGap;
  /** The editor fields, stacked by the block inside `EditorStack`. */
  children: ReactNode;
}

export function EditorChrome(props: EditorChromeProps): JSX.Element;
```

Rendered structure:

```tsx
<EditorScreen>
  <EditorToolbar back={back} title={title} status={status} actions={actions} />
  {banner}
  <EditorStack gap={gap}>
    {children}
    {tagPicker && (
      <TagPicker
        tags={tagPicker.tags}
        selectedIds={tagPicker.selectedIds}
        onToggle={tagPicker.onToggle}
        label={tagPicker.label}
      />
    )}
  </EditorStack>
</EditorScreen>
```

### Semantics and edge cases

- `back` is a real button (via `EditorToolbar`'s `IconButton` with `ChevronLeft`), never a
  link: the app's `onBack` performs the leave/flush and then navigates. Routing stays in
  the app.
- `title` and `status` are mutually exclusive in the rendered toolbar: `EditorToolbar`
  renders `title` when present, otherwise `status` (see `editor-toolbar.tsx:27-31`). A
  screen may pass both; `title` wins.
- `tagPicker` renders only when provided; an app with no tags omits it (the block does not
  inspect `tags.length`).
- `banner` renders between the toolbar and the body, so the conflict bar keeps its current
  position while its state machine stays app-side.
- The block is presentational: it never reads or writes editor state, never calls fetch,
  and imports nothing from `next/navigation`. Autosave/flush/conflict logic stays in the
  app (e.g. `apps/app/app/note-editor.tsx`).

### Element-by-element mapping (duplication evidence)

`apps/app/app/note-editor.tsx:365-374` ≡ `apps/app/app/todo-editor.tsx:74-83` (the editor
frame), per the intent doc's `editor chrome` row.

| Chrome slot | note-editor.tsx | todo-editor.tsx |
|---|---|---|
| `EditorScreen` | `:365` | `:74` |
| `EditorToolbar` (back + status/actions) | `:366-374` | `:75-83` |
| `title` | — (status only) | `:77` (`Edit Todo`/`New Todo`) |
| `banner` (conflict `AlertBanner`) | `:375-401` | — |
| `EditorStack` body | `:402-414` (fields direct today) | `:85-145` |
| `TagPicker` wiring | `:415-422` (label `Attached tags`) | `:137-144` (label `Tags`) |

The note editor currently places its `Textarea` directly in `EditorScreen`; the port moves
it into the chrome's `EditorStack` body slot so both editors share one frame. The
`Textarea variant="editor"` keeps `flex: 1`, so the full-height behavior is preserved
inside the stack.

### Frozen e2e surface (what the suite actually queries — must not change)

- `getByLabel('Back')` → `EditorToolbar` back button (from `back.label`)
  (`journey.suite.ts:99`).
- `getByLabel('Save')` → the note editor's `Save` `IconButton` in `actions`
  (`journey.ts:68,78`).
- `getByLabel('Note body')` → the `Textarea` the app passes in `children`
  (`journey.ts:67,76`).

Preserved but **not** asserted by any test today — the chrome must not alter them all the
same: the todo editor's `Save todo` / `Add todo` action labels, the `Edit Todo` /
`New Todo` heading, the `getByRole('status')` status read-out, and `TagPicker`'s
`role="group"` + per-tag `aria-pressed`. They stay because the chrome renders the app's
`actions`/`title`/`status` nodes and `ui-blocks`' `TagPicker` unchanged.

## CSS ownership

The chrome composes blocks whose classes are already owned: `EditorScreen`
(`.ui-editor-screen`), `EditorToolbar` (`.ui-editor-toolbar`, `.ui-editor-toolbar__title`),
`EditorStack` (`.ui-editor-stack` + gap modifiers), `TagPicker` (its own classes). It adds
no CSS and no raw values; the existing `EditorStack` token gap (`sm`/`md`/`lg`) is the
only spacing knob, so both editors render one rhythm.

## Tech Stack

React 19 TSX source, `@life/ui/styles.css`, token values only. Composes `ui-blocks`
(`EditorScreen`, `EditorToolbar`, `EditorStack`, `TagPicker`). No `next/navigation`, no
fetch, no server actions.

## Commands

- `npm run typecheck -w packages/ui`
- `npm run test:unit -w packages/ui -- test/editor-chrome.test.tsx`

## Project Structure

```
packages/ui/src/components/editor-chrome.tsx   # chrome source + exported prop types
packages/ui/src/index.ts                       # re-exports EditorChrome + types
packages/ui/test/editor-chrome.test.tsx        # one suite for the chrome
```

## Code Style

Frame + slots; the app owns state:

```tsx
<EditorChrome
  back={{ label: 'Back', onBack: () => void leave() }}
  status={<StatusText>{STATUS_TEXT[status]}</StatusText>}
  actions={<IconButton label="Save" onClick={() => void leave()}><Check size={20} aria-hidden /></IconButton>}
  banner={conflictNote && (
    <AlertBanner role="alert" actions={conflictActions}>
      This note changed on another device.
    </AlertBanner>
  )}
  tagPicker={availableTags.length > 0
    ? { tags: availableTags, selectedIds, onToggle: toggleTag, label: 'Attached tags' }
    : undefined}
>
  <Textarea ref={textareaRef} variant="editor" aria-label="Note body"
            value={body}
            onChange={(e) => { setBody(e.target.value); bodyRef.current = e.target.value; schedule(); }}
            onBlur={() => void flush()} />
</EditorChrome>
```

`leave`, `save`, `flush`, the conflict state machine, `parseInlineTags` and the fields stay
in `apps/app`.

## Testing Strategy

Unit tests only (jest, `packages/ui`). Cover: toolbar slots render (back label, title as
`<h1>`, status, actions); `title` wins over `status`; `banner` renders between toolbar and
stack; `children` render inside `EditorStack`; `tagPicker` renders when provided and is
absent when omitted; `onToggle` passes through (delegates to `TagPicker`'s own suite); the
back control is a button, not a link. No autosave/routing behavior — that stays in the
app's suites. E2E is not run by this module; `segment-port` runs the journey unchanged.

## Boundaries

- Always: preserve the `Back` button, the `note-editor` labels and the field ordering the
  app relies on; spacing via tokens only (`EditorStack` gap).
- Ask first: new props that would move autosave/conflict/flush behavior into the package;
  any new CSS class; running E2E.
- Never (hard exclusions): autosave/flush/debounce logic, conflict state, `parseInlineTags`,
  routing or `next/navigation` inside `packages/ui`; domain types (`Note`/`Todo`/`List`) or
  domain copy baked in; `fetch`/server actions; raw hex/px/rem values; a per-app fork of
  the chrome.

## Success Criteria

1. Both editors render their frame from `EditorChrome`; only fields and callbacks differ.
2. The *Frozen e2e surface* list above is reproduced verbatim.
3. `grep -riE "note|todo" packages/ui/src/components/editor-chrome.tsx` → no domain hits;
   no `next/navigation` in `packages/ui`.
4. `npm run typecheck -w packages/ui` and the chrome's unit suite are green.
5. The existing journey E2E is unchanged when the editors are ported (`segment-port`).

## Open Questions

- None.
