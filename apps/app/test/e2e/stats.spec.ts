import { expect, test, type Page, type Response } from '@playwright/test';
import { logIn } from './journey';

/**
 * The focus-stats surface as the owner meets it on a 375 px phone
 * (`SPEC-pomodoro-stats` §6): one recorded focus block reaches today's bar, that
 * bar survives a reload, a new goal re-measures today alone, and every period
 * draws its own window one leftward step back. Only the frozen surface is read —
 * roles, visible text, aria-labels — so the timer's own labels and every
 * `button.trash-delete` label stay exactly as they are.
 */
const PHONE_VIEWPORT = { width: 375, height: 667 } as const;

/** One shipped focus phase: how long it runs on the fake clock, and the minutes it records. */
const FOCUS_MINUTES = 25;
const MINUTE_MS = 60_000;

/** Two goals far enough apart that a re-measured bar cannot still read the first one. */
const FIRST_GOAL = 30;
const SECOND_GOAL = 50;

/** A day per bar for week and month, a month per bar for year. */
const PERIODS = [
  { name: 'Week', barCount: 7 },
  { name: 'Month', barCount: 30 },
  { name: 'Year', barCount: 12 },
] as const;

test.use({ viewport: PHONE_VIEWPORT });

test.describe('stats', () => {
  test('records a focus block and reads it against today in every window', async ({ page }) => {
    await page.clock.install();
    await logIn(page);

    await recordFocusBlock(page);

    // The timer's toolbar is the only page that carries the approved nav order,
    // and its stats icon is the only door to the surface this spec is about.
    await page.goto('/pomodoro');
    await expectToolbarOrder(page);
    await openStats(page);

    // FIRST_GOAL lands on a day that already holds the block, so today measures
    // against it. Snapshotting that window is what lets the second write prove it
    // moves today's bar alone; the write itself leaves the owner on settings, so the
    // surface is re-opened by its URL before it is read.
    await saveGoal(page, FIRST_GOAL);
    await page.goto('/pomodoro/stats');
    await expectTodayFill(page, { minutes: FOCUS_MINUTES, goal: FIRST_GOAL, percent: 83 });
    const firstGoalWindow = await barTexts(page);
    await expectBarCount(page, PERIODS[0].barCount);
    await expectNoHorizontalOverflow(page);
    await expectWindowSurvivesReload(page, firstGoalWindow);

    for (const period of PERIODS) await expectPeriodWalksBack(page, period);

    await saveGoal(page, SECOND_GOAL);
    await page.goto('/pomodoro/stats');
    await expectTodayFill(page, { minutes: FOCUS_MINUTES, goal: SECOND_GOAL, percent: 50 });

    // Only today's goal moved: every day before it keeps the goal its own row gave
    // it, while today's bar is the one the second write re-measures.
    const secondGoalWindow = await barTexts(page);
    expect(secondGoalWindow.slice(0, -1)).toEqual(firstGoalWindow.slice(0, -1));
    expect(secondGoalWindow.at(-1)).not.toEqual(firstGoalWindow.at(-1));
  });
});

/** Sets the owner's daily goal where the settings page takes it, waiting for the write to land. */
async function saveGoal(page: Page, minutes: number): Promise<void> {
  await page.goto('/pomodoro/settings');
  await page.getByLabel('Daily goal').fill(String(minutes));

  const saved = page.waitForResponse(serverActionOn('/pomodoro/settings'));
  await page.getByRole('button', { name: 'Save goal' }).click();
  await saved;
}

/**
 * One whole focus phase, run out on the fake clock: the card settles on the
 * boundary and the minutes reach the owner's day through the server action.
 */
async function recordFocusBlock(page: Page): Promise<void> {
  await page.goto('/pomodoro');
  await expectTimerMounted(page);
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();

  const recorded = page.waitForResponse(serverActionOn('/pomodoro'));
  await page.clock.runFor(FOCUS_MINUTES * MINUTE_MS);
  await expect(page.getByText('Next: Short break', { exact: true })).toBeVisible();
  await recorded;
}

/** Stats, then the gear — the timer's toolbar keeps those two controls; feedback is a Support row. */
async function expectToolbarOrder(page: Page): Promise<void> {
  const labels = await page
    .getByRole('navigation')
    .locator('a, button')
    .evaluateAll((controls) => controls.map((control) => control.getAttribute('aria-label')));

  expect(labels).toEqual(['Stats', 'Settings']);
}

/** Takes the toolbar's shape-only stats icon, the surface's only door, and lands on the surface. */
async function openStats(page: Page): Promise<void> {
  await page.getByLabel('Stats').click();
  await page.waitForURL(/\/pomodoro\/stats$/);
}

/** Today's fill, named by the minutes and goal it claims, reporting the percent it measured. */
async function expectTodayFill(
  page: Page,
  today: { minutes: number; goal: number; percent: number },
): Promise<void> {
  const bar = page.getByRole('progressbar', {
    name: `Today: ${today.minutes} of ${today.goal} minutes`,
  });

  await expect(bar).toHaveAttribute('aria-valuenow', String(today.percent));
}

/** Every bar as the chart states it, in window order. */
async function barTexts(page: Page): Promise<string[]> {
  const items = await page.getByRole('listitem').allTextContents();
  return items.map((item) => item.trim());
}

async function expectBarCount(page: Page, barCount: number): Promise<void> {
  await expect(page.getByRole('listitem')).toHaveCount(barCount);
}

/** A reload re-reads the same day from the service, so every bar comes back identical. */
async function expectWindowSurvivesReload(page: Page, before: string[]): Promise<void> {
  await page.reload();
  expect(await barTexts(page)).toEqual(before);
}

/**
 * The period filter draws its own window, and one leftward step re-reads the
 * window before it: same bar count, different totals, still inside the phone.
 */
async function expectPeriodWalksBack(
  page: Page,
  period: { name: string; barCount: number },
): Promise<void> {
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('period') === period.name.toLowerCase()),
    page.getByRole('link', { name: period.name }).click(),
  ]);
  await expectBarCount(page, period.barCount);

  const currentWindow = await barTexts(page);
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('offset') === '1'),
    page.getByLabel('Earlier period').click(),
  ]);
  await expectBarCount(page, period.barCount);
  expect(await barTexts(page)).not.toEqual(currentWindow);

  await expectNoHorizontalOverflow(page);
}

/** A phone screen shows the whole surface: the document never runs wider than its viewport. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/** The timer has mounted once it writes its mode; a click before that is lost to hydration. */
async function expectTimerMounted(page: Page): Promise<void> {
  await page.waitForFunction(() => window.localStorage.getItem('pomodoro-mode') !== null, undefined, {
    timeout: 30_000,
  });
}

/** A Next server action answers with a POST back to the route that submitted it. */
function serverActionOn(path: string): (response: Response) => boolean {
  return (response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === path;
}
