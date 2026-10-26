# Spec: ui-manager-surface

Module id: `ui-manager-surface` (sibling of `ui-blocks`). Internal to `@life/ui`.

## Objective

`ListManager` and `TagManager` were the same surface written twice: a create field,
then one row per item with an inline rename editor and a `Menu` holding the row
actions. The two differed only in the row noun (`list` / `tag`), the id type
(`string` / `number`) and the BEM base (`ui-list-manager` / `ui-tag-manager`).

`ManagerSurface` owns that surface once. Both managers become thin wrappers that
supply `items`, `classPrefix`, `noun` and their own defaults, and pass the rest
through. Success = the rendered HTML is byte-identical to the pre-extraction output
for every state in `packages/ui/test/{list,tag}-manager.test.tsx`, and the frozen e2e
selector surface (roles, visible text, aria-labels) is unchanged.

## Scope

- **Not exported from the package barrel.** This is an internal implementation
  detail consumed by two primitives in the same package, not a new public concept.
  `ListManager` and `TagManager` remain the public surface.
- No app code changes. No behaviour change. No visual change.
- No domain types: a row is `ManagerItem` (`{ id: string | number; name: string }`).

## Component (prop contract)

```tsx
export interface ManagerItem {
  id: string | number;
  name: string;
}

export interface ManagerSurfaceProps<T extends ManagerItem>
  extends Omit<ComponentPropsWithRef<'div'>, 'onCreate'> {
  items: T[];
  classPrefix: string;          // BEM base, e.g. 'ui-tag-manager'
  noun: string;                 // 'tag' → "Rename tag X"
  label: string;                // surface aria-label
  placeholder: string;          // create field placeholder + aria-label
  createLabel: string;          // create IconButton label
  disabled?: boolean;
  rowExtra?: (item: T) => ReactNode;
  onCreate: (name: string) => void;
  onRename: (id: T['id'], name: string) => void;
  onDelete: (id: T['id']) => void;
}

export function ManagerSurface<T extends ManagerItem>(
  props: Readonly<ManagerSurfaceProps<T>>,
): JSX.Element;
```

`onCreate` is omitted from the inherited div props because a native div has no such
handler; `onRename`/`onDelete` are the component's own.

## Rendered structure

```
<div class="{prefix}" aria-label={label}>
  <div class="{prefix}__create">
    <Input aria-label={placeholder} placeholder={placeholder} />
    <IconButton label={createLabel}><Plus /></IconButton>
  </div>
  <ul class="{prefix}__list">
    <li class="{prefix}__row">
      editing → <div class="{prefix}__edit"><Input aria-label="Rename {noun} {name}" /><IconButton label="Save" /><IconButton label="Cancel" /></div>
      else    → <Menu label="Actions for {name}" summary={<span class="{prefix}__name">{name}</span>}>
                  {rowExtra?.(item)}
                  <IconButton label="Rename {noun} {name}" />
                  <IconButton label="Delete {noun} {name}" />
                </Menu>
    </li>
  </ul>
</div>
```

## Frozen strings and structure

These are e2e-visible and must not move:

- Surface aria-label defaults: `Manage lists` / `Manage tags`.
- Create placeholder + aria-label: `New list` / `New tag`; create button `Add list` / `Add tag`.
- Row disclosure: `Actions for {name}`; rename/delete: `Rename {noun} {name}`, `Delete {noun} {name}`.
- Inline editor: `Rename {noun} {name}`, plus `Save` and `Cancel`.
- Element order inside the `Menu` panel: `rowExtra` first, then rename, then delete.
- Class names: `{prefix}` and its `__create` / `__list` / `__row` / `__edit` / `__name` parts.

## Semantics

- `create` trims; an all-whitespace draft does nothing. Enter in the create field
  creates and clears the draft; the create button is disabled while the draft is empty.
- `saveEdit` trims; an all-whitespace edit does nothing and keeps the editor open.
  The `Save` button is disabled while the edit draft is empty.
- Enter in the edit field saves. Enter in either field never submits a surrounding form.
- Opening another row's menu closes the current one (`openId` is a single value).
- Starting an edit or deleting closes the open menu.
- State is local: `draft`, `editingId`, `editDraft`, `openId`.

## Element-by-element mapping (duplication evidence)

| Region | Elements |
| --- | --- |
| root | structural `div`, `{prefix}`, `aria-label` |
| create row | `Input` + `IconButton` (`Plus`, `createLabel`) |
| rows | `ul` / `li` (`{prefix}__row`); a non-editing row is one `Menu` |
| row summary | `Menu` `summary` = name `span` (`{prefix}__name`) |
| disclosure | `Menu` `⋯` (`MoreVertical`), `Actions for {name}` |
| row actions | `IconButton` `Pencil` / `IconButton` `CircleX` |
| inline edit | `Input` + `IconButton` `Check` (`Save`) + `IconButton` `X` (`Cancel`) |
