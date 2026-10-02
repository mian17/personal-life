'use client';

import type { List, Todo } from '@life/shared';
import {
  Button,
  Checkbox,
  DueDate,
  IconButton,
  ListItem,
  Pill,
  PillGroup,
  type ListItemTone,
  type TagOption,
  useSnackbar,
} from '@life/ui';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { completeTodoAction, deleteTodoAction, updateTodoAction } from './todo-actions';
import { repeatLabel } from '@/lib/todo-repeat-label';

/**
 * The done toggle as a client wrapper: composes the upstream `IconButton`
 * (frozen label, always ghost) with the `Checkbox` glyph. Ticking a row is a
 * plain toggle — the row never hides or collapses.
 */
function DoneToggle({ done, label, onToggle }: { done: boolean; label: string; onToggle: () => void }) {
  return (
    <IconButton label={label} variant="ghost" onClick={onToggle}>
      <Checkbox checked={done} />
    </IconButton>
  );
}

/**
 * One todo row at two sizes, from one `ListItem variant="todo"`: a borderless
 * square checkbox LEADING the row (top-aligned with the title) and the title
 * clamped to two lines, with the signal due date. The row links to its edit
 * screen (`/todos/[id]/edit`, the same editor as create, in edit mode).
 *
 * `size="default"` (the `/todos` List) keeps the extras: list name, note
 * snippet and the trash delete action, at the base type scale (`--checkbox-size`
 * 1.25rem). `size="dense"` (the Eisenhower matrix) is the minimal lens — name +
 * signal due date only, compact type, and the same anatomy at 0.75rem. `tone`
 * tints the leading checkbox for a coloured matrix quadrant; the matrix passes
 * `DueDate tone="signal"` (overdue deep red, any future lighter red) and the
 * List row uses it too, so the two views of one todo agree.
 */
export function TodoItem({
  todo,
  today,
  lists,
  availableTags,
  size = 'default',
  tone,
}: {
  todo: Todo;
  today: string;
  lists: List[];
  availableTags: TagOption[];
  size?: 'default' | 'dense';
  tone?: ListItemTone;
}) {
  const { showSnackbar } = useSnackbar();
  // Optimistic completion: the row strikes/mutes in place at tick time and is
  // relocated by `completeTodoAction`'s delayed revalidation. Never set for a
  // repeating todo — its server state stays open after the advance.
  const [completed, setCompleted] = useState(false);
  const done = todo.done || completed;

  const attached = availableTags.filter((tag) => todo.tagIds.includes(tag.id));
  const list = lists.find((candidate) => candidate.id === todo.listId);
  const repeat = repeatLabel(todo.repeat, todo.dueDate, todo.repeatDays);

  const doneToggle = (
    <DoneToggle
      done={done}
      label={done ? `Mark ${todo.title} not done` : `Mark ${todo.title} done`}
      onToggle={() => {
        if (!todo.done) {
          if (todo.repeat) {
            // Repeating rows stay open (the server advances them) — never
            // optimistically strike them; the write is immediate and version-checked.
            void updateTodoAction(todo.id, { done: true }, todo.version);
          } else {
            setCompleted(true);
            void completeTodoAction(todo.id, todo.version);
          }
          showSnackbar({
            message: 'Task completed',
            actionLabel: 'Undo',
            onAction: () => {
              // No expectedVersion: the done write bumped the row's version, so a
              // version-checked PATCH would 409. This is an unconditional undo.
              setCompleted(false);
              void updateTodoAction(todo.id, { done: false });
            },
          });
        } else {
          setCompleted(false);
          void updateTodoAction(todo.id, { done: false }, todo.version);
        }
      }}
    />
  );

  const isDefault = size === 'default';

  return (
    <ListItem
      href={`/todos/${todo.id}/edit`}
      title={todo.title}
      meta={
        <>
          <DueDate dueDate={todo.dueDate} today={today} tone="signal" />
          {repeat && <span>{repeat}</span>}
          {isDefault && list && <span>{list.name}</span>}
        </>
      }
      snippet={isDefault ? (todo.note ?? undefined) : undefined}
      leading={doneToggle}
      done={done}
      variant="todo"
      size={size}
      tone={tone}
      deleteAction={
        isDefault && !done ? (
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
        ) : undefined
      }
    >
    </ListItem>
  );
}
