import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { logIn } from './journey';

/**
 * The signed-in meditation flow (`SPEC-meditation-app` §1, §5, §6), driven through the rebuilt
 * screens: the length stepper and its three rows, the interval bells sheet, the running panel,
 * the stop confirm, and the complete panel.
 *
 * The day's goal lives in the `ListShell` subtitle and nowhere in the body, so the goal is read
 * as one line — `N minutes done · Today's goal is M minutes` — and the body is separately proven
 * to hold no goal of its own. Every assertion is something the sitter can see or hear: a role, a
 * visible string, an aria-label. No screenshots, no CSS classes.
 *
 * The clock is Playwright's fake clock: real while the pages are navigated and the sheets are
 * pressed, paused only around a running sitting, so a fifteen-minute plan costs no wait and the
 * countdown's digits are exact. It is resumed before any dialog or `router.refresh()`, because
 * both wait on frames and a round trip rather than on timers.
 *
 * The two tests share one throwaway stack and run in file order: the flow records two sittings
 * and deletes one, the stats test asserts the window and its numbers render.
 */

const GOAL_MINUTES = 30;

/** The service's default planned length, which is where the idle stepper opens. */
const PLANNED_MINUTES = 15;

/** One press up, to show the ± pair moves the read-out, then back down to the plan. */
const STEPPED_MINUTES = 16;

/** The seconds sat before the stop is confirmed. */
const STOPPED_AFTER_SECONDS = 70;

const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const PLANNED_SECONDS = PLANNED_MINUTES * SECONDS_PER_MINUTE;

/** The minutes a seventy-second stop records: elapsed rounded up. */
const KEPT_MINUTES = 2;

/** The progress bar's percentage after the stopped stretch: 70 of 900 seconds, rounded. */
const STOPPED_PROGRESS_PERCENT = 8;

/** The day before the first sitting: nothing sat, against the goal the spec just wrote. */
const NO_MINUTES_DONE = '0 minutes done';

test.describe('meditation', () => {
  test('meditation: shape the sitting, run it, stop it, finish it', async ({ page }) => {
    await page.clock.install();
    await logIn(page);
    await saveGoal(page, GOAL_MINUTES);

    // 1. The idle screen: the stepper moves the read-out, the three rows read their values, Start.
    await openMeditation(page);
    await expectDuration(page, PLANNED_MINUTES);
    await increaseDuration(page).click();
    await expectDuration(page, STEPPED_MINUTES);
    await decreaseDuration(page).click();
    await expectDuration(page, PLANNED_MINUTES);
    await expectIdleRows(page, 'Off');
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();

    // 2. The goal is the subtitle's alone: one line on the page, and none of it in the body.
    await expectSubtitle(page, `${NO_MINUTES_DONE} · Today's goal is ${GOAL_MINUTES} minutes`);
    await expect(page.getByText(/Today's goal is/)).toHaveCount(1);
    await expect(
      page.getByRole('region', { name: 'Session setup' }).getByText(/Today's goal is/),
    ).toHaveCount(0);

    // 3. The bells sheet: opened from the row, cancelled to discard, saved to persist.
    await expectBellsSheetToDiscard(page, PLANNED_MINUTES);
    await saveIntervalBells(page);

    // 4. A sitting stopped early: the countdown, the one control, then the confirm sheet.
    await pauseClock(page);
    await startSitting(page, PLANNED_MINUTES);
    await expectRunning(page, PLANNED_MINUTES);
    await expectProgress(page, 0);

    await page.clock.runFor(STOPPED_AFTER_SECONDS * MILLISECONDS_PER_SECOND);
    await expectCountdown(page, PLANNED_SECONDS - STOPPED_AFTER_SECONDS);
    await expectProgress(page, STOPPED_PROGRESS_PERCENT);

    // Real time from here: a dialog's mount, focus and unmount are frames, not timers.
    await page.clock.resume();
    const frozen = clockText(PLANNED_SECONDS - STOPPED_AFTER_SECONDS);
    await openStopSheet(page);
    await page.getByRole('button', { name: 'Keep going', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    // Keep going ended nothing: the clock is still running, so the digits move on their own.
    await expect.poll(() => countdownText(page), { timeout: 5_000 }).not.toBe(frozen);

    await openStopSheet(page);
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await expectComplete(page, 'Session ended early', KEPT_MINUTES);

    await doneToIdle(page);
    await expectSubtitle(
      page,
      `${KEPT_MINUTES} minutes done · Today's goal is ${GOAL_MINUTES} minutes`,
    );

    // 5. A sitting that runs its whole plan: the countdown reaches zero and records itself.
    await pauseClock(page);
    await startSitting(page, PLANNED_MINUTES);
    await expectRunning(page, PLANNED_MINUTES);
    await page.clock.runFor(PLANNED_SECONDS * MILLISECONDS_PER_SECOND);
    await page.clock.resume();
    await expectComplete(page, 'Session complete', PLANNED_MINUTES);

    await doneToIdle(page);
    await expectSubtitle(
      page,
      `${KEPT_MINUTES + PLANNED_MINUTES} minutes done · Today's goal is ${GOAL_MINUTES} minutes`,
    );

    // 6. The log lists both sittings newest first, and a delete leaves the log and the day.
    await openSittingLog(page);
    const rows = page.getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(
      `${PLANNED_MINUTES} minutes of ${PLANNED_MINUTES} minutes planned`,
    );
    await expect(rows.first()).toContainText('Complete');
    await expect(rows.nth(1)).toContainText(
      `${KEPT_MINUTES} minutes of ${PLANNED_MINUTES} minutes planned`,
    );
    await expect(rows.nth(1)).toContainText('Kept early');

    await rows.nth(1).getByRole('link').first().click();
    await page.waitForURL(/\/meditation\/sessions\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByText('Kept early', { exact: true })).toBeVisible();

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete sitting', exact: true }).click();
    await page.waitForURL(/\/meditation\/sessions$/, { timeout: 15_000 });

    await expect(page.getByText('1 sitting recorded', { exact: true })).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(1);

    // The stamped sitting left the day with it: the plan's own minutes are what is left.
    await openMeditation(page);
    await expectSubtitle(
      page,
      `${PLANNED_MINUTES} minutes done · Today's goal is ${GOAL_MINUTES} minutes`,
    );
  });

  test('meditation: the stats screen renders its window and the numbers beside it', async ({
    page,
  }) => {
    await logIn(page);
    await page.goto('/meditation/stats');
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // The week lens is the default, and its three read-outs are the page's own contract.
    await expect(page.getByText('Last 7 days', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Meditation minutes per day' })).toBeVisible();
    await expect(page.getByText('Sat in this window', { exact: true })).toBeVisible();
    await expect(page.getByText('Sittings', { exact: true })).toBeVisible();
    await expect(page.getByText('Average per sitting', { exact: true })).toBeVisible();
  });
});

/** Writes the daily goal on `/meditation/settings` and waits for the write to land. */
async function saveGoal(page: Page, minutes: number): Promise<void> {
  await page.goto('/meditation/settings');
  await page.getByLabel('Daily goal').selectOption(String(minutes));

  const saved = page.waitForResponse(serverActionOn('/meditation/settings'));
  await page.getByRole('button', { name: 'Save goal', exact: true }).click();
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

/** The stepper's big figure: an `<output>`, the element for a calculated read-out. */
function durationReadout(page: Page): Locator {
  return page.getByRole('region', { name: 'Session setup' }).locator('output');
}

/** The length the sitter reads: the stepper's figure, and the Duration row that repeats it. */
async function expectDuration(page: Page, minutes: number): Promise<void> {
  // Case-insensitive on purpose: the unit is uppercased by the stylesheet, so `innerText` reads it
  // shouted while the digits are the figure being asserted.
  await expect(durationReadout(page)).toHaveText(
    new RegExp(`^${minutes}\\s*${minuteUnit(minutes)}$`, 'i'),
  );
  await expect(page.getByText(`${minutes} min`, { exact: true })).toBeVisible();
}

function increaseDuration(page: Page): Locator {
  return page.getByRole('button', { name: 'Increase duration by one minute', exact: true });
}

function decreaseDuration(page: Page): Locator {
  return page.getByRole('button', { name: 'Decrease duration by one minute', exact: true });
}

/** The three rows under the stepper, each with the value it reads. */
async function expectIdleRows(page: Page, intervalBells: string): Promise<void> {
  await expect(page.getByText('Duration', { exact: true })).toBeVisible();
  await expect(page.getByText('Interval bells', { exact: true })).toBeVisible();
  await expect(page.getByText(intervalBells, { exact: true })).toBeVisible();
  await expect(page.getByText('Ending bell', { exact: true })).toBeVisible();
  await expect(page.getByText('Gong', { exact: true })).toBeVisible();
}

/** The `ListShell` subtitle: the day's minutes done, and the goal they face. */
async function expectSubtitle(page: Page, line: string): Promise<void> {
  await expect(page.getByText(line, { exact: true })).toBeVisible({ timeout: 15_000 });
}

/** The idle row that opens the sheet; its name is the label, the value and the chevron. */
function intervalBellsRow(page: Page): Locator {
  return page.getByRole('button', { name: /^Interval bells/ });
}

/**
 * Opens the sheet, proves the switch owns the whole block, edits every group, and cancels: the
 * row still reads `Off`, so nothing a press did was written.
 */
async function expectBellsSheetToDiscard(page: Page, sessionMinutes: number): Promise<void> {
  await intervalBellsRow(page).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Interval bells', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeVisible();

  // Off: the header and the switch row, and nothing the switch owns.
  await expect(
    sheet.getByRole('button', { name: 'Decrease start offset by one minute' }),
  ).toHaveCount(0);

  await sheet.getByRole('switch', { name: 'Interval bells' }).click();
  await expect(sheet.getByRole('heading', { name: 'Start after', exact: true })).toBeVisible();
  await expect(sheet.getByLabel('Start offset hours')).toHaveValue('0');
  await expect(sheet.getByLabel('Start offset minutes')).toHaveValue('0');
  await expect(sheet.getByLabel('Start offset seconds')).toHaveValue('0');
  await expect(
    sheet.getByRole('button', { name: 'Decrease start offset by one minute' }),
  ).toBeDisabled();
  await expect(sheet.getByRole('heading', { name: 'Every', exact: true })).toBeVisible();
  await expect(sheet.getByText('Every 10 min', { exact: true })).toBeVisible();
  await expect(
    sheet.getByRole('button', { name: 'Decrease interval by one minute' }),
  ).toBeDisabled();
  await expect(sheet.getByRole('heading', { name: 'Repeat', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Repeat: unlimited' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(sheet.getByRole('button', { name: 'Repeat: 3×' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // Fifteen minutes at one bowl every ten: two bowls, both inside the sitting.
  await expect(
    sheet.getByText('Bowl every 10 min, starting after 0 min, unlimited. 2 bowls this session.'),
  ).toBeVisible();

  // Each group rewrites the summary line as it is pressed, against this sitting's own length.
  await sheet.getByRole('button', { name: 'Increase interval by one minute' }).click();
  await expect(
    sheet.getByText('Bowl every 20 min, starting after 0 min, unlimited. 1 bowl this session.'),
  ).toBeVisible();
  await sheet.getByLabel('Start offset minutes').fill('5');
  await expect(
    sheet.getByText('Bowl every 20 min, starting after 5 min, unlimited. 1 bowl this session.'),
  ).toBeVisible();
  await sheet.getByRole('button', { name: 'Repeat: 3×' }).click();
  await expect(sheet.getByRole('button', { name: 'Repeat: 3×' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await sheet.getByLabel('Start offset hours').fill('1');
  await expect(
    sheet.getByText(
      `Bowl every 20 min, starting after 1 h 5 min, 3× — no bowl will sound in a ${sessionMinutes} min session.`,
    ),
  ).toBeVisible();

  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Off', { exact: true })).toBeVisible();
}

/**
 * Re-opens the sheet on the bells Cancel left behind, turns them on, saves a schedule whose first
 * bowl falls past the sitting, and reads the row back from a fresh render of the page.
 *
 * The schedule's offset sits past the plan on purpose: the sitting rings nothing, so no case here
 * depends on Web Audio being available.
 */
async function saveIntervalBells(page: Page): Promise<void> {
  await intervalBellsRow(page).click();
  const sheet = page.getByRole('dialog');

  // Cancel wrote nothing: the sheet opens on the stored bells, off.
  await expect(sheet.getByRole('switch', { name: 'Interval bells' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await sheet.getByRole('switch', { name: 'Interval bells' }).click();
  await sheet.getByRole('button', { name: 'Increase interval by one minute' }).click();
  await sheet.getByLabel('Start offset hours').fill('1');
  await expect(sheet.getByText(/^Bowl every 20 min, starting after 1 h,/)).toBeVisible();

  await sheet.getByRole('button', { name: 'Save', exact: true }).click();

  // The sheet closes on a write that landed, and the row reads back what the service stored.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openMeditation(page);
  await expect(intervalBellsRow(page)).toContainText('Every 20 min');
}

/**
 * Pauses the fake clock one second ahead, so a sitting's seconds are exactly the spec's. The clock
 * is installed at the top of the test and ticks for real until its first sitting, so login, the
 * goal write and the sheet presses are never left waiting on a frozen timer.
 */
async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + MILLISECONDS_PER_SECOND);
}

async function startSitting(page: Page, minutes: number): Promise<void> {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByText(`Meditation · ${minutes} min`, { exact: true })).toBeVisible();
}

/** The running panel: the session line, the countdown, the track, and the one control. */
async function expectRunning(page: Page, minutes: number): Promise<void> {
  await expect(page.getByText(`Meditation · ${minutes} min`, { exact: true })).toBeVisible();
  await expectCountdown(page, minutes * SECONDS_PER_MINUTE);
  await expect(page.getByRole('progressbar', { name: 'Session progress' })).toBeVisible();
  // Nothing competes with Stop: it is the screen's only control.
  await expect(page.getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
}

/** The countdown as `m:ss` for a whole number of seconds left. */
async function expectCountdown(page: Page, secondsLeft: number): Promise<void> {
  await expect(page.getByRole('status')).toHaveText(clockText(secondsLeft));
}

/** The countdown's digits as they read right now. */
async function countdownText(page: Page): Promise<string> {
  return (await page.getByRole('status').textContent()) ?? '';
}

/** How much of the plan the track shows as sat. */
async function expectProgress(page: Page, percent: number): Promise<void> {
  await expect(page.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute(
    'aria-valuenow',
    String(percent),
  );
}

/** The stop confirm: the design's question, its copy, and its two answers. */
async function openStopSheet(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'End this session?' })).toBeVisible();
  await expect(sheet.getByText('The minutes you have sat are not saved.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Keep going', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'End session', exact: true })).toBeVisible();
}

/** The complete panel: the heading the ending earned, the minutes, and the line naming them. */
async function expectComplete(page: Page, heading: string, minutes: number): Promise<void> {
  await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('status')).toHaveText(`${minutes} min`);
  await expect(page.getByText('minutes sat', { exact: true })).toBeVisible();
}

/** Back to idle with a freshly read day, which is where the day read-out is measured. */
async function doneToIdle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/** A whole count of seconds as the countdown spells it. */
function clockText(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** A count of minutes with the noun the screens give it. */
function minuteUnit(minutes: number): string {
  return minutes === 1 ? 'minute' : 'minutes';
}

/** A server action's own POST, which is how the goal write is observed to have landed. */
function serverActionOn(path: string): (response: Response) => boolean {
  return (response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === path;
}
