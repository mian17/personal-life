'use client';

import { useState } from 'react';
import { Button, Section, Stack, Stepper, ValueRow } from '@life/ui';
import { MEDITATION_MINUTE_STEP } from '@/lib/meditation-bells';
import { minuteUnit, type BellChoice } from '@/lib/meditation-clock';
import { IntervalBellsSheet, type SaveBells } from './interval-bells-sheet';

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
 * The stepper moves *this sitting's* length and nothing else: the stored plan is edited at
 * `/meditation/settings`. What it does remember is the length it started, so the next visit opens
 * where the last one left off (`rememberSittingLength`, fired by the start it precedes).
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
    <Section aria-label="Session setup" gap="lg">
      <Stepper
        tone="card"
        size="display"
        readout={{ kind: 'text', value: String(minutes), unit: minuteUnit(minutes) }}
        decreaseLabel="Decrease duration by one minute"
        increaseLabel="Increase duration by one minute"
        onDecrease={() =>
          setMinutes((current) => clampMinutes(current - MEDITATION_MINUTE_STEP.step))
        }
        onIncrease={() =>
          setMinutes((current) => clampMinutes(current + MEDITATION_MINUTE_STEP.step))
        }
        decreaseDisabled={minutes === MEDITATION_MINUTE_STEP.floor}
        increaseDisabled={minutes === MEDITATION_MINUTE_STEP.ceiling}
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
      <Button size="hero" onClick={() => onStart(minutes)}>
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

/**
 * The length inside the stepper's range, on the minute it is already on: the stored plan may sit
 * on a five-minute value such as 15, and snapping it onto the ten-minute grid would quietly
 * rewrite the owner's saved choice. Stepping by ten from 15 lands on 5 or 25, which the service
 * stores as they are.
 */
function clampMinutes(minutes: number): number {
  return Math.min(
    Math.max(Math.round(minutes), MEDITATION_MINUTE_STEP.floor),
    MEDITATION_MINUTE_STEP.ceiling,
  );
}

/** The interval row's words: the schedule the settings hold, or `Off` when it rings none. */
function intervalBellsLabel(bells: BellChoice): string {
  if (!bells.enabled) return 'Off';
  const minutes = Math.round(bells.intervalSec / SECONDS_PER_MINUTE);
  return `Every ${minutes} min`;
}
