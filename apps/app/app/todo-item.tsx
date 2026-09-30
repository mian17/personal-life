'use client';

import { useState } from 'react';
import type { List, Todo } from '@life/shared';
import {
  Button,
  ConfirmButton,
  DueDatePill,
  IconButton,
  Input,
  ListItem,
  Pill,
  PillGroup,
  Stack,
  TagPicker,
  Textarea,
  type TagOption,
} from '@life/ui';
import { Circle, CircleCheck, Pencil, Trash2, X } from 'lucide-react';
import { deleteTodoAction, updateTodoAction } from './todo-actions';

/**
 * One todo row: done toggle, inline edit (title, note, due date, list), tag
 * attach/detach through the shared `TagPicker`, and permanent delete. All
 * visuals come from `@life/ui`; the date state is `DueDatePill`'s (`data-state`).
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
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [note, setNote] = useState(todo.note ?? '');
  const [dueDate, setDueDate] = useState(todo.dueDate ?? '');
  const [listId, setListId] = useState<string | null>(todo.listId);
  const [tagIds, setTagIds] = useState<number[]>(todo.tagIds);

  const attached = availableTags.filter((tag) => tagIds.includes(tag.id));
  const list = lists.find((candidate) => candidate.id === listId);

  function reset() {
    setTitle(todo.title);
    setNote(todo.note ?? '');
    setDueDate(todo.dueDate ?? '');
    setListId(todo.listId);
    setTagIds(todo.tagIds);
  }

  function cancel() {
    reset();
    setEditing(false);
  }

  function save() {
    void updateTodoAction(
      todo.id,
      {
        title,
        note: note.trim() === '' ? null : note,
        dueDate: dueDate === '' ? null : dueDate,
        listId,
        tagIds,
      },
      todo.version,
    );
    setEditing(false);
  }

  return (
    <ListItem
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
          disabled={editing}
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
      {attached.length > 0 && (
        <PillGroup aria-label="Tags">
          {attached.map((tag) => (
            <Pill key={tag.id} size="chip">
              {tag.name}
            </Pill>
          ))}
        </PillGroup>
      )}

      {editing ? (
        <Stack>
          <Input
            type="text"
            aria-label="Todo title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea aria-label="Todo note" value={note} onChange={(e) => setNote(e.target.value)} />
          <Input
            type="date"
            aria-label="Due date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <IconButton label="Clear due date" onClick={() => setDueDate('')}>
            <X size={16} aria-hidden />
          </IconButton>
          {lists.length > 0 && (
            <PillGroup label="List" aria-label="List">
              <Pill
                as="button"
                size="chip"
                active={listId === null}
                aria-pressed={listId === null}
                onClick={() => setListId(null)}
              >
                No list
              </Pill>
              {lists.map((candidate) => (
                <Pill
                  key={candidate.id}
                  as="button"
                  size="chip"
                  active={listId === candidate.id}
                  aria-pressed={listId === candidate.id}
                  onClick={() => setListId(candidate.id)}
                >
                  {candidate.name}
                </Pill>
              ))}
            </PillGroup>
          )}
          <TagPicker
            tags={availableTags}
            selectedIds={tagIds}
            onToggle={(id) =>
              setTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
            }
            label="Tags"
          />
          <PillGroup>
            <Button variant="primary" size="bare" onClick={save}>
              Save
            </Button>
            <Button variant="ghost" size="bare" onClick={cancel}>
              Cancel
            </Button>
          </PillGroup>
        </Stack>
      ) : (
        <IconButton label={`Edit ${todo.title}`} onClick={() => setEditing(true)}>
          <Pencil size={18} aria-hidden />
        </IconButton>
      )}
    </ListItem>
  );
}
