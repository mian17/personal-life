import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AlertBanner,
  Button,
  Select,
  SettingsBlock,
  SettingsRow,
  Stack,
  type SelectOption,
} from '@life/ui';
import { minuteUnit } from '@/lib/meditation-clock';
import { fetchSettings, saveSettings } from '@/lib/meditation-api';

/** The one flag a failed write sends back, and the page it reopens with the banner up. */
export const SAVE_FAILED_FLAG = 'save';
const SAVE_FAILED_HREF = `/meditation/settings?error=${SAVE_FAILED_FLAG}`;

/** Fifteens on purpose (spec §1): a step of fifteen from a minimum of five would walk 5, 20, 35. */
const GOAL_RANGE = { from: 15, to: 480, step: 15 };

/**
 * The page's one app-specific group: the daily goal, saved on its own.
 *
 * The submit carries the goal and nothing else, so no value this screen does not show can be
 * rewritten from here — the sitting length and the bells ride back on the read row untouched.
 */
export function DailyGoalForm({
  goalMinutes,
  saveFailed,
}: Readonly<{ goalMinutes: number; saveFailed: boolean }>) {
  return (
    <form action={saveDailyGoal}>
      <SettingsBlock
        title="Meditation"
        footer={
          <Stack gap="md">
            {saveFailed && <AlertBanner>Could not save your settings. Try again.</AlertBanner>}
            <Button type="submit">Save goal</Button>
          </Stack>
        }
      >
        <SettingsRow
          label="Daily goal"
          description="Minutes of sitting that make a day done."
          control={
            <Select
              name="goalMinutes"
              aria-label="Daily goal"
              defaultValue={String(goalMinutes)}
              options={goalOptions()}
            />
          }
        />
      </SettingsBlock>
    </form>
  );
}

/**
 * Write the submitted goal over the row the service holds: one read, one write, then the page
 * re-renders on the value it stored. A refused or unreachable service reopens the page flagged
 * rather than leaving the owner believing a goal was saved.
 */
async function saveDailyGoal(formData: FormData): Promise<void> {
  'use server';
  try {
    const current = await fetchSettings();
    await saveSettings({ ...current, goalMinutes: Number(formData.get('goalMinutes')) });
  } catch {
    redirect(SAVE_FAILED_HREF);
  }
  revalidatePath('/meditation/settings');
}

/** Every grid minute as its own option, so the select can only land on the service's offering. */
function goalOptions(): SelectOption[] {
  const options: SelectOption[] = [];
  for (let minutes = GOAL_RANGE.from; minutes <= GOAL_RANGE.to; minutes += GOAL_RANGE.step) {
    options.push({ value: String(minutes), label: `${minutes} ${minuteUnit(minutes)}` });
  }
  return options;
}
