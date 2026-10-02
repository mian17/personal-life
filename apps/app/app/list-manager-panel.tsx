'use client';

import type { List } from '@life/shared';
import { ListManager, SettingsRow, Switch } from '@life/ui';
import { createListAction, deleteListAction, renameListAction } from './todo-actions';

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
              <Switch
                label="Default important"
                checked={list?.importantDefault ?? false}
                onCheckedChange={(next) =>
                  void renameListAction(option.id, option.name, next, list?.version)
                }
              />
            }
          />
        );
      }}
    />
  );
}
