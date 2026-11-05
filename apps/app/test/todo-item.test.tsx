import type { ReactElement } from 'react';
import type { Todo } from '@life/shared';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('../app/todo-actions', () => ({
  updateTodoAction: jest.fn(),
  deleteTodoAction: jest.fn(),
  completeTodoAction: jest.fn(),
}));

import { TodoItem } from '../app/todo-item';
import { completeTodoAction, updateTodoAction } from '../app/todo-actions';
import { TOGGLE_DEBOUNCE_MS } from '../lib/use-debounced-callback';

const updateMock = updateTodoAction as jest.Mock;
const completeMock = completeTodoAction as jest.Mock;

const TODAY = '2026-10-01';

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: 'Buy milk',
    note: 'a note snippet',
    done: false,
    important: null,
    effectiveImportant: false,
    dueDate: TODAY,
    repeat: null,
    repeatDays: null,
    reminderScheduledAt: null,
    listId: 'l1',
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    version: 0,
    ...overrides,
  };
}

const lists = [{ id: 'l1', name: 'Groceries' }] as any;

function markup(size?: 'default' | 'dense', overrides: Partial<Todo> = {}): string {
  // A real render, so the row's own hooks run and nothing is stubbed.
  return renderReal(
    () =>
      renderToStaticMarkup(
        <TodoItem
          todo={todo(overrides)}
          today={TODAY}
          lists={lists}
          availableTags={[]}
          size={size}
        />,
      ),
    { useState: 0, useContext: 1 },
  );
}

// The compiled component reads `useContext` off the raw `react` module exports
// at call time, so spying there intercepts it; the `import * as React`
// namespace is a frozen copy and cannot be.
const ReactModule = jest.requireActual<typeof import('react')>('react');

/**
 * The harness stubs React's hooks globally, because it calls `TodoItem` as a plain function.
 * A real render of that tree reaches stateful children — the registry `Checkbox` holds its own
 * `useState` and reads its own context — and those must get the real hook, not the harness's.
 * `renderReal` counts the calls that still answer with a stub, so exactly the hooks `TodoItem`
 * itself would call keep the harness behaviour and every hook below it delegates.
 */
interface StubbedHookCalls {
  useState: number;
  useContext: number;
}

let realRender: StubbedHookCalls | null = null;

const realHooks = {
  useState: ReactModule.useState as unknown as (initial: unknown) => [unknown, (next: unknown) => void],
  useContext: ReactModule.useContext as unknown as (context: unknown) => unknown,
  useRef: ReactModule.useRef as unknown as (initial: unknown) => { current: unknown },
  useEffect: ReactModule.useEffect as unknown as (effect: () => void | (() => void)) => void,
};

/** How many of each hook a tree calls above the components under test; the rest are real. */
function renderReal<T>(render: () => T, stubbed: StubbedHookCalls): T {
  realRender = { ...stubbed };
  try {
    return render();
  } finally {
    realRender = null;
  }
}

/** Outside a real render every call is the harness's; inside one, only the counted calls are. */
function takesStub(hook: keyof StubbedHookCalls): boolean {
  if (realRender === null) return true;
  if (realRender[hook] <= 0) return false;
  realRender[hook] -= 1;
  return true;
}

/** `TodoItem`'s element tree; its props surface a node test can drive. */
type ItemTree = ReactElement<Record<string, unknown>>;

/**
 * `TodoItem` now runs `useSnackbar` (`useContext`), one `useState` holding the
 * version-anchored optimistic intent, a `useRef` baseline, and the shared debounce
 * hook (`useRef`/`useEffect`). A direct call is outside React, so the harness stubs
 * each hook through the live-module read: `useContext` captures `showSnackbar`,
 * `useState` returns a harness-owned intent the test can read, position-keyed
 * `useRef`s persist across renders, and `useEffect` captures the debounce cleanup
 * so `unmount()` can flush a pending write. Markup assertions that do not care
 * about state go through `markup()` instead.
 */
function snackbarHarness() {
  const showSnackbar = jest.fn();
  let intent: { version: number; done: boolean } | null = null;
  let renderedVersion = 0;
  let refIndex = 0;
  const refs: Array<{ current: any }> = [];
  const effects: Array<() => void | (() => void)> = [];
  const ctxSpy = jest
    .spyOn(ReactModule, 'useContext')
    .mockImplementation((() => ({ showSnackbar })) as unknown as typeof ReactModule.useContext);
  const stateSpy = jest
    .spyOn(ReactModule, 'useState')
    .mockImplementation(((initial: unknown) => {
      if (!takesStub('useState')) return realHooks.useState(initial);
      return [
        intent,
        (value: typeof intent) => {
          intent = value;
        },
      ];
    }) as unknown as typeof ReactModule.useState);
  const refSpy = jest
    .spyOn(ReactModule, 'useRef')
    .mockImplementation(((initial: unknown) => {
      if (realRender !== null) return realHooks.useRef(initial);
      const slot = refIndex++;
      if (!refs[slot]) refs[slot] = { current: initial };
      return refs[slot];
    }) as unknown as typeof ReactModule.useRef);
  const effectSpy = jest
    .spyOn(ReactModule, 'useEffect')
    .mockImplementation(((fn: () => void | (() => void)) => {
      if (realRender !== null) return realHooks.useEffect(fn);
      effects.push(fn);
    }) as unknown as typeof ReactModule.useEffect);

  function renderTree(options?: { size?: 'default' | 'dense'; overrides?: Partial<Todo> }): ItemTree {
    refIndex = 0;
    effects.length = 0;
    renderedVersion = todo(options?.overrides).version;
    return TodoItem({
      todo: todo(options?.overrides),
      today: TODAY,
      lists,
      availableTags: [],
      size: options?.size,
    }) as unknown as ItemTree;
  }

  return {
    renderTree,
    /**
     * Render the tree the harness built through React. `renderTree` already called `TodoItem`,
     * so its `useState` keeps the harness intent here and its `useSnackbar` is not re-entered.
     */
    renderMarkup: (tree: ItemTree) =>
      renderReal(() => renderToStaticMarkup(tree), { useState: 1, useContext: 0 }),
    showSnackbar,
    get intent() {
      return intent;
    },
    get completed() {
      // Mirror `TodoItem`'s version-anchored `done` for the row last rendered.
      return intent !== null && intent.version === renderedVersion ? intent.done : false;
    },
    unmount: () => {
      for (const fn of effects.splice(0)) {
        const cleanup = fn();
        if (typeof cleanup === 'function') cleanup();
      }
    },
    restore: () => {
      ctxSpy.mockRestore();
      stateSpy.mockRestore();
      refSpy.mockRestore();
      effectSpy.mockRestore();
    },
  };
}

/** Depth-first search for the first element of `type` (optionally matching). */
function findNode(
  node: unknown,
  type: unknown,
  match?: (el: ReactElement<Record<string, unknown>>) => boolean,
): any {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, type, match);
      if (hit) return hit;
    }
    return undefined;
  }
  if (node == null || typeof node !== 'object') return undefined;
  const el = node as ReactElement<Record<string, unknown>>;
  if ((type === undefined || el.type === type) && (!match || match(el))) return el;
  return findNode((el.props as Record<string, unknown>)?.children, type, match);
}

/** `TodoItem`'s done toggle is the leading element carrying the "Mark … " label. */
function doneToggle(tree: ItemTree): any {
  const found = findNode(
    tree.props.leading,
    undefined,
    (el) => typeof (el.props as Record<string, unknown>).label === 'string' &&
      String((el.props as Record<string, unknown>).label).startsWith('Mark '),
  );
  if (!found) throw new Error('no done toggle rendered in the todo item');
  return found;
}

describe('TodoItem sizes', () => {
  it('dense: the done checkbox LEADS the row and links to the edit screen', () => {
    const html = markup('dense');
    // First child after the <li> open tag is the toggle button.
    expect(html).toMatch(/<li[^>]*ui-list-item[^>]*>\s*<button[^>]*aria-label="Mark Buy milk done"/);
    expect(html).toContain('ui-checkbox');
    expect(html).not.toContain('ui-icon-btn');
    expect(html).toMatch(/<a[^>]*class="ui-list-item__link[^"]*"[^>]*href="\/todos\/t1\/edit"/);
  });

  it('dense: the toggle glyph is the square Checkbox atom, checked when done', () => {
    expect(markup('dense')).toContain('ui-checkbox');
    expect(markup('dense', { done: true })).toContain('ui-checkbox--checked');
  });

  it('dense: adds both the todo and dense classes', () => {
    const html = markup('dense');
    expect(html).toContain('ui-list-item--todo');
    expect(html).toContain('ui-list-item--dense');
  });

  it('dense: no delete action, no list name, no note — only the signal due date', () => {
    const html = markup('dense');
    expect(html).toContain('>Today<');
    expect(html).not.toContain('ui-btn--danger');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('ui-list-item__snippet');
    expect(html).not.toContain('Groceries');
    expect(html).not.toContain('a note snippet');
  });

  it('dense: the due date renders through DueDate tone="signal"', () => {
    const html = markup('dense');
    expect(html).toContain('ui-due-date');
    expect(html).toContain('ui-due-date--today');
    expect(html).toContain('ui-due-date--signal');
  });

  it('default: the square Checkbox LEADS the row (no lucide circle)', () => {
    const html = markup();
    expect(html).toMatch(/<li[^>]*ui-list-item[^>]*>\s*<button[^>]*aria-label="Mark Buy milk done"/);
    expect(html).toContain('ui-checkbox');
    expect(html).not.toContain('ui-icon-btn');
    expect(html).not.toContain('<circle');
    expect(html).not.toContain('ui-checkbox--checked');
  });

  it('default: adds the todo class but NOT the dense class', () => {
    const html = markup();
    expect(html).toContain('ui-list-item--todo');
    expect(html).not.toContain('ui-list-item--dense');
  });

  it('default: keeps the delete action, list name and note snippet', () => {
    const html = markup();
    expect(html).toContain('<form');
    expect(html).toMatch(/ui-btn ui-btn--danger/);
    expect(html).toContain('aria-label="Delete Buy milk"');
    expect(html).toContain('Groceries');
    expect(html).toContain('ui-list-item__snippet');
    expect(html).toContain('a note snippet');
  });

  it('default: the due date also renders through DueDate tone="signal"', () => {
    const html = markup();
    expect(html).toContain('ui-due-date');
    expect(html).toContain('ui-due-date--signal');
    expect(html).toContain('>Today<');
  });

  it('done: true marks the row struck/muted with ui-list-item--done', () => {
    const html = markup(undefined, { done: true });
    expect(html).toContain('ui-list-item--done');
  });

  it('a done default row keeps the delete slot in the DOM, hidden from assistive tech', () => {
    const html = markup(undefined, { done: true });
    // Unticking used to INSERT the form (the slot was gated on `!done`), so the row reflowed
    // around it. The slot is now always rendered and `invisible` when done: same node count in
    // both states, still no affordance, because `visibility:hidden` leaves the a11y tree.
    expect(html).toMatch(/<form[^>]*class="invisible"/);
  });

  it('an open default row renders the same delete slot, visible', () => {
    const html = markup();
    expect(html).toContain('<form');
    expect(html).not.toContain('class="invisible"');
  });

  it('a not-yet-done row renders neither --done nor --collapsing initially', () => {
    const html = markup();
    expect(html).not.toContain('ui-list-item--done');
    expect(html).not.toContain('ui-list-item--collapsing');
  });

  it('renders outside a SnackbarProvider without throwing (no-op default)', () => {
    expect(() => markup()).not.toThrow();
  });
});

describe('TodoItem timed and repeat meta', () => {
  it('renders a timed due label with its local time suffix', () => {
    const html = markup(undefined, { dueDate: '2026-10-01T09:30' });
    expect(html).toContain('>Today 09:30<');
  });

  it('renders the repeatLabel when the todo recurs', () => {
    const html = markup(undefined, { repeat: 'weekly' });
    expect(html).toContain('>Weekly (Thursday)<');
  });

  it('renders no repeat text for a non-recurring todo', () => {
    expect(markup()).not.toContain('>Daily<');
    expect(markup()).not.toContain('>Weekly (Thursday)<');
  });
});

describe('TodoItem tick keeps the row visible', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('non-recurring: a tick strikes on the same press, then writes + shows the snackbar after the settle window', () => {
    const harness = snackbarHarness();
    updateMock.mockClear();
    completeMock.mockClear();
    try {
      const first = harness.renderTree();
      expect(harness.completed).toBe(false);
      doneToggle(first).props.onCheckedChange();

      // The row strikes optimistically on the SAME press; the write waits.
      expect(harness.completed).toBe(true);
      expect(completeMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();

      jest.advanceTimersByTime(TOGGLE_DEBOUNCE_MS);

      expect(completeMock).toHaveBeenNthCalledWith(1, 't1', 0);
      expect(updateMock).not.toHaveBeenCalled();

      expect(harness.showSnackbar).toHaveBeenCalledTimes(1);
      const snackbar = harness.showSnackbar.mock.calls[0][0];
      expect(snackbar.message).toBe('Task completed');
      expect(snackbar.actionLabel).toBe('Undo');
      expect(snackbar.onAction).toBeInstanceOf(Function);

      // Undo resets the optimistic strike and reverses server-side unconditionally.
      snackbar.onAction();
      expect(harness.completed).toBe(false);
      expect(harness.intent).toBeNull();
      expect(updateMock).toHaveBeenNthCalledWith(1, 't1', { done: false });
      expect(updateMock.mock.calls[0]).toEqual(['t1', { done: false }]);
    } finally {
      harness.restore();
    }
  });

  it('non-recurring: a ticked row is never rendered collapsing', () => {
    expect(markup(undefined, { done: true })).not.toContain('ui-list-item--collapsing');
  });

  it('repeating: a tick strikes on the same press, then writes through completeTodoAction and undoes unconditionally', () => {
    const harness = snackbarHarness();
    updateMock.mockClear();
    completeMock.mockClear();
    try {
      const first = harness.renderTree({ overrides: { repeat: 'daily' } });
      const toggle = doneToggle(first);

      toggle.props.onCheckedChange();

      // Same path as a non-recurring tick: strike optimistically, then write.
      expect(harness.completed).toBe(true);
      expect(completeMock).not.toHaveBeenCalled();

      jest.advanceTimersByTime(TOGGLE_DEBOUNCE_MS);

      expect(completeMock).toHaveBeenNthCalledWith(1, 't1', 0);
      expect(updateMock).not.toHaveBeenCalled();

      // Snackbar appears when the tick settles, with the one-off copy and action.
      expect(harness.showSnackbar).toHaveBeenCalledTimes(1);
      const snackbar = harness.showSnackbar.mock.calls[0][0];
      expect(snackbar.message).toBe('Task completed');
      expect(snackbar.actionLabel).toBe('Undo');

      // The row stays put — a repeating tick advances and stays open, and the
      // rendered row never carries the collapsed/unmounted class.
      expect(first).not.toBeNull();
      expect(markup(undefined, { repeat: 'daily' })).not.toContain('ui-list-item--collapsing');

      // Undo clears the version anchor and reverses server-side with no
      // expectedVersion.
      snackbar.onAction();
      expect(harness.completed).toBe(false);
      expect(harness.intent).toBeNull();
      expect(updateMock).toHaveBeenNthCalledWith(1, 't1', { done: false });
      expect(updateMock.mock.calls[0]).toEqual(['t1', { done: false }]);
    } finally {
      harness.restore();
    }
  });

  it('repeating: the optimistic strike self-resets when the server advance bumps the version', () => {
    const harness = snackbarHarness();
    updateMock.mockClear();
    completeMock.mockClear();
    try {
      const first = harness.renderTree({ overrides: { repeat: 'daily' } });
      doneToggle(first).props.onCheckedChange();
      expect(harness.intent).toEqual({ version: 0, done: true });

      // Still on the ticked version: the row renders struck.
      const struck = harness.renderTree({ overrides: { repeat: 'daily' } });
      expect(harness.renderMarkup(struck)).toContain('ui-list-item--done');

      // The advance bumped todo.version, so the anchor no longer matches and the
      // strike self-resets — the advanced occurrence renders open.
      const advanced = harness.renderTree({ overrides: { repeat: 'daily', version: 1 } });
      expect(harness.completed).toBe(false);
      expect(harness.renderMarkup(advanced)).not.toContain('ui-list-item--done');
    } finally {
      harness.restore();
    }
  });

  it('does not show a snackbar when clicking an already-done repeating row (the click undoes)', () => {
    const harness = snackbarHarness();
    updateMock.mockClear();
    completeMock.mockClear();
    try {
      const first = harness.renderTree({
        overrides: { repeat: 'daily', done: true },
      });

      doneToggle(first).props.onCheckedChange();
      jest.advanceTimersByTime(TOGGLE_DEBOUNCE_MS);

      // The click un-ticks the row; the write is still version-checked.
      expect(updateMock).toHaveBeenNthCalledWith(1, 't1', { done: false }, 0);
      expect(completeMock).not.toHaveBeenCalled();

      // No snackbar: an un-tick is not a completion, so there is nothing to undo.
      expect(harness.showSnackbar).not.toHaveBeenCalled();
      expect(harness.completed).toBe(false);
    } finally {
      harness.restore();
    }
  });

  it.each([
    ['non-recurring', undefined],
    ['repeating', 'daily'],
  ] as const)('coalesces a burst of presses into one write, reflecting the final state (%s)', (_label, repeat) => {
    const harness = snackbarHarness();
    updateMock.mockClear();
    completeMock.mockClear();
    try {
      // on → off → on: only the final (done) request is sent, once.
      doneToggle(harness.renderTree({ overrides: { repeat } })).props.onCheckedChange();
      doneToggle(harness.renderTree({ overrides: { repeat } })).props.onCheckedChange();
      doneToggle(harness.renderTree({ overrides: { repeat } })).props.onCheckedChange();

      expect(completeMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();

      jest.advanceTimersByTime(TOGGLE_DEBOUNCE_MS);

      expect(completeMock).toHaveBeenCalledTimes(1);
      expect(completeMock).toHaveBeenCalledWith('t1', 0);
      expect(updateMock).not.toHaveBeenCalled();
    } finally {
      harness.restore();
    }
  });

  it.each([
    ['non-recurring', undefined],
    ['repeating', 'daily'],
  ] as const)('sends nothing when a press is reversed back to the origin within the window (%s)', (_label, repeat) => {
    const harness = snackbarHarness();
    updateMock.mockClear();
    completeMock.mockClear();
    try {
      doneToggle(harness.renderTree({ overrides: { repeat } })).props.onCheckedChange(); // on
      doneToggle(harness.renderTree({ overrides: { repeat } })).props.onCheckedChange(); // back off

      jest.advanceTimersByTime(TOGGLE_DEBOUNCE_MS);

      expect(completeMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(harness.showSnackbar).not.toHaveBeenCalled();
      expect(harness.completed).toBe(false);
    } finally {
      harness.restore();
    }
  });

  it('flushes a pending write when the row unmounts before the settle window', () => {
    const harness = snackbarHarness();
    updateMock.mockClear();
    completeMock.mockClear();
    try {
      doneToggle(harness.renderTree()).props.onCheckedChange();
      expect(completeMock).not.toHaveBeenCalled();

      // Unmount before the timer fires: the pending complete write is flushed, not lost.
      harness.unmount();

      expect(completeMock).toHaveBeenCalledTimes(1);
      expect(completeMock).toHaveBeenCalledWith('t1', 0);
    } finally {
      harness.restore();
    }
  });
});
