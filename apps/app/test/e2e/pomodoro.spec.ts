import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn } from './journey';

/**
 * The pomodoro timer's phase boundary, driven the way its owner meets it
 * (`SPEC-pomodoro-flow` Testing Strategy): a focus phase runs out, the card holds
 * `00:00` and names the next phase, one beep sounds, the tab title flashes, and
 * nothing advances until the focused button is pressed. A reload keeps the time
 * that is left, and the durations saved on `/pomodoro/settings` size the phases.
 *
 * Time is Playwright's fake clock, installed before the first navigation and
 * paused once the page is interactive, so a 25-minute phase costs no real wait.
 *
 * Selectors are pomodoro-owned only: the copy this module renders on `/pomodoro`
 * and `/pomodoro/settings`, plus the button names of its own controls. The frozen
 * e2e selector surface of other suites is neither read nor changed here.
 */

/** Where the audio stub counts the tones the page played. */
declare global {
  interface Window {
    startedOscillators: number;
  }
}

/** The durations as `/pomodoro/settings` takes them, in minutes. */
interface ChosenMinutes {
  focus: number;
  short: number;
  long: number;
}

/** Three distinct lengths, so a field wired to a sibling's cookie cannot pass. */
const CHOSEN_MINUTES: ChosenMinutes = { focus: 2, short: 3, long: 4 };

/** The shipped lengths: the phase the boundary test runs out, and the break it unlocks. */
const FOCUS_MINUTES = 25;
const SHORT_BREAK_MINUTES = 5;

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

/** Where the timer keeps its mode; its presence means the client mounted. */
const TIMER_MODE_KEY = 'pomodoro-mode';

/** The tab's name whenever no phase is waiting to be started. */
const PINNED_TITLE = 'Pomodoro';

type TimerPhase = 'Focus' | 'Short break' | 'Long break';

test.describe('pomodoro timer', () => {
  test('phase boundary holds until Start pressed', async ({ page }) => {
    await stubAudioContext(page);
    await openPomodoro(page);

    // The controls the boundary card replaced are gone, not merely hidden.
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(0);
    await expect(page.getByText(/^Session \d of 4$/)).toHaveCount(0);

    await expectCountdownSeconds(page, minutesToSeconds(FOCUS_MINUTES));
    await expect(startButton(page, 'Focus')).toBeFocused();
    await startButton(page, 'Focus').click();

    // The whole focus phase, in fake time.
    await page.clock.runFor(FOCUS_MINUTES * MINUTE_MS);

    await expectBoundary(page, 'Short break');
    await expectStartedOscillators(page, 1);
    await expectTitleFlashing(page, 'Next: Short break');

    // Nothing counts once the phase is over: five more fake minutes leave the card as it was.
    await page.clock.runFor(SHORT_BREAK_MINUTES * MINUTE_MS);
    await expectBoundary(page, 'Short break');
    await expectStartedOscillators(page, 1);

    // The press is the only way forward, and it begins the break at its whole length.
    await startButton(page, 'Short break').click();
    await expect(phaseLine(page)).toHaveText('Short break');
    await expectCountdownSeconds(page, minutesToSeconds(SHORT_BREAK_MINUTES));
    await expect(page).toHaveTitle(PINNED_TITLE);
  });

  test('reload resumes remaining time', async ({ page }) => {
    await openPomodoro(page);
    await startButton(page, 'Focus').click();

    // Two fake minutes into the shipped 25-minute focus.
    await page.clock.runFor(2 * MINUTE_MS);
    await expectCountdownSeconds(page, minutesToSeconds(FOCUS_MINUTES - 2));

    // The reload spends a few real seconds of the phase while it hydrates, so the
    // digits land near 23:00 rather than exactly on it.
    await reloadPomodoro(page);
    const resumedSeconds = await readCountdownSeconds(page);
    expect(resumedSeconds).toBeGreaterThanOrEqual(minutesToSeconds(FOCUS_MINUTES - 2) - 15);
    expect(resumedSeconds).toBeLessThanOrEqual(minutesToSeconds(FOCUS_MINUTES - 2) + 1);

    // And it keeps counting: ten more fake seconds are ten fewer on the card.
    await page.clock.runFor(10 * SECOND_MS);
    await expectCountdownSeconds(page, resumedSeconds - 10);

    // The toolbar's gear is the way to the durations, and it lands on their page.
    await page.clock.resume();
    await page.getByLabel('Settings').click();
    await page.waitForURL(/\/pomodoro\/settings$/);
    for (const field of MINUTE_FIELDS) {
      await minutesField(page, field).fill(String(CHOSEN_MINUTES[field.name]));
    }
    await page.getByRole('button', { name: 'Save durations' }).click();
    for (const field of MINUTE_FIELDS) {
      await expectStoredMinutes(page, field);
    }

    // The timer is not on screen, so nothing observes the focus deadline passing.
    await page.clock.runFor(FOCUS_MINUTES * MINUTE_MS);
    await visitPomodoro(page);
    await expectBoundary(page, 'Short break');

    // A deadline that passed while the page was gone lands on the boundary card,
    // and the card stays there: another fake minute moves nothing.
    await page.clock.runFor(MINUTE_MS);
    await expectBoundary(page, 'Short break');

    // The saved lengths size the phases the boundary button starts.
    await startButton(page, 'Short break').click();
    await expectCountdownSeconds(page, minutesToSeconds(CHOSEN_MINUTES.short));
    await page.clock.runFor(CHOSEN_MINUTES.short * MINUTE_MS);
    await expectBoundary(page, 'Focus');

    await startButton(page, 'Focus').click();
    await expectCountdownSeconds(page, minutesToSeconds(CHOSEN_MINUTES.focus));
  });
});

/**
 * Replaces WebAudio before the page's own scripts run, so the beep is observable
 * without a sound card and the count survives the reloads the specs drive.
 */
async function stubAudioContext(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.startedOscillators = 0;

    class StubOscillator {
      frequency = { value: 0 };
      onended: (() => void) | null = null;
      connect() {}
      start() {
        window.startedOscillators += 1;
      }
      stop() {}
    }

    class StubAudioContext {
      currentTime = 0;
      destination = {};
      createOscillator() {
        return new StubOscillator();
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }

    window.AudioContext = StubAudioContext as unknown as typeof AudioContext;
  });
}

/** The beep is one tone per phase end, however long the card waits at the boundary. */
async function expectStartedOscillators(page: Page, count: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.startedOscillators)).toBe(count);
}

/** Logs in, lands on the pomodoro page, and pauses the fake clock on it. */
async function openPomodoro(page: Page): Promise<void> {
  await page.clock.install();
  await logIn(page);
  await visitPomodoro(page);
}

/** Opens the pomodoro page, and pauses the fake clock on it. */
async function visitPomodoro(page: Page): Promise<void> {
  await arriveAtTimer(page, () => page.goto('/pomodoro'));
}

/** Reloads the page on screen, and pauses the fake clock on it again. */
async function reloadPomodoro(page: Page): Promise<void> {
  await arriveAtTimer(page, () => page.reload());
}

/**
 * The clock must run while a document loads and hydrates, or the readiness probe
 * below waits on a frozen browser; it is frozen again once the timer is up.
 */
async function arriveAtTimer(page: Page, load: () => Promise<unknown>): Promise<void> {
  await page.clock.resume();
  await load();
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

/** The one control on the card: it names the phase it begins. */
function startButton(page: Page, nextPhase: TimerPhase): Locator {
  return page.getByRole('button', {
    name: nextPhase === 'Focus' ? 'Start focus' : 'Start break',
    exact: true,
  });
}

/** A phase that ran out: `00:00` held, the next phase named, its start button focused. */
async function expectBoundary(page: Page, nextPhase: TimerPhase): Promise<void> {
  await expectCountdownSeconds(page, 0);
  await expect(page.getByText(`Next: ${nextPhase}`, { exact: true })).toBeVisible();
  await expect(startButton(page, nextPhase)).toBeFocused();
}

/**
 * The tab alternates between its pinned name and the next phase once per fake
 * second, so a second later it shows the other of the two, and a second after
 * that the one it started on.
 */
async function expectTitleFlashing(page: Page, nextTitle: string): Promise<void> {
  const reads = [await page.title()];
  for (const _ of [SECOND_MS, SECOND_MS]) {
    await page.clock.runFor(SECOND_MS);
    reads.push(await page.title());
  }

  for (const title of reads) {
    expect([PINNED_TITLE, nextTitle]).toContain(title);
  }
  expect(reads[1]).not.toBe(reads[0]);
  expect(reads[2]).toBe(reads[0]);
}

/** The phase line: the only text on the page that is a phase name on its own. */
function phaseLine(page: Page): Locator {
  return page.getByText(/^(Focus|Short break|Long break)$/);
}

/** The countdown digits: the only text on the page shaped like `mm:ss`. */
function countdownDigits(page: Page): Locator {
  return page.getByText(/^\d{2}:\d{2}$/);
}

async function expectCountdownSeconds(page: Page, totalSeconds: number): Promise<void> {
  await expect(countdownDigits(page)).toHaveText(toDigits(totalSeconds));
}

async function readCountdownSeconds(page: Page): Promise<number> {
  return toSeconds(await countdownDigits(page).innerText());
}

/** One duration field on `/pomodoro/settings`: its name, its cookie, and its label. */
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

function minutesField(page: Page, field: MinuteField): Locator {
  return page.getByLabel(field.label, { exact: true });
}

async function expectStoredMinutes(page: Page, field: MinuteField): Promise<void> {
  const minutes = String(CHOSEN_MINUTES[field.name]);
  await expect.poll(() => storedMinutes(page, field), { timeout: 15_000 }).toBe(minutes);
}

async function storedMinutes(page: Page, field: MinuteField): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === `pref_${field.preference}`)?.value;
}

function minutesToSeconds(minutes: number): number {
  return minutes * 60;
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
