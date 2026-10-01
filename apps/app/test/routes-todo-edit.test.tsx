import type { ReactElement } from 'react';
import type { List, Todo } from '@life/shared';
import { Switch, type SwitchProps, type TagOption } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    const error = new Error('NEXT_NOT_FOUND');
    (error as { digest?: string }).digest = 'NEXT_NOT_FOUND';
    throw error;
  }),
  useRouter: () => ({
    back: jest.fn(),
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
}));

import { notFound } from 'next/navigation';
import { getTodo, listLists } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { createTodoAction, updateTodoAction } from '@/app/todo-actions';
import EditTodoPage from '@/app/todos/[id]/edit/page';
import { TodoEditor } from '@/app/todo-editor';

const mockedGetTodo = getTodo as jest.MockedFunction<typeof getTodo>;
const mockedListLists = listLists as jest.MockedFunction<typeof listLists>;
const mockedListTags = listTags as jest.MockedFunction<typeof listTags>;
const mockedNotFound = notFound as jest.MockedFunction<typeof notFound>;
const mockedCreateTodoAction = createTodoAction as jest.MockedFunction<typeof createTodoAction>;
const mockedUpdateTodoAction = updateTodoAction as jest.MockedFunction<typeof updateTodoAction>;

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: 'Buy milk',
    note: 'two litres',
    done: false,
    important: null,
    effectiveImportant: false,
    dueDate: '2026-10-02',
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
    actions: ReactElement<{ onClick: () => void; label?: string }>;
  };
}

interface EditorField extends ReactElement {
  props: {
    'aria-label'?: string;
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

function switchOf(tree: EditorTree): ReactElement<SwitchProps> {
  const found = tree.props.children.find((child) => child.type === Switch);
  if (!found) throw new Error('no Switch rendered in the todo editor');
  return found as ReactElement<SwitchProps>;
}

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
    it('saves the toggled explicit override through updateTodoAction', () => {
      const fixture = todo({ important: true, effectiveImportant: true, version: 3 });
      const harness = stateHarness();
      try {
        const first = switchOf(harness.renderTree(fixture));
        expect(first.props.checked).toBe(true);

        first.props.onCheckedChange!(false);

        const second = harness.renderTree(fixture);
        expect(second.props.actions.props.label).toBe('Save todo');
        second.props.actions.props.onClick();

        expect(mockedUpdateTodoAction).toHaveBeenCalledTimes(1);
        const [id, patch, version] = mockedUpdateTodoAction.mock.calls[0];
        expect(id).toBe('t1');
        expect(version).toBe(3);
        expect(patch).toEqual({
          title: 'Buy milk',
          note: 'two litres',
          dueDate: '2026-10-02',
          listId: 'l1',
          tagIds: [7],
          important: false,
        });
      } finally {
        harness.restore();
      }
    });

    it('creates with the toggled explicit override through createTodoAction', () => {
      const harness = stateHarness();
      try {
        const first = switchOf(harness.renderTree(undefined));
        expect(first.props.checked).toBe(false);

        first.props.onCheckedChange!(true);
        const titleInput = harness
          .renderTree(undefined)
          .props.children.find((child) => child.props['aria-label'] === 'Todo title');
        titleInput!.props.onChange!({ target: { value: 'New task' } });

        const second = harness.renderTree(undefined);
        expect(second.props.actions.props.label).toBe('Add todo');
        second.props.actions.props.onClick();

        expect(mockedCreateTodoAction).toHaveBeenCalledTimes(1);
        const [input] = mockedCreateTodoAction.mock.calls[0];
        expect(input).toEqual({
          title: 'New task',
          note: undefined,
          dueDate: undefined,
          listId: undefined,
          tagIds: [],
          important: true,
        });
      } finally {
        harness.restore();
      }
    });
  });
});

