'use client';

import type { List } from '@life/shared';
import { ListManager, SettingsRow, Switch, type TodoListOption } from '@life/ui';
import { useRef, useState } from 'react';
import { createListAction, deleteListAction, renameListAction } from './todo-actions';
import { TOGGLE_DEBOUNCE_MS, useDebouncedCallback } from '@/lib/use-debounced-callback';

/**
 * Per-list "Important by default" switch: flips optimistically, then persists the
 * settled value once (rapid toggles coalesce; a toggle back to the server value
 * sends nothing).
 */
export function ImportantDefaultSwitch({
  id,
  name,
  importantDefault,
  version,
}: Readonly<{
  id: string;
  name: string;
  importantDefault: boolean | null;
  version?: number;
}>) {
  const [on, setOn] = useState(importantDefault ?? false);
  const persisted = useRef(importantDefault ?? false);
  const debouncedFlush = useDebouncedCallback(TOGGLE_DEBOUNCE_MS);

  return (
    <Switch
      label="Default important"
      checked={on}
      onCheckedChange={(next) => {
        setOn(next);
        debouncedFlush(() => {
          if (next === persisted.current) return;
          persisted.current = next;
          void renameListAction(id, name, next, version);
        });
      }}
    />
  );
}

/**
 * The extra settings row a managed list carries: its "Important by default"
 * switch. Hoisted out of `ListManagerPanel` so the row is a stable component
 * identity (and the switch keeps its state across re-renders of the panel).
 */
function ListRowExtra({
  id,
  name,
  list,
}: Readonly<{ id: string; name: string; list: List | undefined }>) {
  return (
    <SettingsRow
      label="Important by default"
      control={
        <ImportantDefaultSwitch
          id={id}
          name={name}
          importantDefault={list?.importantDefault ?? null}
          version={list?.version}
        />
      }
    />
  );
}

/**
 * Builds the `rowExtra` renderer once per panel render. It lives at module
 * scope, not inline in `ListManagerPanel`, so the JSX-returning arrow is not a
 * component definition nested inside a component (Sonar `S6478`) and the row
 * keeps a stable identity.
 */
function rowExtraFor(lists: List[]) {
  return (option: TodoListOption) => (
    <ListRowExtra
      id={option.id}
      name={option.name}
      list={lists.find((candidate) => candidate.id === option.id)}
    />
  );
}

/**
 * The todo-local list management surface (`ListManager` upstream primitive),
 * wired to todo-service through the shared server actions.
 */
export function ListManagerPanel({ lists }: Readonly<{ lists: List[] }>) {
  return (
    <ListManager
      lists={lists.map((list) => ({ id: list.id, name: list.name }))}
      onCreate={(name) => void createListAction(name)}
      onRename={(id, name) => {
        const list = lists.find((candidate) => candidate.id === id);
        void renameListAction(id, name, list?.importantDefault ?? false, list?.version);
      }}
      onDelete={(id) => void deleteListAction(id)}
      rowExtra={rowExtraFor(lists)}
    />
  );
}
