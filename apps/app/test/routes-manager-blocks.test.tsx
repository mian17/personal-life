import type { List } from '@life/shared';
import { ManagerBlock, SettingsRow, Switch } from '@life/ui';

jest.mock('@/app/todo-actions', () => ({
  createListAction: jest.fn(),
  deleteListAction: jest.fn(),
  renameListAction: jest.fn(),
}));

import { renameListAction } from '@/app/todo-actions';
import { ImportantDefaultSwitch, ListManagerPanel } from '@/app/list-manager-panel';
import { TOGGLE_DEBOUNCE_MS } from '@/lib/use-debounced-callback';
import { TagManagerSection } from '@/app/tag-manager-section';
import { ListManagerSection } from '@/app/list-manager-section';
import NotesTagsPage from '@/app/notes/tags/page';
import TodosTagsPage from '@/app/todos/tags/page';
import TodosListsPage from '@/app/todos/lists/page';

const mockedRenameListAction = renameListAction as jest.MockedFunction<typeof renameListAction>;

// `ImportantDefaultSwitch` reads its hooks off the raw `react` module exports at
// call time, so spying there intercepts a direct call. `useRef`s are position-keyed
// and persist across renders; `useEffect` is captured so `unmount()` can flush a
// pending write. Timers are faked to drive the shared debounce.
const ReactModule = jest.requireActual<typeof import('react')>('react');

function hookHarness() {
  let refIndex = 0;
  let stateIndex = 0;
  const refs: Array<{ current: any }> = [];
  const state: Array<{ value: any }> = [];
  const effects: Array<() => void> = [];
  const stateSpy = jest.spyOn(ReactModule, 'useState').mockImplementation((((initial: any) => {
    const slot = stateIndex++;
    if (slot >= state.length) {
      state[slot] = { value: typeof initial === 'function' ? initial() : initial };
    }
    return [
      state[slot].value,
      (next: any) => {
        state[slot].value = typeof next === 'function' ? next(state[slot].value) : next;
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
  return {
    begin() {
      refIndex = 0;
      stateIndex = 0;
    },
    unmount() {
      for (const cleanup of effects.splice(0)) cleanup();
    },
    restore() {
      stateSpy.mockRestore();
      refSpy.mockRestore();
      effectSpy.mockRestore();
    },
  };
}

function list(overrides: Partial<List> = {}): List {
  return {
    id: 'l1',
    name: 'Groceries',
    importantDefault: null,
    version: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('manager-page routes on ManagerBlock', () => {
  it('/notes/tags renders ManagerBlock titled Tags backed to /notes/settings', () => {
    const el = NotesTagsPage();

    expect(el.type).toBe(ManagerBlock);
    expect(el.props.title).toBe('Tags');
    expect(el.props.backHref).toBe('/notes/settings');
    expect(el.props.children.type).toBe(TagManagerSection);
  });

  it('/todos/tags renders ManagerBlock titled Tags backed to /todos/settings', () => {
    const el = TodosTagsPage();

    expect(el.type).toBe(ManagerBlock);
    expect(el.props.title).toBe('Tags');
    expect(el.props.backHref).toBe('/todos/settings');
    expect(el.props.children.type).toBe(TagManagerSection);
  });

  it('/todos/lists renders ManagerBlock titled Lists backed to /todos/settings', () => {
    const el = TodosListsPage();

    expect(el.type).toBe(ManagerBlock);
    expect(el.props.title).toBe('Lists');
    expect(el.props.backHref).toBe('/todos/settings');
    expect(el.props.children.type).toBe(ListManagerSection);
  });
});

describe('ListManagerPanel importance-default Switch', () => {
  beforeEach(() => jest.clearAllMocks());

  const rowExtraFor = (lists: List[], id: string, name = 'Groceries') => {
    const el = ListManagerPanel({ lists });
    const row = el.props.rowExtra({ id, name });
    // The extra row is its own module-scope component (`ListRowExtra`, hoisted so
    // the JSX-returning arrow is not defined inside a component). Assertions
    // below still target the `SettingsRow` it renders; evaluate one level.
    return row.type(row.props);
  };

  it.each([
    [true, true],
    [false, false],
    [null, false],
  ])('wraps an Important by default SettingsRow whose switch is checked %p → %p', (importantDefault, expected) => {
    const lists = [list({ importantDefault: importantDefault as boolean | null })];
    const node = rowExtraFor(lists, 'l1');

    expect(node.type).toBe(SettingsRow);
    expect(node.props.label).toBe('Important by default');
    expect(node.props.control.type).toBe(ImportantDefaultSwitch);

    const harness = hookHarness();
    try {
      harness.begin();
      const control = ImportantDefaultSwitch({
        id: 'l1',
        name: 'Groceries',
        importantDefault: importantDefault as boolean | null,
      });
      expect(control.type).toBe(Switch);
      expect(control.props.label).toBe('Default important');
      expect(control.props.checked).toBe(expected);
    } finally {
      harness.restore();
    }
  });

  it('sends the settled value and the list version through renameListAction', () => {
    jest.useFakeTimers();
    const harness = hookHarness();
    try {
      harness.begin();
      const control = ImportantDefaultSwitch({
        id: 'l1',
        name: 'Groceries',
        importantDefault: true,
        version: 7,
      });

      control.props.onCheckedChange(false);
      expect(mockedRenameListAction).not.toHaveBeenCalled();

      jest.advanceTimersByTime(TOGGLE_DEBOUNCE_MS);

      expect(mockedRenameListAction).toHaveBeenCalledTimes(1);
      expect(mockedRenameListAction).toHaveBeenCalledWith('l1', 'Groceries', false, 7);
    } finally {
      harness.restore();
      jest.useRealTimers();
    }
  });

  it('coalesces rapid toggles into one renameListAction with the final value', () => {
    jest.useFakeTimers();
    const harness = hookHarness();
    try {
      harness.begin();
      const control = ImportantDefaultSwitch({
        id: 'l1',
        name: 'Groceries',
        importantDefault: false,
        version: 7,
      });

      control.props.onCheckedChange(true);
      control.props.onCheckedChange(false);
      control.props.onCheckedChange(true);

      jest.advanceTimersByTime(TOGGLE_DEBOUNCE_MS);

      expect(mockedRenameListAction).toHaveBeenCalledTimes(1);
      expect(mockedRenameListAction).toHaveBeenCalledWith('l1', 'Groceries', true, 7);
    } finally {
      harness.restore();
      jest.useRealTimers();
    }
  });

  it('sends nothing when toggled back to the seeded value', () => {
    jest.useFakeTimers();
    const harness = hookHarness();
    try {
      harness.begin();
      const control = ImportantDefaultSwitch({
        id: 'l1',
        name: 'Groceries',
        importantDefault: true,
        version: 7,
      });

      control.props.onCheckedChange(false);
      control.props.onCheckedChange(true);

      jest.advanceTimersByTime(TOGGLE_DEBOUNCE_MS);

      expect(mockedRenameListAction).not.toHaveBeenCalled();
    } finally {
      harness.restore();
      jest.useRealTimers();
    }
  });

  it('renames with the list current default and version', () => {
    const lists = [list({ importantDefault: true, version: 3 })];
    const el = ListManagerPanel({ lists });

    el.props.onRename('l1', 'Food');

    expect(mockedRenameListAction).toHaveBeenCalledWith('l1', 'Food', true, 3);
  });
});
