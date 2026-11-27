import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/meditation-api', () => ({ fetchSettings: jest.fn(), saveSettings: jest.fn() }));
jest.mock('@/app/feedback-actions', () => ({ submitFeedbackAction: jest.fn() }));

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { SettingsBlock, SettingsShell } from '@life/ui';
import { submitFeedbackAction } from '@/app/feedback-actions';
import { fetchSettings, saveSettings, type SettingsRow } from '@/lib/meditation-api';
import MeditationSettingsPage from '@/app/meditation/settings/page';
import { DailyGoalForm } from '@/app/meditation/settings/daily-goal-form';

/**
 * `/meditation/settings` is the shared `SettingsShell` plus the one group the app owns: the daily
 * goal. The shell draws Appearance, Comfort and Support, so the page's own markup is a form around
 * a single `SettingsBlock` — no bells group and no sitting-length control, because the idle screen's
 * stepper and `/meditation`'s bells sheet own those two values now.
 */

const mockedFetchSettings = fetchSettings as jest.MockedFunction<typeof fetchSettings>;
const mockedSaveSettings = saveSettings as jest.MockedFunction<typeof saveSettings>;
const mockedRedirect = redirect as jest.MockedFunction<typeof redirect>;
const mockedRevalidatePath = revalidatePath as jest.MockedFunction<typeof revalidatePath>;

/** A stored row whose sitting length and bells this page never shows, so a save has to carry them. */
const STORED: SettingsRow = {
  goalMinutes: 30,
  plannedMinutes: 45,
  bells: { enabled: true, offsetSec: 300, intervalSec: 600, repeat: null },
};

/** The page's element for one stored row and one query flag. */
async function renderPageElement(
  settings: SettingsRow = STORED,
  params: { error?: string } = {},
): Promise<any> {
  mockedFetchSettings.mockResolvedValue(settings);
  return MeditationSettingsPage({ searchParams: Promise.resolve(params) });
}

/** The page as it renders for one stored row and one query flag. */
async function renderPage(
  settings: SettingsRow = STORED,
  params: { error?: string } = {},
): Promise<string> {
  return renderToStaticMarkup(await renderPageElement(settings, params));
}

/** React children flattened to one array (single child, list, or mapped list). */
function childList(node: any): any[] {
  const kids = node?.props?.children;
  if (kids == null) return [];
  return (Array.isArray(kids) ? kids : [kids]).flat();
}

/** The form the page's one app group renders; its `action` is this route's single write. */
function goalForm(page: any): any {
  const [group] = childList(page);
  return DailyGoalForm(group.props);
}

/** The block the page draws between Comfort and Support. */
function goalBlock(page: any): any {
  return childList(goalForm(page))[0];
}

/** The `<select>` a name addresses, as markup, so its options can be read. */
function selectMarkup(html: string, name: string): string {
  return new RegExp(`<select[^>]*name="${name}"[^>]*>(.*?)</select>`, 's').exec(html)?.[1] ?? '';
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

/** The `FormData` the browser would post for a one-field form. */
function formData(values: Record<string, string>): FormData {
  const data = new FormData();

  for (const [field, value] of Object.entries(values)) data.set(field, value);

  return data;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedSaveSettings.mockResolvedValue(STORED);
});

describe('/meditation/settings through the shared shell', () => {
  it('composes one SettingsShell titled Settings, backed to /meditation, wired to meditation feedback', async () => {
    const page = await renderPageElement();

    expect(page.type).toBe(SettingsShell);
    expect(page.props.title).toBe('Settings');
    expect(page.props.backHref).toBe('/meditation');
    expect(page.props.app).toBe('meditation');
    expect(page.props.onSubmit).toBe(submitFeedbackAction);
  });

  it('adds exactly one app group: a Daily goal block, and no second block beside it', async () => {
    const page = await renderPageElement();

    expect(childList(page)).toHaveLength(1);
    const block = goalBlock(page);
    expect(block.type).toBe(SettingsBlock);
    expect(block.props.title).toBe('Meditation');
    const rows = childList(block);
    expect(rows).toHaveLength(1);
    expect(rows[0].props.label).toBe('Daily goal');
  });

  it('leaves Appearance, Comfort and Support to the shell', async () => {
    const html = await renderPage();

    expect(html).toContain('role="group" aria-label="Appearance"');
    expect(html).toContain('Reduce motion');
    expect(html).toContain(
      'Follows the system setting. Turn it on in iOS Settings › Accessibility.',
    );
    expect(html).toContain('Send feedback');
    expect(html).toContain('Personal Life · prototype');
  });

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

  it('names the goal control and opens it on the stored minutes', async () => {
    const html = await renderPage();

    expect(html).toContain('name="goalMinutes"');
    expect(html).toContain('aria-label="Daily goal"');
    expect(html).toContain('Save goal');
    expect(chosenValue(html, 'goalMinutes')).toBe('30');
  });

  it('carries no bells control and no sitting-length control on the route', async () => {
    const html = await renderPage();

    expect(html).not.toContain('Interval bells');
    expect(html).not.toContain('First bell at');
    expect(html).not.toContain('Bell interval');
    expect(html).not.toContain('Rings');
    expect(html).not.toContain('Sitting length');
    expect(html).not.toMatch(/name="(plannedMinutes|offsetSec|intervalSec|repeat|bellsEnabled)"/);
    // The goal is the screen's only control, so it is its only select.
    expect(html.match(/<select/g)).toHaveLength(1);
  });

  it('saves the goal over the row the service holds, sending plannedMinutes and bells back unchanged', async () => {
    const page = await renderPageElement();
    const form = goalForm(page);

    mockedFetchSettings.mockClear();
    await form.props.action(formData({ goalMinutes: '60' }));

    expect(mockedFetchSettings).toHaveBeenCalledTimes(1);
    expect(mockedSaveSettings).toHaveBeenCalledTimes(1);
    expect(mockedSaveSettings).toHaveBeenCalledWith({
      goalMinutes: 60,
      plannedMinutes: STORED.plannedMinutes,
      bells: STORED.bells,
    });
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/meditation/settings');
  });

  it('sends a refused write back to the page flagged instead of reporting a save', async () => {
    mockedSaveSettings.mockRejectedValue(new Error('meditation-service is down'));

    const page = await renderPageElement();
    await goalForm(page).props.action(formData({ goalMinutes: '60' }));

    expect(mockedRedirect).toHaveBeenCalledWith('/meditation/settings?error=save');
  });

  it('shows the refused write as the banner, and only under the flag', async () => {
    expect(await renderPage(STORED, { error: 'save' })).toContain(
      'Could not save your settings. Try again.',
    );
    expect(await renderPage()).not.toContain('Could not save your settings.');
  });
});
