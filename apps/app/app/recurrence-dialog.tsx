'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, Pill, PillGroup, Select, WEEKDAY_SHORT, isoWeekday } from '@life/ui';

export interface RecurrenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dueDate: string;
  value: number[];
  onConfirm: (days: number[]) => void;
}

/**
 * The custom-repeat builder: a v1 weekly rule on a chosen weekday set, composed
 * entirely from `@life/ui`. The committed repeat lives in the editor's state;
 * this component owns only the in-progress draft, reseeded each time it opens
 * (C3): the committed days when non-empty, else the due date's ISO weekday,
 * else nothing. Confirm is disabled until the draft holds a day.
 *
 * The panel is the bottom sheet — the revised system's only overlay shape (§8
 * draws every modal as `.sheet`): grab handle, title, fields, foot.
 */
export function RecurrenceDialog({
  open,
  onOpenChange,
  dueDate,
  value,
  onConfirm,
}: Readonly<RecurrenceDialogProps>) {
  const [draft, setDraft] = useState<number[]>(value);

  useEffect(() => {
    if (!open) return;
    const due = isoWeekday(dueDate);
    const seed = due !== 0 ? [due] : [];
    setDraft(value.length > 0 ? value : seed);
  }, [open, value, dueDate]);

  function toggle(day: number) {
    setDraft((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Custom repeat"
      size="sheet"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={draft.length === 0}
            onClick={() => {
              onConfirm(draft);
              onOpenChange(false);
            }}
          >
            Confirm
          </Button>
        </>
      }
    >
      <Select
        aria-label="Frequency"
        value="weekly"
        onChange={() => {}}
        options={[{ value: 'weekly', label: 'Weekly' }]}
      />
      <PillGroup label="Days">
        {WEEKDAY_SHORT.map((label, index) => {
          const day = index + 1;
          const active = draft.includes(day);
          return (
            <Pill
              key={day}
              as="button"
              size="filter"
              active={active}
              aria-pressed={active}
              onClick={() => toggle(day)}
            >
              {label}
            </Pill>
          );
        })}
      </PillGroup>
    </Dialog>
  );
}
