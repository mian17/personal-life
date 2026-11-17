import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AlertBanner,
  Button,
  Card,
  Field,
  Input,
  ManagerBlock,
  PageActions,
  Select,
  Stack,
  type SelectOption,
} from '@life/ui';
import { BellsSwitch } from '@/app/meditation/bells-switch';
import { fetchSettings, saveSettings, type SettingsRow } from '@/lib/meditation-api';
import { minuteUnit } from '@/lib/meditation-clock';
import { UNTIL_SESSION_ENDS, repeatFrom, repeatValue } from '@/lib/meditation-repeat';

export const dynamic = 'force-dynamic';

/** The one flag a failed write sends back, and the page it reopens with the banner up. */
const SAVE_FAILED_FLAG = 'save';
const SAVE_FAILED_HREF = `/meditation/settings?error=${SAVE_FAILED_FLAG}`;

/** The service's own `OFFSET_MAX_SEC`: 23:59:59, the last second of a day. */
const OFFSET_MAX_SEC = 23 * 60 * 60 + 59 * 60 + 59;
const SECONDS_PER_MINUTE = 60;

/** A run of whole minutes; the goal and the sitting length are both chosen over one. */
interface MinuteRange {
  from: number;
  to: number;
  step: number;
}

/** Fifteens on purpose (spec §1): a step of fifteen from a minimum of five would walk 5, 20, 35. */
const GOAL_RANGE: MinuteRange = { from: 15, to: 480, step: 15 };
const INTERVAL_RANGE: MinuteRange = { from: 10, to: 120, step: 10 };
const REPEAT_COUNTS = [1, 2, 3, 4, 5, 6];

/**
 * `/meditation/settings` — the daily goal, the planned sitting length, and the bells
 * (`SPEC-meditation-app` §1, assumption 6).
 *
 * Every value is the service's: the form opens on `GET /settings` and each save is one
 * `PUT /settings`, so switching devices shows the same goal with no browser storage
 * anywhere. One form carries all three groups, so a save never writes half a configuration.
 */
export default async function MeditationSettingsRoute({
  searchParams,
}: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
  const settings = await readSettings();
  if (settings === null) return <UnavailableScreen />;

  return (
    <ManagerBlock title="Settings" backHref="/meditation">
      <SettingsForm
        settings={settings}
        saveFailed={(await searchParams).error === SAVE_FAILED_FLAG}
      />
    </ManagerBlock>
  );
}

/** The whole configuration as one form: the goal, the sitting length, then the bells. */
function SettingsForm({
  settings,
  saveFailed,
}: Readonly<{ settings: SettingsRow; saveFailed: boolean }>) {
  return (
    <form action={saveSettingsAction}>
      <Card>
        <Stack gap="lg">
          {saveFailed && <AlertBanner>Could not save your settings. Try again.</AlertBanner>}
          <Field label="Daily goal" htmlFor="goalMinutes">
            <Select
              id="goalMinutes"
              name="goalMinutes"
              aria-label="Daily goal"
              defaultValue={String(settings.goalMinutes)}
              options={minuteRangeOptions(GOAL_RANGE)}
            />
          </Field>
          <Field label="Sitting length" htmlFor="plannedMinutes">
            <Select
              id="plannedMinutes"
              name="plannedMinutes"
              aria-label="Sitting length"
              defaultValue={String(settings.plannedMinutes)}
              options={minuteRangeOptions(GOAL_RANGE)}
            />
          </Field>
          <Field label="Interval bells">
            <BellsSwitch enabled={settings.bells.enabled} />
          </Field>
          <Field label="First bell at (seconds into the sitting)" htmlFor="offsetSec">
            <Input
              id="offsetSec"
              name="offsetSec"
              type="number"
              min={0}
              max={OFFSET_MAX_SEC}
              step={1}
              aria-label="First bell at (seconds into the sitting)"
              defaultValue={settings.bells.offsetSec}
            />
          </Field>
          <Field label="Bell interval" htmlFor="intervalSec">
            <Select
              id="intervalSec"
              name="intervalSec"
              aria-label="Bell interval"
              defaultValue={String(settings.bells.intervalSec)}
              options={intervalOptions()}
            />
          </Field>
          <Field label="Rings" htmlFor="repeat">
            <Select
              id="repeat"
              name="repeat"
              aria-label="Rings"
              defaultValue={repeatValue(settings.bells.repeat)}
              options={repeatOptions()}
            />
          </Field>
        </Stack>
      </Card>
      <PageActions>
        <Button type="submit">Save settings</Button>
      </PageActions>
    </form>
  );
}

/**
 * Write the submitted configuration; a refused or unreachable service reopens the page
 * flagged rather than leaving the owner believing a value was stored.
 */
async function saveSettingsAction(formData: FormData): Promise<void> {
  'use server';
  try {
    await saveSettings(settingsFrom(formData));
  } catch {
    redirect(SAVE_FAILED_HREF);
  }
  revalidatePath('/meditation/settings');
}

/** No stored configuration to edit, so the screen says so instead of inventing one. */
function UnavailableScreen() {
  return (
    <ManagerBlock title="Settings" backHref="/meditation">
      <AlertBanner>
        Settings are unavailable — meditation-service did not answer. Reload to try again.
      </AlertBanner>
    </ManagerBlock>
  );
}

/** The owner's configuration, or `null`: an unreachable service has nothing for a form to open on. */
async function readSettings(): Promise<SettingsRow | null> {
  try {
    return await fetchSettings();
  } catch {
    return null;
  }
}

/** Every minute of the range as its own option, so the select can only land on a grid value. */
function minuteRangeOptions(range: MinuteRange): SelectOption[] {
  const options: SelectOption[] = [];
  for (let minutes = range.from; minutes <= range.to; minutes += range.step) {
    options.push({ value: String(minutes), label: `${minutes} ${minuteUnit(minutes)}` });
  }
  return options;
}

/** The interval grid in seconds, which is what the service stores. */
function intervalOptions(): SelectOption[] {
  return minuteRangeOptions(INTERVAL_RANGE).map(({ value, label }) => ({
    value: String(Number(value) * SECONDS_PER_MINUTE),
    label,
  }));
}

/** One to six rings, then the endless choice that stores `repeat: null`. */
function repeatOptions(): SelectOption[] {
  const counted = REPEAT_COUNTS.map((count) => ({
    value: String(count),
    label: `${count} ${count === 1 ? 'ring' : 'rings'}`,
  }));
  return [...counted, { value: UNTIL_SESSION_ENDS, label: 'Until the session ends' }];
}

/** The submitted form as the settings row the service stores; the service clamps and validates. */
function settingsFrom(formData: FormData): SettingsRow {
  return {
    goalMinutes: Number(formData.get('goalMinutes')),
    plannedMinutes: Number(formData.get('plannedMinutes')),
    bells: {
      enabled: formData.get('bellsEnabled') === 'on',
      offsetSec: Number(formData.get('offsetSec')),
      intervalSec: Number(formData.get('intervalSec')),
      repeat: repeatFrom(formData.get('repeat')),
    },
  };
}
