import { fireEvent, render, screen } from '@testing-library/react';
import { Checkbox } from '../src/components/checkbox';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Checkbox', () => {
  it('renders the registry root as a checkbox control, unchecked by default', () => {
    render(<Checkbox />);
    const box = screen.getByRole('checkbox');
    expect(box.tagName).toBe('BUTTON');
    expect(box.getAttribute('type')).toBe('button');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(box.classList.contains('ui-checkbox')).toBe(true);
    expect(box.classList.contains('ui-checkbox--checked')).toBe(false);
    // The registry indicator is presence-driven: an unchecked box draws no glyph.
    expect(box.querySelector('.ui-checkbox__glyph')).toBeNull();
  });

  it('adds the checked modifier and the checked root state when checked', () => {
    render(<Checkbox checked />);
    const box = screen.getByRole('checkbox');
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(box.getAttribute('data-state')).toBe('checked');
    expect(box.classList.contains('ui-checkbox--checked')).toBe(true);
    expect(box.classList.contains('data-[state=checked]:bg-current')).toBe(true);
    expect(box.querySelector('.ui-checkbox__glyph')).not.toBeNull();
  });

  it('carries its accessible name from label as aria-label', () => {
    render(<Checkbox label="Mark Buy milk done" />);
    expect(screen.getByRole('checkbox').getAttribute('aria-label')).toBe('Mark Buy milk done');
  });

  it('merges className instead of replacing it', () => {
    render(<Checkbox className="legacy-hook" />);
    const box = screen.getByRole('checkbox');
    expect(box.classList.contains('legacy-hook')).toBe(true);
    expect(box.classList.contains('ui-checkbox')).toBe(true);
  });

  it('reports the user toggle through onCheckedChange, not through its own state', () => {
    const onCheckedChange = jest.fn();
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('sizes and rounds the square through the checkbox-size token, not the line height', () => {
    render(<Checkbox />);
    const classes = classesOf(screen.getByRole('checkbox'));
    const sizing = classes.filter((name) => name.startsWith('size-['));
    expect(sizing).toHaveLength(1);
    expect(sizing[0]).toMatch(/var\(--checkbox-size,\s*var\(--space-0-75\)\)/);
    expect(classes).not.toContain('size-[var(--leading)]');
    expect(classes).toContain('rounded-[var(--space-0-2)]');
    // Inherits the row's colour, so a tone on the leading control tints the square.
    expect(classes).toContain('border-current');
  });
});
