import { readPrefNumber } from '@life/app-kit';
import { Button, Input, ManagerBlock, SettingsBlock, SettingsRow, ThemeToggle } from '@life/ui';
import { DEFAULT_DURATIONS, MINUTES_RANGE, type Durations } from '@life/pomodoro';
import { setPomodoroDurations } from '../actions';

export const dynamic = 'force-dynamic';

/** The form field names the server action reads back, in the order the owner reads them. */
const DURATION_FIELDS = [
  { field: 'focus', label: 'Focus' },
  { field: 'short', label: 'Short break' },
  { field: 'long', label: 'Long break' },
] as const;

/** Thin mount: the inputs open on the stored minutes, the server action owns the write. */
export default async function PomodoroSettingsRoute() {
  const durations = await readDurations();

  return (
    <ManagerBlock title="Settings" backHref="/pomodoro">
      <SettingsBlock title="Appearance">
        <SettingsRow label="Theme" description="System, light, or dark." control={<ThemeToggle />} />
      </SettingsBlock>

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
