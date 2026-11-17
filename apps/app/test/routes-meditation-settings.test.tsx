import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/meditation-api', () => ({ fetchSettings: jest.fn(), saveSettings: jest.fn() }));

import { fetchSettings, type SettingsRow } from '@/lib/meditation-api';
import { repeatFrom, repeatValue } from '@/lib/meditation-repeat';
import MeditationSettingsPage from '@/app/meditation/settings/page';

/**
 * `/meditation/settings`'s offering grids (`SPEC-meditation-app` §1, plan Task [12]
 * acceptance criterion 2): the goal is chosen only on the 15–480 fifteen-minute grid, the bell
 * interval only on 10–120 seconds in tens, and the endless repeat option is the one that
 * stores `repeat: null`. A green service run says nothing about these — they are the form's
 * own contract, so they are asserted on the markup the page renders.
 */

const mockedFetchSettings = fetchSettings as jest.MockedFunction<typeof fetchSettings>;

/** A stored row whose repeat is the endless choice, so the null mapping has to show itself. */
const STORED: SettingsRow = {
  goalMinutes: 30,
  plannedMinutes: 45,
  bells: { enabled: true, offsetSec: 300, intervalSec: 600, repeat: null },
};

/** The page as it renders for one stored row. */
async function renderPage(settings: SettingsRow = STORED): Promise<string> {
  mockedFetchSettings.mockResolvedValue(settings);
  return renderToStaticMarkup(await MeditationSettingsPage({ searchParams: Promise.resolve({}) }));
}

/** The `<select>` a name addresses, as markup, so its options can be read. */
function selectMarkup(html: string, name: string): string {
  return new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(html)?.[1] ?? '';
}

/** The values one named select offers, in the order it offers them. */
function offeredValues(html: string, name: string): string[] {
  return [...selectMarkup(html, name).matchAll(/<option value="([^"]*)"/g)].map(([, v]) => v);
}

/** The value the browser opens the named select on. */
function chosenValue(html: string, name: string): string | undefined {
  return [...selectMarkup(html, name).matchAll(/<option[^>]*value="([^"]*)"[^>]*selected/g)].map(
    ([, v]) => v,
  )[0];
}

describe('/meditation/settings offering grids', () => {
  it('offers the goal only on the fifteen-minute grid from 15 to 480', async () => {
    const values = offeredValues(await renderPage(), 'goalMinutes');

    expect(values).toHaveLength(32);
    expect(values[0]).toBe('15');
    expect(values[1]).toBe('30');
    expect(values[values.length - 1]).toBe('480');
    // Fifteens on purpose: a five-minute minimum stepped by fifteen would offer 5, 20, 35.
    expect(values).not.toContain('5');
    expect(values).not.toContain('20');
    expect(values.every((value) => Number(value) % 15 === 0)).toBe(true);
  });

  it('offers the bell interval only from 10 to 120 seconds in steps of ten', async () => {
    const values = offeredValues(await renderPage(), 'intervalSec');

    expect(values).toEqual([
      '600',
      '1200',
      '1800',
      '2400',
      '3000',
      '3600',
      '4200',
      '4800',
      '5400',
      '6000',
      '6600',
      '7200',
    ]);
  });

  it('offers one to six rings and the endless choice that stores repeat: null', async () => {
    const values = offeredValues(await renderPage(), 'repeat');

    expect(values).toEqual(['1', '2', '3', '4', '5', '6', 'until-end']);
    expect(selectMarkup(await renderPage(), 'repeat')).toContain('Until the session ends');
    // A stored `null` is the endless option, so the screen never reads back as "one ring".
    expect(chosenValue(await renderPage(), 'repeat')).toBe('until-end');
  });

  it('draws the bells on/off as a Switch that carries its value into the form post', async () => {
    const html = await renderPage();

    expect(html).toContain('data-slot="switch"');
    expect(html).toContain('aria-label="Interval bells"');
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="bellsEnabled"[^>]*value="on"/);
  });

  it('maps the endless option to repeat: null in both directions', () => {
    // The screen offers the endless choice under the value the save action reads back.
    expect(repeatValue(null)).toBe('until-end');
    expect(repeatFrom('until-end')).toBeNull();
    expect(repeatFrom(null)).toBeNull();
    // Every counted option is its own number, never the endless choice.
    expect(repeatFrom('3')).toBe(3);
    expect(repeatValue(3)).toBe('3');
  });

  it('opens on the stored goal and sitting length, not on the grid minimum', async () => {
    const html = await renderPage();

    expect(chosenValue(html, 'goalMinutes')).toBe('30');
    expect(chosenValue(html, 'plannedMinutes')).toBe('45');
  });
});
