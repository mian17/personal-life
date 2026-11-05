import { fireEvent, render, screen } from '@testing-library/react';
import { TagManager } from '../src/components/tag-manager';
import type { TagOption } from '../src/components/tag-combobox';

const TAGS: TagOption[] = [
  { id: 1, name: 'errand' },
  { id: 2, name: 'home' },
];

function setup(disabled = false) {
  const onCreate = jest.fn();
  const onRename = jest.fn();
  const onDelete = jest.fn();
  render(
    <TagManager
      tags={TAGS}
      onCreate={onCreate}
      onRename={onRename}
      onDelete={onDelete}
      disabled={disabled}
    />,
  );
  return { onCreate, onRename, onDelete };
}

/**
 * The registry trigger opens on a primary press, so a click alone would never reach it. jsdom ships
 * no `PointerEvent`, hence the mouse event carrying that type.
 */
const openMenu = (name: string) =>
  fireEvent(
    screen.getByRole('button', { name: `Actions for ${name}` }),
    new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
  );

describe('TagManager', () => {
  it('lists every tag with a rename and delete affordance', () => {
    setup();
    expect(screen.getByText('errand')).toBeTruthy();
    expect(screen.getByText('home')).toBeTruthy();
    openMenu('errand');
    expect(screen.getByRole('button', { name: 'Rename tag errand' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete tag errand' })).toBeTruthy();
  });

  it('creates a trimmed tag name and clears the draft', () => {
    const { onCreate } = setup();
    const input = screen.getByLabelText('New tag') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  work  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(onCreate).toHaveBeenCalledWith('work');
    expect(input.value).toBe('');
  });

  it('never creates from an empty or whitespace-only name', () => {
    const { onCreate } = setup();
    fireEvent.change(screen.getByLabelText('New tag'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('renames a tag through inline edit and exits edit on save', () => {
    const { onRename } = setup();
    openMenu('errand');
    fireEvent.click(screen.getByRole('button', { name: 'Rename tag errand' }));
    expect(screen.queryByRole('menu')).toBeNull();
    const input = screen.getByLabelText('Rename tag errand') as HTMLInputElement;
    expect(input.value).toBe('errand');
    fireEvent.change(input, { target: { value: 'errands' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).toHaveBeenCalledWith(1, 'errands');
    expect(screen.queryByRole('textbox', { name: 'Rename tag errand' })).toBeNull();
  });

  it('saves an inline rename on Enter', () => {
    const { onRename } = setup();
    openMenu('home');
    fireEvent.click(screen.getByRole('button', { name: 'Rename tag home' }));
    const input = screen.getByLabelText('Rename tag home');
    fireEvent.change(input, { target: { value: 'house' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(2, 'house');
  });

  it('never renames to an empty or whitespace-only name and keeps editing', () => {
    const { onRename } = setup();
    openMenu('errand');
    fireEvent.click(screen.getByRole('button', { name: 'Rename tag errand' }));
    const input = screen.getByLabelText('Rename tag errand') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Rename tag errand')).toBeTruthy();
  });

  it('cancels an inline rename without calling onRename', () => {
    const { onRename } = setup();
    openMenu('errand');
    fireEvent.click(screen.getByRole('button', { name: 'Rename tag errand' }));
    fireEvent.change(screen.getByLabelText('Rename tag errand'), { target: { value: 'other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Rename tag errand' })).toBeNull();
  });

  it('deletes by id through the labelled affordance and closes the menu', () => {
    const { onDelete } = setup();
    openMenu('home');
    fireEvent.click(screen.getByRole('button', { name: 'Delete tag home' }));
    expect(onDelete).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('passes a long rename through verbatim (trimmed)', () => {
    const { onRename } = setup();
    openMenu('errand');
    fireEvent.click(screen.getByRole('button', { name: 'Rename tag errand' }));
    fireEvent.change(screen.getByLabelText('Rename tag errand'), {
      target: { value: `  ${'y'.repeat(300)}  ` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).toHaveBeenCalledWith(1, 'y'.repeat(300));
  });

  it('honours the disabled flag on the trigger', () => {
    setup(true);
    expect((screen.getByRole('button', { name: 'Add tag' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Actions for errand' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('separates tag rows with one flush hairline, closing the shared list gap', () => {
    setup();

    const manager = document.querySelector('.ui-tag-manager')!;
    expect(manager.classList.contains('[&>ul]:gap-0')).toBe(true);
    expect(manager.classList.contains('[&>ul>*+*]:border-t')).toBe(true);
    expect(manager.classList.contains('[&>ul>*+*]:border-line')).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(
      <TagManager
        tags={TAGS}
        onCreate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        className="legacy-hook"
      />,
    );
    expect(document.querySelector('.ui-tag-manager')!.classList.contains('legacy-hook')).toBe(true);
  });
});
