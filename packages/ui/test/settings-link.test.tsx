import { render, screen } from '@testing-library/react';
import { SettingsLink } from '../src/components/settings-link';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('SettingsLink', () => {
  it('keeps the accessible name verbatim and links to the resolved settings href', () => {
    render(<SettingsLink href="/todos/settings" />);

    const link = screen.getByRole('link', { name: 'Settings' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('aria-label')).toBe('Settings');
    expect(link.getAttribute('href')).toBe('/todos/settings');
  });

  it('renders the bare control: no frame, no fill, the tap target kept', () => {
    render(<SettingsLink href="/todos/settings" />);

    const classes = classesOf(screen.getByRole('link'));
    expect(classes).toContain('ui-icon-link');
    expect(classes).toContain('ui-icon-link--bare');
    expect(classes).not.toContain('ui-icon-link--framed');
    expect(classes).not.toContain('bg-surface');
    expect(classes).not.toContain('border-line');
    expect(classes).toContain('size-[var(--tap)]');
  });

  it('marks the sliders glyph decorative, so the label is the whole accessible name', () => {
    const { container } = render(<SettingsLink href="/todos/settings" />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(screen.getByRole('link').textContent).toBe('');
  });

  it('merges className instead of replacing the control classes', () => {
    render(<SettingsLink href="/todos/settings" className="legacy-hook" />);

    const link = screen.getByRole('link');
    expect(classesOf(link)).toContain('legacy-hook');
    expect(link.classList.contains('ui-icon-link')).toBe(true);
    expect(link.classList.contains('ui-icon-link--bare')).toBe(true);
  });
});
