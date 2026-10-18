import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn } from './journey';

/**
 * The pomodoro timer driven as a user (`SPEC-pomodoro` Testing Strategy): one
 * whole cycle, pause / resume / reset, and a reload that keeps both the chosen
 * durations and the running mode.
 *
 * Time is Playwright's fake clock, installed before the first navigation and
 * paused once the page is interactive, so a phase lasts 60 000 fake milliseconds
 * instead of a real minute and the run does not depend on wall time.
 *
 * Selectors are pomodoro-owned only: the copy this module renders (heading,
 * phase and session lines, countdown digits, field labels) and the button names
 * of its own controls. The frozen e2e selector surface of other suites is not
 * read or changed here.
 */

/** The three durations as their fields show them, in minutes. */
interface ChosenMinutes {
  focus: number;
  short: number;
  long: number;
}

const DEFAULT_MINUTES: ChosenMinutes = { focus: 25, short: 5, long: 15 };
const ONE_MINUTE: ChosenMinutes = { focus: 1, short: 1, long: 1 };
const CHOSEN_MINUTES: ChosenMinutes = { focus: 2, short: 3, long: 4 };

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

/** Where the timer keeps its mode; its presence means the client mounted. */
const TIMER_MODE_KEY = 'pomodoro-mode';

type TimerPhase = 'Focus' | 'Short break' | 'Long break';

/** What the timer card must read: the phase, and the focus session it belongs to. */
interface PhaseReadout {
  phase: TimerPhase;
  session: number;
}

/**
 * One cycle from the first focus session. A break belongs to the session it
 * follows, so the session number only moves when focus begins — which is why the
 * long break reads `Session 4 of 4` and the next cycle restarts at session 1.
 */
const ONE_CYCLE: PhaseReadout[] = [
  { phase: 'Short break', session: 1 },
  { phase: 'Focus', session: 2 },
  { phase: 'Short break', session: 2 },
  { phase: 'Focus', session: 3 },
  { phase: 'Short break', session: 3 },
  { phase: 'Focus', session: 4 },
  { phase: 'Long break', session: 4 },
  { phase: 'Focus', session: 1 },
];

test.describe('pomodoro timer', () => {
  test('the full cycle runs every phase in order, and a reload keeps durations and mode', async ({
    page,
  }) => {
    await openPomodoro(page);

    // First use: the shipped 25 / 5 / 15 minutes, first focus session, not started.
    await expectShownMinutes(page, DEFAULT_MINUTES);
    await expectPhase(page, { phase: 'Focus', session: 1 });
    await expectCountdownSeconds(page, 25 * 60);

    // One minute per phase keeps the whole cycle inside fake time. Each edit is
    // stored and reloaded before the next is typed, so a later write can never
    // carry a sibling field's stale value back to the server.
    for (const edit of durationEdits(ONE_MINUTE)) {
      await chooseMinutes(page, edit);
      await reloadPomodoro(page);
    }
    await expectShownMinutes(page, ONE_MINUTE);
    await expectCountdownSeconds(page, 60);

    // One cycle: focus 1, three short breaks between focus 2, 3, 4, then the long
    // break, then back to focus 1.
    await timerControl(page, 'Start').click();
    for (const readout of ONE_CYCLE) {
      await runOnePhase(page);
      await expectPhase(page, readout);
    }
    await expectCountdownSeconds(page, 60);

    // Pause freezes the digits: half a minute of clock time moves nothing.
    await timerControl(page, 'Pause').click();
    const frozenSeconds = await readCountdownSeconds(page);
    await page.clock.runFor(30 * SECOND_MS);
    await expectCountdownSeconds(page, frozenSeconds);

    // Resume continues from the frozen second, not from the phase's full length.
    await timerControl(page, 'Start').click();
    await page.clock.runFor(10 * SECOND_MS);
    await expectCountdownSeconds(page, frozenSeconds - 10);

    // Reset returns to the first focus session at its full chosen length.
    await timerControl(page, 'Reset').click();
    await expectPhase(page, { phase: 'Focus', session: 1 });
    await expectCountdownSeconds(page, 60);

    // Three new durations, each persisted through the server action and read back
    // from the cookie it writes.
    for (const edit of durationEdits(CHOSEN_MINUTES)) {
      await chooseMinutes(page, edit);
      await reloadPomodoro(page);
    }
    await expectShownMinutes(page, CHOSEN_MINUTES);
    await expectCountdownSeconds(page, 2 * 60);

    // A mode that is not the first one: the short break after the first focus.
    await timerControl(page, 'Start').click();
    await page.clock.runFor(2 * MINUTE_MS);
    await expectPhase(page, { phase: 'Short break', session: 1 });
    await expectCountdownSeconds(page, 3 * 60);

    // Reload: the stored durations and the stored mode come back together, and the
    // restored phase restarts at its own full length.
    await reloadPomodoro(page);
    await expectShownMinutes(page, CHOSEN_MINUTES);
    await expectPhase(page, { phase: 'Short break', session: 1 });
    await expectCountdownSeconds(page, 3 * 60);
  });
});

/** Logs in, lands on the pomodoro page, and pauses the fake clock on it. */
async function openPomodoro(page: Page): Promise<void> {
  await page.clock.install();
  await logIn(page);
  await page.goto('/pomodoro');
  await waitForTimer(page);
  await freezeClock(page);
}

/** Reloads with a running clock, so the page can hydrate, then freezes it again. */
async function reloadPomodoro(page: Page): Promise<void> {
  await page.clock.resume();
  await page.reload();
  await waitForTimer(page);
  await freezeClock(page);
}

/** The page's own readiness signal: the timer mounts, then stores its mode. */
async function waitForTimer(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Pomodoro', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForFunction(
    (modeKey) => window.localStorage.getItem(modeKey) !== null,
    TIMER_MODE_KEY,
    { timeout: 30_000 },
  );
}

/**
 * Freezes the fake clock one second ahead of the page's own time: the jump is
 * forward only, and it fires any due timer at most once.
 */
async function freezeClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + SECOND_MS);
}

/** Types one duration and waits until the server stored it. */
async function chooseMinutes(page: Page, edit: DurationEdit): Promise<void> {
  await minutesField(page, edit).fill(String(edit.minutes));
  await expectStoredMinutes(page, edit);
}

async function expectStoredMinutes(page: Page, edit: DurationEdit): Promise<void> {
  await expect
    .poll(() => storedPreference(page, edit), { timeout: 15_000 })
    .toBe(String(edit.minutes));
}

async function storedPreference(page: Page, edit: DurationEdit): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === `pref_${edit.preference}`)?.value;
}

async function expectShownMinutes(page: Page, chosen: ChosenMinutes): Promise<void> {
  for (const edit of durationEdits(chosen)) {
    await expect(minutesField(page, edit)).toHaveValue(String(edit.minutes));
  }
}

function minutesField(page: Page, edit: DurationEdit): Locator {
  return page.getByLabel(edit.label, { exact: true });
}

/** One minute of fake time, which is exactly one phase now that each lasts a minute. */
async function runOnePhase(page: Page): Promise<void> {
  await page.clock.runFor(MINUTE_MS);
}

async function expectPhase(page: Page, readout: PhaseReadout): Promise<void> {
  await expect(phaseReadout(page)).toHaveText(readout.phase);
  await expect(sessionReadout(page)).toHaveText(`Session ${readout.session} of 4`);
}

async function expectCountdownSeconds(page: Page, totalSeconds: number): Promise<void> {
  await expect(countdownReadout(page)).toHaveText(toDigits(totalSeconds));
}

async function readCountdownSeconds(page: Page): Promise<number> {
  return toSeconds(await countdownReadout(page).innerText());
}

/** The timer card, reached by the heading the pomodoro page renders above it. */
function timerSection(page: Page): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Timer', exact: true }) });
}

/** The phase line: the only text in the card that is a phase name. */
function phaseReadout(page: Page): Locator {
  return timerSection(page).getByText(/^(Focus|Short break|Long break)$/);
}

/** The countdown digits: the only text in the card shaped like `mm:ss`. */
function countdownReadout(page: Page): Locator {
  return timerSection(page).getByText(/^\d{2}:\d{2}$/);
}

/** The session line: `Session N of 4`. */
function sessionReadout(page: Page): Locator {
  return timerSection(page).getByText(/^Session \d of 4$/);
}

type TimerControl = 'Start' | 'Pause' | 'Reset';

function timerControl(page: Page, name: TimerControl): Locator {
  return page.getByRole('button', { name, exact: true });
}

/** One duration field: the preference the server stores it under, and its label. */
interface MinuteField {
  name: keyof ChosenMinutes;
  /** The cookie is `pref_` plus this name (`@life/app-kit`'s preference naming). */
  preference: string;
  label: string;
}

const MINUTE_FIELDS: MinuteField[] = [
  { name: 'focus', preference: 'pomodoro_focus', label: 'Focus' },
  { name: 'short', preference: 'pomodoro_short', label: 'Short break' },
  { name: 'long', preference: 'pomodoro_long', label: 'Long break' },
];

interface DurationEdit extends MinuteField {
  minutes: number;
}

function durationEdits(chosen: ChosenMinutes): DurationEdit[] {
  return MINUTE_FIELDS.map((field) => ({ ...field, minutes: chosen[field.name] }));
}

function toSeconds(digits: string): number {
  const [minutes, seconds] = digits.split(':').map(Number);
  return minutes * 60 + seconds;
}

function toDigits(totalSeconds: number): string {
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
}

function pad(part: number): string {
  return String(part).padStart(2, '0');
}
