'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { List, Todo } from '@life/shared';
import {
  EditorChrome,
  IconButton,
  Input,
  Pill,
  PillGroup,
  Switch,
  Textarea,
  type TagOption,
} from '@life/ui';
import { Check } from 'lucide-react';
import { createTodoAction, updateTodoAction } from './todo-actions';

/**
 * The todo editor screen, shared by create (`/todos/new`) and edit
 * (`/todos/[id]/edit`). One component, two modes — the same fields and layout;
 * only the initial values and the save action differ. All visuals come from
 * `@life/ui`; the fields stack through `EditorStack`.
 */
export function TodoEditor({
  todo,
  lists,
  availableTags,
}: {
  /** Absent = create mode. */
  todo?: Todo;
  lists: List[];
  availableTags: TagOption[];
}) {
  const router = useRouter();
  const editing = todo != null;
  const [title, setTitle] = useState(todo?.title ?? '');
  const [note, setNote] = useState(todo?.note ?? '');
  const [dueDate, setDueDate] = useState(todo?.dueDate ?? '');
  const [listId, setListId] = useState<string | null>(todo?.listId ?? null);
  const [tagIds, setTagIds] = useState<number[]>(todo?.tagIds ?? []);
  // The user's explicit override; `undefined` = untouched (inherit). Not a hook:
  // the seed is derived from the current list so create mode follows its default.
  const [importantOverride, setImportantOverride] = useState<boolean | undefined>(undefined);
  const seedImportant = todo
    ? (todo.important ?? todo.effectiveImportant)
    : (lists.find((list) => list.id === listId)?.importantDefault ?? false);
  const important = importantOverride ?? seedImportant;

  const canSave = title.trim() !== '';

  function save() {
    if (!canSave) return;
    if (editing) {
      void updateTodoAction(
        todo.id,
        {
          title,
          note: note.trim() === '' ? null : note,
          dueDate: dueDate === '' ? null : dueDate,
          listId,
          tagIds,
          ...(importantOverride !== undefined ? { important: importantOverride } : {}),
        },
        todo.version,
      );
    } else {
      void createTodoAction({
        title,
        note: note.trim() === '' ? undefined : note,
        dueDate: dueDate === '' ? undefined : dueDate,
        listId: listId ?? undefined,
        tagIds,
        ...(importantOverride !== undefined ? { important: importantOverride } : {}),
      });
    }
    router.back();
  }

  return (
    <EditorChrome
      back={{ label: 'Back', onBack: () => router.back() }}
      title={editing ? 'Edit Todo' : 'New Todo'}
      actions={
        <IconButton label={editing ? 'Save todo' : 'Add todo'} onClick={save} disabled={!canSave}>
          <Check size={20} aria-hidden />
        </IconButton>
      }
      gap="lg"
      tagPicker={{
        tags: availableTags,
        selectedIds: tagIds,
        onToggle: (id) =>
          setTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
        label: 'Tags',
      }}
    >
      <Input
        type="text"
        aria-label="Todo title"
        placeholder="What needs doing?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus={!editing}
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
      </PillGroup>

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

      <Switch label="Important" checked={important} onCheckedChange={setImportantOverride} />
    </EditorChrome>
  );
}
