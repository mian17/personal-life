import { readPrefNumber } from '@life/app-kit';
import {
  Button,
  Input,
  ManagerBlock,
  Pill,
  SettingsBlock,
  SettingsRow,
  ThemeToggle,
} from '@life/ui';
import { DEFAULT_DURATIONS, MINUTES_RANGE, type Durations } from '@life/pomodoro';
import { listGoals } from '@/lib/focus-api';
import { resolveGoal } from '@/lib/stats-buckets';
import { getToday } from '@/lib/today';
import { setPomodoroDurations, setPomodoroGoal } from '../actions';

export const dynamic = 'force-dynamic';

/** The form field names the server action reads back, in the order the owner reads them. */
const DURATION_FIELDS = [
  { field: 'focus', label: 'Focus' },
  { field: 'short', label: 'Short break' },
  { field: 'long', label: 'Long break' },
] as const;

/**
 * §8's `.row__meta` as a standalone line: no primitive renders static body copy
 * (a `StatusText` is a live region and a `SettingsRow` needs a control), so the
 * footer line is a structural `<p>` carrying the meta tier's token classes only.
 */
const footerStyles = 'mt-[var(--s6)] text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)]';

/**
 * Thin mount: the inputs open on the stored minutes, the server action owns the write.
 *
 * The groups follow the reference's settings screen order (Appearance, Comfort,
 * Focus, Support). The theme control is the one the screen already had; the
 * reference's "Send feedback" row is deliberately absent — this screen has no
 * feedback entry point of its own (the timer's toolbar owns it), so drawing it
 * would add behaviour the restyle must not add.
 */
export default async function PomodoroSettingsRoute() {
  const [durations, dailyGoal] = await Promise.all([readDurations(), readDailyGoal()]);

  return (
    <ManagerBlock title="Settings" backHref="/pomodoro">
      <SettingsBlock title="Appearance">
        <SettingsRow label="Theme" description="System, light, or dark." control={<ThemeToggle inGroup />} />
      </SettingsBlock>

      <SettingsBlock title="Comfort">
        <SettingsRow
          label="Reduce motion"
          description="Follows system setting."
          control={<Pill>System</Pill>}
        />
      </SettingsBlock>

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

      <p className={footerStyles}>Personal Life · prototype</p>
    </ManagerBlock>
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
