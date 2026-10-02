'use client';

import type { List } from '@life/shared';
import { ListManager, SettingsRow, Switch } from '@life/ui';
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
}: {
  id: string;
  name: string;
  importantDefault: boolean | null;
  version?: number;
}) {
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
 * The todo-local list management surface (`ListManager` upstream primitive),
 * wired to todo-service through the shared server actions.
 */
export function ListManagerPanel({ lists }: { lists: List[] }) {
  return (
    <ListManager
      lists={lists.map((list) => ({ id: list.id, name: list.name }))}
      onCreate={(name) => void createListAction(name)}
      onRename={(id, name) => {
        const list = lists.find((candidate) => candidate.id === id);
        void renameListAction(id, name, list?.importantDefault ?? false, list?.version);
      }}
      onDelete={(id) => void deleteListAction(id)}
      rowExtra={(option) => {
        const list = lists.find((candidate) => candidate.id === option.id);
        return (
          <SettingsRow
            label="Important by default"
            control={
              <ImportantDefaultSwitch
                id={option.id}
                name={option.name}
                importantDefault={list?.importantDefault ?? null}
                version={list?.version}
              />
            }
          />
        );
      }}
    />
  );
}
