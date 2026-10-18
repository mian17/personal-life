import type { Metadata } from 'next';
import { readPrefNumber } from '@life/app-kit';
import { PageTitle } from '@life/ui';
import { DEFAULT_DURATIONS, PomodoroPage, type Durations } from '@life/pomodoro';
import { setPomodoroDurations } from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Pomodoro' };

/** Thin mount: the durations come from the owner's cookies, the page owns everything visual. */
export default async function PomodoroRoute() {
  const durations = await readDurations();

  return (
    <>
      <PageTitle>Pomodoro</PageTitle>
      <PomodoroPage durations={durations} onDurationsChange={setPomodoroDurations} />
    </>
  );
}

/** An absent or malformed cookie falls back to 25 / 5 / 15 minutes (`readPrefNumber`'s rule). */
async function readDurations(): Promise<Durations> {
  const [focus, short, long] = await Promise.all([
    readPrefNumber('pomodoro_focus', DEFAULT_DURATIONS.focus),
    readPrefNumber('pomodoro_short', DEFAULT_DURATIONS.short),
    readPrefNumber('pomodoro_long', DEFAULT_DURATIONS.long),
  ]);
  return { focus, short, long };
}
