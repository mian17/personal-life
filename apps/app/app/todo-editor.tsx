'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  TODO_REPEATS,
  type CreateTodoInput,
  type List,
  type Todo,
  type TodoRepeat,
  type UpdateTodoInput,
} from '@life/shared';
import {
  Button,
  EditorChrome,
  Field,
  IconButton,
  Input,
  Menu,
  MenuItem,
  Select,
  Switch,
  Textarea,
  dueDay,
  localTimePart,
  type TagOption,
} from '@life/ui';
import { Check, MoreHorizontal } from 'lucide-react';
import { createTodoAction, deleteTodoAction, updateTodoAction } from './todo-actions';
import { RecurrenceDialog } from './recurrence-dialog';
import { repeatLabel } from '@/lib/todo-repeat-label';

/** Join the calendar day and optional time; no date ⇒ date-only stays null. */
function joinDue(dueDate: string, dueTime: string): string | null {
  if (dueDate === '') return null;
  return dueTime === '' ? dueDate : `${dueDate}T${dueTime}`;
}

/** The note is cleared (`null`) rather than sent empty. */
function noteOrNull(note: string): string | null {
  return note.trim() === '' ? null : note;
}

/** Only a custom repeat carries weekdays. */
function customDays(repeat: TodoRepeat | null, repeatDays: number[]): number[] | undefined {
  return repeat === 'custom' ? repeatDays : undefined;
}

/**
 * The todo editor screen, shared by create (`/todos/new`) and edit
 * (`/todos/[id]/edit`). One component, two modes — the same fields and layout;
 * only the initial values, the save action and the actions menu differ. All
 * visuals come from `@life/ui`; the fields stack through `EditorStack`, each a
 * `Field` caption over its control.
 */
export function TodoEditor({
  todo,
  lists,
  availableTags,
}: Readonly<{
  /** Absent = create mode. */
  todo?: Todo;
  lists: List[];
  availableTags: TagOption[];
}>) {
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
  const [repeatDays, setRepeatDays] = useState<number[]>(todo?.repeatDays ?? []);
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);
  const [listId, setListId] = useState<string | null>(todo?.listId ?? null);
  const [tagIds, setTagIds] = useState<number[]>(todo?.tagIds ?? []);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
      setRepeatDays([]);
      setRecurrenceOpen(false);
    }
  }

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    // Await the action's revalidatePath before navigating: the RSC cache must
    // reflect the write before `router.back()` renders the List/Matrix, or they
    // show stale rows. A failed write stays on the editor so the user can retry;
    // the `saving` guard prevents a double write from a second tap.
    try {
      if (editing) await updateTodoAction(todo.id, updateInput(), todo.version);
      else await createTodoAction(createInput());
      router.back();
    } catch {
      setSaving(false);
    }
  }

  /**
   * Moves the todo to the trash and leaves the screen. Deleting is immediate —
   * the trash is the recovery path — and no confirmation stands between the press
   * and the write, matching the note editor and the list row's trash control.
   */
  async function moveToTrash() {
    if (todo == null) return;
    setMenuOpen(false);
    await deleteTodoAction(todo.id);
    router.back();
  }

  /** The edit PATCH: only a touched override is sent, so an untouched one inherits. */
  function updateInput(): UpdateTodoInput {
    return {
      title,
      note: noteOrNull(note),
      dueDate: joinDue(dueDate, dueTime),
      repeat,
      repeatDays: customDays(repeat, repeatDays),
      listId,
      tagIds,
      ...(importantOverride !== undefined ? { important: importantOverride } : {}),
    };
  }

  /** The create POST: absent fields are omitted so the service defaults apply. */
  function createInput(): CreateTodoInput {
    const due = joinDue(dueDate, dueTime);
    return {
      title,
      note: noteOrNull(note) ?? undefined,
      dueDate: due ?? undefined,
      repeat,
      repeatDays: customDays(repeat, repeatDays),
      listId: listId ?? undefined,
      tagIds,
      ...(importantOverride !== undefined ? { important: importantOverride } : {}),
    };
  }

  return (
    <EditorChrome
      back={{ label: 'Back', onBack: () => router.back(), variant: 'framed' }}
      title={editing ? 'Edit Todo' : 'New Todo'}
      actions={
        <>
          <IconButton
            label={editing ? 'Save todo' : 'Add todo'}
            variant="framed"
            onClick={save}
            disabled={!canSave || saving}
          >
            <Check size={20} aria-hidden />
          </IconButton>
          {/* Create mode has no row to remove, so the menu only exists while editing. */}
          {editing && (
            <Menu
              label="Task actions"
              open={menuOpen}
              onOpenChange={setMenuOpen}
              triggerVariant="framed"
              triggerIcon={<MoreHorizontal size={16} aria-hidden />}
            >
              <MenuItem>
                <Button variant="danger" size="bare" disabled={saving} onClick={() => void moveToTrash()}>
                  Move to trash
                </Button>
              </MenuItem>
            </Menu>
          )}
        </>
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
      <Field label="Title">
        <Input
          type="text"
          aria-label="Todo title"
          placeholder="What needs doing?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus={!editing}
        />
      </Field>

      <Field label="Note">
        <Textarea
          aria-label="Todo note"
          placeholder="Details (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <Field label="Due date">
        <Input
          type="date"
          aria-label="Due date"
          value={dueDate}
          onChange={(e) => onDueDateChange(e.target.value)}
        />
      </Field>

      {dueDate !== '' && (
        <Field label="Time">
          <Input
            type="time"
            aria-label="Due time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
          />
        </Field>
      )}

      {dueDate !== '' && (
        <Field label="Repeat">
          <Select
            aria-label="Repeat"
            value={repeat ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              if (value === 'custom') {
                setRecurrenceOpen(true);
                return;
              }
              setRepeat((value || null) as TodoRepeat | null);
              setRepeatDays([]);
            }}
            options={[
              { value: '', label: 'None' },
              ...TODO_REPEATS.filter((value) => value !== 'custom').map((value) => ({
                value,
                label: repeatLabel(value, dueDate)!,
              })),
              {
                value: 'custom',
                label: repeat === 'custom' ? repeatLabel('custom', dueDate, repeatDays)! : 'Custom…',
              },
            ]}
          />
        </Field>
      )}

      <RecurrenceDialog
        open={recurrenceOpen}
        onOpenChange={setRecurrenceOpen}
        dueDate={dueDate}
        value={repeatDays}
        onConfirm={(days) => {
          setRepeat('custom');
          setRepeatDays(days);
        }}
      />

      {lists.length > 0 && (
        <Field label="List">
          <Select
            aria-label="List"
            value={listId ?? ''}
            onChange={(e) => setListId(e.target.value || null)}
            options={[
              { value: '', label: 'No list' },
              ...lists.map((list) => ({ value: list.id, label: list.name })),
            ]}
          />
        </Field>
      )}

      <Field label="Important">
        <Switch label="Important" checked={important} onCheckedChange={setImportantOverride} />
      </Field>
    </EditorChrome>
  );
}
