'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TODO_REPEATS, type List, type Todo, type TodoRepeat } from '@life/shared';
import {
  EditorChrome,
  IconButton,
  Input,
  PillGroup,
  Select,
  Switch,
  Textarea,
  dueDay,
  localTimePart,
  type TagOption,
} from '@life/ui';
import { Check } from 'lucide-react';
import { createTodoAction, updateTodoAction } from './todo-actions';
import { repeatLabel } from '@/lib/todo-repeat-label';

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
  // The date input is date-only; a timed due's local day comes from the single
  // `@life/ui` owner `dueDay`, not the raw instant (no app-side parsing).
  const [dueDate, setDueDate] = useState(dueDay(todo?.dueDate));
  // Seeded from the single `@life/ui` owner of the timed local time part;
  // date-only/missing → '' (no app-side `new Date(...)`, lesson 0016).
  const [dueTime, setDueTime] = useState(localTimePart(todo?.dueDate));
  const [repeat, setRepeat] = useState<TodoRepeat | null>(todo?.repeat ?? null);
  const [listId, setListId] = useState<string | null>(todo?.listId ?? null);
  const [tagIds, setTagIds] = useState<number[]>(todo?.tagIds ?? []);
  const [saving, setSaving] = useState(false);
  // The user's explicit override; `undefined` = untouched (inherit). Not a hook:
  // the seed is derived from the current list so create mode follows its default.
  const [importantOverride, setImportantOverride] = useState<boolean | undefined>(undefined);
  const seedImportant = todo
    ? (todo.important ?? todo.effectiveImportant)
    : (lists.find((list) => list.id === listId)?.importantDefault ?? false);
  const important = importantOverride ?? seedImportant;

  // A repeat requires a due date, so the field only appears once one is set —
  // the invariant can't be violated. With no repeat field reachable, a title is
  // enough to save.
  const canSave = title.trim() !== '';

  // Clearing the due date drops the fields that depend on it (Time, Repeat) so no
  // orphaned time/repeat can survive or be saved; they reappear when a date is set.
  function onDueDateChange(value: string) {
    setDueDate(value);
    if (value === '') {
      setDueTime('');
      setRepeat(null);
    }
  }

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    // Join the calendar day and optional time; no date ⇒ date-only stays null.
    const due = dueDate === '' ? null : dueTime === '' ? dueDate : `${dueDate}T${dueTime}`;
    try {
      // Await the action's revalidatePath before navigating: the RSC cache must
      // reflect the write before `router.back()` renders the List/Matrix, or they
      // show stale rows. A failed write stays on the editor so the user can retry;
      // the `saving` guard prevents a double write from a second tap.
      if (editing) {
        await updateTodoAction(
          todo.id,
          {
            title,
            note: note.trim() === '' ? null : note,
            dueDate: due,
            repeat,
            listId,
            tagIds,
            ...(importantOverride !== undefined ? { important: importantOverride } : {}),
          },
          todo.version,
        );
      } else {
        await createTodoAction({
          title,
          note: note.trim() === '' ? undefined : note,
          dueDate: due ?? undefined,
          repeat,
          listId: listId ?? undefined,
          tagIds,
          ...(importantOverride !== undefined ? { important: importantOverride } : {}),
        });
      }
      router.back();
    } catch {
      setSaving(false);
    }
  }

  return (
    <EditorChrome
      back={{ label: 'Back', onBack: () => router.back() }}
      title={editing ? 'Edit Todo' : 'New Todo'}
      actions={
        <IconButton
          label={editing ? 'Save todo' : 'Add todo'}
          onClick={save}
          disabled={!canSave || saving}
        >
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
          onChange={(e) => onDueDateChange(e.target.value)}
        />
      </PillGroup>

      {dueDate !== '' && (
        <PillGroup label="Time" aria-label="Time">
          <Input
            type="time"
            aria-label="Due time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
          />
        </PillGroup>
      )}

      {dueDate !== '' && (
        <PillGroup label="Repeat" aria-label="Repeat">
          <Select
            aria-label="Repeat"
            value={repeat ?? ''}
            onChange={(e) => setRepeat((e.target.value || null) as TodoRepeat | null)}
            options={[
              { value: '', label: 'None' },
              ...TODO_REPEATS.map((value) => ({ value, label: repeatLabel(value, dueDate)! })),
            ]}
          />
        </PillGroup>
      )}

      {lists.length > 0 && (
        <PillGroup label="List" aria-label="List">
          <Select
            aria-label="List"
            value={listId ?? ''}
            onChange={(e) => setListId(e.target.value || null)}
            options={[
              { value: '', label: 'No list' },
              ...lists.map((list) => ({ value: list.id, label: list.name })),
            ]}
          />
        </PillGroup>
      )}

      <PillGroup label="Important" aria-label="Important">
        <Switch label="Important" checked={important} onCheckedChange={setImportantOverride} />
      </PillGroup>
    </EditorChrome>
  );
}
