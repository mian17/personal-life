'use client';

import { useEffect, useRef, useState } from 'react';
import type { List, Todo } from '@life/shared';
import {
  Button,
  Checkbox,
  DueDate,
  dueDateLabel,
  IconButton,
  ListItem,
  Pill,
  PillGroup,
  type ListItemTone,
  type TagOption,
  useSnackbar,
} from '@life/ui';
import { Circle, CircleCheck, Trash2 } from 'lucide-react';
import { deleteTodoAction, updateTodoAction } from './todo-actions';

const HIDE_DELAY_MS = 1000;
const COLLAPSE_MS = 220;

/**
 * The done toggle as a client wrapper so a row the user just ticked can linger
 * ~1s then collapse out. Composes the upstream `IconButton` (frozen label and
 * variant unchanged). `hide` disables the auto-hide (the Done filter keeps rows
 * put). The timer arms only on a `false→true` tick (`wasDone` ref), so a row
 * already done on load (the "All" filter, Matrix) is only struck/dimmed and
 * never auto-hidden; a snackbar Undo cancels the pending unmount and un-hides
 * the row.
 */
function DoneToggle({
  done,
  label,
  variant,
  hide,
  square,
  onToggle,
  onCollapse,
}: {
  done: boolean;
  label: string;
  variant: 'default' | 'ghost';
  hide: boolean;
  /** Matrix (`square`) glyph: the upstream `Checkbox` atom instead of a lucide circle. */
  square: boolean;
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
      variant={variant}
      onClick={() => {
        onCollapse(false);
        onToggle();
      }}
    >
      {square ? (
        <Checkbox checked={done} />
      ) : done ? (
        <CircleCheck size={20} aria-hidden />
      ) : (
        <Circle size={20} aria-hidden />
      )}
    </IconButton>
  );
}

/**
 * One todo row: a link to its edit screen (`/todos/[id]/edit`, the same editor
 * as create, in edit mode), a done toggle, and a silent soft delete to trash.
 * Editing lives on the dedicated screen; the row only reads + toggles. All
 * visuals come from `@life/ui`; the due date reads out through `dueDateLabel`
 * (Today / Tomorrow / dd/mm/yyyy, muted).
 *
 * `mode="matrix"` renders the minimal TickTick-style lens row: a borderless
 * done toggle LEADING the row, name + due date only (no list name, no
 * note snippet, no delete action), dense type. The matrix `square` toggle glyph
 * is the `Checkbox` atom (rounded square); the default list row keeps the lucide
 * circle. In matrix mode `tone` tints the
 * leading checkbox and the due date is coloured by tier (`DueDate tone="signal"`
 * — overdue deep red, any future lighter red). The default row is unchanged:
 * its checkbox stays untinted and its date stays the muted `dueDateLabel` string
 * (lesson 0003 — list dates stay muted).
 */
export function TodoItem({
  todo,
  today,
  lists,
  availableTags,
  mode = 'default',
  tone,
  hideDone = true,
}: {
  todo: Todo;
  today: string;
  lists: List[];
  availableTags: TagOption[];
  mode?: 'default' | 'matrix';
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
      variant={mode === 'matrix' ? 'ghost' : 'default'}
      hide={hideDone}
      square={mode === 'matrix'}
      onToggle={() => {
        undoneBySnackbar.current = false;
        void updateTodoAction(todo.id, { done: !todo.done }, todo.version);
      }}
      onCollapse={handleCollapse}
    />
  );

  if (mode === 'matrix') {
    return (
      <ListItem
        href={`/todos/${todo.id}/edit`}
        title={todo.title}
        meta={<DueDate dueDate={todo.dueDate} today={today} tone="signal" />}
        leading={doneToggle}
        done={todo.done}
        collapsing={collapsing}
        dense
        tone={tone}
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
      done={todo.done}
      collapsing={collapsing}
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
