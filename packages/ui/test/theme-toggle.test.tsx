import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from '../src/components/theme-toggle';

/** The pressed option's visible label — the group's whole contract in one read. */
function pressedOption(): string | undefined {
  return screen
    .getAllByRole('button')
    .find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent ?? undefined;
}

function option(label: string): HTMLElement {
  return screen.getByRole('button', { name: label });
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('renders the three appearance choices as one pressed group', () => {
    render(<ThemeToggle />);

    expect(screen.getByRole('group', { name: 'Appearance' })).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Light',
      'Dark',
      'System',
    ]);
    expect(pressedOption()).toBe('System');
    expect(option('System').classList.contains('ui-seg__btn--active')).toBe(true);
    expect(option('Light').classList.contains('ui-seg__btn--active')).toBe(false);
  });

  it('applies the picked scheme to the document and moves the pressed state with it', () => {
    render(<ThemeToggle />);

    fireEvent.click(option('Dark'));
    expect(pressedOption()).toBe('Dark');
    expect(window.localStorage.getItem('calm-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    fireEvent.click(option('Light'));
    expect(pressedOption()).toBe('Light');
    expect(window.localStorage.getItem('calm-theme')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('clears the document choice under System, leaving the System preference stored', () => {
    window.localStorage.setItem('calm-theme', 'dark');
    render(<ThemeToggle />);
    expect(pressedOption()).toBe('Dark');

    fireEvent.click(option('System'));
    expect(pressedOption()).toBe('System');
    expect(window.localStorage.getItem('calm-theme')).toBe('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('reads a stored theme on mount without applying it to the document', () => {
    window.localStorage.setItem('calm-theme', 'dark');
    render(<ThemeToggle />);

    expect(pressedOption()).toBe('Dark');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('ignores an unrecognized stored value', () => {
    window.localStorage.setItem('calm-theme', 'sepia');
    render(<ThemeToggle />);

    expect(pressedOption()).toBe('System');
  });

  it('fills the pressed option with the accent and leaves the others transparent', () => {
    render(<ThemeToggle />);

    expect(option('System').classList.contains('bg-max')).toBe(true);
    expect(option('System').classList.contains('bg-transparent')).toBe(false);
    expect(option('Light').classList.contains('bg-transparent')).toBe(true);
    expect(option('Light').classList.contains('bg-max')).toBe(false);
  });

  it('merges a passthrough className onto the group', () => {
    render(<ThemeToggle className="legacy-hook" />);

    expect(screen.getByRole('group', { name: 'Appearance' }).classList.contains('legacy-hook')).toBe(
      true,
    );
  });

  it('drops the trough chrome and fills the row when laid into a settings group', () => {
    const { rerender } = render(<ThemeToggle />);
    const trough = screen.getByRole('group', { name: 'Appearance' });
    expect(trough.classList.contains('border')).toBe(true);
    expect(trough.classList.contains('bg-surface-sunken')).toBe(true);
    expect(trough.classList.contains('w-full')).toBe(false);

    rerender(<ThemeToggle inGroup />);
    expect(trough.classList.contains('border')).toBe(false);
    expect(trough.classList.contains('bg-surface-sunken')).toBe(false);
    expect(trough.classList.contains('bg-transparent')).toBe(true);
    expect(trough.classList.contains('w-full')).toBe(true);
    expect(trough.classList.contains('rounded-none')).toBe(true);
  });
});
