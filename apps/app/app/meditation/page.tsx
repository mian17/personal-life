import { navActions } from '@life/app-kit';
import { AlertBanner, Card, Facts, FactsRow, Kpi, ListShell, Stack } from '@life/ui';
import {
  fetchDayDone,
  fetchSettings,
  type DayDoneRow,
  type SettingsRow,
} from '@/lib/meditation-api';
import { goalProgressLine, minuteUnit } from '@/lib/meditation-clock';
import { getToday } from '@/lib/today';
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
 * `/meditation`'s idle screen (`SPEC-meditation-app` §1): today's progress toward the goal, the
 * start control for the planned length, and — once a sitting ends — what it recorded.
 *
 * The day is the client's own local day, resolved by the shared `getToday()` owner. The numbers
 * are the service's: `GET /sessions/days` measures today against the goal as it stands now, so
 * the screen repeats that answer and derives none of it.
 */
export default async function MeditationRoute() {
  const today = await getToday();
  const settings = await readSettings();
  const day = await readDay(today);

  return (
    <ListShell
      title="Meditation"
      subtitle={subtitleFor(settings)}
      navTrailing={navActions('meditation')}
      body={
        <SittingTimer
          plannedMinutes={settings.plannedMinutes}
          bells={settings.bells}
          idle={<TodayCard day={day} />}
        />
      }
    />
  );
}

/** Today's live minutes, the goal, and the done state, all as the service reported them. */
function TodayCard({ day }: Readonly<{ day: DayDoneRow | null }>) {
  if (day === null) {
    return (
      <AlertBanner>
        Today's progress is unavailable — meditation-service did not answer.
      </AlertBanner>
    );
  }

  return (
    <Card>
      <Stack gap="lg">
        <Kpi
          label="Done so far"
          value={day.liveMinutes}
          unit={`of ${day.goalMinutes} ${minuteUnit(day.goalMinutes)}`}
        />
        <Facts>
          <FactsRow label="Today" value={goalProgressLine(day)} />
          <FactsRow label="Done" value={day.done ? 'Yes' : 'Not yet'} />
        </Facts>
      </Stack>
    </Card>
  );
}

/**
 * The one quiet fact under the title: the sitting the start control will run, and how the bells
 * punctuate it. Derived from the settings row, so the header cannot disagree with the control.
 */
function subtitleFor({ plannedMinutes, goalMinutes }: SettingsRow): string {
  const plan = `${plannedMinutes} ${minuteUnit(plannedMinutes)}`;
  if (plannedMinutes >= goalMinutes) return `${plan} · reaches today's goal`;
  return `${plan} · ${goalMinutes} ${minuteUnit(goalMinutes)} goal`;
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
