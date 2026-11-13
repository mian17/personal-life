import { readPrefNumber } from '@life/app-kit';
import {
  Button,
  Input,
  SettingsBlock,
  SettingsRow,
  SettingsShell,
  Stack,
  StatusText,
} from '@life/ui';
import { DEFAULT_DURATIONS, MINUTES_RANGE, type Durations } from '@life/pomodoro';
import { listGoals, readGrantState } from '@/lib/focus-api';
import { resolveGoal } from '@/lib/stats-buckets';
import { getToday } from '@/lib/today';
import { FocusGrantToggle } from '../../focus-grant-toggle';
import { setPomodoroDurations, setPomodoroGoal } from '../actions';
import { submitFeedbackAction } from '../../feedback-actions';

export const dynamic = 'force-dynamic';

/** The form field names the server action reads back, in the order the owner reads them. */
const DURATION_FIELDS = [
  { field: 'focus', label: 'Focus' },
  { field: 'short', label: 'Short break' },
  { field: 'long', label: 'Long break' },
] as const;

/** The flag `setPomodoroGoal` sends back when it refuses a daily goal (`actions.ts`). */
const GOAL_REJECTED_FLAG = 'rejected';

/**
 * Thin mount: the inputs open on the stored minutes, the server action owns the write.
 *
 * The shell draws the shared Appearance, Comfort, Support and closing line; this page adds the
 * timer's two groups between Comfort and Support. The timer's toolbar keeps its own feedback
 * icon entry, so the Support row is the same double entry the other apps already have.
 *
 * The Todos row is the first-use enablement of the read grant (`SPEC-todo-origin`
 * assumption 12) — without it only an operator CLI could let Focus read the owner's
 * tasks. Its state is read here, at render, so the row shows what the service holds.
 */
export default async function PomodoroSettingsRoute({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ goal?: string }>;
}>) {
  const [durations, dailyGoal, grantState] = await Promise.all([
    readDurations(),
    readDailyGoal(),
    readGrantState(),
  ]);
  const goalRejected = (await searchParams).goal === GOAL_REJECTED_FLAG;

  return (
    <SettingsShell
      title="Settings"
      backHref="/pomodoro"
      app="pomodoro"
      onSubmit={submitFeedbackAction}
    >
      <form action={setPomodoroGoal}>
        <SettingsBlock
          title="Focus"
          footer={
            <Stack gap="md">
              {goalRejected && (
                <StatusText className="text-danger!">
                  {`A daily goal is ${MINUTES_RANGE.min} to ${MINUTES_RANGE.max} whole minutes.`}
                </StatusText>
              )}
              <Button type="submit">Save goal</Button>
            </Stack>
          }
        >
          <SettingsRow
            label="Daily goal"
            description="Total focus minutes for a whole day."
            control={
              <Input
                type="number"
                name="goal"
                min={MINUTES_RANGE.min}
                max={MINUTES_RANGE.max}
                step={1}
                aria-label="Daily goal"
                defaultValue={dailyGoal ?? undefined}
              />
            }
          />
        </SettingsBlock>
      </form>

      <form action={setPomodoroDurations}>
        <SettingsBlock title="Durations" footer={<Button type="submit">Save durations</Button>}>
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
        </SettingsBlock>
      </form>

      <SettingsBlock title="Todos">
        <SettingsRow
          label="Todos"
          description="Read your open todos so you can pick one to focus on. Focus never creates or ticks a todo, and access cannot be revoked."
          control={<FocusGrantToggle state={grantState} />}
        />
      </SettingsBlock>
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
