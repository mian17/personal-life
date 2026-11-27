import { navActions } from '@life/app-kit';
import { ListShell } from '@life/ui';
import {
  fetchDayDone,
  fetchSettings,
  type DayDoneRow,
  type SettingsRow,
} from '@/lib/meditation-api';
import { goalSubtitleLine } from '@/lib/meditation-clock';
import { getToday } from '@/lib/today';
import { saveIntervalBells } from './actions';
import { SittingTimer } from './sitting-timer';

export const dynamic = 'force-dynamic';

/**
 * Where a fresh owner starts when the service cannot answer: the service's own defaults are a
 * fifteen-minute goal and planned length with the bells off, and an unreachable service must not
 * leave the screen with no start control at all.
 */
const FALLBACK_SETTINGS: SettingsRow = {
  goalMinutes: 15,
  plannedMinutes: 15,
  bells: { enabled: false, offsetSec: 0, intervalSec: 600, repeat: null },
};

/**
 * `/meditation`'s idle screen (`SPEC-meditation-app` §1): the sitting's length, how the bells
 * shape it, and the start control.
 *
 * The day is the client's own local day, resolved by the shared `getToday()` owner. The daily goal
 * lives in the subtitle alone, and only as `GET /sessions/days` reported it: a failed read leaves
 * the line off rather than inventing minutes for it.
 */
export default async function MeditationRoute() {
  const today = await getToday();
  const settings = await readSettings();
  const day = await readDay(today);

  return (
    <ListShell
      title="Meditation"
      subtitle={day === null ? undefined : goalSubtitleLine(day)}
      navTrailing={navActions('meditation')}
      body={
        <SittingTimer
          plannedMinutes={settings.plannedMinutes}
          bells={settings.bells}
          onSaveBells={saveIntervalBells}
        />
      }
    />
  );
}

/** The owner's settings, or the service's own defaults when the service cannot answer. */
async function readSettings(): Promise<SettingsRow> {
  try {
    return await fetchSettings();
  } catch {
    return FALLBACK_SETTINGS;
  }
}

/** Today measured against the goal, or `null`: a failed read is a missing read-out, not a wrong one. */
async function readDay(today: string): Promise<DayDoneRow | null> {
  try {
    const [day] = await fetchDayDone(today, today);
    return day ?? null;
  } catch {
    return null;
  }
}
