import type { ReactElement, ReactNode } from 'react';
import type { List, Todo } from '@life/shared';
import {
  Button,
  DueDatePill,
  Field,
  IconButton,
  Input,
  Menu,
  Select,
  Switch,
  type SwitchProps,
  type TagOption,
} from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

const mockBack = jest.fn();
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    const error = new Error('NEXT_NOT_FOUND');
    (error as { digest?: string }).digest = 'NEXT_NOT_FOUND';
    throw error;
  }),
  useRouter: () => ({
    back: mockBack,
    forward: jest.fn(),
    refresh: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));
jest.mock('@/lib/todo-api', () => ({
  getTodo: jest.fn(),
  listLists: jest.fn(),
}));
jest.mock('@/lib/tags-api', () => ({
  listTags: jest.fn(),
}));
jest.mock('@/app/todo-actions', () => ({
  createTodoAction: jest.fn(),
  updateTodoAction: jest.fn(),
  deleteTodoAction: jest.fn(),
}));

import { notFound } from 'next/navigation';
import { getTodo, listLists } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { createTodoAction, deleteTodoAction, updateTodoAction } from '@/app/todo-actions';
import EditTodoPage from '@/app/todos/[id]/edit/page';
import { TodoEditor } from '@/app/todo-editor';
import { RecurrenceDialog } from '@/app/recurrence-dialog';

const mockedGetTodo = getTodo as jest.MockedFunction<typeof getTodo>;
const mockedListLists = listLists as jest.MockedFunction<typeof listLists>;
const mockedListTags = listTags as jest.MockedFunction<typeof listTags>;
const mockedNotFound = notFound as jest.MockedFunction<typeof notFound>;
const mockedCreateTodoAction = createTodoAction as jest.MockedFunction<typeof createTodoAction>;
const mockedUpdateTodoAction = updateTodoAction as jest.MockedFunction<typeof updateTodoAction>;
const mockedDeleteTodoAction = deleteTodoAction as jest.MockedFunction<typeof deleteTodoAction>;

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: 'Buy milk',
    note: 'two litres',
    done: false,
    important: null,
    effectiveImportant: false,
    dueDate: '2026-10-02',
    repeat: null,
    repeatDays: null,
    reminderScheduledAt: null,
    listId: 'l1',
    tagIds: [7],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    version: 3,
    ...overrides,
  };
}

describe('/todos/[id]/edit page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListLists.mockResolvedValue([
      {
        id: 'l1',
        name: 'Groceries',
        importantDefault: null,
        version: 0,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ] as List[]);
    mockedListTags.mockResolvedValue([
      { id: 7, name: 'errand', version: 0, createdAt: '2026-09-01T00:00:00.000Z' },
    ]);
  });

  it('loads the todo through loadOrNotFound and feeds the editor', async () => {
    const fixture = todo();
    mockedGetTodo.mockResolvedValue(fixture);

    const el = await EditTodoPage({ params: Promise.resolve({ id: 't1' }) });

    expect(mockedGetTodo).toHaveBeenCalledWith('t1');
    expect(el.type).toBe(TodoEditor);
    expect(el.props.todo).toBe(fixture);
    expect(el.props.lists).toEqual([
      {
        id: 'l1',
        name: 'Groceries',
        importantDefault: null,
        version: 0,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
    expect(el.props.availableTags).toEqual([{ id: 7, name: 'errand' }]);
  });

  it('renders the edit-mode title and save action labels', async () => {
    mockedGetTodo.mockResolvedValue(todo());

    const el = await EditTodoPage({ params: Promise.resolve({ id: 't1' }) });
    const html = renderToStaticMarkup(el);

    expect(html).toContain('Edit Todo');
    expect(html).toContain('aria-label="Save todo"');
  });

  it('renders the create-mode title and add action labels for a new todo', () => {
    const html = renderToStaticMarkup(<TodoEditor lists={[]} availableTags={[]} />);

    expect(html).toContain('New Todo');
    expect(html).toContain('aria-label="Add todo"');
  });

  it('routes a 404-shaped loader failure through notFound()', async () => {
    mockedGetTodo.mockRejectedValue({ status: 404, message: 'gone' });

    await expect(
      EditTodoPage({ params: Promise.resolve({ id: 'missing' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockedNotFound).toHaveBeenCalled();
    expect(mockedListLists).not.toHaveBeenCalled();
  });

  it('rethrows a non-404 failure without calling notFound()', async () => {
    mockedGetTodo.mockRejectedValue({ status: 500, message: 'boom' });

    await expect(
      EditTodoPage({ params: Promise.resolve({ id: 't1' }) }),
    ).rejects.toEqual({ status: 500, message: 'boom' });

    expect(mockedNotFound).not.toHaveBeenCalled();
  });
});

const editorLists: List[] = [
  {
    id: 'l1',
    name: 'Groceries',
    importantDefault: null,
    version: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'l2',
    name: 'Work',
    importantDefault: true,
    version: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

const noTags: TagOption[] = [];

// The compiled component reads `useState` off the raw `react` module exports at
// call time (named imports compile to `react_1.useState(...)`), so spying there
// intercepts it; the `import * as React` namespace is a frozen copy and cannot be.
const ReactModule = jest.requireActual<typeof import('react')>('react');
const realUseState = ReactModule.useState;

/** `renderToStaticMarkup` needs a working hook; this passes through to the real one. */
function withRealUseState<T>(run: () => T): T {
  const spy = jest
    .spyOn(ReactModule, 'useState')
    .mockImplementation(
      ((initial: unknown) => realUseState(initial as never)) as unknown as typeof realUseState,
    );
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

interface EditorTree extends ReactElement {
  props: {
    children: EditorField[];
    /** The toolbar actions fragment: the save check, plus the edit-mode actions menu. */
    actions: ReactNode;
  };
}

interface EditorField extends ReactElement {
  props: {
    'aria-label'?: string;
    value?: string;
    options?: Array<{ value: string; label: string }>;
    onChange?: (event: { target: { value: string } }) => void;
  };
}

/**
 * `apps/app` runs with `testEnvironment: "node"` (no jsdom/renderer), so state
 * and handlers are observed through the element tree. `react`'s named exports
 * compile to live `react.useState` reads, so a stateful stub can be spied in
 * place: a direct `TodoEditor(...)` call runs only the editor's own hooks, and
 * re-invoking it picks up a change made through a setter captured from the
 * previous tree — which is how "toggle the Switch, then Save" is exercised.
 */
function stateHarness() {
  let store: unknown[] = [];
  const spy = jest.spyOn(ReactModule, 'useState');

  function renderTree(todo?: Todo): EditorTree {
    let index = 0;
    spy.mockImplementation(((initial: unknown) => {
      const i = index++;
      if (i >= store.length) {
        store[i] =
          typeof initial === 'function' ? (initial as () => unknown)() : initial;
      }
      const set = (next: unknown) => {
        store[i] =
          typeof next === 'function' ? (next as (prev: unknown) => unknown)(store[i]) : next;
      };
      return [store[i], set];
    }) as typeof realUseState);
    return TodoEditor({ todo, lists: editorLists, availableTags: noTags }) as EditorTree;
  }

  return { renderTree, restore: () => spy.mockRestore() };
}

function findByType(
  node: unknown,
  type: unknown,
  match?: (el: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByType(child, type, match);
      if (hit) return hit;
    }
    return undefined;
  }
  if (node == null || typeof node !== 'object') return undefined;
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === type && (!match || match(el))) return el;
  return findByType(el.props?.children, type, match);
}

function switchOf(tree: EditorTree): ReactElement<SwitchProps> {
  const found = findByType(tree.props.children, Switch);
  if (!found) throw new Error('no Switch rendered in the todo editor');
  return found as unknown as ReactElement<SwitchProps>;
}

/** The `Field` whose visible caption is `label`. */
function field(tree: EditorTree, label: string): ReactElement<Record<string, unknown>> | undefined {
  return findByType(tree.props.children, Field, (el) => el.props.label === label);
}

/** The toolbar's save control (the check `IconButton`), whatever rides beside it. */
function saveButton(tree: EditorTree): ReactElement<{ onClick: () => void | Promise<void>; label?: string; disabled?: boolean }> {
  const found = findByType(tree.props.actions, IconButton);
  if (!found) throw new Error('no save IconButton in the todo editor toolbar');
  return found as unknown as ReactElement<{ onClick: () => void | Promise<void>; label?: string; disabled?: boolean }>;
}

/** The field (`Input`) selected by its accessible name. */
function inputByLabel(tree: EditorTree, label: string): EditorField {
  const found = findByType(
    tree.props.children,
    Input,
    (el) => el.props['aria-label'] === label,
  );
  if (!found) throw new Error(`no Input labelled ${label}`);
  return found as unknown as EditorField;
}

/** The field (`Select`) selected by its accessible name. */
function selectByLabel(tree: EditorTree, label: string): EditorField {
  const found = findByType(
    tree.props.children,
    Select,
    (el) => el.props['aria-label'] === label,
  );
  if (!found) throw new Error(`no Select labelled ${label}`);
  return found as unknown as EditorField;
}

describe('TodoEditor save awaits the write before navigating', () => {
  beforeEach(() => jest.clearAllMocks());

  function renderEditing() {
    const harness = stateHarness();
    const tree = harness.renderTree(todo());
    return { harness, tree };
  }

  it('does not navigate back until updateTodoAction resolves', async () => {
    let resolveAction!: () => void;
    mockedUpdateTodoAction.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAction = resolve;
      }),
    );

    const { harness, tree } = renderEditing();
    try {
      const pending = saveButton(tree).props.onClick();

      // The old fire-and-forget code called `router.back()` in the same tick.
      expect(mockBack).not.toHaveBeenCalled();

      resolveAction();
      await pending;

      expect(mockBack).toHaveBeenCalledTimes(1);
    } finally {
      harness.restore();
    }
  });

  it('does not navigate back when the write fails', async () => {
    mockedUpdateTodoAction.mockRejectedValue(new Error('boom'));

    const { harness, tree } = renderEditing();
    try {
      await saveButton(tree).props.onClick();

      expect(mockBack).not.toHaveBeenCalled();
    } finally {
      harness.restore();
    }
  });

  it('ignores a second save while the first is still in flight', async () => {
    let resolveAction!: () => void;
    mockedUpdateTodoAction.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAction = resolve;
      }),
    );

    const { harness, tree } = renderEditing();
    try {
      const first = saveButton(tree).props.onClick();

      // Re-render picks up the `saving` state, so the button is disabled and the
      // handler is a no-op until the in-flight write settles.
      const second = harness.renderTree(todo());
      expect(saveButton(second).props.disabled).toBe(true);
      await saveButton(second).props.onClick();

      resolveAction();
      await first;

      expect(mockedUpdateTodoAction).toHaveBeenCalledTimes(1);
      expect(mockBack).toHaveBeenCalledTimes(1);
    } finally {
      harness.restore();
    }
  });
});

describe('TodoEditor important Switch', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('seed', () => {
    it.each<[string, Partial<Todo>, boolean]>([
      ['stored override true wins', { important: true, effectiveImportant: false }, true],
      ['stored override false wins', { important: false, effectiveImportant: true }, false],
      ['null + effective true inherits true', { important: null, effectiveImportant: true }, true],
      ['null + effective false inherits false', { important: null, effectiveImportant: false }, false],
    ])('%s', (_name, overrides, expected) => {
      const harness = stateHarness();
      try {
        const node = switchOf(harness.renderTree(todo(overrides)));
        expect(node.type).toBe(Switch);
        expect(node.props.label).toBe('Important');
        expect(node.props.checked).toBe(expected);
      } finally {
        harness.restore();
      }
    });

    it('create mode seeds checked={false}', () => {
      const harness = stateHarness();
      try {
        const node = switchOf(harness.renderTree(undefined));
        expect(node.props.label).toBe('Important');
        expect(node.props.checked).toBe(false);
      } finally {
        harness.restore();
      }
    });

    it('wraps the switch in a Field captioned Important', () => {
      const harness = stateHarness();
      try {
        const block = field(harness.renderTree(todo()), 'Important');
        expect(block?.type).toBe(Field);
        expect(block!.props.label).toBe('Important');
        expect(findByType(block!.props.children, Switch)).toBeDefined();
      } finally {
        harness.restore();
      }
    });

    it("create mode seeds from the selected list's importantDefault", () => {
      const harness = stateHarness();
      try {
        const first = harness.renderTree(undefined);
        expect(switchOf(first).props.checked).toBe(false);

        selectByLabel(first, 'List').props.onChange!({ target: { value: 'l2' } });

        const second = harness.renderTree(undefined);
        const node = switchOf(second);
        expect(node.props.label).toBe('Important');
        expect(node.props.checked).toBe(true);
      } finally {
        harness.restore();
      }
    });

    it.each<[boolean, string]>([
      [true, 'true'],
      [false, 'false'],
    ])('marks up role/name/aria-checked for important %p', (important, checked) => {
      const html = withRealUseState(() =>
        renderToStaticMarkup(
          <TodoEditor
            todo={todo({ important, effectiveImportant: important })}
            lists={editorLists}
            availableTags={noTags}
          />,
        ),
      );

      expect(html).toContain('role="switch"');
      expect(html).toContain('aria-label="Important"');
      expect(html).toContain(`aria-checked="${checked}"`);
    });
  });

  describe('write', () => {
    it('saves the toggled explicit override through updateTodoAction', async () => {
      const fixture = todo({ important: true, effectiveImportant: true, version: 3 });
      const harness = stateHarness();
      try {
        const first = switchOf(harness.renderTree(fixture));
        expect(first.props.checked).toBe(true);

        first.props.onCheckedChange!(false);

        const second = harness.renderTree(fixture);
        expect(saveButton(second).props.label).toBe('Save todo');
        await saveButton(second).props.onClick();

        expect(mockedUpdateTodoAction).toHaveBeenCalledTimes(1);
        const [id, patch, version] = mockedUpdateTodoAction.mock.calls[0];
        expect(id).toBe('t1');
        expect(version).toBe(3);
        expect(patch).toEqual({
          title: 'Buy milk',
          note: 'two litres',
          dueDate: '2026-10-02',
          repeat: null,
          listId: 'l1',
          tagIds: [7],
          important: false,
        });
      } finally {
        harness.restore();
      }
    });

    it('creates with the toggled explicit override through createTodoAction', async () => {
      const harness = stateHarness();
      try {
        const first = switchOf(harness.renderTree(undefined));
        expect(first.props.checked).toBe(false);

        first.props.onCheckedChange!(true);
        inputByLabel(harness.renderTree(undefined), 'Todo title').props.onChange!({
          target: { value: 'New task' },
        });

        const second = harness.renderTree(undefined);
        expect(saveButton(second).props.label).toBe('Add todo');
        await saveButton(second).props.onClick();

        expect(mockedCreateTodoAction).toHaveBeenCalledTimes(1);
        const [input] = mockedCreateTodoAction.mock.calls[0];
        expect(input).toEqual({
          title: 'New task',
          note: undefined,
          dueDate: undefined,
          repeat: null,
          listId: undefined,
          tagIds: [],
          important: true,
        });
      } finally {
        harness.restore();
      }
    });

    it('edit mode untouched save omits important so an inheriting todo stays null', () => {
      const fixture = todo({ important: null, effectiveImportant: true, version: 3 });
      const harness = stateHarness();
      try {
        const tree = harness.renderTree(fixture);
        expect(switchOf(tree).props.checked).toBe(true);

        saveButton(tree).props.onClick();

        expect(mockedUpdateTodoAction).toHaveBeenCalledTimes(1);
        const [, patch] = mockedUpdateTodoAction.mock.calls[0];
        expect('important' in patch).toBe(false);
      } finally {
        harness.restore();
      }
    });

    it('create mode untouched save omits important', () => {
      const harness = stateHarness();
      try {
        inputByLabel(harness.renderTree(undefined), 'Todo title').props.onChange!({
          target: { value: 'New task' },
        });

        const tree = harness.renderTree(undefined);
        saveButton(tree).props.onClick();

        expect(mockedCreateTodoAction).toHaveBeenCalledTimes(1);
        const [input] = mockedCreateTodoAction.mock.calls[0];
        expect('important' in input).toBe(false);
      } finally {
        harness.restore();
      }
    });
  });
});

describe('TodoEditor Time and Repeat fields', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders Fields captioned Time and Repeat', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree(todo({ dueDate: '2026-10-05' }));

      expect(field(tree, 'Time')?.type).toBe(Field);
      expect(inputByLabel(tree, 'Due time').props['aria-label']).toBe('Due time');

      const repeat = field(tree, 'Repeat');
      expect(repeat?.type).toBe(Field);
      const select = findByType(repeat!.props.children, Select);
      expect(select).toBeDefined();
      expect((select!.props.options as Array<{ value: string; label: string }>)[0]).toEqual({
        value: '',
        label: 'None',
      });
    } finally {
      harness.restore();
    }
  });

  it('reveals Time and Repeat once a due date is set', () => {
    const harness = stateHarness();
    try {
      const none = harness.renderTree(todo({ dueDate: null }));
      expect(field(none, 'Time')).toBeUndefined();
      expect(field(none, 'Repeat')).toBeUndefined();

      inputByLabel(none, 'Due date').props.onChange!({ target: { value: '2026-10-05' } });
      const withDue = harness.renderTree(todo({ dueDate: null }));
      expect(field(withDue, 'Time')).toBeDefined();
      expect(field(withDue, 'Repeat')).toBeDefined();
    } finally {
      harness.restore();
    }
  });

  it('clearing the due date drops Time and Repeat so nothing orphaned can be saved', async () => {
    const fixture = todo({ dueDate: '2026-10-05T09:30', repeat: 'weekly', version: 3 });
    const harness = stateHarness();
    try {
      const first = harness.renderTree(fixture);
      expect(field(first, 'Time')?.type).toBe(Field);
      expect(field(first, 'Repeat')?.type).toBe(Field);

      inputByLabel(first, 'Due date').props.onChange!({ target: { value: '' } });
      const cleared = harness.renderTree(fixture);
      expect(field(cleared, 'Time')).toBeUndefined();
      expect(field(cleared, 'Repeat')).toBeUndefined();

      await saveButton(cleared).props.onClick();
      expect(mockedUpdateTodoAction).toHaveBeenCalledTimes(1);
      const [, patch] = mockedUpdateTodoAction.mock.calls[0];
      expect(patch.dueDate).toBeNull();
      expect(patch.repeat).toBeNull();
    } finally {
      harness.restore();
    }
  });

  it('joins date + time into dueDate and carries repeat in the save payload', async () => {
    const fixture = todo({ dueDate: null, repeat: null, version: 3 });
    const harness = stateHarness();
    try {
      const first = harness.renderTree(fixture);
      inputByLabel(first, 'Due date').props.onChange!({ target: { value: '2026-10-05' } });

      const second = harness.renderTree(fixture);
      inputByLabel(second, 'Due time').props.onChange!({ target: { value: '09:30' } });

      const third = harness.renderTree(fixture);
      selectByLabel(third, 'Repeat').props.onChange!({ target: { value: 'weekly' } });
      expect(field(third, 'Repeat')).toBeDefined();

      const fourth = harness.renderTree(fixture);
      expect(saveButton(fourth).props.label).toBe('Save todo');
      await saveButton(fourth).props.onClick();

      expect(mockedUpdateTodoAction).toHaveBeenCalledTimes(1);
      const [, patch] = mockedUpdateTodoAction.mock.calls[0];
      expect(patch.dueDate).toBe('2026-10-05T09:30');
      expect(patch.repeat).toBe('weekly');
    } finally {
      harness.restore();
    }
  });

  it('a repeat with no due date is unreachable, so a title alone saves', async () => {
    const titleOnly = todo({ dueDate: null, repeat: null, version: 3 });
    const harness = stateHarness();
    try {
      const first = harness.renderTree(titleOnly);
      // No due ⇒ no Repeat field, so the repeat-requires-due state cannot be reached.
      expect(field(first, 'Repeat')).toBeUndefined();
      expect(saveButton(first).props.disabled).toBe(false);

      inputByLabel(first, 'Todo title').props.onChange!({ target: { value: 'Plain task' } });
      const second = harness.renderTree(titleOnly);
      expect(saveButton(second).props.disabled).toBe(false);
      await saveButton(second).props.onClick();

      expect(mockedUpdateTodoAction).toHaveBeenCalledTimes(1);
      const [, patch] = mockedUpdateTodoAction.mock.calls[0];
      expect(patch.dueDate).toBeNull();
      expect(patch.repeat).toBeNull();
    } finally {
      harness.restore();
    }
  });
});

describe('TodoEditor custom repeat', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers a Custom option and opening it does not commit the repeat', () => {
    const fixture = todo({ dueDate: '2026-10-01', repeat: null, version: 3 });
    const harness = stateHarness();
    try {
      const first = harness.renderTree(fixture);
      const select = selectByLabel(first, 'Repeat');
      const options = select.props.options as Array<{ value: string; label: string }>;
      expect(options.some((option) => option.value === 'custom')).toBe(true);
      expect(options.find((option) => option.value === 'custom')?.label).toBe('Custom…');
      expect(select.props.value).toBe('');

      select.props.onChange!({ target: { value: 'custom' } });

      const second = harness.renderTree(fixture);
      // The controlled Select snaps back to the committed value; opening the modal
      // is not a commit.
      expect(selectByLabel(second, 'Repeat').props.value).toBe('');
      expect(findByType(second.props.children, RecurrenceDialog)?.props.open).toBe(true);
    } finally {
      harness.restore();
    }
  });

  it('confirms the days and saves custom + repeatDays', async () => {
    const fixture = todo({ dueDate: '2026-10-01', repeat: null, version: 3 });
    const harness = stateHarness();
    try {
      const first = harness.renderTree(fixture);
      selectByLabel(first, 'Repeat').props.onChange!({ target: { value: 'custom' } });

      const opened = harness.renderTree(fixture);
      const dialog = findByType(opened.props.children, RecurrenceDialog);
      expect(dialog?.props.open).toBe(true);
      (dialog!.props.onConfirm as (days: number[]) => void)([4, 5]);
      // The dialog's Confirm button pairs onConfirm with onOpenChange(false).
      (dialog!.props.onOpenChange as (open: boolean) => void)(false);

      const confirmed = harness.renderTree(fixture);
      const options = selectByLabel(confirmed, 'Repeat').props.options as Array<{
        value: string;
        label: string;
      }>;
      expect(options.find((option) => option.value === 'custom')?.label).toBe('Custom (Thu, Fri)');
      expect(findByType(confirmed.props.children, RecurrenceDialog)?.props.open).toBe(false);

      await saveButton(confirmed).props.onClick();

      expect(mockedUpdateTodoAction).toHaveBeenCalledTimes(1);
      const [, patch] = mockedUpdateTodoAction.mock.calls[0];
      expect(patch.repeat).toBe('custom');
      expect(patch.repeatDays).toEqual([4, 5]);
    } finally {
      harness.restore();
    }
  });

  it('clearing the due resets repeatDays and closes the dialog', async () => {
    const fixture = todo({ dueDate: '2026-10-01', repeat: null, version: 3 });
    const harness = stateHarness();
    try {
      const first = harness.renderTree(fixture);
      selectByLabel(first, 'Repeat').props.onChange!({ target: { value: 'custom' } });
      const opened = harness.renderTree(fixture);
      (findByType(opened.props.children, RecurrenceDialog)!.props.onConfirm as (days: number[]) => void)([4, 5]);

      const confirmed = harness.renderTree(fixture);
      expect(selectByLabel(confirmed, 'Repeat').props.value).toBe('custom');

      inputByLabel(confirmed, 'Due date').props.onChange!({ target: { value: '' } });
      const cleared = harness.renderTree(fixture);
      expect(findByType(cleared.props.children, RecurrenceDialog)?.props.open).toBe(false);
      // `value` is `repeatDays`, so the reset to [] is observable at the boundary.
      expect(findByType(cleared.props.children, RecurrenceDialog)?.props.value).toEqual([]);

      // Time/Repeat fields are gone, so the save carries neither repeat nor days.
      await saveButton(cleared).props.onClick();
      const [, patch] = mockedUpdateTodoAction.mock.calls[0];
      expect(patch.repeat).toBeNull();
      expect(patch.repeatDays).toBeUndefined();
    } finally {
      harness.restore();
    }
  });

  it('seeds repeatDays from a saved custom todo', () => {
    const fixture = todo({ dueDate: '2026-10-01', repeat: 'custom', repeatDays: [4, 5], version: 3 });
    const harness = stateHarness();
    try {
      const tree = harness.renderTree(fixture);
      expect(selectByLabel(tree, 'Repeat').props.value).toBe('custom');
      expect(findByType(tree.props.children, RecurrenceDialog)?.props.value).toEqual([4, 5]);
    } finally {
      harness.restore();
    }
  });

  it('Cancel is a no-op: closing the dialog without confirming commits nothing', async () => {
    const fixture = todo({ dueDate: '2026-10-01', repeat: null, version: 3 });
    const harness = stateHarness();
    try {
      const first = harness.renderTree(fixture);
      expect(selectByLabel(first, 'Repeat').props.value).toBe('');
      selectByLabel(first, 'Repeat').props.onChange!({ target: { value: 'custom' } });

      const opened = harness.renderTree(fixture);
      // Opening is uncommitted: the controlled Select still shows the saved value.
      expect(selectByLabel(opened, 'Repeat').props.value).toBe('');
      const dialog = findByType(opened.props.children, RecurrenceDialog);
      expect(dialog?.props.open).toBe(true);

      // Cancel/Escape/backdrop all funnel to onOpenChange(false) with no onConfirm.
      (dialog!.props.onOpenChange as (open: boolean) => void)(false);

      const cancelled = harness.renderTree(fixture);
      expect(findByType(cancelled.props.children, RecurrenceDialog)?.props.open).toBe(false);
      expect(selectByLabel(cancelled, 'Repeat').props.value).toBe('');

      await saveButton(cancelled).props.onClick();

      expect(mockedUpdateTodoAction).toHaveBeenCalledTimes(1);
      const [, patch] = mockedUpdateTodoAction.mock.calls[0];
      expect(patch.repeat).toBeNull();
      expect(patch.repeatDays).toBeUndefined();
    } finally {
      harness.restore();
    }
  });
});

describe('TodoEditor screen shape', () => {
  beforeEach(() => jest.clearAllMocks());

  it('no longer renders a due-date strip above the fields', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree(todo({ dueDate: '2026-10-02' }));
      expect(findByType(tree.props.children, DueDatePill)).toBeUndefined();
    } finally {
      harness.restore();
    }
  });

  it('orders the fields Title, Note, Due date, Time, Repeat, List, Important', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree(todo({ dueDate: '2026-10-05' }));
      const captions = (tree.props.children as unknown as Array<ReactElement<{ label: string }>>)
        .filter((child) => child.type === Field)
        .map((child) => child.props.label);
      expect(captions).toEqual([
        'Title',
        'Note',
        'Due date',
        'Time',
        'Repeat',
        'List',
        'Important',
      ]);
    } finally {
      harness.restore();
    }
  });

  it('offers the Task actions menu with an immediate Move to trash in edit mode', async () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree(todo());
      const menu = findByType(tree.props.actions, Menu);
      expect(menu).toBeDefined();
      expect(menu!.props.label).toBe('Task actions');

      const trash = findByType(menu!.props.children, Button);
      expect(trash!.props.children).toBe('Move to trash');

      await (trash!.props.onClick as () => Promise<void>)();

      expect(mockedDeleteTodoAction).toHaveBeenCalledWith('t1');
      expect(mockBack).toHaveBeenCalledTimes(1);
      // No confirmation step: the delete is the press.
      expect(mockedUpdateTodoAction).not.toHaveBeenCalled();
    } finally {
      harness.restore();
    }
  });

  it('renders no Task actions menu in create mode', () => {
    const harness = stateHarness();
    try {
      const tree = harness.renderTree(undefined);
      expect(findByType(tree.props.actions, Menu)).toBeUndefined();
    } finally {
      harness.restore();
    }
  });
});
