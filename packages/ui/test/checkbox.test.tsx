import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { Checkbox } from '../src/components/checkbox';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Checkbox', () => {
  it('renders an aria-hidden span with the base class, unchecked by default', () => {
    const { container } = render(<Checkbox />);
    const box = container.querySelector('.ui-checkbox')!;
    expect(box.tagName).toBe('SPAN');
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(classesOf(box)).toEqual(['ui-checkbox']);
    expect(container.querySelector('.ui-checkbox__glyph')).not.toBeNull();
  });

  it('adds the checked modifier when checked', () => {
    const { container } = render(<Checkbox checked />);
    const box = container.querySelector('.ui-checkbox')!;
    expect(classesOf(box)).toEqual(['ui-checkbox', 'ui-checkbox--checked']);
  });

  it('merges className instead of replacing it', () => {
    const { container } = render(<Checkbox className="legacy-hook" />);
    const box = container.querySelector('.ui-checkbox')!;
    expect(classesOf(box)).toEqual(['legacy-hook', 'ui-checkbox']);
  });

  it('sizes and rounds the square through tokens', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'atoms.css'), 'utf8');
    const block = (selector: string) =>
      (css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) ??
        [])[1] ?? '';

    const box = block('.ui-checkbox');
    for (const dimension of ['width', 'height']) {
      const value = box.match(new RegExp(`${dimension}:\\s*([^;]+);`))?.[1] ?? '';
      expect(value).toMatch(/var\(--space-0-75\)/);
      expect(value).not.toMatch(/var\(--leading\)/);
    }
    expect(box).toMatch(/border-radius:\s*var\(--space-0-2\)/);
    expect(box).not.toMatch(/\d+(px|rem)/);
  });
});
