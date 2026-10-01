import { fireEvent, render, screen } from '@testing-library/react';
import { ListManager, type TodoListOption } from '../src/components/list-manager';

const LISTS: TodoListOption[] = [
  { id: 'l1', name: 'Groceries' },
  { id: 'l2', name: 'Work' },
];

function setup(disabled = false) {
  const onCreate = jest.fn();
  const onRename = jest.fn();
  const onDelete = jest.fn();
  render(
    <ListManager
      lists={LISTS}
      onCreate={onCreate}
      onRename={onRename}
      onDelete={onDelete}
      disabled={disabled}
    />,
  );
  return { onCreate, onRename, onDelete };
}

describe('ListManager', () => {
  it('lists every todo list with a rename and delete affordance', () => {
    setup();
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(screen.getByText('Work')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename list Groceries' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete list Groceries' })).toBeTruthy();
  });

  it('creates a trimmed list name and clears the draft', () => {
    const { onCreate } = setup();
    const input = screen.getByLabelText('New list') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Errands  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add list' }));
    expect(onCreate).toHaveBeenCalledWith('Errands');
    expect(input.value).toBe('');
  });

  it('never creates from an empty or whitespace-only name', () => {
    const { onCreate } = setup();
    fireEvent.change(screen.getByLabelText('New list'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add list' }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('renames a list by string id and exits edit on save', () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Rename list Groceries' }));
    const input = screen.getByLabelText('Rename list Groceries') as HTMLInputElement;
    expect(input.value).toBe('Groceries');
    fireEvent.change(input, { target: { value: 'Market' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).toHaveBeenCalledWith('l1', 'Market');
    expect(screen.queryByRole('textbox', { name: 'Rename list Groceries' })).toBeNull();
  });

  it('never renames to an empty or whitespace-only name', () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Rename list Work' }));
    fireEvent.change(screen.getByLabelText('Rename list Work'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Rename list Work')).toBeTruthy();
  });

  it('cancels an inline rename without calling onRename', () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Rename list Work' }));
    fireEvent.change(screen.getByLabelText('Rename list Work'), { target: { value: 'Job' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRename).not.toHaveBeenCalled();
  });

  it('deletes by string id', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete list Work' }));
    expect(onDelete).toHaveBeenCalledWith('l2');
  });

  it('passes a long list name through verbatim (trimmed)', () => {
    const { onCreate } = setup();
    fireEvent.change(screen.getByLabelText('New list'), {
      target: { value: ` ${'z'.repeat(300)} ` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add list' }));
    expect(onCreate).toHaveBeenCalledWith('z'.repeat(300));
  });

  it('honours the disabled flag on every control', () => {
    setup(true);
    expect((screen.getByRole('button', { name: 'Add list' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Rename list Work' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Delete list Work' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(
      <ListManager
        lists={LISTS}
        onCreate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        className="legacy-hook"
      />,
    );
    expect(document.querySelector('.ui-list-manager')!.classList.contains('legacy-hook')).toBe(true);
  });

  it('calls rowExtra once per list and renders each node in its own row', () => {
    const rowExtra = jest.fn((list: TodoListOption) => <span>extra-{list.id}</span>);
    render(
      <ListManager
        lists={LISTS}
        onCreate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        rowExtra={rowExtra}
      />,
    );
    expect(rowExtra).toHaveBeenCalledTimes(2);
    expect(rowExtra).toHaveBeenCalledWith(LISTS[0]);
    expect(rowExtra).toHaveBeenCalledWith(LISTS[1]);
    const rows = document.querySelectorAll('.ui-list-manager__row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Groceries');
    expect(rows[0].textContent).toContain('extra-l1');
    expect(rows[1].textContent).toContain('Work');
    expect(rows[1].textContent).toContain('extra-l2');
  });

  it('renders the existing rows unchanged when rowExtra is omitted', () => {
    setup();
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(screen.getByText('Work')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename list Groceries' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete list Groceries' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename list Work' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete list Work' })).toBeTruthy();
  });
});
