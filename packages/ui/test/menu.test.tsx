import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Menu } from '../src/components/menu';

/**
 * The registry trigger opens on a primary press, so a click alone would never reach it. jsdom
 * ships no `PointerEvent`, hence the mouse event carrying that type — it has the `button` the
 * trigger reads and nothing else the trigger needs.
 */
function press(node: HTMLElement) {
  fireEvent(node, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
}

const trigger = () => screen.getByRole('button', { name: 'Actions for Groceries' });

/** Radix attaches its outside-press listener a tick after the panel mounts. */
async function settleDismissLayer() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

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
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the panel on a primary press of the trigger', () => {
    render(<Harness />);
    press(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on Escape', () => {
    render(<Harness />);
    press(trigger());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on an outside press', async () => {
    render(<Harness />);
    press(trigger());
    await settleDismissLayer();
    press(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not close on a press inside the menu', () => {
    render(<Harness />);
    press(trigger());
    press(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('disables the trigger', () => {
    render(<Harness disabled />);
    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
  });
});
