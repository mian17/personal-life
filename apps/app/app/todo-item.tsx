'use client';

import type { List, Todo } from '@life/shared';
import {
  Button,
  Checkbox,
  DueDate,
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

/** Shown when a toggle write rejects: the row falls back to server truth and says why. */
const WRITE_FAILED_MESSAGE = "Couldn't save that change.";

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

  /**
   * A rejected write must not leave the row looking saved. Drop the optimistic value so the
   * row follows `todo.done` again, rewind the baseline to the server state this window started
   * from (a baseline the server never accepted would turn the user's next press into a no-op),
   * and say the change did not stick through the same snackbar the row already owns.
   */
  function reportWriteFailure(
    attempted: { version: number; done: boolean },
    serverState: { version: number; done: boolean },
  ) {
    // A newer press may already own the baseline; only rewind the one this write set.
    // ponytail: a failure landing after a retick still drops the newer optimistic value —
    // the row shows server truth, which is the honest state. Add a per-press write id if a
    // flicker on that race ever gets reported.
    if (baseline.current.version === attempted.version && baseline.current.done === attempted.done) {
      baseline.current = serverState;
    }
    setIntent(null);
    showSnackbar({ message: WRITE_FAILED_MESSAGE });
  }

  /** Fire a write without awaiting it, but never let its rejection go silent. */
  function writeTodo(
    write: Promise<unknown>,
    attempted: { version: number; done: boolean },
    serverState: { version: number; done: boolean },
  ) {
    void Promise.resolve(write).catch(() => reportWriteFailure(attempted, serverState));
  }

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
    const attempted = { version, done: next };
    const serverState = { version, done: serverDone };
    if (next) {
      writeTodo(completeTodoAction(id, version), attempted, serverState);
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
      writeTodo(updateTodoAction(id, { done: false }, version), attempted, serverState);
    }
  }

  function toggleDone() {
    const next = !done;
    setIntent({ version: todo.version, done: next });
    debouncedFlush(() => flush(next, todo.id, todo.version, todo.done));
  }

  const doneToggle = (
    <Checkbox
      checked={done}
      label={done ? `Mark ${todo.title} not done` : `Mark ${todo.title} done`}
      onCheckedChange={toggleDone}
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
        isDefault ? (
          // The slot is always present so a row's width never depends on `done`: gated instead,
          // unticking inserted the form and the row reflowed around it. Hiding it keeps the
          // reserved width and takes the control out of the accessibility tree, so a done row
          // still offers no delete affordance. The gate reads the durable prop, never the
          // optimistic `done`: an untick would otherwise paint the trash can mid-write.
          <form
            action={deleteTodoAction.bind(null, todo.id)}
            className={todo.done ? 'invisible' : undefined}
          >
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
