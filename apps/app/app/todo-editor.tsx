'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { List } from '@life/shared';
import {
  EditorScreen,
  EditorStack,
  EditorToolbar,
  IconButton,
  Input,
  Pill,
  PillGroup,
  TagPicker,
  Textarea,
  type TagOption,
} from '@life/ui';
import { Check, X } from 'lucide-react';
import { createTodoAction } from './todo-actions';

/**
 * The `/todos/new` editor screen — the FAB target, mirroring the notes editor
 * pattern (full-screen `EditorScreen` + `EditorToolbar`). Title is required; the
 * toolbar's ✓ is the single save action (no duplicate button). All visuals come
 * from `@life/ui`; the fields stack through `EditorStack` so the editor never
 * hand-stacks controls.
 */
export function TodoEditor({
  lists,
  availableTags,
}: {
  lists: List[];
  availableTags: TagOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [listId, setListId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<number[]>([]);

  const canSave = title.trim() !== '';

  function save() {
    if (!canSave) return;
    void createTodoAction({
      title,
      note: note.trim() === '' ? undefined : note,
      dueDate: dueDate === '' ? undefined : dueDate,
      listId: listId ?? undefined,
      tagIds,
    });
    router.back();
  }

  return (
    <EditorScreen>
      <EditorToolbar
        back={{ label: 'Back', onBack: () => router.back() }}
        title="New Todo"
        actions={
          <IconButton label="Save todo" onClick={save} disabled={!canSave}>
            <Check size={20} aria-hidden />
          </IconButton>
        }
      />

      <EditorStack gap="lg">
        <Input
          type="text"
          aria-label="Todo title"
          placeholder="What needs doing?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />

        <Textarea
          aria-label="Todo note"
          placeholder="Details (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <PillGroup label="Due" aria-label="Due">
          <Input
            type="date"
            aria-label="Due date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          {dueDate !== '' && (
            <IconButton label="Clear due date" onClick={() => setDueDate('')}>
              <X size={16} aria-hidden />
            </IconButton>
          )}
        </PillGroup>

        {lists.length > 0 && (
          <PillGroup label="List" aria-label="List">
            <Pill
              as="button"
              size="filter"
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
                size="filter"
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
      </EditorStack>
    </EditorScreen>
  );
}
