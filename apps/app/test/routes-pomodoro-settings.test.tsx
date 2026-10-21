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

import { readPrefNumber } from '@life/app-kit';
import { DEFAULT_DURATIONS } from '@life/pomodoro';
import PomodoroSettingsPage from '@/app/pomodoro/settings/page';

const mockedReadPrefNumber = readPrefNumber as jest.MockedFunction<typeof readPrefNumber>;

beforeEach(() => {
  jest.resetAllMocks();
  mockedReadPrefNumber.mockImplementation(async (_name, fallback) => fallback);
});

/** React children flattened to one array (single child, list, or mapped list). */
function childList(node: any): any[] {
  const kids = node?.props?.children;
  if (kids == null) return [];
  return (Array.isArray(kids) ? kids : [kids]).flat();
}

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
    const form = childList(page).find((child) => child?.type === 'form');
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
    const form = childList(page).find((child) => child?.type === 'form');
    const block = settingsBlock(form, 'Durations');

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
