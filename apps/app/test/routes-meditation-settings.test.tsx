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

/** The `<input>` a name addresses, as markup, so its attributes can be read. */
function inputMarkup(html: string, name: string): string {
  return new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? '';
}

/** The value the browser opens a named input on. */
function inputValue(html: string, name: string): string | undefined {
  return /value="([^"]*)"/.exec(inputMarkup(html, name))?.[1];
}

/** The number of minutes one attribute of a named input holds, or `undefined` when absent. */
function inputNumber(html: string, name: string, attribute: string): number | undefined {
  const found = new RegExp(`${attribute}="([^"]*)"`).exec(inputMarkup(html, name))?.[1];
  return found === undefined ? undefined : Number(found);
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

  it('takes the goal as a typed whole minute from 15 to 480', async () => {
    const html = await renderPage();
    const field = inputMarkup(html, 'goalMinutes');

    expect(field).toContain('type="number"');
    expect(inputNumber(html, 'goalMinutes', 'min')).toBe(15);
    expect(inputNumber(html, 'goalMinutes', 'max')).toBe(480);
    expect(inputNumber(html, 'goalMinutes', 'step')).toBe(1);
  });

  it('names the goal control and opens it on the stored minutes', async () => {
    const html = await renderPage();

    expect(html).toContain('name="goalMinutes"');
    expect(html).toContain('aria-label="Daily goal"');
    expect(html).toContain('Save goal');
    expect(inputValue(html, 'goalMinutes')).toBe('30');
  });

  it('carries no bells control and no sitting-length control on the route', async () => {
    const html = await renderPage();

    expect(html).not.toContain('Interval bells');
    expect(html).not.toContain('First bell at');
    expect(html).not.toContain('Bell interval');
    expect(html).not.toContain('Rings');
    expect(html).not.toContain('Sitting length');
    expect(html).not.toMatch(/name="(plannedMinutes|offsetSec|intervalSec|repeat|bellsEnabled)"/);
    // The goal is a typed field now, so the route draws no select at all.
    expect(html).not.toContain('<select');
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

  it('sends the typed minutes as typed, not as the fifteen they sit nearest', async () => {
    const page = await renderPageElement();

    await goalForm(page).props.action(formData({ goalMinutes: '23' }));

    expect(mockedSaveSettings).toHaveBeenCalledWith({ ...STORED, goalMinutes: 23 });
  });

  it('refuses an empty or out-of-range field instead of writing it', async () => {
    const page = await renderPageElement();

    await goalForm(page).props.action(formData({ goalMinutes: '' }));
    await goalForm(page).props.action(formData({ goalMinutes: '501' }));

    expect(mockedSaveSettings).not.toHaveBeenCalled();
    expect(mockedRedirect).toHaveBeenCalledTimes(2);
    expect(mockedRedirect).toHaveBeenCalledWith('/meditation/settings?error=save');
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
