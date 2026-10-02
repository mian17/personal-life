import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Menu } from '../src/components/menu';

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Menu
        label="Actions for Groceries"
        summary="Groceries"
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
      >
        <button type="button">Rename</button>
      </Menu>
      <button type="button">Outside</button>
    </div>
  );
}

describe('Menu', () => {
  it('renders the summary and a closed trigger', () => {
    render(<Harness />);
    expect(screen.getByText('Groceries')).toBeTruthy();
    const trigger = screen.getByRole('button', { name: 'Actions for Groceries' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the panel on trigger click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Groceries' }));
    expect(
      screen.getByRole('button', { name: 'Actions for Groceries' }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on Escape', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Groceries' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on an outside pointerdown', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Groceries' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not close on a pointerdown inside the menu', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Groceries' }));
    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('disables the trigger', () => {
    render(<Harness disabled />);
    expect(
      (screen.getByRole('button', { name: 'Actions for Groceries' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
