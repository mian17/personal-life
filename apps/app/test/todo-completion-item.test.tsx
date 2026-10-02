import type { TodoCompletion } from '@life/shared';
import { dueDateLabel } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompletionItem } from '../app/todo-completion-item';

const TODAY = '2026-10-02';
const COMPLETED_AT = '2026-10-02T09:30:00.000Z';

function completion(overrides: Partial<TodoCompletion> = {}): TodoCompletion {
  return {
    id: 'c1',
    todoId: 't1',
    occurrence: '2026-10-01',
    completedAt: COMPLETED_AT,
    title: 'Water plants',
    listId: 'l1',
    listName: 'Home',
    ...overrides,
  };
}

describe('CompletionItem', () => {
  it('renders a PLAIN read-only completion row (title, edit link, date, list)', () => {
    const html = renderToStaticMarkup(<CompletionItem completion={completion()} today={TODAY} />);

    expect(html).toContain('Water plants');
    expect(html).toContain('href="/todos/t1/edit"');
    expect(html).toContain(dueDateLabel(COMPLETED_AT, TODAY));
    expect(html).toContain('Home');
  });

  it('carries no strike, toggle, checkbox, trash or form', () => {
    const html = renderToStaticMarkup(<CompletionItem completion={completion()} today={TODAY} />);

    expect(html).not.toContain('ui-list-item--done');
    expect(html).not.toContain('ui-list-item--todo');
    expect(html).not.toContain('ui-checkbox');
    expect(html).not.toContain('ui-btn--danger');
    expect(html).not.toContain('<form');
  });

  it('omits the list meta when the completion is unlisted', () => {
    const html = renderToStaticMarkup(
      <CompletionItem completion={completion({ listName: null })} today={TODAY} />,
    );

    expect(html).not.toContain('Home');
  });
});
