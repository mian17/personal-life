'use client';

import type { List, Todo } from '@life/shared';
import {
  Button,
  dueDateLabel,
  IconButton,
  ListItem,
  Pill,
  PillGroup,
  type TagOption,
} from '@life/ui';
import { Circle, CircleCheck, Trash2 } from 'lucide-react';
import { deleteTodoAction, updateTodoAction } from './todo-actions';

/**
 * One todo row: a link to its edit screen (`/todos/[id]/edit`, the same editor
 * as create, in edit mode), a done toggle, and a silent soft delete to trash.
 * Editing lives on the dedicated screen; the row only reads + toggles. All
 * visuals come from `@life/ui`; the due date reads out through `dueDateLabel`
 * (Today / Tomorrow / dd/mm/yyyy, muted).
 *
 * `mode="matrix"` renders the minimal TickTick-style lens row: a borderless
 * done toggle LEADING the row, name + due-date label only (no list name, no
 * note snippet, no delete action), dense type. The default row is unchanged.
 */
export function TodoItem({
  todo,
  today,
  lists,
  availableTags,
  mode = 'default',
}: {
  todo: Todo;
  today: string;
  lists: List[];
  availableTags: TagOption[];
  mode?: 'default' | 'matrix';
}) {
  const attached = availableTags.filter((tag) => todo.tagIds.includes(tag.id));
  const list = lists.find((candidate) => candidate.id === todo.listId);

  const doneToggle = (
    <IconButton
      label={todo.done ? `Mark ${todo.title} not done` : `Mark ${todo.title} done`}
      variant={mode === 'matrix' ? 'ghost' : 'default'}
      onClick={() => void updateTodoAction(todo.id, { done: !todo.done }, todo.version)}
    >
      {todo.done ? <CircleCheck size={20} aria-hidden /> : <Circle size={20} aria-hidden />}
    </IconButton>
  );

  if (mode === 'matrix') {
    return (
      <ListItem
        href={`/todos/${todo.id}/edit`}
        title={todo.title}
        meta={dueDateLabel(todo.dueDate, today)}
        leading={doneToggle}
        dense
      />
    );
  }

  return (
    <ListItem
      href={`/todos/${todo.id}/edit`}
      title={todo.title}
      meta={
        <>
          {dueDateLabel(todo.dueDate, today)}
          {list && <span>{list.name}</span>}
        </>
      }
      snippet={todo.note ?? undefined}
      trailing={doneToggle}
      deleteAction={
        <form action={deleteTodoAction.bind(null, todo.id)}>
          <Button
            type="submit"
            variant="danger"
            size="icon"
            aria-label={`Delete ${todo.title}`}
          >
            <Trash2 size={18} aria-hidden />
          </Button>
        </form>
      }
    >
    </ListItem>
  );
}
