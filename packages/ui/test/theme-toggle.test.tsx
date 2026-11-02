import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from '../src/components/theme-toggle';

function currentIcon(button: HTMLElement): string | null {
  const svg = button.querySelector('svg');
  if (!svg) return null;
  return Array.from(svg.classList).find((cls) => cls.startsWith('lucide-') && cls !== 'lucide') ?? null;
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('starts on system and renders an IconButton with the frozen label', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button');
    expect(button.tagName).toBe('BUTTON');
    expect(button.classList.contains('ui-icon-btn')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Theme: System. Activate for Light.');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(currentIcon(button)).toBe('lucide-monitor');
  });

  it('cycles system → light → dark and back to system', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button');

    fireEvent.click(button);
    expect(button.getAttribute('aria-label')).toBe('Theme: Light. Activate for Dark.');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(currentIcon(button)).toBe('lucide-sun');
    expect(window.localStorage.getItem('calm-theme')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    fireEvent.click(button);
    expect(button.getAttribute('aria-label')).toBe('Theme: Dark. Activate for System.');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(currentIcon(button)).toBe('lucide-moon');
    expect(window.localStorage.getItem('calm-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    fireEvent.click(button);
    expect(button.getAttribute('aria-label')).toBe('Theme: System. Activate for Light.');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(currentIcon(button)).toBe('lucide-monitor');
    expect(window.localStorage.getItem('calm-theme')).toBe('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('reads a stored theme on mount without applying it to the document', () => {
    window.localStorage.setItem('calm-theme', 'dark');
    render(<ThemeToggle />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('Theme: Dark. Activate for System.');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(currentIcon(button)).toBe('lucide-moon');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('ignores an unrecognized stored value', () => {
    window.localStorage.setItem('calm-theme', 'sepia');
    render(<ThemeToggle />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe(
      'Theme: System. Activate for Light.',
    );
  });

  it('merges a passthrough className', () => {
    render(<ThemeToggle className="legacy-hook" />);
    expect(screen.getByRole('button').classList.contains('legacy-hook')).toBe(true);
  });
});
