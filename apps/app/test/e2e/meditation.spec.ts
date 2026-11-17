import { expect, test, type Page, type Response } from '@playwright/test';
import { logIn } from './journey';

/**
 * The one signed-in meditation flow (`SPEC-meditation-app` §6): set the goal, sit, finish,
 * reload, and find the goal and the sittings still there.
 *
 * The day-done boundary is proven by the records this flow itself writes, never by a
 * screenshot. Two sittings face one 15-minute goal: 14 recorded minutes read "Not yet" — the
 * goal less one — and the next minute lands exactly on the goal and reads "Yes". Stamping that
 * minute out afterwards leaves the fourteen again, which is what shows a soft-deleted sitting
 * does not count toward a day.
 *
 * The clock is Playwright's fake clock, paused once the screen is interactive, so a
 * fourteen-minute sitting costs no real wait and the recorded minutes land on the edge exactly.
 *
 * Only the app's roles, visible text and aria-labels are read.
 */

const GOAL_MINUTES = 15;
const SITTING_MINUTES = 15;

/** The whole planned length, as the idle screen's start control names it. */
const START_BUTTON = `Start ${SITTING_MINUTES} minutes`;

/** The header line naming the plan and the goal it reaches. */
const HEADER_LINE = `${SITTING_MINUTES} minutes · reaches today's goal`;

/** The goal as the day read-out spells it, for the two strings the boundary is asserted with. */
const GOAL_LINE = `${GOAL_MINUTES} minutes`;

const GOAL_ONE_SHORT_LINE = `14 of ${GOAL_LINE} today · 1 minute to go`;
const GOAL_MET_LINE = `Goal met · ${GOAL_LINE} today, against a goal of ${GOAL_LINE}`;

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** One sitting the flow runs: the seconds it sits, and the minutes they round up to. */
interface Sitting {
  elapsedSeconds: number;
  recordedMinutes: number;
}

/** Fourteen recorded minutes — the goal less one — reached by the stop dialog's rounding. */
const ONE_SHORT_OF_THE_GOAL: Sitting = {
  elapsedSeconds: 13 * SECONDS_PER_MINUTE + 5,
  recordedMinutes: GOAL_MINUTES - 1,
};

/** The minute that reaches the goal: thirty seconds round up to one. */
const THE_LAST_MINUTE: Sitting = { elapsedSeconds: 30, recordedMinutes: 1 };

test.describe('meditation', () => {
  test('meditation: set goal, sit, finish, reload', async ({ page }) => {
    await page.clock.install();
    await logIn(page);

    await saveSettings(page, { goalMinutes: GOAL_MINUTES, sittingMinutes: SITTING_MINUTES });
    await openMeditation(page);
    await expect(page.getByText(HEADER_LINE, { exact: true })).toBeVisible();

    await pauseClock(page);
    await sitAndKeep(page, ONE_SHORT_OF_THE_GOAL);
    await expectRecordedSitting(page, ONE_SHORT_OF_THE_GOAL);
    await leaveRecordedScreen(page);
    await expectDay(page, GOAL_ONE_SHORT_LINE, 'Not yet');

    await sitAndKeep(page, THE_LAST_MINUTE);
    await expectRecordedSitting(page, THE_LAST_MINUTE);
    await leaveRecordedScreen(page);
    await expectDay(page, GOAL_MET_LINE, 'Yes');

    // The reload is the point of this flow: neither the goal nor the sittings live in this tab.
    await page.clock.resume();
    await openMeditation(page);
    await expect(page.getByText(HEADER_LINE, { exact: true })).toBeVisible();
    await expectDay(page, GOAL_MET_LINE, 'Yes');

    await openSittingLog(page);
    await expect(page.getByRole('listitem')).toHaveCount(2);

    // Newest first, by the row's own minutes: the minute that reached the goal leads the log,
    // so the row the delete below opens is the minute and never the fourteen.
    await expect(page.getByRole('listitem').first()).toContainText(
      loggedMinutesFor(THE_LAST_MINUTE),
    );
    await expect(page.getByRole('listitem').nth(1)).toContainText(
      loggedMinutesFor(ONE_SHORT_OF_THE_GOAL),
    );

    // A stamped sitting leaves the log and its day both: the minute is gone, the fourteen are not.
    await deleteSitting(page, THE_LAST_MINUTE);
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await openMeditation(page);
    await expectDay(page, GOAL_ONE_SHORT_LINE, 'Not yet');
  });
});

/** The configuration `/meditation/settings` takes, over the grids it offers. */
interface ChosenSettings {
  goalMinutes: number;
  sittingMinutes: number;
}

/** Writes the configuration on `/meditation/settings` and waits for the write to land. */
async function saveSettings(
  page: Page,
  { goalMinutes, sittingMinutes }: ChosenSettings,
): Promise<void> {
  await page.goto('/meditation/settings');
  await page.getByLabel('Daily goal').selectOption(String(goalMinutes));
  await page.getByLabel('Sitting length').selectOption(String(sittingMinutes));

  const saved = page.waitForResponse(serverActionOn('/meditation/settings'));
  await page.getByRole('button', { name: 'Save settings' }).click();
  await saved;
}

/** The idle screen, once its heading has rendered. */
async function openMeditation(page: Page): Promise<void> {
  await page.goto('/meditation');
  await expect(page.getByRole('heading', { name: 'Meditation', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** The sitting log, newest sitting first. */
async function openSittingLog(page: Page): Promise<void> {
  await page.goto('/meditation/sessions');
  await expect(page.getByRole('heading', { name: 'Sitting log', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Today as the idle screen measures it. The progress line is the service's own live minutes
 * against the current goal, so the pair of it and the done fact is the boundary in two strings.
 */
async function expectDay(page: Page, progressLine: string, doneFact: string): Promise<void> {
  await expect(page.getByText(progressLine, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(doneFact, { exact: true })).toBeVisible();
}

/** Pauses the fake clock one second ahead, so a sitting's seconds are exactly the spec's. */
async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + MILLISECONDS_PER_SECOND);
}

/** Starts a sitting, spends its seconds, and keeps what it sat. */
async function sitAndKeep(page: Page, { elapsedSeconds, recordedMinutes }: Sitting): Promise<void> {
  await page.getByRole('button', { name: START_BUTTON, exact: true }).click();
  await page.clock.runFor(elapsedSeconds * MILLISECONDS_PER_SECOND);

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: keepButtonFor(recordedMinutes), exact: true }).click();
}

/** The stop control's own name for the minutes it is about to save. */
function keepButtonFor(minutes: number): string {
  return `End & keep ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** The completion screen: the minutes the service recorded, kept early rather than planned. */
async function expectRecordedSitting(page: Page, { recordedMinutes }: Sitting): Promise<void> {
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(String(recordedMinutes), { exact: true })).toBeVisible();
}

/** Back to idle with a freshly read day, which is where the boundary is read. */
async function leaveRecordedScreen(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: START_BUTTON, exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/** The log row's own words for the minutes a sitting kept: `14 minutes of 15 minutes planned`. */
function loggedMinutesFor({ recordedMinutes }: Sitting): string {
  return `${recordedMinutes} ${minuteUnit(recordedMinutes)} of`;
}

/** A count of minutes with the noun the screen gives it, so the row is named the way it reads. */
function minuteUnit(minutes: number): string {
  return minutes === 1 ? 'minute' : 'minutes';
}

/** Stamps the sitting that kept these minutes and lands back on the log. */
async function deleteSitting(page: Page, sitting: Sitting): Promise<void> {
  await page
    .getByRole('listitem')
    .filter({ hasText: loggedMinutesFor(sitting) })
    .getByRole('link')
    .first()
    .click();
  await page.waitForURL(/\/meditation\/sessions\/[^/]+$/, { timeout: 15_000 });

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete sitting', exact: true }).click();
  await page.waitForURL(/\/meditation\/sessions$/, { timeout: 15_000 });
}

/** A server action's own POST, which is how the settings write is observed to have landed. */
function serverActionOn(path: string): (response: Response) => boolean {
  return (response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === path;
}
