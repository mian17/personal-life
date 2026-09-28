'use client';

import { useState } from 'react';
import type { List } from '@life/shared';
import {
  Button,
  IconButton,
  Input,
  Pill,
  PillGroup,
  TagPicker,
  Textarea,
  type TagOption,
} from '@life/ui';
import { X } from 'lucide-react';
import { createTodoAction } from './todo-actions';

/**
 * The `/todos` composer: title (required), optional note, due date, list, and
 * tags — every control an `@life/ui` primitive. Submitting clears the draft for
 * the next capture.
 */
export function TodoComposer({
  lists,
  availableTags,
}: {
  lists: List[];
  availableTags: TagOption[];
}) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [listId, setListId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<number[]>([]);

  const canCreate = title.trim() !== '';

  function submit() {
    if (!canCreate) return;
    void createTodoAction({
      title,
      note: note.trim() === '' ? undefined : note,
      dueDate: dueDate === '' ? undefined : dueDate,
      listId: listId ?? undefined,
      tagIds,
    });
    setTitle('');
    setNote('');
    setDueDate('');
    setListId(null);
    setTagIds([]);
  }

  return (
    <div role="group" aria-label="New todo">
      <Input
        type="text"
        aria-label="Todo title"
        placeholder="What needs doing?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Textarea
        aria-label="Todo note"
        placeholder="Details (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
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
          {lists.map((list) => (
            <Pill
              key={list.id}
              as="button"
              size="chip"
              active={listId === list.id}
              aria-pressed={listId === list.id}
              onClick={() => setListId(list.id)}
            >
              {list.name}
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
      <Button variant="primary" onClick={submit} disabled={!canCreate}>
        Add todo
      </Button>
    </div>
  );
}
