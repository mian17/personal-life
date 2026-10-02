import type { ReactElement } from 'react';
import type { Todo } from '@life/shared';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('../app/todo-actions', () => ({
  updateTodoAction: jest.fn(),
  deleteTodoAction: jest.fn(),
}));

import { TodoItem } from '../app/todo-item';
import { updateTodoAction } from '../app/todo-actions';

const updateMock = updateTodoAction as jest.Mock;

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
  return renderToStaticMarkup(
    <TodoItem
      todo={todo(overrides)}
      today={TODAY}
      lists={lists}
      availableTags={[]}
      size={size}
    />,
  );
}

// The compiled component reads `useContext` off the raw `react` module exports
// at call time, so spying there intercepts it; the `import * as React`
// namespace is a frozen copy and cannot be.
const ReactModule = jest.requireActual<typeof import('react')>('react');

/** `TodoItem`'s element tree, the props surface a node test can drive. */
type ItemTree = ReactElement<Record<string, unknown>>;

/**
 * `TodoItem` holds no local state; a direct call runs only its `useSnackbar`
 * hook, so the harness stubs `useContext` through the live-module read to
 * capture `showSnackbar` — no `SnackbarProvider` needed. Markup assertions that
 * do not care about the snackbar go through `markup()` instead.
 */
function snackbarHarness() {
  const showSnackbar = jest.fn();
  const ctxSpy = jest
    .spyOn(ReactModule, 'useContext')
    .mockImplementation((() => ({ showSnackbar })) as unknown as typeof ReactModule.useContext);

  function renderTree(options?: { size?: 'default' | 'dense'; overrides?: Partial<Todo> }): ItemTree {
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
    showSnackbar,
    restore: () => ctxSpy.mockRestore(),
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
  it('dense: the ghost done toggle LEADS the row and links to the edit screen', () => {
    const html = markup('dense');
    // First child after the <li> open tag is the toggle button.
    expect(html).toMatch(/<li[^>]*ui-list-item[^>]*>\s*<button[^>]*aria-label="Mark Buy milk done"/);
    expect(html).toContain('ui-icon-btn--ghost');
    expect(html).toMatch(/<a[^>]*class="ui-list-item__link"[^>]*href="\/todos\/t1\/edit"/);
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

  it('default: the ghost square Checkbox LEADS the row (no lucide circle)', () => {
    const html = markup();
    expect(html).toMatch(/<li[^>]*ui-list-item[^>]*>\s*<button[^>]*aria-label="Mark Buy milk done"/);
    expect(html).toContain('ui-icon-btn--ghost');
    expect(html).toContain('ui-checkbox');
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
  it('non-recurring: a tick to done fires the version-checked write and shows the snackbar', () => {
    const harness = snackbarHarness();
    updateMock.mockClear();
    try {
      const first = harness.renderTree();
      doneToggle(first).props.onToggle();

      expect(updateMock).toHaveBeenNthCalledWith(1, 't1', { done: true }, 0);

      expect(harness.showSnackbar).toHaveBeenCalledTimes(1);
      const snackbar = harness.showSnackbar.mock.calls[0][0];
      expect(snackbar.message).toBe('Task completed');
      expect(snackbar.actionLabel).toBe('Undo');
      expect(snackbar.onAction).toBeInstanceOf(Function);
    } finally {
      harness.restore();
    }
  });

  it('non-recurring: a ticked row is never rendered collapsing', () => {
    expect(markup(undefined, { done: true })).not.toContain('ui-list-item--collapsing');
  });

  it('repeating: keeps the row rendered, shows the snackbar, and undoes unconditionally', () => {
    const harness = snackbarHarness();
    updateMock.mockClear();
    try {
      const first = harness.renderTree({ overrides: { repeat: 'daily' } });
      const toggle = doneToggle(first);

      toggle.props.onToggle();

      // The advance write fires immediately, still version-checked.
      expect(updateMock).toHaveBeenNthCalledWith(1, 't1', { done: true }, 0);

      // Snackbar appears immediately, with the one-off copy and action.
      expect(harness.showSnackbar).toHaveBeenCalledTimes(1);
      const snackbar = harness.showSnackbar.mock.calls[0][0];
      expect(snackbar.message).toBe('Task completed');
      expect(snackbar.actionLabel).toBe('Undo');

      // The row stays put — a repeating tick advances and stays open, and the
      // rendered row never carries the collapsed/unmounted class.
      expect(first).not.toBeNull();
      expect(markup(undefined, { repeat: 'daily' })).not.toContain('ui-list-item--collapsing');

      // Undo reverses server-side with no expectedVersion.
      snackbar.onAction();
      expect(updateMock).toHaveBeenNthCalledWith(2, 't1', { done: false });
      expect(updateMock.mock.calls[1]).toEqual(['t1', { done: false }]);
    } finally {
      harness.restore();
    }
  });

  it('does not show a snackbar when clicking an already-done repeating row (the click undoes)', () => {
    const harness = snackbarHarness();
    updateMock.mockClear();
    try {
      const first = harness.renderTree({
        overrides: { repeat: 'daily', done: true },
      });

      doneToggle(first).props.onToggle();

      // The click un-ticks the row; the write is still version-checked.
      expect(updateMock).toHaveBeenNthCalledWith(1, 't1', { done: false }, 0);

      // No snackbar: an un-tick is not a completion, so there is nothing to undo.
      expect(harness.showSnackbar).not.toHaveBeenCalled();
    } finally {
      harness.restore();
    }
  });
});
