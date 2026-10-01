import type { Todo } from '@life/shared';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('../app/todo-actions', () => ({
  updateTodoAction: jest.fn(),
  deleteTodoAction: jest.fn(),
}));

import { TodoItem } from '../app/todo-item';

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

function markup(mode?: 'default' | 'matrix'): string {
  return renderToStaticMarkup(
    <TodoItem
      todo={todo()}
      today={TODAY}
      lists={lists}
      availableTags={[]}
      mode={mode}
    />,
  );
}

describe('TodoItem modes', () => {
  it('matrix: the done toggle LEADS the row, borderless', () => {
    const html = markup('matrix');
    // First child after the <li> open tag is the toggle button.
    expect(html).toMatch(/<li[^>]*ui-list-item[^>]*>\s*<button[^>]*aria-label="Mark Buy milk done"/);
    expect(html).toContain('ui-icon-btn--ghost');
    expect(html).toMatch(/<a[^>]*class="ui-list-item__link"[^>]*href="\/todos\/t1\/edit"/);
  });

  it('matrix: no delete action, no list name, no note — only the due label', () => {
    const html = markup('matrix');
    expect(html).toContain('>Today<');
    expect(html).not.toContain('ui-btn--danger');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('ui-list-item__snippet');
    expect(html).not.toContain('Groceries');
    expect(html).not.toContain('a note snippet');
  });

  it('matrix: the row is dense and still links to the edit screen', () => {
    const html = markup('matrix');
    expect(html).toContain('ui-list-item--dense');
    expect(html).toContain('href="/todos/t1/edit"');
  });

  it('default: bordered trailing toggle, delete action, list name and note kept', () => {
    const html = markup();
    // No leading control: the row body link is the first child.
    expect(html).toMatch(/<li[^>]*ui-list-item[^>]*>\s*<a[^>]*class="ui-list-item__link"/);
    expect(html).not.toContain('ui-list-item--dense');
    expect(html).not.toMatch(/ui-icon-btn ui-icon-btn--ghost/);

    expect(html).toContain('<form');
    expect(html).toMatch(/ui-btn ui-btn--danger/);
    expect(html).toContain('aria-label="Delete Buy milk"');
    expect(html).toContain('Groceries');
    expect(html).toContain('ui-list-item__snippet');
    expect(html).toContain('a note snippet');
  });
});
