'use client';

import type { List } from '@life/shared';
import { ListManager } from '@life/ui';
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
        void renameListAction(id, name, list?.version);
      }}
      onDelete={(id) => void deleteListAction(id)}
    />
  );
}
