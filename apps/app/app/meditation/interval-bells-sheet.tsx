'use client';

import { useState } from 'react';
import {
  Button,
  Caption,
  ChoiceChips,
  Dialog,
  NumberField,
  Row,
  Section,
  Stack,
  Stepper,
  Switch,
  ValueRow,
  type ChoiceChipOption,
} from '@life/ui';
import {
  BELL_INTERVAL_STEP,
  OFFSET_MAX_SEC,
  OFFSET_PART_MAX,
  bellsFrom,
  describeSchedule,
  draftFrom,
  offsetFromParts,
  offsetParts,
  stepInterval,
  stepOffset,
  type BellsDraft,
} from '@/lib/meditation-bells';
import type { BellChoice } from '@/lib/meditation-clock';
import { repeatFrom, repeatValue } from '@/lib/meditation-repeat';

/**
 * The interval bells sheet (`SPEC-ui-meditation-primitives` §10, §14 C1–C6): the one editor of
 * `enabled`, `offsetSec`, `intervalSec` and `repeat`, opened from the idle screen's row.
 *
 * Every control writes to a draft copy; the service hears about it only on Save. That is the
 * preview's own `openDrawer`/`commitDraft` split (`preview/app.js:439-448`), and the reason
 * Cancel can discard: the draft is re-read from the saved bells on each open.
 */

/** The service's repeat choices (spec C3): ring until the sitting ends, or one to six bowls. */
const REPEAT_CHOICES = [null, 1, 2, 3, 4, 5, 6];

/** The chips as the design draws them: `∞` first, then `1` … `6`, each with its spoken name. */
const REPEAT_OPTIONS: ChoiceChipOption[] = REPEAT_CHOICES.map((repeat) => ({
  value: repeatValue(repeat),
  label: repeat === null ? '∞' : String(repeat),
  ariaLabel: repeatName(repeat),
}));

/** Persists the bells the sheet saved; the app hands its settings write in through it. */
export type SaveBells = (bells: BellChoice) => Promise<void>;

export interface IntervalBellsSheetProps {
  /** The id the Interval bells row announces through `aria-controls`. */
  id: string;
  open: boolean;
  /** The saved bells: the draft opens on these, and Cancel returns to them. */
  bells: BellChoice;
  /** The length the summary measures the schedule against — this sitting's, not the plan's. */
  sessionMinutes: number;
  /** The write Save hands the draft to. Omitted, no write is wired and Save stays inert. */
  onSave?: SaveBells;
  /** The sheet is leaving, by Cancel, Save or Escape alike. */
  onClose: () => void;
}

export function IntervalBellsSheet({
  id,
  open,
  bells,
  sessionMinutes,
  onSave,
  onClose,
}: Readonly<IntervalBellsSheetProps>) {
  const [draft, setDraft] = useBellsDraft(open, bells);

  async function save(): Promise<void> {
    if (onSave === undefined) return;
    try {
      await onSave(bellsFrom(draft));
    } catch {
      // Nothing was written, so the draft stays: the sheet is the only place the edits exist.
      return;
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sheet"
      title="Interval bells"
      description="A bowl at a steady interval while you sit."
      footer={
        <Button disabled={onSave === undefined} onClick={() => void save()}>
          Save
        </Button>
      }
    >
      {/* `Dialog` draws no id on its panel, so the row's `aria-controls` target is this marker. */}
      <div id={id} hidden />
      <ValueRow
        label="Interval bells"
        tone="sunken"
        control={
          <Switch
            label="Interval bells"
            checked={draft.enabled}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        }
      />
      {draft.enabled && (
        <ScheduleDetails draft={draft} sessionMinutes={sessionMinutes} onChange={setDraft} />
      )}
    </Dialog>
  );
}

interface ScheduleDetailsProps {
  draft: BellsDraft;
  sessionMinutes: number;
  onChange: (next: BellsDraft) => void;
}

/**
 * Groups 2 to 5, the whole block the switch owns: hidden together while the bells are off, which
 * is the preview's own `details.hidden` (`preview/app.js:404`) and what keeps the sheet's
 * collapsed shape to its header and the switch row.
 *
 * The block carries its own `--s2` rhythm, one step tighter than the sheet body's: the design nests
 * these four groups in one child of the body (`#interval-details`), so the wider step lands between
 * the switch row and this block, never between the groups themselves.
 */
function ScheduleDetails({ draft, sessionMinutes, onChange }: Readonly<ScheduleDetailsProps>) {
  return (
    <Stack gap="md">
      <StartAfterGroup
        offsetSec={draft.offsetSec}
        onChange={(offsetSec) => onChange({ ...draft, offsetSec })}
      />
      <EveryGroup
        intervalMin={draft.intervalMin}
        onChange={(intervalMin) => onChange({ ...draft, intervalMin })}
      />
      <RepeatGroup repeat={draft.repeat} onChange={(repeat) => onChange({ ...draft, repeat })} />
      <Caption size="meta" live>
        {describeSchedule(draft, sessionMinutes)}
      </Caption>
    </Stack>
  );
}

interface StartAfterGroupProps {
  offsetSec: number;
  onChange: (offsetSec: number) => void;
}

/** Group 2 — Start after: the three fields, and a ± pair that moves the whole offset a minute. */
function StartAfterGroup({ offsetSec, onChange }: Readonly<StartAfterGroupProps>) {
  const parts = offsetParts(offsetSec);

  return (
    <Section label="Start after" headingLevel="h3" labelTone="ink-3" margin={false}>
      <Stepper
        tone="bare"
        readout={{
          kind: 'control',
          children: (
            <Row gap="md" className="flex-1">
              <OffsetField
                label="Start offset hours"
                unit="h"
                max={OFFSET_PART_MAX.hours}
                value={parts.hours}
                onPart={(hours) => onChange(offsetFromParts({ ...parts, hours }))}
              />
              <OffsetField
                label="Start offset minutes"
                unit="m"
                max={OFFSET_PART_MAX.minutes}
                value={parts.minutes}
                onPart={(minutes) => onChange(offsetFromParts({ ...parts, minutes }))}
              />
              <OffsetField
                label="Start offset seconds"
                unit="s"
                max={OFFSET_PART_MAX.seconds}
                value={parts.seconds}
                onPart={(seconds) => onChange(offsetFromParts({ ...parts, seconds }))}
              />
            </Row>
          ),
        }}
        decreaseLabel="Decrease start offset by one minute"
        increaseLabel="Increase start offset by one minute"
        onDecrease={() => onChange(stepOffset(offsetSec, -1))}
        onIncrease={() => onChange(stepOffset(offsetSec, 1))}
        decreaseDisabled={offsetSec === 0}
        increaseDisabled={offsetSec === OFFSET_MAX_SEC}
      />
    </Section>
  );
}

interface OffsetFieldProps {
  label: string;
  unit: string;
  max: number;
  value: number;
  onPart: (next: number) => void;
}

/**
 * One of the three offset fields. It is bounded by its own unit and reports a whole part; an
 * emptied box is the field's zero, which is the reading `syncOffsetFromFields` gives it.
 */
function OffsetField({ label, unit, max, value, onPart }: Readonly<OffsetFieldProps>) {
  return (
    <NumberField
      label={label}
      unit={unit}
      min={0}
      max={max}
      value={value}
      onChange={(next) => onPart(next ?? 0)}
    />
  );
}

interface EveryGroupProps {
  intervalMin: number;
  onChange: (intervalMin: number) => void;
}

/** Group 3 — Every: the sunken bar's − / read-out / +, a whole ten minutes a press (spec C1). */
function EveryGroup({ intervalMin, onChange }: Readonly<EveryGroupProps>) {
  return (
    <Section label="Every" headingLevel="h3" labelTone="ink-3" margin={false}>
      <Stepper
        tone="row"
        readout={{ kind: 'text', value: `Every ${intervalMin} min` }}
        decreaseLabel="Decrease interval by one minute"
        increaseLabel="Increase interval by one minute"
        onDecrease={() => onChange(stepInterval(intervalMin, -1))}
        onIncrease={() => onChange(stepInterval(intervalMin, 1))}
        decreaseDisabled={intervalMin === BELL_INTERVAL_STEP.floor}
        increaseDisabled={intervalMin === BELL_INTERVAL_STEP.ceiling}
      />
    </Section>
  );
}

interface RepeatGroupProps {
  repeat: number | null;
  onChange: (repeat: number | null) => void;
}

/** Group 4 — Repeat: the service's seven choices, the endless one drawn as `∞`. */
function RepeatGroup({ repeat, onChange }: Readonly<RepeatGroupProps>) {
  return (
    <Section label="Repeat" headingLevel="h3" labelTone="ink-3" margin={false}>
      <ChoiceChips
        label="Repeat"
        options={REPEAT_OPTIONS}
        value={repeatValue(repeat)}
        onChange={(next) => onChange(repeatFrom(next))}
      />
    </Section>
  );
}

/**
 * The draft is the sheet's own copy of the saved bells, re-read from them whenever the sheet
 * opens — during that render, so the first frame of the entrance already shows the saved values
 * and Cancel is a discard rather than an undo.
 */
function useBellsDraft(open: boolean, bells: BellChoice): [BellsDraft, (next: BellsDraft) => void] {
  const [draft, setDraft] = useState<BellsDraft>(() => draftFrom(bells));
  const [openBefore, setOpenBefore] = useState(open);

  if (open !== openBefore) {
    setOpenBefore(open);
    if (open) setDraft(draftFrom(bells));
  }

  return [draft, setDraft];
}

/** The chip's spoken name: the endless choice says so, every counted one says its count. */
function repeatName(repeat: number | null): string {
  return repeat === null ? 'Repeat: unlimited' : `Repeat: ${repeat}×`;
}
