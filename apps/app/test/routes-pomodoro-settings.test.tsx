import { SettingsBlock, SettingsRow, SettingsShell, Input } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The page reads the owner's minutes through `readPrefNumber`, which loads
 * `next/headers` inside `@life/app-kit`; mocking the barrel keeps the
 * server-only module out of the node test env and lets the test choose the
 * stored values.
 */
jest.mock('@life/app-kit', () => ({
  readPrefNumber: jest.fn(),
  setPrefNumber: jest.fn(),
}));
/** The goal row reads the owner's goal rows and the request day through these two seams. */
jest.mock('@/lib/focus-api', () => ({
  listGoals: jest.fn(),
  setGoal: jest.fn(),
  readGrantState: jest.fn(),
}));
jest.mock('@/app/focus-grant-toggle', () => ({ FocusGrantToggle: jest.fn(() => null) }));
jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));
jest.mock('@/app/feedback-actions', () => ({ submitFeedbackAction: jest.fn() }));
/** A refused goal leaves the form by redirect; the page reads the flag the action set. */
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));

import { readPrefNumber } from '@life/app-kit';
import { DEFAULT_DURATIONS, MINUTES_RANGE } from '@life/pomodoro';
import { listGoals, readGrantState, setGoal, type GoalRow } from '@/lib/focus-api';
import { getToday } from '@/lib/today';
import { redirect } from 'next/navigation';
import PomodoroSettingsPage from '@/app/pomodoro/settings/page';
import { FocusGrantToggle } from '@/app/focus-grant-toggle';
import { setPomodoroGoal } from '@/app/pomodoro/actions';
import { submitFeedbackAction } from '@/app/feedback-actions';

const mockedReadPrefNumber = readPrefNumber as jest.MockedFunction<typeof readPrefNumber>;
const mockedListGoals = listGoals as jest.MockedFunction<typeof listGoals>;
const mockedReadGrantState = readGrantState as jest.MockedFunction<typeof readGrantState>;
const mockedSetGoal = setGoal as jest.MockedFunction<typeof setGoal>;
const mockedGetToday = getToday as jest.MockedFunction<typeof getToday>;
const mockedRedirect = redirect as jest.MockedFunction<typeof redirect>;

const TODAY = '2026-10-28';

/** React children flattened to one array (single child, list, or mapped list). */
function childList(node: any): any[] {
  const kids = node?.props?.children;
  if (kids == null) return [];
  return (Array.isArray(kids) ? kids : [kids]).flat();
}

/**
 * The page returns one `SettingsShell`; the timer's own groups are its `children`, so both
 * helpers re-root at that child slot (`SPEC-ui-settings-shell` Design 3).
 */
function shellChildren(page: any): any[] {
  return childList(page);
}

/** The block inside a node whose children are blocks — a `<form>` wrapper, or the shell itself. */
function settingsBlock(node: any, title: string): any {
  return childList(node).find(
    (child) => child?.type === SettingsBlock && child.props.title === title,
  );
}

function settingsRow(block: any, label: string): any {
  return childList(block).find(
    (child) => child?.type === SettingsRow && child.props.label === label,
  );
}

/** The `<form>` the page wraps a titled block in; its `action` is that block's write. */
function blockForm(page: any, title: string): any {
  return shellChildren(page).find(
    (child) => child?.type === 'form' && settingsBlock(child, title) !== undefined,
  );
}

function goal(day: string, minutes: number): GoalRow {
  return { validFrom: day, minutes };
}

/** The route takes Next's `searchParams` promise; no flag is the plain form. */
function renderPage(params: { goal?: string } = {}) {
  return PomodoroSettingsPage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedReadPrefNumber.mockImplementation(async (_name, fallback) => fallback);
  mockedListGoals.mockResolvedValue([]);
  mockedGetToday.mockResolvedValue(TODAY);
  mockedSetGoal.mockResolvedValue(goal(TODAY, 40));
  mockedReadGrantState.mockResolvedValue('missing');
});

describe('/pomodoro/settings page wiring', () => {
  it('composes one SettingsShell titled Settings, backed to /pomodoro, wired to pomodoro feedback', async () => {
    const page = await renderPage();

    expect(page.type).toBe(SettingsShell);
    expect(page.props.title).toBe('Settings');
    expect(page.props.backHref).toBe('/pomodoro');
    expect(page.props.app).toBe('pomodoro');
    expect(page.props.onSubmit).toBe(submitFeedbackAction);
  });

  it('renders the Appearance group with no Theme row: the shell draws the segment alone', async () => {
    const html = renderToStaticMarkup(await renderPage());

    expect(html).toContain('role="group" aria-label="Appearance"');
    expect(html).not.toContain('System, light, or dark.');
  });

  it('lays the appearance segment into the settings row: full width, no trough chrome', async () => {
    const html = renderToStaticMarkup(await renderPage());
    const segment = html.match(/role="group" aria-label="Appearance"[^>]*/)?.[0] ?? '';

    expect(segment).toContain('w-full');
    expect(segment).not.toContain('bg-surface-sunken');
  });

  it('renders the Comfort group with the standard Reduce motion copy', async () => {
    const html = renderToStaticMarkup(await renderPage());

    expect(html).toContain('Reduce motion');
    expect(html).toContain(
      'Follows the system setting. Turn it on in iOS Settings › Accessibility.',
    );
  });

  it('renders the three duration fields bound to their own preference', async () => {
    const page = await renderPage();
    const form = blockForm(page, 'Durations');
    const block = settingsBlock(form, 'Durations');

    expect(block).toBeDefined();
    for (const [field, label] of [
      ['focus', 'Focus'],
      ['short', 'Short break'],
      ['long', 'Long break'],
    ] as const) {
      const control = settingsRow(block, label).props.control;
      expect(control.type).toBe(Input);
      expect(control.props.name).toBe(field);
      expect(control.props['aria-label']).toBe(label);
      expect(control.props.defaultValue).toBe(DEFAULT_DURATIONS[field]);
    }
    expect(mockedReadPrefNumber).toHaveBeenCalledWith('pomodoro_focus', DEFAULT_DURATIONS.focus);
    expect(mockedReadPrefNumber).toHaveBeenCalledWith('pomodoro_short', DEFAULT_DURATIONS.short);
    expect(mockedReadPrefNumber).toHaveBeenCalledWith('pomodoro_long', DEFAULT_DURATIONS.long);
  });

  it('renders the stored minutes, not the defaults, when the cookies are set', async () => {
    mockedReadPrefNumber.mockImplementation(async (name) => {
      if (name === 'pomodoro_focus') return 40;
      if (name === 'pomodoro_short') return 8;
      return 20;
    });

    const page = await renderPage();
    const block = settingsBlock(blockForm(page, 'Durations'), 'Durations');

    expect(settingsRow(block, 'Focus').props.control.props.defaultValue).toBe(40);
    expect(settingsRow(block, 'Short break').props.control.props.defaultValue).toBe(8);
    expect(settingsRow(block, 'Long break').props.control.props.defaultValue).toBe(20);
  });

  it('renders the frozen copy, the footer meta line and a back affordance targeting /pomodoro', async () => {
    const html = renderToStaticMarkup(await renderPage());

    expect(html).toContain('Settings');
    expect(html).not.toContain('System, light, or dark.');
    expect(html).toContain('Save durations');
    expect(html).toContain('href="/pomodoro"');
    expect(html).toContain('Reduce motion');
    expect(html).toContain('Personal Life · prototype');
  });

  it('renders the shared Support row as the dialog trigger', async () => {
    const html = renderToStaticMarkup(await renderPage());

    expect(html).toContain('Send feedback');
    expect(html).toContain('Tell us what got in the way.');
  });
});

describe('/pomodoro/settings daily goal row', () => {
  it('opens the input on the goal resolved for today, inside the minutes range', async () => {
    mockedListGoals.mockResolvedValue([goal('2026-10-01', 30), goal(TODAY, 40)]);

    const page = await renderPage();
    const control = settingsRow(settingsBlock(blockForm(page, 'Focus'), 'Focus'), 'Daily goal')
      .props.control;

    expect(control.type).toBe(Input);
    expect(control.props.name).toBe('goal');
    expect(control.props['aria-label']).toBe('Daily goal');
    expect(control.props.min).toBe(MINUTES_RANGE.min);
    expect(control.props.max).toBe(MINUTES_RANGE.max);
    expect(control.props.defaultValue).toBe(40);
    expect(mockedListGoals).toHaveBeenCalledTimes(1);
  });

  it('leaves the input blank when the owner has no goal for today', async () => {
    mockedListGoals.mockResolvedValue([goal('2026-11-01', 50)]);

    const page = await renderPage();
    const control = settingsRow(settingsBlock(blockForm(page, 'Focus'), 'Focus'), 'Daily goal')
      .props.control;

    expect(control.props.defaultValue).toBeUndefined();
  });

  it('submits through a server action that writes today with the minutes the owner typed', async () => {
    const page = await renderPage();
    const form = blockForm(page, 'Focus');

    expect(form.props.action).toBe(setPomodoroGoal);

    mockedGetToday.mockClear();
    await form.props.action(formData({ goal: '40' }));

    expect(mockedGetToday).toHaveBeenCalledTimes(1);
    expect(mockedSetGoal).toHaveBeenCalledWith(TODAY, 40);
  });

  it('sends a refused daily goal back to the form instead of writing a number nobody chose', async () => {
    await setPomodoroGoal(formData({ goal: String(MINUTES_RANGE.max + 1) }));

    expect(mockedRedirect).toHaveBeenCalledWith('/pomodoro/settings?goal=rejected');
    expect(mockedSetGoal).not.toHaveBeenCalled();
  });

  it('shows the refused goal as a message above the button that sent it', async () => {
    const html = renderToStaticMarkup(await renderPage({ goal: 'rejected' }));

    expect(html).toContain('A daily goal is 1 to 180 whole minutes.');
    expect(html).toContain('role="status"');
  });
});

/** The `FormData` the browser would post for a one-field form. */
function formData(values: Record<string, string>): FormData {
  const data = new FormData();

  for (const [field, value] of Object.entries(values)) data.set(field, value);

  return data;
}

describe('/pomodoro/settings Todos row', () => {
  it('adds a Todos group with the grant control, no href: the row acts, it does not route', async () => {
    const page = await renderPage();
    const block = settingsBlock(page, 'Todos');

    expect(block).toBeDefined();
    const row = settingsRow(block, 'Todos');
    expect(row.props.href).toBeUndefined();
    expect(row.props.control.type).toBe(FocusGrantToggle);
    // The row states the limits itself, so the promise is on the screen before the press.
    expect(String(row.props.description)).toContain('cannot be revoked');
  });

  it('seeds the control from the state the service reports, so a grant reads back as one', async () => {
    mockedReadGrantState.mockResolvedValue('granted');

    const row = settingsRow(settingsBlock(await renderPage(), 'Todos'), 'Todos');

    expect(mockedReadGrantState).toHaveBeenCalledTimes(1);
    expect(row.props.control.props.state).toBe('granted');
  });

  it('renders the Allow action while the service reports no grant', async () => {
    mockedReadGrantState.mockResolvedValue('missing');

    const row = settingsRow(settingsBlock(await renderPage(), 'Todos'), 'Todos');

    expect(row.props.control.props.state).toBe('missing');
  });
});
