import { readPrefNumber } from '@life/app-kit';
import { Button, Input, SettingsBlock, SettingsRow, SettingsShell } from '@life/ui';
import { DEFAULT_DURATIONS, MINUTES_RANGE, type Durations } from '@life/pomodoro';
import { listGoals } from '@/lib/focus-api';
import { resolveGoal } from '@/lib/stats-buckets';
import { getToday } from '@/lib/today';
import { setPomodoroDurations, setPomodoroGoal } from '../actions';
import { submitFeedbackAction } from '../../feedback-actions';

export const dynamic = 'force-dynamic';

/** The form field names the server action reads back, in the order the owner reads them. */
const DURATION_FIELDS = [
  { field: 'focus', label: 'Focus' },
  { field: 'short', label: 'Short break' },
  { field: 'long', label: 'Long break' },
] as const;

/**
 * Thin mount: the inputs open on the stored minutes, the server action owns the write.
 *
 * The shell draws the shared Appearance, Comfort, Support and closing line; this page adds the
 * timer's two groups between Comfort and Support. The timer's toolbar keeps its own feedback
 * icon entry, so the Support row is the same double entry the other apps already have.
 */
export default async function PomodoroSettingsRoute() {
  const [durations, dailyGoal] = await Promise.all([readDurations(), readDailyGoal()]);

  return (
    <SettingsShell
      title="Settings"
      backHref="/pomodoro"
      app="pomodoro"
      onSubmit={submitFeedbackAction}
    >
      <form action={setPomodoroGoal}>
        <SettingsBlock title="Focus">
          <SettingsRow
            label="Daily goal"
            description="Minutes across all blocks."
            control={
              <Input
                type="number"
                name="goal"
                min={MINUTES_RANGE.min}
                max={MINUTES_RANGE.max}
                aria-label="Daily goal"
                defaultValue={dailyGoal ?? undefined}
              />
            }
          />
          <Button type="submit">Save goal</Button>
        </SettingsBlock>
      </form>

      <form action={setPomodoroDurations}>
        <SettingsBlock title="Durations">
          {DURATION_FIELDS.map(({ field, label }) => (
            <SettingsRow
              key={field}
              label={label}
              description="Minutes"
              control={
                <Input
                  type="number"
                  name={field}
                  min={MINUTES_RANGE.min}
                  max={MINUTES_RANGE.max}
                  aria-label={label}
                  defaultValue={durations[field]}
                />
              }
            />
          ))}
          <Button type="submit">Save durations</Button>
        </SettingsBlock>
      </form>
    </SettingsShell>
  );
}

/** The same read the timer route does: an absent or malformed cookie falls back to 25 / 5 / 15. */
async function readDurations(): Promise<Durations> {
  const [focus, short, long] = await Promise.all([
    readPrefNumber('pomodoro_focus', DEFAULT_DURATIONS.focus),
    readPrefNumber('pomodoro_short', DEFAULT_DURATIONS.short),
    readPrefNumber('pomodoro_long', DEFAULT_DURATIONS.long),
  ]);
  return { focus, short, long };
}

/**
 * Today's goal exactly as the stats route measures today against it: the latest
 * goal row at or before today (`resolveGoal`), and `null` when the owner set
 * none, so the input opens blank instead of inventing a number.
 */
async function readDailyGoal(): Promise<number | null> {
  const [goals, today] = await Promise.all([listGoals(), getToday()]);
  return resolveGoal(goals, today);
}
