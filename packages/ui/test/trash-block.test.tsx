import { render, screen } from '@testing-library/react';
import { TrashBlock, type TrashBlockProps } from '../src/components/trash-block';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

function makeProps(overrides: Partial<TrashBlockProps> = {}): TrashBlockProps {
  return {
    title: 'Trash',
    backHref: '/notes',
    items: [{ id: 'n1', title: 'Groceries' }],
    emptyMessage: 'Trash is empty.',
    restoreAction: () => jest.fn(),
    deleteForeverAction: () => jest.fn(),
    deleteForeverMessage: () => 'Delete this forever? This cannot be undone.',
    emptyTrashAction: jest.fn(),
    emptyTrashMessage: 'Empty trash? This cannot be undone.',
    ...overrides,
  };
}

describe('TrashBlock', () => {
  it('renders a non-empty trash: row title, restore label, trash-delete control, Empty Trash', () => {
    render(<TrashBlock {...makeProps({ items: [{ id: 'n1', title: 'Groceries' }] })} />);

    expect(screen.getByRole('listitem').textContent).toContain('Groceries');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Trash');
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/notes');

    const restore = screen.getByRole('button', { name: 'Restore Groceries' });
    expect(restore.getAttribute('type')).toBe('submit');
    expect(restore.textContent).toBe('Restore');
    expect(classesOf(restore)).toContain('trash-restore');

    const del = document.querySelector('.trash-delete')!;
    expect(del.tagName).toBe('BUTTON');
    expect(classesOf(del)).toContain('trash-delete');
    expect(classesOf(del)).toContain('ui-btn--danger');

    expect(screen.getByText('Empty Trash').tagName).toBe('BUTTON');
    expect(classesOf(screen.getByText('Empty Trash'))).toContain('trash-empty');
  });

  it('renders the empty state and no Empty Trash control when items is empty', () => {
    render(<TrashBlock {...makeProps({ items: [] })} />);

    expect(screen.getByText('Trash is empty.')).toBeTruthy();
    expect(screen.queryByText('Empty Trash')).toBeNull();
    expect(document.querySelector('.ui-page-actions')).toBeNull();
    expect(document.querySelector('.ui-list')).toBeNull();
  });

  it('draws the empty state on the page ground, keeping the reference hairline', () => {
    render(<TrashBlock {...makeProps({ items: [] })} />);

    const empty = document.querySelector('.ui-empty')!;
    expect(empty.classList.contains('bg-transparent!')).toBe(true);
    expect(empty.classList.contains('border-0!')).toBe(false);
    expect(empty.classList.contains('border')).toBe(true);
    expect(empty.classList.contains('border-line')).toBe(true);
  });

  it('omits meta and snippet from the DOM when undefined', () => {
    render(<TrashBlock {...makeProps({ items: [{ id: 'n1', title: 'Groceries' }] })} />);

    expect(document.querySelector('.ui-list-item__snippet')).toBeNull();
    expect(document.querySelector('.ui-list-item__sep')).toBeNull();
    expect(document.querySelector('.ui-list-item__sub')!.textContent).toBe('');
  });

  it('renders meta and snippet when supplied', () => {
    render(
      <TrashBlock
        {...makeProps({
          items: [
            {
              id: 'n1',
              title: 'Groceries',
              meta: <time dateTime="2026-10-01">01/10/2026</time>,
              snippet: 'milk and eggs',
            },
          ],
        })}
      />,
    );

    expect(document.querySelector('.ui-list-item__sub')!.contains(screen.getByText('01/10/2026'))).toBe(true);
    expect(screen.getByText('milk and eggs')).toBeTruthy();
  });

  it('binds each row action once per row, receiving that row id and item', () => {
    const restoreAction = jest.fn(() => jest.fn());
    const deleteForeverAction = jest.fn(() => jest.fn());
    const deleteForeverMessage = jest.fn(() => 'gone?');
    const items = [
      { id: 'n1', title: 'Groceries' },
      { id: 'n2', title: 'Milk' },
    ];

    render(
      <TrashBlock
        {...makeProps({ items, restoreAction, deleteForeverAction, deleteForeverMessage })}
      />,
    );

    expect(restoreAction.mock.calls).toEqual([['n1'], ['n2']]);
    expect(deleteForeverAction.mock.calls).toEqual([['n1'], ['n2']]);
    expect(deleteForeverMessage.mock.calls).toEqual([[items[0]], [items[1]]]);
    expect(document.querySelectorAll('form')).toHaveLength(5);
  });

  it('lets restoreLabel, emptyTrashLabel and backLabel overrides win', () => {
    render(
      <TrashBlock
        {...makeProps({
          items: [{ id: 'n1', title: 'Groceries' }],
          restoreLabel: 'Undo',
          emptyTrashLabel: 'Purge all',
          backLabel: 'Return',
        })}
      />,
    );

    expect(screen.getByRole('link', { name: 'Return' }).getAttribute('href')).toBe('/notes');
    expect(screen.getByRole('button', { name: 'Undo Groceries' }).textContent).toBe('Undo');
    expect(screen.getByText('Purge all').tagName).toBe('BUTTON');
    expect(screen.queryByText('Restore')).toBeNull();
    expect(screen.queryByText('Empty Trash')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
  });
});
