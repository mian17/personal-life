import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AlertBanner,
  Button,
  Input,
  SettingsBlock,
  SettingsRow,
  Stack,
  StatusText,
} from '@life/ui';
import { fetchSettings, saveSettings } from '@/lib/meditation-api';

/** The one flag a failed write sends back, and the page it reopens with the banner up. */
export const SAVE_FAILED_FLAG = 'save';
const SAVE_FAILED_HREF = `/meditation/settings?error=${SAVE_FAILED_FLAG}`;

/** The goal's range (`SPEC-meditation-app` §1): any whole minute from 15 to 480. */
const GOAL_BOUNDS = { min: 15, max: 480 } as const;

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
            <StatusText>
              {`A daily goal is ${GOAL_BOUNDS.min} to ${GOAL_BOUNDS.max} whole minutes.`}
            </StatusText>
            <Button type="submit">Save goal</Button>
          </Stack>
        }
      >
        <SettingsRow
          label="Daily goal"
          description="Minutes of sitting that make a day done."
          control={
            <Input
              type="number"
              name="goalMinutes"
              min={GOAL_BOUNDS.min}
              max={GOAL_BOUNDS.max}
              step={1}
              aria-label="Daily goal"
              defaultValue={goalMinutes}
            />
          }
        />
      </SettingsBlock>
    </form>
  );
}

/**
 * Write the submitted goal and re-render on the value the service stored. An empty or worded
 * field is refused before the write, so it can never land as 0.
 */
async function saveDailyGoal(formData: FormData): Promise<void> {
  'use server';
  const typedMinutes = Number(formData.get('goalMinutes'));

  if (isGoalInRange(typedMinutes)) await storeGoal(typedMinutes);
  else redirect(SAVE_FAILED_HREF);

  revalidatePath('/meditation/settings');
}

/**
 * One read, one write over the row the service holds, so the sitting length and the bells this
 * screen never shows ride back untouched. A refused or unreachable service reopens the page
 * flagged rather than leaving the owner believing a goal was saved.
 */
async function storeGoal(goalMinutes: number): Promise<void> {
  try {
    const current = await fetchSettings();
    await saveSettings({ ...current, goalMinutes });
  } catch {
    redirect(SAVE_FAILED_HREF);
  }
}

/** A whole minute inside the range — an empty field reads as 0, and 0 is not a goal. */
function isGoalInRange(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= GOAL_BOUNDS.min && minutes <= GOAL_BOUNDS.max;
}
