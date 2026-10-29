import { ManagerBlock, SettingsBlock, SettingsRow, ThemeToggle, Input } from '@life/ui';
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
jest.mock('@/lib/focus-api', () => ({ listGoals: jest.fn(), setGoal: jest.fn() }));
jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));

import { readPrefNumber } from '@life/app-kit';
import { DEFAULT_DURATIONS, MINUTES_RANGE } from '@life/pomodoro';
import { listGoals, setGoal, type GoalRow } from '@/lib/focus-api';
import { getToday } from '@/lib/today';
import PomodoroSettingsPage from '@/app/pomodoro/settings/page';
import { setPomodoroGoal } from '@/app/pomodoro/actions';

const mockedReadPrefNumber = readPrefNumber as jest.MockedFunction<typeof readPrefNumber>;
const mockedListGoals = listGoals as jest.MockedFunction<typeof listGoals>;
const mockedSetGoal = setGoal as jest.MockedFunction<typeof setGoal>;
const mockedGetToday = getToday as jest.MockedFunction<typeof getToday>;

const TODAY = '2026-10-28';

/** React children flattened to one array (single child, list, or mapped list). */
function childList(node: any): any[] {
  const kids = node?.props?.children;
  if (kids == null) return [];
  return (Array.isArray(kids) ? kids : [kids]).flat();
}

/** The page's tree expanded one level, so a block is found inside the form that wraps it. */
function settingsBlock(page: any, title: string): any {
  return childList(page).find(
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
  return childList(page).find(
    (child) => child?.type === 'form' && settingsBlock(child, title) !== undefined,
  );
}

function goal(day: string, minutes: number): GoalRow {
  return { validFrom: day, minutes };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedReadPrefNumber.mockImplementation(async (_name, fallback) => fallback);
  mockedListGoals.mockResolvedValue([]);
  mockedGetToday.mockResolvedValue(TODAY);
  mockedSetGoal.mockResolvedValue(goal(TODAY, 40));
});

describe('/pomodoro/settings page wiring', () => {
  it('composes ManagerBlock titled Settings backed to /pomodoro', async () => {
    const page = await PomodoroSettingsPage();

    expect(page.type).toBe(ManagerBlock);
    expect(page.props.title).toBe('Settings');
    expect(page.props.backHref).toBe('/pomodoro');
  });

  it('renders the Appearance block with a ThemeToggle control', async () => {
    const page = await PomodoroSettingsPage();
    const block = settingsBlock(page, 'Appearance');

    expect(block).toBeDefined();
    expect(settingsRow(block, 'Theme').props.control.type).toBe(ThemeToggle);
  });

  it('renders the three duration fields bound to their own preference', async () => {
    const page = await PomodoroSettingsPage();
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

    const page = await PomodoroSettingsPage();
    const block = settingsBlock(blockForm(page, 'Durations'), 'Durations');

    expect(settingsRow(block, 'Focus').props.control.props.defaultValue).toBe(40);
    expect(settingsRow(block, 'Short break').props.control.props.defaultValue).toBe(8);
    expect(settingsRow(block, 'Long break').props.control.props.defaultValue).toBe(20);
  });

  it('renders the frozen copy and a back affordance targeting /pomodoro', async () => {
    const html = renderToStaticMarkup(await PomodoroSettingsPage());

    expect(html).toContain('Settings');
    expect(html).toContain('Theme');
    expect(html).toContain('System, light, or dark.');
    expect(html).toContain('Save durations');
    expect(html).toContain('href="/pomodoro"');
  });
});

describe('/pomodoro/settings daily goal row', () => {
  it('opens the input on the goal resolved for today, clamped to the minutes range', async () => {
    mockedListGoals.mockResolvedValue([goal('2026-10-01', 30), goal(TODAY, 40)]);

    const page = await PomodoroSettingsPage();
    const control = settingsRow(settingsBlock(blockForm(page, 'Focus stats'), 'Focus stats'), 'Daily goal')
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

    const page = await PomodoroSettingsPage();
    const control = settingsRow(
      settingsBlock(blockForm(page, 'Focus stats'), 'Focus stats'),
      'Daily goal',
    ).props.control;

    expect(control.props.defaultValue).toBeUndefined();
  });

  it('submits through a server action that writes today with the clamped minutes', async () => {
    const page = await PomodoroSettingsPage();
    const form = blockForm(page, 'Focus stats');

    expect(form.props.action).toBe(setPomodoroGoal);

    mockedGetToday.mockClear();
    await form.props.action(formData({ goal: '40' }));

    expect(mockedGetToday).toHaveBeenCalledTimes(1);
    expect(mockedSetGoal).toHaveBeenCalledWith(TODAY, 40);
  });

  it('clamps an out-of-range minute rather than sending it raw', async () => {
    await setPomodoroGoal(formData({ goal: String(MINUTES_RANGE.max + 40) }));

    expect(mockedSetGoal).toHaveBeenCalledWith(TODAY, DEFAULT_DURATIONS.focus);
  });
});

/** The `FormData` the browser would post for a one-field form. */
function formData(values: Record<string, string>): FormData {
  const data = new FormData();

  for (const [field, value] of Object.entries(values)) data.set(field, value);

  return data;
}
