'use client';

import { useState } from 'react';
import { Button, Section, Stack, Stepper, ValueRow } from '@life/ui';
import { minuteUnit, type BellChoice } from '@/lib/meditation-clock';
import { MEDITATION_LENGTH_STEP, readStoredLength, storeLength } from '@/lib/meditation-length';
import { IntervalBellsSheet, type SaveBells } from './interval-bells-sheet';

const SECONDS_PER_MINUTE = 60;

/** The bells sheet this row announces; the sheet mounts under this id. */
const INTERVAL_BELLS_SHEET_ID = 'interval-dialog';

export interface IdleScreenProps {
  /** The settings' planned length: the first-visit default this browser has no memory to override. */
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
 * The stepper moves *this sitting's* length and nothing else: the plan a first visit opens on is
 * edited at `/meditation/settings`. Once this browser has started a sitting, its own memory wins
 * over that plan — the plan is only the first-visit default, and the stepper opens where this
 * browser last left off.
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
  // Read inside the initialiser, never at module scope: a server render has no storage to read.
  const [minutes, setMinutes] = useState(() => clampMinutes(readStoredLength() ?? plannedMinutes));
  const [bellsSheetOpen, setBellsSheetOpen] = useState(false);

  /** The sitting starts on the length on screen; every step already wrote it down. */
  function startSitting(): void {
    onStart(minutes);
  }

  /** One step of the stepper: clamp it, remember it, and show it — a refresh opens on it. */
  function chooseLengthBy(step: number): void {
    const next = clampMinutes(minutes + step * MEDITATION_LENGTH_STEP.step);
    storeLength(next);
    setMinutes(next);
  }

  return (
    <Section aria-label="Session setup" gap="lg">
      <Stepper
        tone="card"
        size="display"
        readout={{ kind: 'text', value: String(minutes), unit: minuteUnit(minutes) }}
        decreaseLabel="Decrease duration by one minute"
        increaseLabel="Increase duration by one minute"
        onDecrease={() => chooseLengthBy(-1)}
        onIncrease={() => chooseLengthBy(1)}
        decreaseDisabled={minutes === MEDITATION_LENGTH_STEP.floor}
        increaseDisabled={minutes === MEDITATION_LENGTH_STEP.ceiling}
      />
      <Stack gap="md">
        <ValueRow label="Duration" value={`${minutes} min`} />
        <ValueRow
          label="Interval bells"
          value={intervalBellsLabel(bells)}
          onClick={() => setBellsSheetOpen(true)}
          popup="dialog"
          controls={INTERVAL_BELLS_SHEET_ID}
        />
        <ValueRow label="Ending bell" value="Gong" />
      </Stack>
      <Button size="hero" onClick={() => startSitting()}>
        Start
      </Button>
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

/** The length inside the stepper's range, on the minute it is already on: a stored 15 stays 15. */
function clampMinutes(minutes: number): number {
  return Math.min(
    Math.max(Math.round(minutes), MEDITATION_LENGTH_STEP.floor),
    MEDITATION_LENGTH_STEP.ceiling,
  );
}

/** The interval row's words: the schedule the settings hold, or `Off` when it rings none. */
function intervalBellsLabel(bells: BellChoice): string {
  if (!bells.enabled) return 'Off';
  const minutes = Math.round(bells.intervalSec / SECONDS_PER_MINUTE);
  return `Every ${minutes} min`;
}
