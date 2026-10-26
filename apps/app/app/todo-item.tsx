'use client';

import type { List, Todo } from '@life/shared';
import {
  Button,
  Checkbox,
  DueDate,
  IconButton,
  ListItem,
  type ListItemTone,
  type TagOption,
  useSnackbar,
} from '@life/ui';
import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { completeTodoAction, deleteTodoAction, updateTodoAction } from './todo-actions';
import { repeatLabel } from '@/lib/todo-repeat-label';
import { TOGGLE_DEBOUNCE_MS, useDebouncedCallback } from '@/lib/use-debounced-callback';

/**
 * The done toggle as a client wrapper: composes the upstream `IconButton`
 * (frozen label, always ghost) with the `Checkbox` glyph. Ticking a row is a
 * plain toggle — the row never hides or collapses.
 */
export function DoneToggle({
  done,
  label,
  onToggle,
}: Readonly<{ done: boolean; label: string; onToggle: () => void }>) {
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
}: Readonly<{
  todo: Todo;
  today: string;
  lists: List[];
  availableTags: TagOption[];
  size?: 'default' | 'dense';
  tone?: ListItemTone;
}>) {
  const { showSnackbar } = useSnackbar();
  // Optimistic, version-anchored completion: the row strikes/mutes in place on the
  // SAME press, but the server write is debounced — a burst of toggles coalesces
  // into one request once the user settles. `baseline` holds the done state the
  // server was last told within this version window, so toggling back to it sends
  // nothing. The anchor is set for a repeating tick too: the write goes through
  // `completeTodoAction`, which records the occurrence and advances the due while
  // keeping `done: false`, so when the delayed revalidation bumps `todo.version`
  // the anchor no longer matches and the (open) next occurrence renders un-struck.
  const [intent, setIntent] = useState<{ version: number; done: boolean } | null>(null);
  const baseline = useRef({ version: todo.version, done: todo.done });
  const debouncedFlush = useDebouncedCallback(TOGGLE_DEBOUNCE_MS);
  const done = intent?.version === todo.version ? intent.done : todo.done;

  const list = lists.find((candidate) => candidate.id === todo.listId);
  const repeat = repeatLabel(todo.repeat, todo.dueDate, todo.repeatDays);

  function flush(next: boolean, id: string, version: number, serverDone: boolean) {
    // A new server version starts a fresh baseline: the row the server returned.
    if (baseline.current.version !== version) {
      baseline.current = { version, done: serverDone };
    }
    if (next === baseline.current.done) {
      setIntent(null);
      return;
    }
    baseline.current = { version, done: next };
    if (next) {
      void completeTodoAction(id, version);
      showSnackbar({
        message: 'Task completed',
        actionLabel: 'Undo',
        onAction: () => {
          // No expectedVersion: the done write bumped the row's version, so a
          // version-checked PATCH would 409. This is an unconditional undo.
          baseline.current = { version, done: false };
          setIntent(null);
          void updateTodoAction(id, { done: false });
        },
      });
    } else {
      void updateTodoAction(id, { done: false }, version);
    }
  }

  const doneToggle = (
    <DoneToggle
      done={done}
      label={done ? `Mark ${todo.title} not done` : `Mark ${todo.title} done`}
      onToggle={() => {
        const next = !done;
        setIntent({ version: todo.version, done: next });
        debouncedFlush(() => flush(next, todo.id, todo.version, todo.done));
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
