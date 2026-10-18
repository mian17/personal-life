'use client';

import { useReducer, useState } from 'react';
import { Input, SettingsRow } from '@life/ui';
import { MINUTES_RANGE, type Durations } from './timer';

export type DurationFieldName = keyof Durations;

const DURATION_FIELDS: { name: DurationFieldName; label: string }[] = [
  { name: 'focus', label: 'Focus' },
  { name: 'short', label: 'Short break' },
  { name: 'long', label: 'Long break' },
];

export interface DurationFieldsProps {
  durations: Durations;
  onDurationsChange(next: Durations): void;
}

/** One minute field per phase; an accepted value reports itself upward with the rest unchanged. */
export function DurationFields({ durations, onDurationsChange }: DurationFieldsProps) {
  function acceptMinutes(name: DurationFieldName, minutes: number) {
    onDurationsChange({ ...durations, [name]: minutes });
  }

  return (
    <>
      {DURATION_FIELDS.map(({ name, label }) => (
        <MinutesField
          key={name}
          name={name}
          label={label}
          minutes={durations[name]}
          onMinutesAccepted={acceptMinutes}
        />
      ))}
    </>
  );
}

interface MinutesFieldProps {
  name: DurationFieldName;
  label: string;
  /** The starting value; the field owns the number from then on (the MatrixSwitch pattern). */
  minutes: number;
  onMinutesAccepted(name: DurationFieldName, minutes: number): void;
}

function MinutesField({ name, label, minutes, onMinutesAccepted }: MinutesFieldProps) {
  const [typedMinutes, setTypedMinutes] = useState(minutes);
  const [, rerender] = useReducer(nextRenderCount, 0);

  function changeMinutes(raw: string) {
    const accepted = minutesWithinRange(raw);
    if (accepted === null) return rerender();

    setTypedMinutes(accepted);
    onMinutesAccepted(name, accepted);
  }

  return (
    <SettingsRow
      label={label}
      description="Minutes"
      control={
        <Input
          type="number"
          min={MINUTES_RANGE.min}
          max={MINUTES_RANGE.max}
          aria-label={label}
          value={typedMinutes}
          onChange={(event) => changeMinutes(event.target.value)}
        />
      }
    />
  );
}

function nextRenderCount(renderCount: number): number {
  return renderCount + 1;
}

/** A rejected value re-renders the last accepted minutes, because the input is controlled. */
function minutesWithinRange(raw: string): number | null {
  const minutes = Number(raw);
  if (!Number.isInteger(minutes)) return null;
  if (minutes < MINUTES_RANGE.min || minutes > MINUTES_RANGE.max) return null;
  return minutes;
}
