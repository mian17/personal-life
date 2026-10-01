'use client';

import { useEffect, useRef, useState } from 'react';
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
import { deleteTodoAction, updateTodoAction } from './todo-actions';

const HIDE_DELAY_MS = 1000;
const COLLAPSE_MS = 220;

/**
 * The done toggle as a client wrapper so a row the user just ticked can linger
 * ~1s then collapse out. Composes the upstream `IconButton` (frozen label,
 * always ghost) with the `Checkbox` glyph. `hide` disables the auto-hide (the
 * Done filter keeps rows put). The timer arms only on a `false→true` tick
 * (`wasDone` ref), so a row already done on load (the "All" filter, Matrix) is
 * only struck/dimmed and never auto-hidden; a snackbar Undo cancels the pending
 * unmount and un-hides the row.
 */
function DoneToggle({
  done,
  label,
  hide,
  onToggle,
  onCollapse,
}: {
  done: boolean;
  label: string;
  hide: boolean;
  onToggle: () => void;
  onCollapse: (value: boolean) => void;
}) {
  const wasDone = useRef(done);
  const onCollapseRef = useRef(onCollapse);
  onCollapseRef.current = onCollapse;

  useEffect(() => {
    const justDone = !wasDone.current && done;
    wasDone.current = done;
    if (!hide || !justDone) return;
    const timer = setTimeout(() => onCollapseRef.current(true), HIDE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hide, done]);

  return (
    <IconButton
      label={label}
      variant="ghost"
      onClick={() => {
        onCollapse(false);
        onToggle();
      }}
    >
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
  hideDone = true,
}: {
  todo: Todo;
  today: string;
  lists: List[];
  availableTags: TagOption[];
  size?: 'default' | 'dense';
  tone?: ListItemTone;
  hideDone?: boolean;
}) {
  const [collapsing, setCollapsing] = useState(false);
  const [removed, setRemoved] = useState(false);
  const { showSnackbar } = useSnackbar();
  const undoneBySnackbar = useRef(false);

  useEffect(() => {
    if (!collapsing) return;
    const timer = setTimeout(() => {
      if (!undoneBySnackbar.current) setRemoved(true);
    }, COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [collapsing]);

  useEffect(() => {
    if (todo.done) return;
    setRemoved(false);
    setCollapsing(false);
    undoneBySnackbar.current = false;
  }, [todo.done]);

  if (removed) return null;

  const attached = availableTags.filter((tag) => todo.tagIds.includes(tag.id));
  const list = lists.find((candidate) => candidate.id === todo.listId);

  const handleCollapse = (value: boolean) => {
    if (value) {
      showSnackbar({
        message: 'Task completed',
        actionLabel: 'Undo',
        onAction: () => {
          undoneBySnackbar.current = true;
          setRemoved(false);
          setCollapsing(false);
          // No expectedVersion: the done write bumped the row's version, so a
          // version-checked PATCH would 409. This is an unconditional undo.
          void updateTodoAction(todo.id, { done: false });
        },
      });
    }
    setCollapsing(value);
  };

  const doneToggle = (
    <DoneToggle
      done={todo.done}
      label={todo.done ? `Mark ${todo.title} not done` : `Mark ${todo.title} done`}
      hide={hideDone}
      onToggle={() => {
        undoneBySnackbar.current = false;
        void updateTodoAction(todo.id, { done: !todo.done }, todo.version);
      }}
      onCollapse={handleCollapse}
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
          {isDefault && list && <span>{list.name}</span>}
        </>
      }
      snippet={isDefault ? (todo.note ?? undefined) : undefined}
      leading={doneToggle}
      done={todo.done}
      collapsing={collapsing}
      variant="todo"
      size={size}
      tone={tone}
      deleteAction={
        isDefault ? (
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
