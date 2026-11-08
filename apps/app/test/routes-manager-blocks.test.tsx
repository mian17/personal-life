import type { List } from '@life/shared';
import { ListManager, ManagerBlock, SettingsRow, Switch } from '@life/ui';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/app/todo-actions', () => ({
  createListAction: jest.fn(),
  deleteListAction: jest.fn(),
  renameListAction: jest.fn(),
}));

jest.mock('@/lib/tags-api', () => ({
  fetchTagPage: jest.fn(),
}));

jest.mock('@/lib/todo-api', () => ({
  fetchListPage: jest.fn(),
}));

import { PreservingSearchBox } from '@life/app-kit';
import { renameListAction } from '@/app/todo-actions';
import { fetchTagPage } from '@/lib/tags-api';
import { fetchListPage } from '@/lib/todo-api';
import { ImportantDefaultSwitch, ListManagerPanel } from '@/app/list-manager-panel';
import { TagManagerPanel } from '@/app/tag-manager-panel';
import { TOGGLE_DEBOUNCE_MS } from '@/lib/use-debounced-callback';
import { TagManagerSection } from '@/app/tag-manager-section';
import { ListManagerSection } from '@/app/list-manager-section';
import NotesTagsPage from '@/app/notes/tags/page';
import TodosTagsPage from '@/app/todos/tags/page';
import TodosListsPage from '@/app/todos/lists/page';

const mockedRenameListAction = renameListAction as jest.MockedFunction<typeof renameListAction>;
const mockedFetchTagPage = fetchTagPage as jest.MockedFunction<typeof fetchTagPage>;
const mockedFetchListPage = fetchListPage as jest.MockedFunction<typeof fetchListPage>;

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

/** A `loadPage` this test never calls: every panel below is built with a null cursor. */
async function unusedLoadPage(): Promise<never> {
  throw new Error('no page 2 in this fixture');
}

/** A rendered element as these assertions read it: its shape, its props, its remount key. */
interface El {
  type: unknown;
  props: any;
  key: string | null;
}

/**
 * The panel is a fragment of [optional banner, manager, optional load-more], because
 * page 1's rows and every appended page render through the one manager. These helpers
 * read the part an assertion is about, so a test proves behaviour through the new
 * shape instead of assuming the panel returns a single element.
 */
function childrenOf(el: El): ReactNode[] {
  const children = el.props.children as ReactNode | ReactNode[];
  return Array.isArray(children) ? children : [children];
}

/**
 * The first element of `type` anywhere below `el`. The section wraps its island in an
 * unlabelled `Section` and the island wraps its rows in a `Card`, so a one-level search
 * would stop at a wrapper; the search follows `children` down instead of assuming how
 * deep the element it wants sits.
 */
function childOfType(el: El, type: unknown): El {
  for (const node of childrenOf(el)) {
    if (typeof node !== 'object' || node === null) continue;
    const child = node as El;
    if (child.type === type) return child;
    if (child.props?.children === undefined) continue;
    try {
      return childOfType(child, type);
    } catch {
      // Not below this child; keep looking among its siblings.
    }
  }
  throw new Error('expected child not found in panel output');
}

/** The `ListManager` a panel renders, found whatever else the fragment carries. */
function listManagerOf(panel: El): El {
  return childOfType(panel, ListManager);
}

/**
 * The island a section mounts, found by component type. A section's wrapper depth is a
 * layout detail; asserting on it would fail the moment the wrapper changes.
 */
function panelOf(section: El, type: unknown): El {
  return childOfType(section, type);
}

/** Builds the lists panel over page 1 only, wrapped in the hook harness the island needs. */
function listPanel(lists: List[], harness: ReturnType<typeof hookHarness>): El {
  harness.begin();
  return ListManagerPanel({
    lists,
    nextCursor: null,
    isFiltered: false,
    loadPage: unusedLoadPage,
  }) as El;
}

describe('manager-page routes on ManagerBlock', () => {
  it('/notes/tags renders ManagerBlock titled Tags backed to /notes/settings', async () => {
    const el = await NotesTagsPage({ searchParams: Promise.resolve({}) });

    expect(el.type).toBe(ManagerBlock);
    expect(el.props.title).toBe('Tags');
    expect(el.props.backHref).toBe('/notes/settings');
    expect(el.props.children.type).toBe(TagManagerSection);
  });

  it('/todos/tags renders ManagerBlock titled Tags backed to /todos/settings', async () => {
    const el = await TodosTagsPage({ searchParams: Promise.resolve({}) });

    expect(el.type).toBe(ManagerBlock);
    expect(el.props.title).toBe('Tags');
    expect(el.props.backHref).toBe('/todos/settings');
    expect(el.props.children.type).toBe(TagManagerSection);
  });

  it('/todos/lists renders ManagerBlock titled Lists backed to /todos/settings', async () => {
    const el = await TodosListsPage({ searchParams: Promise.resolve({}) });

    expect(el.type).toBe(ManagerBlock);
    expect(el.props.title).toBe('Lists');
    expect(el.props.backHref).toBe('/todos/settings');
    expect(el.props.children.type).toBe(ListManagerSection);
  });
});

describe('manager pages carry the q search param to their section', () => {
  it('passes the param and its own route down, so a filter change lands here', async () => {
    const lists = await TodosListsPage({ searchParams: Promise.resolve({ q: 'gro' }) });
    const todosTags = await TodosTagsPage({ searchParams: Promise.resolve({ q: 'gro' }) });
    const notesTags = await NotesTagsPage({ searchParams: Promise.resolve({ q: 'gro' }) });

    expect(lists.props.children.props).toMatchObject({ path: '/todos/lists', q: 'gro' });
    expect(todosTags.props.children.props).toMatchObject({ path: '/todos/tags', q: 'gro' });
    expect(notesTags.props.children.props).toMatchObject({ path: '/notes/tags', q: 'gro' });
  });
});

describe('manager sections carry the shared search box', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the one app-kit search box, bound to the q param and its own route', async () => {
    mockedFetchListPage.mockResolvedValue({ lists: [], nextCursor: null, total: 0 });
    mockedFetchTagPage.mockResolvedValue({ tags: [], nextCursor: null });

    const lists = await ListManagerSection({ path: '/todos/lists', q: 'gro' });
    const notesTags = await TagManagerSection({ path: '/notes/tags', q: 'gar' });

    const boxOf = (section: El) => childOfType(section, PreservingSearchBox).props;

    // The repo's one search box, not a second one: same component /notes and /meals/foods use.
    expect(boxOf(lists)).toMatchObject({ path: '/todos/lists', q: 'gro', label: 'Search lists' });
    expect(boxOf(notesTags)).toMatchObject({ path: '/notes/tags', q: 'gar', label: 'Search tags' });
  });
});

describe('manager sections read page 1 with the query', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads one filtered lists page on the server, handing the cursor to the island', async () => {
    mockedFetchListPage.mockResolvedValue({ lists: [list()], nextCursor: 'c2', total: 9 });

    const el = await ListManagerSection({ path: '/todos/lists', q: 'gro' });
    const panel = panelOf(el, ListManagerPanel);

    // One request: the rest of the list is the island's job, by cursor.
    expect(mockedFetchListPage).toHaveBeenCalledTimes(1);
    expect(mockedFetchListPage).toHaveBeenCalledWith({ q: 'gro' });
    expect(panel.type).toBe(ListManagerPanel);
    expect(panel.props.nextCursor).toBe('c2');
  });

  it('carries the query into every appended lists page', async () => {
    mockedFetchListPage.mockResolvedValue({ lists: [], nextCursor: null, total: 0 });

    const el = await ListManagerSection({ path: '/todos/lists', q: 'gro' });
    const panel = panelOf(el, ListManagerPanel);

    await panel.props.loadPage('c2');

    expect(mockedFetchListPage).toHaveBeenLastCalledWith({ q: 'gro', cursor: 'c2' });
  });

  it('reads one filtered tags page on the server, handing the cursor to the island', async () => {
    mockedFetchTagPage.mockResolvedValue({
      tags: [{ id: 1, name: 'garden', version: 0, createdAt: '2026-01-01T00:00:00.000Z' }],
      nextCursor: 'c2',
    });

    const el = await TagManagerSection({ path: '/notes/tags', q: 'gar' });
    const panel = panelOf(el, TagManagerPanel);

    expect(mockedFetchTagPage).toHaveBeenCalledTimes(1);
    expect(mockedFetchTagPage).toHaveBeenCalledWith({ q: 'gar' });
    expect(panel.type).toBe(TagManagerPanel);
    expect(panel.props.tags).toEqual([{ id: 1, name: 'garden' }]);
    expect(panel.props.nextCursor).toBe('c2');
  });

  it('carries the query into every appended tags page', async () => {
    mockedFetchTagPage.mockResolvedValue({ tags: [], nextCursor: null });

    const el = await TagManagerSection({ path: '/notes/tags', q: 'gar' });
    const panel = panelOf(el, TagManagerPanel);

    await panel.props.loadPage('c2');

    expect(mockedFetchTagPage).toHaveBeenLastCalledWith({ q: 'gar', cursor: 'c2' });
  });

  it('keys the island on the query, so a changed filter remounts page 1', async () => {
    mockedFetchTagPage.mockResolvedValue({ tags: [], nextCursor: null });

    const unfiltered = await TagManagerSection({ path: '/notes/tags' });
    const filtered = await TagManagerSection({ path: '/notes/tags', q: 'gar' });

    const keyOf = (el: El) => panelOf(el, TagManagerPanel).key;

    // A remount is the reset: the old cursor can never continue the new result set.
    expect(keyOf(unfiltered)).not.toBe(keyOf(filtered));
  });
});

describe('the manager islands page their rows', () => {
  it('renders page-1 rows and one load-more control while a cursor exists', () => {
    const html = renderToStaticMarkup(
      <ListManagerPanel
        lists={[list(), list({ id: 'l2', name: 'Work' })]}
        nextCursor="c2"
        isFiltered={false}
        loadPage={unusedLoadPage}
      />,
    );

    expect(html).toContain('Groceries');
    expect(html).toContain('Work');
    expect(html.match(/>Load more</g)).toHaveLength(1);
  });

  it('renders no load-more control once the list is exhausted', () => {
    const html = renderToStaticMarkup(
      <ListManagerPanel
        lists={[list()]}
        nextCursor={null}
        isFiltered={false}
        loadPage={unusedLoadPage}
      />,
    );

    expect(html).toContain('Groceries');
    expect(html).not.toContain('Load more');
  });

  it('renders only the rows a filtered page-1 envelope carried', () => {
    const html = renderToStaticMarkup(
      <ListManagerPanel
        lists={[list({ name: 'Groceries' })]}
        nextCursor={null}
        isFiltered
        loadPage={unusedLoadPage}
      />,
    );

    expect(html).toContain('Groceries');
    expect(html).not.toContain('Work');
  });

  it('says the filter matched nothing instead of showing an empty manager', () => {
    const html = renderToStaticMarkup(
      <ListManagerPanel lists={[]} nextCursor={null} isFiltered loadPage={unusedLoadPage} />,
    );

    expect(html).toContain('No matches.');
    expect(html).toContain('No list name contains that text.');
  });

  it('renders the tag manager rows and its own load-more control', () => {
    const html = renderToStaticMarkup(
      <TagManagerPanel
        tags={[{ id: 1, name: 'garden' }, { id: 2, name: 'work' }]}
        nextCursor="c2"
        isFiltered={false}
        loadPage={unusedLoadPage}
      />,
    );

    expect(html).toContain('garden');
    expect(html).toContain('work');
    expect(html.match(/>Load more</g)).toHaveLength(1);
  });
});

describe('ListManagerPanel importance-default Switch', () => {
  beforeEach(() => jest.clearAllMocks());

  const rowExtraFor = (
    lists: List[],
    id: string,
    name = 'Groceries',
    harness = hookHarness(),
  ) => {
    try {
      const el = listPanel(lists, harness);
      // `rowExtra` is a prop of the `ListManager` the panel renders; reading it there
      // is the same wiring the panel hands to the primitive.
      const row = listManagerOf(el).props.rowExtra({ id, name });
      // The extra row is its own module-scope component (`ListRowExtra`, hoisted so
      // the JSX-returning arrow is not defined inside a component). Assertions
      // below still target the `SettingsRow` it renders; evaluate one level.
      return row.type(row.props);
    } finally {
      harness.restore();
    }
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
    const harness = hookHarness();
    try {
      const lists = [list({ importantDefault: true, version: 3 })];
      const manager = listManagerOf(listPanel(lists, harness));

      manager.props.onRename('l1', 'Food');

      expect(mockedRenameListAction).toHaveBeenCalledWith('l1', 'Food', true, 3);
    } finally {
      harness.restore();
    }
  });

  it('renames a row that only page 2 delivered, from that row own version', () => {
    const harness = hookHarness();
    try {
      // The merged rows are what the panel hands the manager: here page 2's row, whose
      // default and version page 1 never carried.
      const lists = [list(), list({ id: 'l2', name: 'Work', importantDefault: true, version: 5 })];
      const manager = listManagerOf(listPanel(lists, harness));

      manager.props.onRename('l2', 'Job');

      expect(mockedRenameListAction).toHaveBeenCalledWith('l2', 'Job', true, 5);
    } finally {
      harness.restore();
    }
  });

  it('deletes the row it was invoked on, by id', () => {
    const harness = hookHarness();
    try {
      const manager = listManagerOf(listPanel([list()], harness));

      manager.props.onDelete('l1');

      expect(jest.requireMock('@/app/todo-actions').deleteListAction).toHaveBeenCalledWith('l1');
    } finally {
      harness.restore();
    }
  });
});
