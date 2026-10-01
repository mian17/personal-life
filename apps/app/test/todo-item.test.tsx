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
