import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FabMenu } from '../src/components/fab-menu';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <FabMenu
        label="Log a meal"
        icon={<span data-testid="trigger-icon" />}
        open={open}
        onOpenChange={setOpen}
      >
        <a role="menuitem" href="/meals/entry/new?door=photo">
          Log meal from photo
        </a>
        <a role="menuitem" href="/meals/entry/new?door=food">
          Log food
        </a>
      </FabMenu>
      <button type="button">Outside</button>
    </div>
  );
}

describe('FabMenu', () => {
  it('renders a closed trigger with menu semantics', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Log a meal' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.contains(screen.getByTestId('trigger-icon'))).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the panel on trigger click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Log a meal' }));
    const trigger = screen.getByRole('button', { name: 'Log a meal' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on Escape', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Log a meal' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on an outside pointerdown', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Log a meal' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the panel open on a pointerdown inside it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Log a meal' }));
    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('reveals its options as links with their destinations', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Log a meal' }));
    const photoOption = screen.getByRole('menuitem', { name: 'Log meal from photo' });
    const foodOption = screen.getByRole('menuitem', { name: 'Log food' });
    expect(photoOption.getAttribute('href')).toBe('/meals/entry/new?door=photo');
    expect(foodOption.getAttribute('href')).toBe('/meals/entry/new?door=food');
  });
});
