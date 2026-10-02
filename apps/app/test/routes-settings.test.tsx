import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The settings pages are server components: they read the matrix opt-in through
 * the app's server-only barrel (`@/lib/preferences`, which pulls `next/headers`).
 * Mocking that barrel keeps the server-only module out of the node test env — the
 * real `readPref` must never load here.
 */
jest.mock('@/lib/preferences', () => ({
  readPref: jest.fn(),
  setPref: jest.fn(),
}));

jest.mock('@life/app-kit/preference-action', () => ({
  setPref: jest.fn(),
}));

import { ManagerBlock, SettingsBlock, SettingsRow, ThemeToggle } from '@life/ui';
import { readPref } from '@/lib/preferences';
import { setPref } from '@life/app-kit/preference-action';
import { MatrixSwitch } from '@/app/settings/matrix-switch';
import { TOGGLE_DEBOUNCE_MS } from '@/lib/use-debounced-callback';
import TodosSettingsPage from '@/app/todos/settings/page';
import NotesSettingsPage from '@/app/notes/settings/page';

const mockedReadPref = readPref as jest.MockedFunction<typeof readPref>;

// `MatrixSwitch` reads its hooks off the raw `react` module exports at call time,
// so spying there intercepts a direct call (outside React, `testEnvironment: node`).
const ReactModule = jest.requireActual<typeof import('react')>('react');

/** Run `fn` with `useState`/`useRef`/`useEffect` stubbed; the state and refs are
 *  internal to one call, which is all the switch's change handler needs. */
function withHooks<T>(run: () => T): T {
  const refs: Array<{ current: any }> = [];
  const state: any[] = [];
  let refIndex = 0;
  let stateIndex = 0;
  const effects: Array<() => void> = [];
  const stateSpy = jest.spyOn(ReactModule, 'useState').mockImplementation((((initial: any) => {
    const slot = stateIndex++;
    if (slot >= state.length) {
      state[slot] = typeof initial === 'function' ? initial() : initial;
    }
    return [
      state[slot],
      (next: any) => {
        state[slot] = typeof next === 'function' ? next(state[slot]) : next;
      },
    ];
  }) as unknown) as typeof ReactModule.useState);
  const refSpy = jest.spyOn(ReactModule, 'useRef').mockImplementation(((initial: any) => {
    const slot = refIndex++;
    if (!refs[slot]) refs[slot] = { current: initial };
    return refs[slot];
  }) as unknown as typeof ReactModule.useRef);
  const effectSpy = jest.spyOn(ReactModule, 'useEffect').mockImplementation(((fn: () => void | (() => void)) => {
    const cleanup = fn();
    if (typeof cleanup === 'function') effects.push(cleanup);
  }) as unknown as typeof ReactModule.useEffect);
  try {
    return run();
  } finally {
    stateSpy.mockRestore();
    refSpy.mockRestore();
    effectSpy.mockRestore();
  }
}

/** React children normalized to an array (single child or list). */
function childList(node: any): any[] {
  const kids = node?.props?.children;
  if (kids == null) return [];
  return Array.isArray(kids) ? kids : [kids];
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

describe('/todos/settings page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReadPref.mockResolvedValue(true);
  });

  it('composes ManagerBlock titled Settings backed to /todos', async () => {
    const page = await TodosSettingsPage();

    expect(page.type).toBe(ManagerBlock);
    expect(page.props.title).toBe('Settings');
    expect(page.props.backHref).toBe('/todos');
  });

  it('renders the Appearance Theme row with a ThemeToggle control', async () => {
    const page = await TodosSettingsPage();
    const appearance = settingsBlock(page, 'Appearance');

    expect(appearance).toBeDefined();
    const row = settingsRow(appearance, 'Theme');
    expect(row).toBeDefined();
    expect(row.props.control.type).toBe(ThemeToggle);
  });

  it('renders the Todos matrix row seeding the Switch from readPref', async () => {
    const page = await TodosSettingsPage();
    const todos = settingsBlock(page, 'Todos');

    expect(todos).toBeDefined();
    const row = settingsRow(todos, 'Eisenhower matrix');
    expect(row).toBeDefined();
    expect(row.props.control.type).toBe(MatrixSwitch);
    expect(row.props.control.props.checked).toBe(true);
    expect(mockedReadPref).toHaveBeenCalledWith('matrix');
  });

  it('renders the frozen switch accessible name and checked state', async () => {
    const page = await TodosSettingsPage();
    const html = renderToStaticMarkup(page);

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="Eisenhower matrix"');
    expect(html).toContain('aria-checked="true"');
  });

  it('seeds the switch OFF when the preference is off', async () => {
    mockedReadPref.mockResolvedValue(false);
    const page = await TodosSettingsPage();
    const row = settingsRow(settingsBlock(page, 'Todos'), 'Eisenhower matrix');

    expect(row.props.control.props.checked).toBe(false);
    expect(renderToStaticMarkup(page)).toContain('aria-checked="false"');
  });
});

describe('/notes/settings page wiring', () => {
  it('composes ManagerBlock titled Settings backed to /notes with Appearance only', () => {
    const page = NotesSettingsPage();

    expect(page.type).toBe(ManagerBlock);
    expect(page.props.title).toBe('Settings');
    expect(page.props.backHref).toBe('/notes');

    const blocks = childList(page);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe(SettingsBlock);
    expect(blocks[0].props.title).toBe('Appearance');
  });

  it('renders the Theme row and no matrix switch', () => {
    const page = NotesSettingsPage();
    const row = settingsRow(settingsBlock(page, 'Appearance'), 'Theme');

    expect(row.props.control.type).toBe(ThemeToggle);
    const html = renderToStaticMarkup(page);
    expect(html).not.toContain('Eisenhower matrix');
    expect(html).not.toContain('role="switch"');
  });
});

describe('MatrixSwitch client boundary', () => {
  it('persists through the client-safe action subpath, never the server barrel', () => {
    const source = readFileSync(join(process.cwd(), 'app/settings/matrix-switch.tsx'), 'utf8');

    expect(source).toContain("from '@life/app-kit/preference-action'");
    expect(source).not.toMatch(/from '@life\/app-kit'/);
    expect(source).not.toContain('@/lib/preferences');
    expect(source).not.toContain('readPref(');
  });

  it('reads preferences through the mocked app barrel, not the real next/headers module', () => {
    expect(jest.isMockFunction(readPref)).toBe(true);
  });
});

describe('MatrixSwitch debounce', () => {
  const mockedSetPref = setPref as jest.MockedFunction<typeof setPref>;

  beforeEach(() => {
    mockedSetPref.mockClear();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('coalesces rapid toggles into one setPref after the settle window', () => {
    const control = withHooks(() => MatrixSwitch({ checked: false }));

    control.props.onCheckedChange(true);
    control.props.onCheckedChange(false);
    control.props.onCheckedChange(true);

    expect(mockedSetPref).not.toHaveBeenCalled();

    jest.advanceTimersByTime(TOGGLE_DEBOUNCE_MS);

    expect(mockedSetPref).toHaveBeenCalledTimes(1);
    expect(mockedSetPref).toHaveBeenCalledWith('matrix', true);
  });

  it('sends nothing when toggled back to the seeded value', () => {
    const control = withHooks(() => MatrixSwitch({ checked: true }));

    control.props.onCheckedChange(false);
    control.props.onCheckedChange(true);

    jest.advanceTimersByTime(TOGGLE_DEBOUNCE_MS);

    expect(mockedSetPref).not.toHaveBeenCalled();
  });
});
