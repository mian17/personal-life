'use client';

import type { List, Todo } from '@life/shared';
import { ConfirmButton, DueDatePill, IconButton, ListItem, Pill, PillGroup, type TagOption } from '@life/ui';
import { Circle, CircleCheck, Trash2 } from 'lucide-react';
import { deleteTodoAction, updateTodoAction } from './todo-actions';

/**
 * One todo row: a link to its edit screen (`/todos/[id]/edit`, the same editor
 * as create, in edit mode), a done toggle, and a permanent delete. Editing lives
 * on the dedicated screen; the row only reads + toggles. All visuals come from
 * `@life/ui`; the date state is `DueDatePill`'s.
 */
export function TodoItem({
  todo,
  today,
  lists,
  availableTags,
}: {
  todo: Todo;
  today: string;
  lists: List[];
  availableTags: TagOption[];
}) {
  const attached = availableTags.filter((tag) => todo.tagIds.includes(tag.id));
  const list = lists.find((candidate) => candidate.id === todo.listId);

  return (
    <ListItem
      href={`/todos/${todo.id}/edit`}
      title={todo.title}
      meta={
        <>
          <DueDatePill dueDate={todo.dueDate} today={today} />
          {list && <span>{list.name}</span>}
        </>
      }
      snippet={todo.note ?? undefined}
      trailing={
        <IconButton
          label={todo.done ? `Mark ${todo.title} not done` : `Mark ${todo.title} done`}
          onClick={() => void updateTodoAction(todo.id, { done: !todo.done }, todo.version)}
        >
          {todo.done ? <CircleCheck size={20} aria-hidden /> : <Circle size={20} aria-hidden />}
        </IconButton>
      }
      deleteAction={
        <form action={deleteTodoAction.bind(null, todo.id)}>
          <ConfirmButton
            variant="danger"
            size="icon"
            message="Delete this todo forever? This cannot be undone."
            aria-label={`Delete ${todo.title}`}
          >
            <Trash2 size={18} aria-hidden />
          </ConfirmButton>
        </form>
      }
    >
    </ListItem>
  );
}
