'use client';

import { useState } from 'react';
import { Button, Section, Stack, Stepper, ValueRow } from '@life/ui';
import { minuteUnit, type BellChoice } from '@/lib/meditation-clock';
import { IntervalBellsSheet, type SaveBells } from './interval-bells-sheet';

/** The stepper's range (spec C4): one minute to two hours, one minute at a time. */
const MINUTES_FLOOR = 1;
const MINUTES_CEILING = 120;
const MINUTES_STEP = 1;

const SECONDS_PER_MINUTE = 60;

/** The bells sheet this row announces; the sheet mounts under this id. */
const INTERVAL_BELLS_SHEET_ID = 'interval-dialog';

export interface IdleScreenProps {
  /** The settings' planned length: where the stepper opens, clamped into range. */
  plannedMinutes: number;
  bells: BellChoice;
  /** The chosen length, which becomes this sitting's `plannedMinutes`. */
  onStart: (minutes: number) => void;
  /**
   * The bells sheet's write — the settings `PUT` this screen's row reads back. The screen above
   * hands it in, because the service client is server-only and this screen is a client component.
   */
  onSaveBells?: SaveBells;
}

/**
 * The idle screen, in the design's order: the length as one large stepper, the three facts that
 * shape the sitting, and the start control.
 *
 * The stepper moves *this sitting's* length and nothing else. Spec C4: the service snaps a
 * written plan onto its fifteen-minute grid, so a one-minute value would be displayed here as a
 * number the server never stores. The stored plan is edited at `/meditation/settings`.
 *
 * The bells row's value is the saved bells, never the sheet's draft: the draft lives and dies
 * inside `IntervalBellsSheet`, so closing the sheet without Save leaves the row as it was.
 */
export function IdleScreen({
  plannedMinutes,
  bells,
  onStart,
  onSaveBells,
}: Readonly<IdleScreenProps>) {
  const [minutes, setMinutes] = useState(() => clampMinutes(plannedMinutes));
  const [bellsSheetOpen, setBellsSheetOpen] = useState(false);

  return (
    <Section aria-label="Session setup">
      <Stack gap="md">
        <Stepper
          tone="card"
          size="display"
          readout={{ kind: 'text', value: String(minutes), unit: minuteUnit(minutes) }}
          decreaseLabel="Decrease duration by one minute"
          increaseLabel="Increase duration by one minute"
          onDecrease={() => setMinutes((current) => clampMinutes(current - MINUTES_STEP))}
          onIncrease={() => setMinutes((current) => clampMinutes(current + MINUTES_STEP))}
          decreaseDisabled={minutes === MINUTES_FLOOR}
          increaseDisabled={minutes === MINUTES_CEILING}
        />
        <ValueRow label="Duration" value={`${minutes} min`} />
        <ValueRow
          label="Interval bells"
          value={intervalBellsLabel(bells)}
          onClick={() => setBellsSheetOpen(true)}
          popup="dialog"
          controls={INTERVAL_BELLS_SHEET_ID}
        />
        <ValueRow label="Ending bell" value="Gong" />
        <Button size="hero" onClick={() => onStart(minutes)}>
          Start
        </Button>
      </Stack>
      <IntervalBellsSheet
        id={INTERVAL_BELLS_SHEET_ID}
        open={bellsSheetOpen}
        bells={bells}
        sessionMinutes={minutes}
        onSave={onSaveBells}
        onClose={() => setBellsSheetOpen(false)}
      />
    </Section>
  );
}

/** A whole minute inside the design's range, whichever end a step pushes past. */
function clampMinutes(minutes: number): number {
  return Math.min(Math.max(Math.round(minutes), MINUTES_FLOOR), MINUTES_CEILING);
}

/** The interval row's words: the schedule the settings hold, or `Off` when it rings none. */
function intervalBellsLabel(bells: BellChoice): string {
  if (!bells.enabled) return 'Off';
  const minutes = Math.round(bells.intervalSec / SECONDS_PER_MINUTE);
  return `Every ${minutes} min`;
}
